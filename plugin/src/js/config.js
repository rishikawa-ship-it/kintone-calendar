/**
 * config.js
 * KC Calendar プラグイン設定画面スクリプト (統合版: Phase 7 + Phase 9)
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
 *   3. refreshPerViewSelect() でビュー一覧取得 + orphan 削除 + プルダウン構築
 *   4. applyFieldMapping() で共通設定を反映
 *   5. 先頭ビュー (or 新規作成) を currentViewId に設定して applyViewConfig() で反映
 *
 * 保存処理:
 *   「保存」: saveConfig({ updateViews: false }) — PUT views なし、setConfig のみ
 *   「保存して更新」: saveConfig({ updateViews: true }) — PUT views + setConfig + デプロイ
 *
 *   新規作成モード (currentViewId === null) では「保存」は disabled。
 *   「保存して更新」でのみ PUT views → ID 取得 → setConfig の順で処理する。
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

  /* --- セクション 2: ビュー個別設定 (統合版) --- */
  var elPerViewSelect = document.getElementById('kc-per-view-select');
  var elPerViewLabel = document.getElementById('kc-per-view-label');
  var elPerViewFields = document.getElementById('kc-per-view-fields');
  var elNewViewNameField = document.getElementById('kc-new-view-name-field');
  var elNewViewName = document.getElementById('kc-new-view-name');
  var elCopySection = document.getElementById('kc-copy-section');
  var elCopySource = document.getElementById('kc-copy-source');
  var elCopyExecute = document.getElementById('kc-copy-execute');
  var elCopyResult = document.getElementById('kc-copy-result');
  var elCalendarTitle = document.getElementById('kc-calendar-title');

  /* --- 操作ボタン --- */
  var elSubmit = document.getElementById('kc-config-submit');
  var elSubmitDeploy = document.getElementById('kc-config-submit-deploy');
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
   * 指定ビューの個別設定を DOM 要素に反映し、ボタン状態・ラベルを更新する。
   * viewId が null の場合は新規作成モードとして扱う。
   * @param {string|null} viewId - ビュー ID (文字列)、新規作成モードは null
   */
  function applyViewConfig(viewId) {
    if (!viewId) {
      // 新規作成モード: フォームをデフォルト値で活性化
      elCalendarTitle.value = '';
      var monthRadio = document.querySelector('input[name="defaultView"][value="month"]');
      if (monthRadio) { monthRadio.checked = true; }
      setPerViewFieldsEnabled(true);
      elPerViewLabel.textContent = '(新規ビュー)';
      elNewViewNameField.style.display = 'block';
      // 新規作成時もコピーセクションを表示 (全 CUSTOM ビューを選択肢として提示)
      elCopySection.style.display = '';
      rebuildCopySourceSelect(null);
      // 新規作成モード: 「保存」は disabled、「保存して更新」は enabled
      elSubmit.disabled = true;
      elSubmitDeploy.disabled = false;
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

    // 編集中ビューラベル更新 (select の右にインライン表示)
    var viewName = findViewNameById(viewId);
    elPerViewLabel.textContent = viewName
      ? '(' + viewName + ' / id: ' + viewId + ')'
      : '(id: ' + viewId + ')';

    // 既存ビュー選択時: 新規ビュー名フィールドは非表示
    elNewViewNameField.style.display = 'none';
    elCopySection.style.display = '';

    // 既存ビュー選択時: 「保存」「保存して更新」両方 enabled
    elSubmit.disabled = false;
    elSubmitDeploy.disabled = false;

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
   * コピー元ドロップダウンを再構築する
   * @param {string|null} excludeViewId - 除外するビュー ID。null の場合は全件表示 (新規作成モード)
   */
  function rebuildCopySourceSelect(excludeViewId) {
    while (elCopySource.options.length > 0) {
      elCopySource.remove(0);
    }

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- コピー元を選択 --';
    elCopySource.appendChild(emptyOpt);

    // CUSTOM ビューを index 順でソートして追加
    // excludeViewId が null の場合 (新規作成モード) は除外なし
    var entries = Object.keys(availableViews).map(function (name) {
      return availableViews[name];
    }).filter(function (v) {
      if (excludeViewId === null) { return true; }
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
   * ビュー管理ユーティリティ
   * ==================================================================== */

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
   * ビュー一覧から CUSTOM 型のみを抽出して返す
   * @param {Object} views - loadViews() の戻り値
   * @returns {Object} CUSTOM 型ビューのみのオブジェクト
   */
  function filterCustomViews(views) {
    var result = {};
    Object.keys(views).forEach(function (name) {
      if (views[name].type === 'CUSTOM') {
        result[name] = views[name];
      }
    });
    return result;
  }

  /**
   * 「対象ビュー」プルダウンを CUSTOM ビュー一覧で再構築し、availableViews を更新する。
   * 「-- 新規作成 --」を先頭に追加し、以降は CUSTOM ビューを index 順で追加する。
   * orphan エントリも削除する。
   * @returns {Promise<void>}
   */
  async function refreshPerViewSelect() {
    var allViews;
    try {
      allViews = await loadViews();
    } catch (e) {
      console.error('[KC Config] ビュー一覧取得失敗:', e);
      return;
    }

    // CUSTOM ビューのみを availableViews に格納
    availableViews = filterCustomViews(allViews);

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

    // 「-- 新規作成 --」を先頭 option として追加
    var newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '-- 新規作成 --';
    elPerViewSelect.appendChild(newOpt);

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

    // currentViewId の選択状態を維持、なければ最初の既存ビューを選択
    if (currentViewId && currentViewId !== null) {
      elPerViewSelect.value = currentViewId;
      // 選択できなかった場合 (削除されたビューなど) は先頭ビューを選択
      if (elPerViewSelect.value !== currentViewId) {
        if (entries.length > 0) {
          currentViewId = String(entries[0].id);
          elPerViewSelect.value = currentViewId;
          applyViewConfig(currentViewId);
        } else {
          currentViewId = null;
          elPerViewSelect.value = '__new__';
          applyViewConfig(null);
        }
      }
    } else if (entries.length > 0) {
      // 初回: 先頭の既存ビューを選択
      currentViewId = String(entries[0].id);
      elPerViewSelect.value = currentViewId;
      applyViewConfig(currentViewId);
    } else {
      // 既存 CUSTOM ビューなし: 新規作成モード
      currentViewId = null;
      elPerViewSelect.value = '__new__';
      applyViewConfig(null);
    }
  }

  /* ====================================================================
   * Phase 9: ビュー個別設定イベントハンドラ
   * ==================================================================== */

  /**
   * 「対象ビュー」ドロップダウン変更時のハンドラ。
   * - 現在の編集内容を currentConfig.views[currentViewId] に保存
   * - 新しい currentViewId に切り替えて applyViewConfig を呼び出す
   * - __new__ 選択時: 新規ビュー名フィールド表示、「保存」disabled
   * - 既存ビュー選択時: 「保存」「保存して更新」両方 enabled
   */
  function handleViewSelectChange() {
    var selectedValue = elPerViewSelect.value;

    // 現在の編集中ビューの設定を一時保存 (切替前)
    if (currentViewId) {
      currentConfig.views[currentViewId] = collectViewConfig();
    }

    if (selectedValue === '__new__') {
      currentViewId = null;
      applyViewConfig(null);
    } else {
      currentViewId = selectedValue || null;
      applyViewConfig(currentViewId);
    }
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
   * 設定値を保存する共通ロジック。
   * - collectFieldMapping() で共通設定を currentConfig.fieldMapping に反映
   * - 現在の編集中ビューの個別設定を currentConfig.views に反映
   * - options.updateViews が true の場合: PUT views.json でビューを作成/上書き
   *   - 新規作成モード (currentViewId === null): 新規ビューを追加して currentViewId を更新
   *   - 既存ビュー更新: html を強制上書き (確認ダイアログなし)
   * - orphan 削除 (メモリ内 + mergedViews)
   * - getConfig 先読みでタブ間競合を回避して mergedViews を構築
   * - kintone.plugin.app.setConfig で保存
   * @param {{ updateViews?: boolean }} [options] - updateViews: PUT views.json を実行するか
   * @returns {Promise<boolean>} 保存成功なら true、バリデーション失敗や例外で false
   */
  async function saveConfig(options) {
    clearError();
    var doUpdateViews = options && options.updateViews === true;

    // 新規作成時のビュー名バリデーション
    var newViewName = null;
    if (doUpdateViews && currentViewId === null) {
      newViewName = (elNewViewName.value || 'カレンダー').trim();
      if (!newViewName) {
        showError('新規ビュー名を入力してください。');
        return false;
      }
      var sameName = Object.keys(availableViews).some(function (name) {
        return name === newViewName;
      });
      if (sameName) {
        showError('「' + newViewName + '」は既に存在します。別の名前を入力してください。');
        return false;
      }
    }

    // 共通設定を収集して currentConfig.fieldMapping を更新
    currentConfig.fieldMapping = collectFieldMapping();

    // 現在の編集中ビューの個別設定を保存 (新規作成時は後で ID 確定後に保存)
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
      return false;
    }

    try {
      // PUT views.json: 新規作成または既存ビュー更新
      if (doUpdateViews) {
        var allViews = await loadViews();

        if (currentViewId === null) {
          // 新規作成: ビューを追加
          var newView = buildCalendarView(newViewName, Object.keys(allViews).length);
          allViews[newViewName] = newView;

          await kintone.api(
            kintone.api.url('/k/v1/preview/app/views.json', true),
            'PUT',
            { app: kintone.app.getId(), views: allViews }
          );

          // 作成後のビュー ID を再取得して currentViewId に反映
          var refreshed = await loadViews();
          var createdView = refreshed[newViewName];
          if (createdView && createdView.id) {
            currentViewId = String(createdView.id);
            // availableViews を更新して orphan チェックの validIds も更新
            availableViews[newViewName] = createdView;
            validIds.push(currentViewId);
            // 新規ビューの個別設定を currentConfig.views に追加
            currentConfig.views[currentViewId] = collectViewConfig();
          } else {
            console.warn('[KC Config] 新規ビューの ID が取得できませんでした');
          }
        } else {
          // 既存ビュー更新: html を強制上書き (確認なし)
          var existingKey = Object.keys(allViews).find(function (k) {
            return String(allViews[k].id) === currentViewId;
          });
          if (existingKey) {
            allViews[existingKey].html = '<div id="kc-root" class="kc-root"></div>';
            allViews[existingKey].htmlForMobile = '<div id="kc-root" class="kc-root"></div>';
            await kintone.api(
              kintone.api.url('/k/v1/preview/app/views.json', true),
              'PUT',
              { app: kintone.app.getId(), views: allViews }
            );
          } else {
            console.warn('[KC Config] 更新対象ビューが見つかりませんでした: id =', currentViewId);
          }
        }
      }

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
      // コールバック形式を Promise 化して await できるようにする
      await new Promise(function (resolve, reject) {
        try {
          kintone.plugin.app.setConfig(
            { config: JSON.stringify(finalConfig) },
            resolve
          );
        } catch (setErr) {
          reject(setErr);
        }
      });

      return true;
    } catch (e) {
      console.error('[KC Config] saveConfig 失敗:', e);
      showError('設定の保存に失敗しました。時間をおいて再度お試しください。');
      return false;
    }
  }

  /**
   * 保存ボタンクリック時のハンドラ (既存ビュー編集のみ)。
   * - 新規作成モード (currentViewId === null) の場合はエラーを表示して終了
   * - saveConfig({ updateViews: false }) で setConfig のみ実行
   * - 成功時は成功メッセージを 1.5 秒表示してから前の画面に戻る
   * @returns {Promise<void>}
   */
  async function handleSubmit() {
    if (currentViewId === null) {
      showError('新規作成は「保存して更新」ボタンをご利用ください。');
      return;
    }

    elSubmit.disabled = true;
    elSubmit.textContent = '保存中...';

    var ok = await saveConfig({ updateViews: false });
    if (!ok) {
      elSubmit.disabled = false;
      elSubmit.textContent = '保存';
      return;
    }

    showSuccess('設定を保存しました');
    setTimeout(function () { history.back(); }, 1500);
  }

  /**
   * 「保存して更新」ボタンクリック時のハンドラ。
   * saveConfig({ updateViews: true }) でビュー更新 + setConfig を実行したあと、
   * kintone プレビュー API でデプロイ (本番反映) を実行する。
   *
   * 注意: POST deploy.json はアプリの全 preview 変更を本番に反映するため、
   *       他の未保存変更 (フィールド追加など) も同時に公開される。
   *       ユーザーには成功メッセージでこのリスクを通知する。
   *
   * @returns {Promise<void>}
   */
  async function handleSubmitAndDeploy() {
    elSubmit.disabled = true;
    elSubmitDeploy.disabled = true;
    elSubmitDeploy.textContent = '保存中...';

    var ok = await saveConfig({ updateViews: true });
    if (!ok) {
      elSubmit.disabled = false;
      elSubmitDeploy.disabled = false;
      elSubmitDeploy.textContent = '保存して更新';
      return;
    }

    // 続けてデプロイ (本番反映)
    elSubmitDeploy.textContent = 'アプリを更新中...';

    var POLL_INTERVAL = 3000;  // ポーリング間隔 (ms)
    var POLL_TIMEOUT  = 120000; // ポーリングタイムアウト (ms)

    try {
      await kintone.api(
        kintone.api.url('/k/v1/preview/app/deploy.json', true),
        'POST',
        { apps: [{ app: kintone.app.getId() }] }
      );

      // デプロイ完了をポーリングで待機 (Phase 7 の handleViewApply と同じ API パターン)
      var elapsed = 0;
      while (elapsed < POLL_TIMEOUT) {
        await new Promise(function (r) { setTimeout(r, POLL_INTERVAL); });
        elapsed += POLL_INTERVAL;

        var statusResp = await kintone.api(
          kintone.api.url('/k/v1/preview/app/deploy.json', true),
          'GET',
          { apps: [kintone.app.getId()] }
        );
        var appStatus = statusResp.apps[0].status;

        if (appStatus === 'SUCCESS') {
          // ビュー一覧を再取得してプルダウンを更新 (新規作成後に currentViewId を select に反映)
          await refreshPerViewSelect();
          showSuccess('設定を保存しアプリを更新しました (他の未保存変更も同時に公開されました)');
          setTimeout(function () { history.back(); }, 2000);
          return;
        }
        if (appStatus === 'FAIL' || appStatus === 'CANCEL') {
          throw new Error('デプロイ失敗 (status: ' + appStatus + ')');
        }
        // PROCESSING の場合は継続
      }
      throw new Error('デプロイがタイムアウトしました (' + (POLL_TIMEOUT / 1000) + ' 秒経過)');

    } catch (e) {
      console.error('[KC Plugin Config] デプロイ失敗:', e);
      showError('アプリ更新に失敗しました: ' + (e.message || '') + ' (設定値は保存済み)');
      elSubmit.disabled = false;
      elSubmitDeploy.disabled = false;
      elSubmitDeploy.textContent = '保存して更新';
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
   * 設定画面の初期化処理 (統合版: Phase 7 + Phase 9)
   * 1. loadInitialConfig() で既存設定取得・初期化
   * 2. loadFields() でフィールドプルダウン構築
   * 3. applyFieldMapping() で共通設定を反映
   * 4. refreshPerViewSelect() でビュー個別設定プルダウン構築 (orphan 削除も実行)
   * 5. ボタン初期状態を applyViewConfig の結果に合わせて設定
   */
  async function init() {
    // 初期状態: 「保存」を disabled にしておく (refreshPerViewSelect 後に確定)
    elSubmit.disabled = true;

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

    // 4. ビュー一覧を取得してプルダウンを構築 (orphan 削除も実行)
    try {
      await refreshPerViewSelect();
    } catch (e) {
      console.error('[KC Config] ビュー一覧初期化失敗:', e);
    }

    // ボタンイベントを登録
    elSubmit.addEventListener('click', handleSubmit);
    elSubmitDeploy.addEventListener('click', handleSubmitAndDeploy);
    elCancel.addEventListener('click', handleCancel);

    // ビュー個別設定
    elPerViewSelect.addEventListener('change', handleViewSelectChange);
    elCopyExecute.addEventListener('click', handleCopyFromView);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init().catch(function (e) {
      console.error('[KC Config] 初期化エラー:', e);
    });
  });

})(kintone.$PLUGIN_ID);
