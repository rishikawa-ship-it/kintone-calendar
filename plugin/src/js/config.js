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
 * - excludedStatuses は CSV 文字列で保存する
 *   読込時: config.excludedStatuses.split(',').map(function (s) { return s.trim(); })
 * - setConfig の値はすべて文字列型で保存される (数値・真偽値も文字列)
 *   読込時に必要に応じて Number / Boolean 変換すること
 * - calendarTitle が空文字の場合は KC.Config.detectAppName() フォールバックを実行
 * - 必須キー (fieldTitle / fieldStart / fieldEnd) はバリデーション済のため
 *   desktop.js では存在前提でよいが、念のため defensive に存在チェックを推奨
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

  /** ステータスフィールドとして選択可能な型 */
  var STATUS_FIELD_TYPES = ['DROP_DOWN', 'RADIO_BUTTON', 'STATUS'];

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
  var elFieldStatus = document.getElementById('kc-field-status');
  var elFieldAllday = document.getElementById('kc-field-allday');
  var elFieldColor = document.getElementById('kc-field-color');
  var elFieldPlace = document.getElementById('kc-field-place');
  var elFieldUserName = document.getElementById('kc-field-username');
  var elFieldUserMail = document.getElementById('kc-field-usermail');
  var elFieldAccount = document.getElementById('kc-field-account');
  var elFieldMemo = document.getElementById('kc-field-memo');
  var elExcludedStatuses = document.getElementById('kc-excluded-statuses');
  var elAlldayLabel = document.getElementById('kc-allday-label');
  var elSubmit = document.getElementById('kc-config-submit');
  var elCancel = document.getElementById('kc-config-cancel');
  var elGuideCopy = document.getElementById('kc-guide-copy');

  /* ====================================================================
   * ユーティリティ関数
   * ==================================================================== */

  /**
   * kintone プラグイン設定一覧画面の URL を返す
   * @returns {string} 遷移先 URL
   */
  function getPluginListUrl() {
    return '../../' + kintone.app.getId() + '/plugin/';
  }

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

    // 除外ステータスの形式チェック（全角カンマや全角スペース警告）
    if (config.excludedStatuses) {
      var zenkakuPattern = /[，、　]/;
      if (zenkakuPattern.test(config.excludedStatuses)) {
        errors.push(
          '「除外ステータス」に全角カンマ（，）・読点（、）・全角スペースが含まれています。' +
          '区切り文字には半角カンマ（,）を使用してください。'
        );
      }
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
      fieldStatus:      elFieldStatus.value,
      fieldAllday:      elFieldAllday.value,
      fieldColor:       elFieldColor.value,
      fieldPlace:       elFieldPlace.value,
      fieldUserName:    elFieldUserName.value,
      fieldUserMail:    elFieldUserMail.value,
      fieldAccount:     elFieldAccount.value,
      fieldMemo:        elFieldMemo.value,
      excludedStatuses: elExcludedStatuses.value.trim(),
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
    elExcludedStatuses.value = savedConfig.excludedStatuses || '';
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
    selectValue(elFieldStatus, savedConfig.fieldStatus || '');
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
      populateSelect(elFieldStatus,   filterFields(props, STATUS_FIELD_TYPES),  true);
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
        // 成功時: プラグイン一覧画面へ遷移
        window.location.href = getPluginListUrl();
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
   * キャンセルボタンクリック時のハンドラ
   */
  function handleCancel() {
    window.location.href = getPluginListUrl();
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
  }

  // DOM 構築完了後に初期化
  document.addEventListener('DOMContentLoaded', init);

})(kintone.$PLUGIN_ID);
