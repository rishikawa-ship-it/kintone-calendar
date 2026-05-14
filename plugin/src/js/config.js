/**
 * config.js
 * KC Calendar プラグイン設定画面スクリプト (Phase 9: 2 階層設計対応)
 *
 * 保存形式 (version 2):
 *   {
 *     version: 2,
 *     fieldMapping: { fieldTitle, fieldStart, fieldEnd, ... },
 *     views: { "<viewId>": { calendarTitle, defaultView } }
 *   }
 *
 * 起動シーケンス:
 *   1. loadInitialConfig() で既存設定を取得・初期化
 *   2. loadFields() でフィールド一覧を取得し各プルダウンに反映
 *   3. loadViews() (refreshViewSelect + refreshPerViewSelect) でビュー一覧を取得
 *   4. orphan 削除 (kintone 上に存在しない views エントリを削除)
 *   5. applyFieldMapping() で共通設定を反映
 *   6. 先頭ビューを currentViewId に設定して applyViewConfig() で反映
 *
 * 保存処理:
 *   1. collectFieldMapping() で共通設定を収集
 *   2. collectViewConfig() で現在のビュー個別設定を収集
 *   3. orphan 削除 (最新ビュー一覧と照合)
 *   4. kintone.plugin.app.setConfig({ config: JSON.stringify(currentConfig) }) で保存
 *
 * setConfig / getConfig のキー規約:
 *   - setConfig({ config: JSON.stringify(currentConfig) }, callback) で保存
 *   - getConfig の返り値から rawConfig.config を取り出して JSON.parse する
 *   - rawConfig.config が存在しない場合は rawConfig 全体を試みる (後方互換)
 *
 * Phase 3 (desktop.js) への引き継ぎ事項:
 * - getConfig の返り値の .config キーを JSON.parse して使用する
 * - version が '2' でない場合は設定なしとして扱い detectFields フォールバック
 * - fieldMapping が共通設定、views[viewId] がビュー個別設定
 */
