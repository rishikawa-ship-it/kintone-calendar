/**
 * config.js
 * KC Calendar プラグイン設定画面スクリプト
 *
 * 起動シーケンス:
 *   1. kintone.plugin.app.getConfig() で既存設定を取得
 *   2. kintone.api('/k/v1/app/form/fields') でフィールド一覧を取得 (1回のみ)
 *   3. フィールドプルダウンに選択肢を反映
 *   4. 既存設定値を各入力要素に反映
 *
 * 保存処理:
 *   1. 必須項目バリデーション
 *   2. kintone.plugin.app.setConfig() で保存
 *   3. プラグイン一覧画面へ遷移
 *
 * Phase 3 (desktop.js) への引き継ぎ事項:
 * - setConfig の値はすべて文字列型で保存される (数値・真偽値も文字列)
 *   読込時に必要に応じて Number / Boolean 変換すること
 * - calendarTitle が空文字の場合は KC.Config.detectAppName() フォールバックを実行
 * - 必須キー (fieldTitle / fieldStart / fieldEnd) はバリデーション済のため
 *   desktop.js では存在前提でよいが、念のため defensive に存在チェックを推奨
 * - フィルタは kintone 一覧の絞り込み機能で管理する (Phase 8)
 *   desktop.js の KC.Api.loadEvents が kintone.app.getQueryCondition() を使用する
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
   * DOM 要素参照
   * ==================================================================== */
  var elError = document.getElementById('kc-config-error');
  var elCalendarTitle = document.getElementById('kc-calendar-title');
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
  var elSubmit = document.getElementById('kc-config-submit');
  var elCancel = document.getElementById('kc-config-cancel');
  var elGuideCopy = document.getElementById('kc-guide-copy');

  /* --- Phase 7: ビュー管理 DOM 参照 --- */
  var elViewTarget = document.getElementById('kc-view-target');
  var elViewNewName = document.getElementById('kc-view-new-name');
  var elViewNewNameField = document.getElementById('kc-view-new-name-field');
  var elViewApply = document.getElementById('kc-view-apply');
  var elViewStatus = document.getElementById('kc-view-status');

  /* ====================================================================
   * ユーティリティ関数
   * ==================================================================== */

  /**
   * エラーメッセージを表示する (XSS 対策: textContent 経由)
   * @param {string} message - 表示するエラーメッセージ
   */
  function showError(message) {
    elError.textContent = message;
    elError.style.display = 'block';
    elError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * エラー表示をクリアする
   */
  function clearError() {
    elError.textContent = '';
    elError.style.display = 'none';
  }

  /**
   * プルダウン要素に選択肢を追加する (XSS 対策: textContent / value 経由)
   * @param {HTMLSelectElement} selectEl - 対象の select 要素
   * @param {Array<{code: string, label: string}>} options - 選択肢の配列
   * @param {boolean} withEmpty - 「未設定」選択肢を先頭に追加するか
   */
  function populateSelect(selectEl, options, withEmpty) {
    // 既存の選択肢を削除
    while (selectEl.options.length > 0) {
      selectEl.remove(0);
    }

    // 先頭の空/未設定選択肢を追加
    var emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = withEmpty ? '-- 未設定 --' : '-- フィールドを選択 --';
    selectEl.appendChild(emptyOption);

    // フィールド選択肢を追加
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
    // ラベルのアルファベット順でソート
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
   * 設定値のバリデーションを実行する
   * @param {Object} config - 検証する設定オブジェクト
   * @returns {{valid: boolean, errors: string[]}} バリデーション結果
   */
  function validateConfig(config) {
    var errors = [];

    // 必須項目チェック
    if (!config.fieldTitle) {
      errors.push('「タイトルフィールド」は必須項目です。');
    }
    if (!config.fieldStart) {
      errors.push('「開始日時フィールド」は必須項目です。');
    }
    if (!config.fieldEnd) {
      errors.push('「終了日時フィールド」は必須項目です。');
    }

    // 開始と終了が同じフィールドコードでないかチェック
    if (config.fieldStart && config.fieldEnd && config.fieldStart === config.fieldEnd) {
      errors.push('「開始日時フィールド」と「終了日時フィールド」に同じフィールドを指定することはできません。');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /* ====================================================================
   * 設定値の収集・反映
   * ==================================================================== */

  /**
   * フォームから設定値を収集する
   * @returns {Object} 設定オブジェクト（値はすべて文字列）
   */
  function collectConfig() {
    var defaultViewEl = document.querySelector('input[name="defaultView"]:checked');
    return {
      calendarTitle:    elCalendarTitle.value.trim(),
      defaultView:      defaultViewEl ? defaultViewEl.value : 'month',
      fieldTitle:       elFieldTitle.value,
      fieldStart:       elFieldStart.value,
      fieldEnd:         elFieldEnd.value,
      fieldAllday:      elFieldAllday.value,
      fieldColor:       elFieldColor.value,
      fieldPlace:       elFieldPlace.value,
      fieldUserName:    elFieldUserName.value,
      fieldUserMail:    elFieldUserMail.value,
      fieldAccount:     elFieldAccount.value,
      fieldMemo:        elFieldMemo.value,
      alldayLabel:      elAlldayLabel.value.trim()
    };
  }

  /**
   * 保存済み設定値をフォーム各要素に反映する
   * @param {Object} savedConfig - kintone.plugin.app.getConfig() の返り値
   */
  function applyConfig(savedConfig) {
    if (!savedConfig) { return; }

    // テキスト入力
    elCalendarTitle.value = savedConfig.calendarTitle || '';
    elAlldayLabel.value = savedConfig.alldayLabel || '';

    // デフォルトビューのラジオボタン
    var view = savedConfig.defaultView || 'month';
    var viewRadio = document.querySelector('input[name="defaultView"][value="' + view + '"]');
    if (viewRadio) {
      viewRadio.checked = true;
    }

    // フィールドプルダウン（populateSelect 後に呼び出す必要がある）
    selectValue(elFieldTitle, savedConfig.fieldTitle || '');
    selectValue(elFieldStart, savedConfig.fieldStart || '');
    selectValue(elFieldEnd, savedConfig.fieldEnd || '');
    selectValue(elFieldAllday, savedConfig.fieldAllday || '');
    selectValue(elFieldColor, savedConfig.fieldColor || '');
    selectValue(elFieldPlace, savedConfig.fieldPlace || '');
    selectValue(elFieldUserName, savedConfig.fieldUserName || '');
    selectValue(elFieldUserMail, savedConfig.fieldUserMail || '');
    selectValue(elFieldAccount, savedConfig.fieldAccount || '');
    selectValue(elFieldMemo, savedConfig.fieldMemo || '');
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

      // 各プルダウンにフィールド選択肢を反映
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
   * Phase 7: ビュー管理
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
   * ビュー対象プルダウンを最新のビュー一覧で再構築する
   * 「新規作成」を先頭に、既存ビューを index 順で追加する
   * @returns {Promise<void>}
   */
  async function refreshViewSelect() {
    var views;
    try {
      views = await loadViews();
    } catch (e) {
      // ビュー一覧取得失敗時はプルダウンを変更しない
      console.error('[KC Plugin Config] ビュー一覧取得失敗:', e);
      return;
    }

    // 現在の選択値を保持
    var currentValue = elViewTarget.value;

    // 「新規作成」以外の選択肢を削除
    while (elViewTarget.options.length > 1) {
      elViewTarget.remove(1);
    }

    // ビューを index 順でソートして追加
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

    // 元の選択値を復元 (存在する場合のみ)
    if (currentValue && currentValue !== '__new__') {
      elViewTarget.value = currentValue;
      if (elViewTarget.value !== currentValue) {
        // 復元できなかった場合は新規作成に戻す
        elViewTarget.value = '__new__';
      }
    }

    // 新規名フィールドの表示状態を更新
    updateNewNameFieldVisibility();
  }

  /**
   * 「新規ビュー名」入力フィールドの表示/非表示を切り替える
   * 「新規作成」選択時: 表示 / 既存ビュー選択時: 非表示
   */
  function updateNewNameFieldVisibility() {
    if (elViewTarget.value === '__new__') {
      elViewNewNameField.style.display = '';
    } else {
      elViewNewNameField.style.display = 'none';
    }
  }

  /**
   * カレンダー用 CUSTOM ビューを作成または更新する。
   * REST API: GET views → 差分書き換え → PUT views → POST deploy。
   *
   * 注意: POST deploy.json はアプリの全 preview 変更を本番に反映するため、
   *       他の未保存変更 (フィールド追加など) も同時に公開される。
   *       ユーザーには成功メッセージでこのリスクを通知する。
   *
   * AC23 (新規作成) / AC24 (既存ビュー上書き) を実装する
   * @returns {Promise<void>}
   */
  async function handleViewApply() {
    // refreshViewSelect() 後も target の値を保持するため先頭で取得
    var target = elViewTarget.value;
    showViewStatus('処理中...', '');
    elViewApply.disabled = true;

    try {
      // 最新のビュー一覧を取得
      var views = await loadViews();

      if (target === '__new__') {
        // 新規作成
        var newName = (elViewNewName.value || 'カレンダー').trim();
        if (!newName) {
          showViewStatus('ビュー名を入力してください', 'error');
          elViewApply.disabled = false;
          return;
        }
        // 同名ビューが既に存在する場合はエラー
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
        // 既存ビュー更新 (Q8: 上書き確認ダイアログ)
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

      // プレビューにビューを反映
      await kintone.api(
        kintone.api.url('/k/v1/preview/app/views.json', true),
        'PUT',
        {
          app: kintone.app.getId(),
          views: views
        }
      );

      // アプリをデプロイ
      await kintone.api(
        kintone.api.url('/k/v1/preview/app/deploy.json', true),
        'POST',
        {
          apps: [{ app: kintone.app.getId() }]
        }
      );

      // 成功メッセージは新規作成/既存更新で分岐
      var successMsg = (target === '__new__')
        ? 'ビューを作成しました。アプリを保存・公開してください。未保存の他の設定変更も同時に公開されます。'
        : 'ビューを更新しました。アプリを保存・公開してください。未保存の他の設定変更も同時に公開されます。';
      showViewStatus(successMsg, 'success');

      // プルダウンを最新状態に更新
      await refreshViewSelect();

    } catch (e) {
      console.error('[KC Plugin Config] ビュー操作失敗:', e);
      showViewStatus(
        'ビューの作成 / 更新に失敗しました: ' + (e.message || ''),
        'error'
      );
    } finally {
      elViewApply.disabled = false;
    }
  }

  /* ====================================================================
   * イベントハンドラ
   * ==================================================================== */

  /**
   * 保存ボタンクリック時のハンドラ
   */
  function handleSubmit() {
    clearError();

    var config = collectConfig();
    var validation = validateConfig(config);

    if (!validation.valid) {
      showError(validation.errors.join('\n'));
      return;
    }

    // ボタンを無効化して二重送信を防止
    elSubmit.disabled = true;
    elSubmit.textContent = '保存中...';

    try {
      kintone.plugin.app.setConfig(config, function () {
        // 設定保存後、直前画面に戻る
        history.back();
      });
    } catch (e) {
      // setConfig 自体が例外を投げた場合のフォールバック
      // 注: コールバックが呼ばれない非同期失敗は kintone SDK の仕様で検知不可
      console.error('[KC Plugin Config] setConfig failed:', e);
      showError('設定の保存に失敗しました。時間をおいて再度お試しください。');
      elSubmit.disabled = false;
      elSubmit.textContent = '保存';
    }
  }

  /**
   * キャンセルボタン処理。直前の画面に戻る。
   * kintone プラグイン設定画面の URL 構造に依存しないよう history.back() を使用。
   */
  function handleCancel() {
    history.back();
  }

  /**
   * セットアップガイドのコードをクリップボードにコピーするハンドラ
   */
  function handleGuideCopy() {
    var code = '<div id="kc-root" class="kc-root"></div>';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        elGuideCopy.textContent = 'コピー済';
        setTimeout(function () {
          elGuideCopy.textContent = 'コピー';
        }, 2000);
      }).catch(function () {
        fallbackCopy(code);
      });
    } else {
      fallbackCopy(code);
    }
  }

  /**
   * clipboard API 非対応環境向けのフォールバックコピー
   * @param {string} text - コピーするテキスト
   */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      elGuideCopy.textContent = 'コピー済';
      setTimeout(function () {
        elGuideCopy.textContent = 'コピー';
      }, 2000);
    } catch (e) {
      console.warn('[KC Config] クリップボードコピー失敗:', e);
    }
    document.body.removeChild(ta);
  }

  /* ====================================================================
   * 初期化
   * ==================================================================== */

  /**
   * 設定画面の初期化処理
   * - フィールド一覧取得 → プルダウン反映 → 保存済み設定値反映
   */
  function init() {
    // 既存設定を取得
    var savedConfig = kintone.plugin.app.getConfig(PLUGIN_ID);

    // フィールド一覧を取得してプルダウンに反映後、既存設定値を適用
    loadFields().then(function () {
      applyConfig(savedConfig);
    }).catch(function () {
      // フィールド取得失敗時も既存設定値は表示する
      applyConfig(savedConfig);
    });

    // ボタンイベントを登録
    elSubmit.addEventListener('click', handleSubmit);
    elCancel.addEventListener('click', handleCancel);
    if (elGuideCopy) {
      elGuideCopy.addEventListener('click', handleGuideCopy);
    }

    // Phase 7: ビュー管理の初期化
    // ビュー一覧を取得してプルダウンに反映する (失敗しても画面全体は止めない)
    refreshViewSelect().catch(function (e) {
      console.error('[KC Plugin Config] ビュー一覧初期化失敗:', e);
    });

    // 対象ビュー変更時に新規ビュー名フィールドの表示を切り替える
    elViewTarget.addEventListener('change', updateNewNameFieldVisibility);

    // 「ビューを作成 / 更新」ボタンのクリックハンドラ
    elViewApply.addEventListener('click', handleViewApply);
  }

  // DOM 構築完了後に初期化
  document.addEventListener('DOMContentLoaded', init);

})(kintone.$PLUGIN_ID);