(function (PLUGIN_ID) {
  'use strict';

  /* ====================================================================
   * フィールド型フィルタ定義
   * ==================================================================== */

  /** タイトルフィールドとして選択可能な型 */
  var TITLE_FIELD_TYPES = ['SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT', 'NUMBER', 'CALC'];

  /** 開始/終了フィールドとして選択可能な型 */
  var DATE_FIELD_TYPES = ['DATETIME', 'DATE'];

  /** 終日フィールドとして選択可能な型 */
  var ALLDAY_FIELD_TYPES = ['CHECK_BOX'];

  /** 色フィールドとして選択可能な型 */
  var COLOR_FIELD_TYPES = ['SINGLE_LINE_TEXT', 'DROP_DOWN', 'RADIO_BUTTON'];

  /** 場所・氏名・メールとして選択可能な型 */
  var TEXT_FIELD_TYPES = ['SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT'];

  /** アカウントフィールドとして選択可能な型 */
  var ACCOUNT_FIELD_TYPES = ['USER_SELECT'];

  /** メモフィールドとして選択可能な型 */
  var MEMO_FIELD_TYPES = ['MULTI_LINE_TEXT', 'RICH_TEXT', 'SINGLE_LINE_TEXT'];

  /* ====================================================================
   * グローバル状態
   * ==================================================================== */

  /**
   * setConfig で保存する全体設定オブジェクト (version 2)
   * @type {{ version: number, fieldMapping: Object, views: Object }}
   */
  var currentConfig = {
    version: 2,
    fieldMapping: {},
    views: {}
  };

  /**
   * ビュー個別設定セクションで編集中のビュー ID (文字列)
   * @type {string|null}
   */
  var currentViewId = null;

  /**
   * GET /k/v1/app/views.json で取得した CUSTOM ビュー一覧
   * キー: ビュー名, 値: { id, name, type, index, ... }
   * @type {Object}
   */
  var availableViews = {};

  /* ====================================================================
   * DOM 要素参照
   * ==================================================================== */
  var elError = document.getElementById('kc-config-error');

  /* --- セクション 1: 共通設定 (フィールドマッピング) --- */
  var elFieldTitle = document.getElementById('kc-field-title');
  var elFieldStart = document.getElementById('kc-field-start');
  var elFieldEnd = document.getElementById('kc-field-end');
  var elFieldAllday = document.getElementById('kc-field-allday');
  var elFieldColor = document.getElementById('kc-field-color');
  var elFieldPlace = document.getElementById('kc-field-place');
  var elFieldUserName = document.getElementById('kc-field-username');
  var elFieldUserMail = document.getElementById('kc-field-usermail');
  var elFieldAccount = document.getElementById('kc-field-account');
  var elFieldMemo = document.getElementById('kc-field-memo');
  var elAlldayLabel = document.getElementById('kc-allday-label');

  /* --- セクション 2: ビュー個別設定 --- */
  var elPerViewSelect = document.getElementById('kc-per-view-select');
  var elPerViewLabel = document.getElementById('kc-per-view-label');
  var elPerViewFields = document.getElementById('kc-per-view-fields');
  var elPerViewGuide = document.getElementById('kc-per-view-guide');
  var elCopySection = document.getElementById('kc-copy-section');
  var elCopySource = document.getElementById('kc-copy-source');
  var elCopyExecute = document.getElementById('kc-copy-execute');
  var elCopyResult = document.getElementById('kc-copy-result');
  var elCalendarTitle = document.getElementById('kc-calendar-title');

  /* --- セクション 3: カレンダー用ビュー管理 (Phase 7) --- */
  var elViewTarget = document.getElementById('kc-view-target');
  var elViewNewName = document.getElementById('kc-view-new-name');
  var elViewNewNameField = document.getElementById('kc-view-new-name-field');
  var elViewApply = document.getElementById('kc-view-apply');
  var elViewStatus = document.getElementById('kc-view-status');

  /* --- 操作ボタン --- */
  var elSubmit = document.getElementById('kc-config-submit');
  var elCancel = document.getElementById('kc-config-cancel');

  /* ====================================================================
   * ユーティリティ関数
   * ==================================================================== */

  /**
   * エラーメッセージを表示する (XSS 対策: textContent 経由)
   * 成功表示クラスを除去してエラー表示クラスに切り替える。
   * @param {string} message - 表示するエラーメッセージ
   */
  function showError(message) {
    elError.textContent = message;
    elError.classList.remove('kc-config-success-active');
    elError.classList.add('kc-config-error-active');
    elError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * 成功メッセージを表示する (XSS 対策: textContent 経由)
   * エラー表示クラスを除去して成功表示クラス (緑系) に切り替える。
   * @param {string} message - 表示する成功メッセージ
   */
  function showSuccess(message) {
    elError.textContent = message;
    elError.classList.remove('kc-config-error-active');
    elError.classList.add('kc-config-success-active');
    elError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * エラー / 成功メッセージ表示をクリアする
   */
  function clearError() {
    elError.textContent = '';
    elError.classList.remove('kc-config-error-active', 'kc-config-success-active');
  }

  /**
   * プルダウン要素に選択肢を追加する (XSS 対策: textContent / value 経由)
   * @param {HTMLSelectElement} selectEl - 対象の select 要素
   * @param {Array<{code: string, label: string}>} options - 選択肢の配列
   * @param {boolean} withEmpty - 「未設定」選択肢を先頭に追加するか
   */
  function populateSelect(selectEl, options, withEmpty) {
    while (selectEl.options.length > 0) {
      selectEl.remove(0);
    }

    var emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = withEmpty ? '-- 未設定 --' : '-- フィールドを選択 --';
    selectEl.appendChild(emptyOption);

    options.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.code;
      opt.textContent = item.label + ' (' + item.code + ')';
      selectEl.appendChild(opt);
    });
  }

  /**
   * kintone フィールド一覧から指定した型のフィールドを抽出する
   * @param {Object} properties - kintone API の properties オブジェクト
   * @param {string[]} allowedTypes - 許可するフィールド型の配列
   * @returns {Array<{code: string, label: string}>} 抽出したフィールドの配列
   */
  function filterFields(properties, allowedTypes) {
    var result = [];
    Object.keys(properties).forEach(function (code) {
      var field = properties[code];
      if (allowedTypes.indexOf(field.type) !== -1) {
        result.push({
          code: code,
          label: field.label || code
        });
      }
    });
    result.sort(function (a, b) {
      if (a.label < b.label) { return -1; }
      if (a.label > b.label) { return 1; }
      return 0;
    });
    return result;
  }

  /**
   * プルダウンに指定した値を選択状態にする
   * @param {HTMLSelectElement} selectEl - 対象の select 要素
   * @param {string} value - 選択する値
   */
  function selectValue(selectEl, value) {
    if (!value) { return; }
    for (var i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === value) {
        selectEl.selectedIndex = i;
        return;
      }
    }
    // 保存済みの値がフィールド一覧に存在しない場合は末尾に追加して選択
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value + ' (フィールドが見つかりません)';
    opt.className = 'kc-option-missing';
    selectEl.appendChild(opt);
    selectEl.value = value;
  }

  /* ====================================================================
   * バリデーション
   * ==================================================================== */

  /**
   * 設定値のバリデーションを実行する (2 階層設計対応)
   * @param {Object} fieldMapping - フィールドマッピングオブジェクト
   * @param {Object} viewConfig - ビュー個別設定オブジェクト (null 可)
   * @returns {{ valid: boolean, errors: string[] }} バリデーション結果
   */
  function validateConfig(fieldMapping, viewConfig) {
    var errors = [];

    // V1: 必須フィールドマッピングチェック
    if (!fieldMapping.fieldTitle) {
      errors.push('「タイトルフィールド」は必須項目です。');
    }
    if (!fieldMapping.fieldStart) {
      errors.push('「開始日時フィールド」は必須項目です。');
    }
    if (!fieldMapping.fieldEnd) {
      errors.push('「終了日時フィールド」は必須項目です。');
    }

    // V2: 開始と終了が同一でないかチェック
    if (fieldMapping.fieldStart && fieldMapping.fieldEnd &&
        fieldMapping.fieldStart === fieldMapping.fieldEnd) {
      errors.push('「開始日時フィールド」と「終了日時フィールド」に同じフィールドを指定することはできません。');
    }

    // V3: ビュー個別設定の defaultView バリデーション
    if (viewConfig && viewConfig.defaultView) {
      if (['month', 'week', 'day'].indexOf(viewConfig.defaultView) === -1) {
        errors.push('「初期ビュー」の値が不正です。月 / 週 / 日 のいずれかを選択してください。');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /* ====================================================================
   * 設定値の収集
   * ==================================================================== */

  /**
   * 共通設定 (フィールドマッピング) セクションの DOM から fieldMapping を収集する
   * @returns {Object} fieldMapping オブジェクト
   */
  function collectFieldMapping() {
    return {
      fieldTitle:    elFieldTitle.value,
      fieldStart:    elFieldStart.value,
      fieldEnd:      elFieldEnd.value,
      fieldAllday:   elFieldAllday.value,
      fieldColor:    elFieldColor.value,
      fieldPlace:    elFieldPlace.value,
      fieldUserName: elFieldUserName.value,
      fieldUserMail: elFieldUserMail.value,
      fieldAccount:  elFieldAccount.value,
      fieldMemo:     elFieldMemo.value,
      alldayLabel:   elAlldayLabel.value.trim()
    };
  }

  /**
   * ビュー個別設定セクションの DOM から { calendarTitle, defaultView } を収集する
   * @returns {{ calendarTitle: string, defaultView: string }}
   */
  function collectViewConfig() {
    var defaultViewEl = document.querySelector('input[name="defaultView"]:checked');
    return {
      calendarTitle: elCalendarTitle.value.trim(),
      defaultView:   defaultViewEl ? defaultViewEl.value : 'month'
    };
  }

  /* ====================================================================
   * 設定値の反映
   * ==================================================================== */

  /**
   * config.fieldMapping の値を共通設定セクションの DOM 要素に反映する
   * @param {Object} fieldMapping - fieldMapping オブジェクト
   */
  function applyFieldMapping(fieldMapping) {
    if (!fieldMapping) { return; }

    elAlldayLabel.value = fieldMapping.alldayLabel || '';

    // フィールドプルダウン (populateSelect 後に呼び出す必要あり)
    selectValue(elFieldTitle,    fieldMapping.fieldTitle    || '');
    selectValue(elFieldStart,    fieldMapping.fieldStart    || '');
    selectValue(elFieldEnd,      fieldMapping.fieldEnd      || '');
    selectValue(elFieldAllday,   fieldMapping.fieldAllday   || '');
    selectValue(elFieldColor,    fieldMapping.fieldColor    || '');
    selectValue(elFieldPlace,    fieldMapping.fieldPlace    || '');
    selectValue(elFieldUserName, fieldMapping.fieldUserName || '');
    selectValue(elFieldUserMail, fieldMapping.fieldUserMail || '');
    selectValue(elFieldAccount,  fieldMapping.fieldAccount  || '');
    selectValue(elFieldMemo,     fieldMapping.fieldMemo     || '');
  }

  /**
   * 指定ビューの個別設定を DOM 要素に反映し、編集中ビューラベルを更新する
   * @param {string} viewId - ビュー ID (文字列)
   */
  function applyViewConfig(viewId) {
    if (!viewId) {
      // ビュー未選択: フォームを非活性化しガイダンス表示
      setPerViewFieldsEnabled(false);
      elPerViewLabel.style.display = 'none';
      elPerViewGuide.style.display = '';
      elCopySection.style.display = 'none';
      return;
    }

    var viewCfg = currentConfig.views[viewId] || {};

    // カレンダータイトル
    elCalendarTitle.value = viewCfg.calendarTitle || '';

    // 初期ビューのラジオボタン
    var view = viewCfg.defaultView || 'month';
    var viewRadio = document.querySelector('input[name="defaultView"][value="' + view + '"]');
    if (viewRadio) {
      viewRadio.checked = true;
    }

    // フォームを活性化
    setPerViewFieldsEnabled(true);

    // 編集中ビューラベル更新
    var viewName = findViewNameById(viewId);
    var labelText = viewName
      ? viewName + ' (id: ' + viewId + ') の設定を編集中'
      : 'ビュー ID: ' + viewId + ' の設定を編集中';
    elPerViewLabel.textContent = labelText;
    elPerViewLabel.style.display = '';
    elPerViewGuide.style.display = 'none';
    elCopySection.style.display = '';

    // コピー元ドロップダウンを再構築 (現在編集中ビュー以外)
    rebuildCopySourceSelect(viewId);
  }

  /**
   * ビュー個別設定フォームの活性/非活性を切り替える
   * @param {boolean} enabled - true: 活性, false: 非活性
   */
  function setPerViewFieldsEnabled(enabled) {
    elCalendarTitle.disabled = !enabled;
    var radios = document.querySelectorAll('input[name="defaultView"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].disabled = !enabled;
    }
    if (enabled) {
      elPerViewFields.classList.remove('kc-per-view-fields--disabled');
    } else {
      elPerViewFields.classList.add('kc-per-view-fields--disabled');
    }
  }

  /**
   * availableViews から指定 ID のビュー名を取得する
   * @param {string} viewId - ビュー ID (文字列)
   * @returns {string|null} ビュー名 (見つからない場合は null)
   */
  function findViewNameById(viewId) {
    var keys = Object.keys(availableViews);
    for (var i = 0; i < keys.length; i++) {
      var v = availableViews[keys[i]];
      if (String(v.id) === String(viewId)) {
        return v.name || keys[i];
      }
    }
    return null;
  }

  /**
   * コピー元ドロップダウンを再構築する (現在編集中ビューを除外)
   * @param {string} excludeViewId - 除外するビュー ID
   */
  function rebuildCopySourceSelect(excludeViewId) {
    while (elCopySource.options.length > 0) {
      elCopySource.remove(0);
    }

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- コピー元を選択 --';
    elCopySource.appendChild(emptyOpt);

    // CUSTOM ビューを index 順でソートして追加 (編集中ビューは除外)
    var entries = Object.keys(availableViews).map(function (name) {
      return availableViews[name];
    }).filter(function (v) {
      return String(v.id) !== String(excludeViewId);
    });
    entries.sort(function (a, b) {
      return Number(a.index) - Number(b.index);
    });

    entries.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = v.name + ' (id: ' + v.id + ')';
      elCopySource.appendChild(opt);
    });
  }

  /* ====================================================================
   * 初期設定取得
   * ==================================================================== */

  /**
   * kintone.plugin.app.getConfig で設定を取得し currentConfig を初期化する。
   * - 旧フラット設定 (version 2 未満) は破棄して再初期化 (Q11 確定)
   * - getConfig の返り値は { config: "<JSON文字列>" } 形式を前提とする
   * @returns {void}
   */
  function loadInitialConfig() {
    var rawConfig = kintone.plugin.app.getConfig(PLUGIN_ID);
    var parsed = null;

    try {
      // setConfig({ config: JSON.stringify(obj) }) 形式で保存されている場合
      if (rawConfig && rawConfig.config) {
        parsed = JSON.parse(rawConfig.config);
      } else if (rawConfig && Object.keys(rawConfig).length > 0) {
        // 互換: rawConfig 全体が JSON.stringify されている可能性を試みる
        // (旧フラット設定の場合は version チェックで破棄される)
        parsed = rawConfig;
      }
    } catch (e) {
      console.warn('[KC Config] 設定のパース失敗、再初期化します:', e);
      parsed = null;
    }

    // version 2 でない場合は破棄 (Q11 確定: 旧フラット設定は再初期化)
    if (!parsed || !parsed.version || Number(parsed.version) < 2) {
      console.log('[KC Config] version 2 以外の設定を破棄し再初期化します');
      currentConfig = { version: 2, fieldMapping: {}, views: {} };
      return;
    }

    currentConfig = {
      version: 2,
      fieldMapping: parsed.fieldMapping || {},
      views: parsed.views || {}
    };
    console.log('[KC Config] 設定を読み込みました:', currentConfig);
  }

  /* ====================================================================
   * フィールド一覧の取得と反映
   * ==================================================================== */

  /**
   * kintone API からフィールド一覧を取得し、各プルダウンに反映する
   * @returns {Promise<void>}
   */
  function loadFields() {
    return kintone.api(
      kintone.api.url('/k/v1/app/form/fields', true),
      'GET',
      { app: kintone.app.getId() }
    ).then(function (resp) {
      var props = resp.properties;

      populateSelect(elFieldTitle,    filterFields(props, TITLE_FIELD_TYPES),   false);
      populateSelect(elFieldStart,    filterFields(props, DATE_FIELD_TYPES),    false);
      populateSelect(elFieldEnd,      filterFields(props, DATE_FIELD_TYPES),    false);
      populateSelect(elFieldAllday,   filterFields(props, ALLDAY_FIELD_TYPES),  true);
      populateSelect(elFieldColor,    filterFields(props, COLOR_FIELD_TYPES),   true);
      populateSelect(elFieldPlace,    filterFields(props, TEXT_FIELD_TYPES),    true);
      populateSelect(elFieldUserName, filterFields(props, TEXT_FIELD_TYPES),    true);
      populateSelect(elFieldUserMail, filterFields(props, TEXT_FIELD_TYPES),    true);
      populateSelect(elFieldAccount,  filterFields(props, ACCOUNT_FIELD_TYPES), true);
      populateSelect(elFieldMemo,     filterFields(props, MEMO_FIELD_TYPES),    true);

      return props;
    }).catch(function (err) {
      console.error('[KC Config] フィールド一覧取得失敗:', err);
      showError('フィールド一覧の取得に失敗しました。ページを再読み込みしてください。');
      throw err;
    });
  }

  /* ====================================================================
   * Phase 7: ビュー管理 (カレンダー用ビュー管理セクション)
   * ==================================================================== */

  /**
   * ステータスメッセージを表示する (XSS 対策: textContent 経由)
   * @param {string} msg - 表示するメッセージ
   * @param {string} type - 'success' / 'error' / '' のいずれか
   */
  function showViewStatus(msg, type) {
    elViewStatus.textContent = msg;
    elViewStatus.className = 'kc-view-status' + (type ? ' kc-view-status-' + type : '');
  }

  /**
   * kintone 本番側のビュー一覧を取得する
   * 設定画面では本番運用中ビューを参照するのが自然なため本番 API を使用する
   * @returns {Promise<Object>} ビュー名をキーとするビュー設定オブジェクト
   */
  async function loadViews() {
    var resp = await kintone.api(
      kintone.api.url('/k/v1/app/views.json', true),
      'GET',
      { app: kintone.app.getId() }
    );
    return resp.views;
  }

  /**
   * カレンダー用カスタマイズビューのビュー設定オブジェクトを生成する
   * @param {string} name - ビュー名
   * @param {number|string} index - ビューの表示順
   * @returns {Object} kintone ビュー設定オブジェクト
   */
  function buildCalendarView(name, index) {
    return {
      type: 'CUSTOM',
      index: String(index),
      name: name,
      html: '<div id="kc-root" class="kc-root"></div>',
      pager: false,
      htmlForMobile: '<div id="kc-root" class="kc-root"></div>'
    };
  }

  /**
   * Phase 7 のビュー管理セクションのプルダウンを最新のビュー一覧で再構築する
   * 「新規作成」を先頭に、既存ビューを index 順で追加する
   * @returns {Promise<void>}
   */
  async function refreshViewSelect() {
    var views;
    try {
      views = await loadViews();
    } catch (e) {
      console.error('[KC Config] ビュー一覧取得失敗 (Phase 7):', e);
      return;
    }

    var currentValue = elViewTarget.value;

    while (elViewTarget.options.length > 1) {
      elViewTarget.remove(1);
    }

    var viewEntries = Object.keys(views).map(function (name) {
      return { name: name, index: Number(views[name].index) };
    });
    viewEntries.sort(function (a, b) { return a.index - b.index; });

    viewEntries.forEach(function (entry) {
      var opt = document.createElement('option');
      opt.value = entry.name;
      opt.textContent = entry.name;
      elViewTarget.appendChild(opt);
    });

    if (currentValue && currentValue !== '__new__') {
      elViewTarget.value = currentValue;
      if (elViewTarget.value !== currentValue) {
        elViewTarget.value = '__new__';
      }
    }

    updateNewNameFieldVisibility();
  }

  /**
   * ビュー個別設定セクションの「対象ビュー」プルダウンを
   * CUSTOM ビュー一覧で再構築し、availableViews を更新する。
   * orphan エントリも削除する (Q12 確定)
   * @returns {Promise<void>}
   */
  async function refreshPerViewSelect() {
    var views;
    try {
      views = await loadViews();
    } catch (e) {
      console.error('[KC Config] ビュー一覧取得失敗 (Phase 9):', e);
      return;
    }

    // CUSTOM ビューのみを availableViews に格納
    availableViews = {};
    Object.keys(views).forEach(function (name) {
      var v = views[name];
      if (v.type === 'CUSTOM') {
        availableViews[name] = v;
      }
    });

    // orphan 削除: currentConfig.views に存在するが CUSTOM ビュー一覧にない ID を削除
    var validIds = Object.keys(availableViews).map(function (name) {
      return String(availableViews[name].id);
    });
    Object.keys(currentConfig.views).forEach(function (viewId) {
      if (validIds.indexOf(viewId) === -1) {
        console.log('[KC Config] orphan エントリを削除:', viewId);
        delete currentConfig.views[viewId];
      }
    });

    // 「対象ビュー」プルダウンを再構築
    while (elPerViewSelect.options.length > 0) {
      elPerViewSelect.remove(0);
    }

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- ビューを選択 --';
    elPerViewSelect.appendChild(emptyOpt);

    var entries = Object.keys(availableViews).map(function (name) {
      return availableViews[name];
    });
    entries.sort(function (a, b) {
      return Number(a.index) - Number(b.index);
    });

    entries.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = v.name + ' (id: ' + v.id + ')';
      elPerViewSelect.appendChild(opt);
    });

    // 先頭ビューを currentViewId として選択
    if (entries.length > 0) {
      var firstId = String(entries[0].id);
      elPerViewSelect.value = firstId;
      currentViewId = firstId;
      applyViewConfig(firstId);
    } else {
      currentViewId = null;
      applyViewConfig(null);
    }
  }

  /**
   * 「新規ビュー名」入力フィールドの表示/非表示を切り替える (Phase 7)
   */
  function updateNewNameFieldVisibility() {
    if (elViewTarget.value === '__new__') {
      elViewNewNameField.style.display = '';
    } else {
      elViewNewNameField.style.display = 'none';
    }
  }

  /**
   * カレンダー用 CUSTOM ビューを作成または更新する (Phase 7)
   * @returns {Promise<void>}
   */
  async function handleViewApply() {
    var target = elViewTarget.value;
    showViewStatus('処理中...', '');
    elViewApply.disabled = true;

    try {
      var views = await loadViews();

      if (target === '__new__') {
        var newName = (elViewNewName.value || 'カレンダー').trim();
        if (!newName) {
          showViewStatus('ビュー名を入力してください', 'error');
          elViewApply.disabled = false;
          return;
        }
        if (views[newName]) {
          showViewStatus(
            '「' + newName + '」は既に存在します。既存ビュー選択から上書きしてください。',
            'error'
          );
          elViewApply.disabled = false;
          return;
        }
        views[newName] = buildCalendarView(newName, Object.keys(views).length);
      } else {
        var confirmed = window.confirm(
          '既存ビュー「' + target + '」を上書きします。\n\n' +
          '現在の HTML・設定が「カレンダー用」の内容に置き換わります。\n' +
          '続行しますか?'
        );
        if (!confirmed) {
          showViewStatus('キャンセルしました', '');
          elViewApply.disabled = false;
          return;
        }
        views[target] = buildCalendarView(target, views[target].index);
      }

      await kintone.api(
        kintone.api.url('/k/v1/preview/app/views.json', true),
        'PUT',
        {
          app: kintone.app.getId(),
          views: views
        }
      );

      await kintone.api(
        kintone.api.url('/k/v1/preview/app/deploy.json', true),
        'POST',
        {
          apps: [{ app: kintone.app.getId() }]
        }
      );

      var successMsg = (target === '__new__')
        ? 'ビューを作成しました。アプリを保存・公開してください。未保存の他の設定変更も同時に公開されます。'
        : 'ビューを更新しました。アプリを保存・公開してください。未保存の他の設定変更も同時に公開されます。';
      showViewStatus(successMsg, 'success');

      // Phase 7 / Phase 9 両方のビュープルダウンを更新
      await Promise.all([refreshViewSelect(), refreshPerViewSelect()]);

    } catch (e) {
      console.error('[KC Config] ビュー操作失敗:', e);
      showViewStatus(
        'ビューの作成 / 更新に失敗しました: ' + (e.message || ''),
        'error'
      );
    } finally {
      elViewApply.disabled = false;
    }
  }

  /* ====================================================================
   * Phase 9: ビュー個別設定イベントハンドラ
   * ==================================================================== */

  /**
   * 「対象ビュー」ドロップダウン変更時のハンドラ
   * - 現在の編集内容を currentConfig.views[currentViewId] に保存
   * - 新しい currentViewId に切り替えて applyViewConfig を呼び出す
   */
  function handleViewSelectChange() {
    var newViewId = elPerViewSelect.value;

    // 現在の編集中ビューの設定を保存
    if (currentViewId) {
      currentConfig.views[currentViewId] = collectViewConfig();
    }

    currentViewId = newViewId || null;
    applyViewConfig(currentViewId);
  }

  /**
   * 「コピー実行」ボタンのハンドラ
   * - コピー元の calendarTitle / defaultView を現在のフォームに転記する
   * - フィールドマッピングはコピー対象外 (共通のため)
   */
  function handleCopyFromView() {
    var srcViewId = elCopySource.value;
    if (!srcViewId) {
      elCopyResult.textContent = 'コピー元のビューを選択してください。';
      elCopyResult.className = 'kc-copy-result kc-copy-result--error';
      return;
    }

    var srcCfg = currentConfig.views[srcViewId];
    if (!srcCfg) {
      // コピー元に設定が存在しない場合 (空の状態) → 空でコピー
      srcCfg = { calendarTitle: '', defaultView: 'month' };
    }

    // フォームに転記
    elCalendarTitle.value = srcCfg.calendarTitle || '';

    var view = srcCfg.defaultView || 'month';
    var viewRadio = document.querySelector('input[name="defaultView"][value="' + view + '"]');
    if (viewRadio) {
      viewRadio.checked = true;
    }

    var srcName = findViewNameById(srcViewId);
    var msg = srcName
      ? '「' + srcName + '」からコピーしました。保存してください。'
      : 'コピーしました。保存してください。';
    elCopyResult.textContent = msg;
    elCopyResult.className = 'kc-copy-result kc-copy-result--success';
    console.log('[KC Config] コピー実行:', srcViewId, srcCfg);
  }

  /* ====================================================================
   * イベントハンドラ
   * ==================================================================== */

  /**
   * 保存ボタンクリック時のハンドラ (2 階層設計対応)
   * - collectFieldMapping() で共通設定を更新
   * - 現在の編集中ビューの個別設定を currentConfig.views に保存
   * - setConfig 直前に getConfig で最新の views を先読み (タブ間競合回避)
   * - mergedViews を構築してから orphan フィルタをかけて setConfig で保存
   * - 成功時は成功メッセージを 1.5 秒表示してから前の画面に戻る
   * @returns {Promise<void>}
   */
  async function handleSubmit() {
    clearError();

    // 共通設定を収集して currentConfig.fieldMapping を更新
    currentConfig.fieldMapping = collectFieldMapping();

    // 現在の編集中ビューの個別設定を保存
    if (currentViewId) {
      currentConfig.views[currentViewId] = collectViewConfig();
    }

    // orphan 削除: 最新 CUSTOM ビューに存在しない ID のエントリを削除 (メモリ内)
    var validIds = Object.keys(availableViews).map(function (name) {
      return String(availableViews[name].id);
    });
    Object.keys(currentConfig.views).forEach(function (viewId) {
      if (validIds.indexOf(viewId) === -1) {
        console.log('[KC Config] 保存時 orphan 削除:', viewId);
        delete currentConfig.views[viewId];
      }
    });

    // バリデーション
    var viewCfg = currentViewId ? currentConfig.views[currentViewId] : null;
    var validation = validateConfig(currentConfig.fieldMapping, viewCfg);
    if (!validation.valid) {
      showError(validation.errors.join('\n'));
      return;
    }

    // ボタンを無効化して二重送信を防止
    elSubmit.disabled = true;
    elSubmit.textContent = '保存中...';

    try {
      // setConfig 直前に getConfig で最新の views を先読みしてタブ間競合を回避する。
      // 取得した最新の views をベースに、編集中のビューのみを上書きする形でマージする。
      var latestViews = {};
      var latestRaw = kintone.plugin.app.getConfig(PLUGIN_ID);
      if (latestRaw && latestRaw.config) {
        try {
          var latestParsed = JSON.parse(latestRaw.config);
          if (latestParsed && Number(latestParsed.version) >= 2 && latestParsed.views) {
            latestViews = latestParsed.views;
          }
        } catch (parseErr) {
          // パース失敗時は latestViews を空のままにしてメモリ内データで上書き
          console.warn('[KC Config] getConfig 先読みのパース失敗、メモリ内データを使用:', parseErr);
        }
      }

      // 最新の views をベースに、編集中のビューのみを上書きする
      var mergedViews = Object.assign({}, latestViews, currentConfig.views);

      // mergedViews からも orphan を除去する (latestViews 由来の orphan 対策)
      Object.keys(mergedViews).forEach(function (viewId) {
        if (validIds.indexOf(viewId) === -1) {
          console.log('[KC Config] mergedViews orphan 削除:', viewId);
          delete mergedViews[viewId];
        }
      });

      // 最終的な保存オブジェクト
      var finalConfig = {
        version: 2,
        fieldMapping: currentConfig.fieldMapping,
        views: mergedViews
      };

      // setConfig は文字列のみ受付のため JSON.stringify して config キーに格納
      kintone.plugin.app.setConfig(
        { config: JSON.stringify(finalConfig) },
        function () {
          showSuccess('設定を保存しました');
          setTimeout(function () {
            history.back();
          }, 1500);
        }
      );
    } catch (e) {
      console.error('[KC Config] setConfig 失敗:', e);
      showError('設定の保存に失敗しました。時間をおいて再度お試しください。');
      elSubmit.disabled = false;
      elSubmit.textContent = '保存';
    }
  }

  /**
   * キャンセルボタン処理
   */
  function handleCancel() {
    history.back();
  }

  /* ====================================================================
   * 初期化
   * ==================================================================== */

  /**
   * 設定画面の初期化処理 (Phase 9: 2 階層設計)
   * 1. loadInitialConfig() で既存設定取得・初期化
   * 2. loadFields() でフィールドプルダウン構築
   * 3. applyFieldMapping() で共通設定を反映
   * 4. refreshPerViewSelect() でビュー個別設定プルダウン構築 (orphan 削除も実行)
   * 5. refreshViewSelect() で Phase 7 のビュー管理プルダウン構築
   */
  async function init() {
    // 1. 既存設定を取得して currentConfig を初期化
    loadInitialConfig();

    // 2. フィールド一覧を取得してプルダウンに反映
    try {
      await loadFields();
    } catch (e) {
      // フィールド取得失敗時も続行 (既存設定値の表示は試みる)
      console.error('[KC Config] フィールド一覧取得失敗:', e);
    }

    // 3. 共通設定 (fieldMapping) をフォームに反映
    applyFieldMapping(currentConfig.fieldMapping);

    // 4. ビュー一覧を取得して両プルダウンを構築 (orphan 削除も実行)
    try {
      await Promise.all([refreshPerViewSelect(), refreshViewSelect()]);
    } catch (e) {
      console.error('[KC Config] ビュー一覧初期化失敗:', e);
    }

    // ボタンイベントを登録
    elSubmit.addEventListener('click', handleSubmit);
    elCancel.addEventListener('click', handleCancel);

    // Phase 7: ビュー管理
    elViewTarget.addEventListener('change', updateNewNameFieldVisibility);
    elViewApply.addEventListener('click', handleViewApply);

    // Phase 9: ビュー個別設定
    elPerViewSelect.addEventListener('change', handleViewSelectChange);
    elCopyExecute.addEventListener('click', handleCopyFromView);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init().catch(function (e) {
      console.error('[KC Config] 初期化エラー:', e);
    });
  });

})(kintone.$PLUGIN_ID);
