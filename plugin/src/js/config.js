/**
 * config.js
 * KC Calendar プラグイン設定画面スクリプト (v6: 権限フィールド設定追加)
 *
 * 保存形式 (version 6):
 *   {
 *     version: 6,
 *     fieldMapping: { fieldTitle, fieldStart, fieldEnd, fieldAllday, ... },
 *     permissionRules: [ { fieldCode, fieldType: "USER_SELECT", permission, bgColor, textColor }, ... ],
 *     fieldValueRules: [ { fieldCode, fieldType, value, permission, bgColor, textColor }, ... ],
 *     views: { "<viewId>": { calendarTitle, defaultView } }
 *   }
 * v6 変更点:
 *   - fieldValueRules 配列を追加（DROPDOWN/RADIO_BUTTON/CHECK_BOX/STATUS ベースの権限判定）
 *   - 「編集権限設定」を「権限ユーザー設定」にリネーム
 *   - v5→v6 マイグレーション: fieldValueRules: [] を追加
 * v5 変更点:
 *   - permissionRules 各エントリの color を bgColor + textColor に分離
 *   - v4→v5 マイグレーション: color → bgColor に流用・textColor を WCAG 輝度から自動判定
 *   - v2/v3→v5 直接マイグレーションも対応
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

  /** メモフィールドとして選択可能な型 */
  var MEMO_FIELD_TYPES = ['MULTI_LINE_TEXT', 'RICH_TEXT', 'SINGLE_LINE_TEXT'];

  /* ====================================================================
   * グローバル状態
   * ==================================================================== */

  /**
   * setConfig で保存する全体設定オブジェクト (version 6)
   * @type {{ version: number, fieldMapping: Object, permissionRules: Array, fieldValueRules: Array, views: Object }}
   */
  var currentConfig = {
    version: 6,
    fieldMapping: {},
    permissionRules: [],
    fieldValueRules: [],
    views: {}
  };

  /**
   * 権限ユーザー設定 UI で使用する USER_SELECT フィールド一覧（loadFields 後に設定される）
   * @type {Array<{code: string, label: string}>}
   */
  var permissionFieldOptions = [];

  /**
   * 権限フィールド設定 UI で使用するフィールド一覧（DROPDOWN/RADIO_BUTTON/CHECK_BOX）
   * loadFields 後に設定される。STATUS は loadStatuses で別途追加される。
   * @type {Array<{code: string, label: string, type: string, options: Object}>}
   */
  var fieldValueFieldOptions = [];

  /**
   * 権限フィールド設定で使用するプロセス管理ステータス一覧
   * loadStatuses 後に設定される。未取得の場合は空配列。
   * 未検証: kintone プロセス管理が無効のアプリでは空配列になる見込み。
   * @type {Array<string>}
   */
  var statusOptions = [];

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
  var elFieldUserMail = document.getElementById('kc-field-usermail');
  var elFieldMemo = document.getElementById('kc-field-memo');
  var elAlldayLabel = document.getElementById('kc-allday-label');

  /* --- 権限ユーザー設定 (v6 リネーム: 旧「編集権限設定」) --- */
  var elPermissionRows = document.getElementById('kc-permission-rows');
  var elPermissionAdd  = document.getElementById('kc-permission-add');

  /* --- 権限フィールド設定 (v6 新規) --- */
  var elFieldValueRows = document.getElementById('kc-fieldvalue-rows');
  var elFieldValueAdd  = document.getElementById('kc-fieldvalue-add');

  /* --- セクション 2: ビュー個別設定 (統合版) --- */
  var elPerViewSelect = document.getElementById('kc-per-view-select');
  var elPerViewFields = document.getElementById('kc-per-view-fields');
  var elNewViewNameField = document.getElementById('kc-new-view-name-field');
  var elNewViewName = document.getElementById('kc-new-view-name');
  var elCopyExecute = document.getElementById('kc-copy-execute');
  var elCopyResult = document.getElementById('kc-copy-result');
  var elCalendarTitle = document.getElementById('kc-calendar-title');

  /* --- コピーモーダル --- */
  var elCopyModal = document.getElementById('kc-copy-modal');
  var elCopyModalClose = document.getElementById('kc-copy-modal-close');
  var elCopyModalCancel = document.getElementById('kc-copy-modal-cancel');
  var elCopyOpenModal = document.getElementById('kc-copy-open-modal');
  /* モーダル内のコピー元 select (実際にユーザーが操作するもの) */
  var elCopySourceModal = document.getElementById('kc-copy-source-modal');

  /* --- 操作ボタン (上下 2 セット分を NodeList で取得) --- */
  var elSubmits = document.querySelectorAll('.kc-config-submit');
  var elSubmitDeploys = document.querySelectorAll('.kc-config-submit-deploy');
  var elCancels = document.querySelectorAll('.kc-config-cancel');

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

    // 選択肢再構築後に空文字状態を反映する（applyFieldMapping で値が入る前でも正しく動作させるため）
    syncSelectEmptyClass(selectEl);
  }

  /**
   * select の value が空文字なら kc-select--empty クラスを付与し、それ以外なら除去する。
   * 未選択時にプレースホルダー option を薄文字で表示するための仕組み。
   * @param {HTMLSelectElement} selectEl - 対象の select 要素
   */
  function syncSelectEmptyClass(selectEl) {
    if (!selectEl) { return; }
    if (selectEl.value === '') {
      selectEl.classList.add('kc-select--empty');
    } else {
      selectEl.classList.remove('kc-select--empty');
    }
  }

  /**
   * select に change イベントリスナーを登録して value が空文字かどうかに応じて
   * kc-select--empty クラスを切り替える。初期状態も即時反映する。
   * @param {HTMLSelectElement} selectEl - 対象の select 要素
   */
  function attachSelectEmptyClassSync(selectEl) {
    if (!selectEl) { return; }
    syncSelectEmptyClass(selectEl);
    selectEl.addEventListener('change', function () { syncSelectEmptyClass(selectEl); });
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
   * ボタン状態制御ヘルパー
   * ==================================================================== */

  /**
   * 「保存」ボタン群 (上下 2 セット) の disabled 状態とテキストを一括設定する
   * @param {boolean} disabled - true: 非活性, false: 活性
   * @param {string} [text] - ボタンのテキスト (省略時は変更しない)
   */
  function setSubmitButtonsState(disabled, text) {
    elSubmits.forEach(function (btn) {
      btn.disabled = disabled;
      if (text !== undefined) { btn.textContent = text; }
    });
  }

  /**
   * 「保存して更新」ボタン群 (上下 2 セット) の disabled 状態とテキストを一括設定する
   * @param {boolean} disabled - true: 非活性, false: 活性
   * @param {string} [text] - ボタンのテキスト (省略時は変更しない)
   */
  function setSubmitDeployButtonsState(disabled, text) {
    elSubmitDeploys.forEach(function (btn) {
      btn.disabled = disabled;
      if (text !== undefined) { btn.textContent = text; }
    });
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
      fieldUserMail: elFieldUserMail.value,
      fieldMemo:     elFieldMemo.value,
      alldayLabel:   elAlldayLabel.value.trim()
    };
  }

  /* ====================================================================
   * 編集権限設定 UI (REQ_edit-permission-extension §4)
   * ==================================================================== */

  /**
   * WCAG 相対輝度を計算する (§8.7)
   * @param {string} hex - '#RRGGBB' 形式の色
   * @returns {number} 0〜1 の輝度値
   */
  function getRelativeLuminance(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var linearize = function (c) {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  }

  /**
   * 背景色から適切な文字色（黒 or 白）を返す (§8.7)
   * 輝度 > 0.5 → 黒文字、輝度 ≤ 0.5 → 白文字
   * @param {string} bgHex - '#RRGGBB' 形式の背景色
   * @returns {string} '#000000' または '#ffffff'
   */
  function pickTextColorByBg(bgHex) {
    return getRelativeLuminance(bgHex) > 0.5 ? '#000000' : '#ffffff';
  }

  /**
   * テーマカラーパレット (REQ_color-picker-ui v2 §2.1.4)
   * 列優先定義: [色相名, [標準, 明+1, 明+2, 暗-1, 暗-2]]
   * Material Design Color System の各階調を参考に静的定義。
   * @type {Array<[string, string[]]>}
   */
  var THEME_COLORS = [
    ['グレー',   ['#757575', '#bdbdbd', '#f5f5f5', '#424242', '#212121']],
    ['赤',       ['#d50000', '#ef9a9a', '#ffebee', '#b71c1c', '#7f0000']],
    ['オレンジ', ['#f4511e', '#ffab91', '#fbe9e7', '#bf360c', '#6d1f0a']],
    ['アンバー', ['#ff8f00', '#ffcc80', '#fff8e1', '#e65100', '#7c3700']],
    ['黄',       ['#f6bf26', '#fff176', '#fffde7', '#f57f17', '#7c5c00']],
    ['緑',       ['#0b8043', '#81c784', '#e8f5e9', '#1b5e20', '#0a3010']],
    ['ティール', ['#00796b', '#80cbc4', '#e0f2f1', '#004d40', '#00251a']],
    ['青',       ['#1976d2', '#90caf9', '#e3f2fd', '#0d47a1', '#072356']],
    ['紫',       ['#8e24aa', '#ce93d8', '#f3e5f5', '#6a1b9a', '#3b0a52']],
    ['ピンク',   ['#e91e63', '#f48fb1', '#fce4ec', '#880e4f', '#4a0526']]
  ];

  /** 行ラベル（明度段階）: THEME_COLORS の各列の [0]〜[4] に対応 */
  var THEME_ROW_LABELS = ['(標準)', '(明+1)', '(明+2)', '(暗-1)', '(暗-2)'];

  /**
   * 標準カラーパレット (REQ_color-picker-ui v2 §2.1.5)
   * 彩度を重視した 10 色。
   * @type {Array<{name: string, hex: string}>}
   */
  var STANDARD_COLORS = [
    { name: '純赤',           hex: '#ff0000' },
    { name: '鮮やかオレンジ', hex: '#ff6600' },
    { name: '鮮やか黄',       hex: '#ffcc00' },
    { name: '鮮やか緑',       hex: '#33cc00' },
    { name: '鮮やかシアン',   hex: '#00cccc' },
    { name: '鮮やか青',       hex: '#0066ff' },
    { name: '鮮やか紫',       hex: '#6600cc' },
    { name: '鮮やかピンク',   hex: '#ff0099' },
    { name: '黒',             hex: '#000000' },
    { name: '白',             hex: '#ffffff' }
  ];

  /**
   * 指定した HEX 値に対応するプリセット色の名前を返す。
   * THEME_COLORS（50色）と STANDARD_COLORS（10色）の両方を検索する。
   * 該当なしの場合は HEX 値をそのまま返す。
   * @param {string} hex - '#RRGGBB' 形式の色
   * @returns {string} 色名 または HEX 値
   */
  function findPresetColorName(hex) {
    var lower = (hex || '').toLowerCase();

    // THEME_COLORS を検索（列優先定義を走査）
    for (var col = 0; col < THEME_COLORS.length; col++) {
      var colName = THEME_COLORS[col][0];
      var shades = THEME_COLORS[col][1];
      for (var row = 0; row < shades.length; row++) {
        if (shades[row].toLowerCase() === lower) {
          return colName + THEME_ROW_LABELS[row];
        }
      }
    }

    // STANDARD_COLORS を検索
    for (var i = 0; i < STANDARD_COLORS.length; i++) {
      if (STANDARD_COLORS[i].hex.toLowerCase() === lower) {
        return STANDARD_COLORS[i].name;
      }
    }

    return hex;
  }

  /**
   * カラーパレットポップオーバーを閉じる
   * 表示中のすべてのポップオーバーを閉じる（複数行が同時に開くのを防ぐ）
   */
  function closeAllColorPopovers() {
    var popovers = document.querySelectorAll('.kc-color-palette:not([hidden])');
    popovers.forEach(function (el) {
      el.setAttribute('hidden', '');
    });
    var btns = document.querySelectorAll('.kc-color-preview-btn[aria-expanded="true"]');
    btns.forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  /**
   * カラーパレットポップオーバーを開く
   * 他のポップオーバーを閉じてから対象を開く
   * @param {HTMLElement} paletteEl - .kc-color-palette 要素
   * @param {HTMLElement} previewBtn - .kc-color-preview-btn 要素
   */
  function openColorPopover(paletteEl, previewBtn) {
    closeAllColorPopovers();
    paletteEl.removeAttribute('hidden');
    previewBtn.setAttribute('aria-expanded', 'true');
    // 最初のタイルにフォーカスを移す
    var firstTile = paletteEl.querySelector('.kc-color-tile');
    if (firstTile) { firstTile.focus(); }
  }

  /**
   * カラープレビューボタンとポップオーバーの色表示を同期する
   * @param {HTMLElement} previewBtn - .kc-color-preview-btn 要素
   * @param {HTMLElement} paletteEl - .kc-color-palette 要素
   * @param {string} hex - '#RRGGBB' 形式の色
   */
  function syncColorDisplay(previewBtn, paletteEl, hex) {
    previewBtn.style.backgroundColor = hex;
    var colorName = findPresetColorName(hex);
    previewBtn.setAttribute('aria-label', '色を選択: ' + colorName);

    // タイルの選択状態を更新
    var tiles = paletteEl.querySelectorAll('.kc-color-tile');
    tiles.forEach(function (tile) {
      var isSelected = tile.dataset.color.toLowerCase() === hex.toLowerCase();
      tile.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
  }

  /**
   * カラーピッカーウィジェットを生成する (REQ_color-picker-ui §5.1)
   * プレビューボタン + プリセットパレットポップオーバー + 非表示ネイティブ input を含む wrapper を返す。
   * extraClass に 'kc-permission-bgcolor' または 'kc-permission-textcolor' を渡すことで
   * collectPermissionRules() がネイティブ input の値をクラス名で収集できる。
   * @param {string} initialColor - 初期色 ('#RRGGBB')
   * @param {string} [extraClass] - ネイティブ input に追加する CSS クラス名
   * @returns {HTMLElement} .kc-color-picker-wrapper 要素
   */
  function buildColorPickerWidget(initialColor, extraClass) {
    var color = initialColor || '#1976d2';
    var wrapper = document.createElement('div');
    wrapper.className = 'kc-color-picker-wrapper';

    // nativeInput を先に生成して palette(customArea) 内に格納する (REQ §5.1)
    var previewBtn = buildColorPreviewBtn(color);
    var nativeInput = buildColorNativeInput(color, extraClass);
    var paletteEl = buildColorPalette(color, nativeInput);

    wrapper.appendChild(previewBtn);
    wrapper.appendChild(paletteEl);

    bindColorPickerEvents(previewBtn, paletteEl, nativeInput);

    return wrapper;
  }

  /**
   * 色プレビューボタンを生成する
   * @param {string} color - 初期色
   * @returns {HTMLButtonElement}
   */
  function buildColorPreviewBtn(color) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kc-color-preview-btn';
    btn.style.backgroundColor = color;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-label', '色を選択: ' + findPresetColorName(color));
    return btn;
  }

  /**
   * カラーパレットポップオーバー要素を生成する。
   * REQ v2 §5.1 の構造に従い:
   *   palette > テーマセクション + 標準セクション + customArea(nativeInput)
   * @param {string} initialColor - 初期選択色
   * @param {HTMLInputElement} nativeInput - buildColorNativeInput() で生成した hidden input
   * @returns {HTMLElement}
   */
  function buildColorPalette(initialColor, nativeInput) {
    var palette = document.createElement('div');
    palette.className = 'kc-color-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', 'カラーパレット');
    palette.setAttribute('hidden', '');

    var themeSection = buildColorThemeSection(initialColor);
    var standardSection = buildColorStandardSection(initialColor);
    var customArea = buildColorCustomArea(nativeInput);

    palette.appendChild(themeSection);
    palette.appendChild(standardSection);
    palette.appendChild(customArea);

    return palette;
  }

  /**
   * 1つの色タイルボタンを生成する共通ヘルパー
   * @param {string} hex - 色の HEX 値
   * @param {string} name - aria-label 用の色名
   * @param {string} initialColor - 現在選択中の色（選択状態の初期化に使用）
   * @param {string} [extraClass] - 追加 CSS クラス名（省略可）
   * @returns {HTMLButtonElement}
   */
  function buildColorTile(hex, name, initialColor, extraClass) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'kc-color-tile' + (extraClass ? ' ' + extraClass : '');
    tile.setAttribute('role', 'option');
    tile.setAttribute('aria-label', name);
    tile.setAttribute('data-color', hex);
    tile.style.backgroundColor = hex;
    var isSelected = hex.toLowerCase() === (initialColor || '').toLowerCase();
    tile.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    return tile;
  }

  /**
   * テーマの色セクションを生成する（10列 × 5行 = 50色）
   * THEME_COLORS は列優先定義のため、行優先に変換してグリッドに追加する。
   * 行優先変換: row=0〜4, col=0〜9 の順で THEME_COLORS[col][1][row] を取得する。
   * @param {string} initialColor - 初期選択色
   * @returns {HTMLElement} .kc-color-section 要素
   */
  function buildColorThemeSection(initialColor) {
    var section = document.createElement('div');
    section.className = 'kc-color-section';
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', 'テーマの色');

    var title = document.createElement('div');
    title.className = 'kc-color-section-title';
    title.textContent = 'テーマの色';

    var grid = document.createElement('div');
    grid.className = 'kc-color-theme-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'テーマカラー');

    // 行優先で展開: row 0=標準, 1=明+1, 2=明+2, 3=暗-1, 4=暗-2
    for (var row = 0; row < 5; row++) {
      for (var col = 0; col < THEME_COLORS.length; col++) {
        var colName = THEME_COLORS[col][0];
        var hex = THEME_COLORS[col][1][row];
        var name = colName + THEME_ROW_LABELS[row];
        grid.appendChild(buildColorTile(hex, name, initialColor));
      }
    }

    section.appendChild(title);
    section.appendChild(grid);
    return section;
  }

  /**
   * 標準の色セクションを生成する（1行 × 10色）
   * @param {string} initialColor - 初期選択色
   * @returns {HTMLElement} .kc-color-section 要素
   */
  function buildColorStandardSection(initialColor) {
    var section = document.createElement('div');
    section.className = 'kc-color-section';
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', '標準の色');

    var title = document.createElement('div');
    title.className = 'kc-color-section-title';
    title.textContent = '標準の色';

    var grid = document.createElement('div');
    grid.className = 'kc-color-standard-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', '標準カラー');

    STANDARD_COLORS.forEach(function (preset) {
      grid.appendChild(buildColorTile(preset.hex, preset.name, initialColor, 'kc-color-tile--standard'));
    });

    section.appendChild(title);
    section.appendChild(grid);
    return section;
  }

  /**
   * 「カスタム...」ボタンエリアを生成する。
   * REQ §5.1 の構造に従い、ネイティブ input を area 内に格納する。
   * @param {HTMLInputElement} nativeInput - buildColorNativeInput() で生成した hidden input
   * @returns {HTMLElement}
   */
  function buildColorCustomArea(nativeInput) {
    var area = document.createElement('div');
    area.className = 'kc-color-palette-custom';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kc-color-custom-btn';
    btn.setAttribute('aria-label', 'カスタムカラーを選択');
    btn.textContent = 'その他の色...';

    area.appendChild(btn);
    area.appendChild(nativeInput);
    return area;
  }

  /**
   * 非表示のネイティブ <input type="color"> を生成する。
   * 「カスタム...」ボタンクリック時に .click() でブラウザネイティブカラーピッカーを起動する。
   * 未検証: kintone iframe 環境での動作（CSS の opacity:0 + click() 方式）。
   * extraClass に収集用クラス（kc-permission-bgcolor / kc-permission-textcolor）を渡す。
   * @param {string} color - 初期色
   * @param {string} [extraClass] - 追加 CSS クラス名（省略時はなし）
   * @returns {HTMLInputElement}
   */
  function buildColorNativeInput(color, extraClass) {
    var input = document.createElement('input');
    input.type = 'color';
    input.className = 'kc-color-native-input' + (extraClass ? ' ' + extraClass : '');
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('tabindex', '-1');
    input.value = color;
    return input;
  }

  /**
   * プレビューボタンのクリックイベント（ポップオーバーの開閉）を登録する
   * @param {HTMLElement} previewBtn
   * @param {HTMLElement} paletteEl
   */
  function bindPreviewBtnEvents(previewBtn, paletteEl) {
    previewBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = paletteEl.getAttribute('hidden') === null;
      if (isOpen) {
        closeAllColorPopovers();
      } else {
        openColorPopover(paletteEl, previewBtn);
      }
    });
  }

  /**
   * パレット内タイルクリックおよびキーボード操作のイベントを登録する
   * @param {HTMLElement} previewBtn
   * @param {HTMLElement} paletteEl
   * @param {HTMLInputElement} nativeInput
   */
  function bindPaletteEvents(previewBtn, paletteEl, nativeInput) {
    // タイルクリック: 色を確定してポップオーバーを閉じる
    // stopPropagation は外側クリック判定との競合を避けるため先頭で呼ぶ
    paletteEl.addEventListener('click', function (e) {
      e.stopPropagation();
      var tile = e.target.closest('.kc-color-tile');
      if (!tile) { return; }
      var hex = tile.dataset.color;
      nativeInput.value = hex;
      syncColorDisplay(previewBtn, paletteEl, hex);
      closeAllColorPopovers();
      previewBtn.focus();
    });

    // ESC キーでポップオーバーを閉じる
    paletteEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllColorPopovers();
        previewBtn.focus();
      }
    });
  }

  /**
   * ネイティブカラーピッカーおよびカスタムボタンのイベントを登録する
   * @param {HTMLElement} previewBtn
   * @param {HTMLElement} paletteEl
   * @param {HTMLInputElement} nativeInput
   */
  function bindNativeInputEvents(previewBtn, paletteEl, nativeInput) {
    // カスタムボタン: ネイティブピッカーを開く
    var customBtn = paletteEl.querySelector('.kc-color-custom-btn');
    if (customBtn) {
      customBtn.addEventListener('click', function () {
        nativeInput.click();
      });
    }

    // ネイティブピッカーで色が変わったときにプレビューを同期する
    nativeInput.addEventListener('input', function () {
      syncColorDisplay(previewBtn, paletteEl, nativeInput.value);
    });
    nativeInput.addEventListener('change', function () {
      syncColorDisplay(previewBtn, paletteEl, nativeInput.value);
      closeAllColorPopovers();
      previewBtn.focus();
    });
  }

  /**
   * カラーピッカーウィジェットの全イベントをまとめて登録する
   * @param {HTMLElement} previewBtn - .kc-color-preview-btn
   * @param {HTMLElement} paletteEl - .kc-color-palette
   * @param {HTMLInputElement} nativeInput - .kc-color-native-input
   */
  function bindColorPickerEvents(previewBtn, paletteEl, nativeInput) {
    bindPreviewBtnEvents(previewBtn, paletteEl);
    bindPaletteEvents(previewBtn, paletteEl, nativeInput);
    bindNativeInputEvents(previewBtn, paletteEl, nativeInput);
  }

  /**
   * 権限種別ドロップダウンの既定選択肢（管理者は当面非表示のため除外）
   * 強い権限順 (編集者 → 閲覧者) で並べる。
   * 内部値 ('edit'/'view'/'delete') は変更しない。
   * @type {Array<{value: string, label: string}>}
   */
  var PERMISSION_OPTIONS_DEFAULT = [
    { value: 'edit', label: '編集者' },
    { value: 'view', label: '閲覧者' }
  ];

  /**
   * 1 行の権限エントリ要素を生成する（USER_SELECT フィールドのみ表示）
   *
   * 権限種別ドロップダウンの選択肢について:
   * - 通常は「編集者 / 閲覧者」のみ表示（管理者は新規追加不可）
   * - rule.permission が 'delete' の場合は先頭に「管理者」を動的追加し、
   *   既存設定の降格を防ぐ
   * - 新規行 (rule が null または permission が 'delete' 以外) では 'delete' を含めない
   *
   * @param {Object} [rule] - 既存ルール { fieldCode, permission, bgColor, textColor }（省略時は空行）
   * @returns {HTMLElement} .kc-permission-row 要素
   */
  function buildPermissionRow(rule) {
    var row = document.createElement('div');
    row.className = 'kc-permission-row';

    // フィールド選択ドロップダウン（USER_SELECT 型のみ）
    var fieldSel = buildPermissionFieldSelect(rule);

    // 権限種別ドロップダウン
    var permSel = buildPermissionPermSelect(rule);

    // 背景色ピッカー
    var bgColor = (rule && rule.bgColor) ? rule.bgColor : '#1976d2';
    var bgWidget = buildColorPickerWidget(bgColor, 'kc-permission-bgcolor');

    // 文字色ピッカー
    var textColor = (rule && rule.textColor) ? rule.textColor : '#ffffff';
    var textWidget = buildColorPickerWidget(textColor, 'kc-permission-textcolor');

    // 削除ボタン
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'kc-config-btn kc-config-btn-secondary kc-permission-del-btn';
    delBtn.textContent = '−';
    delBtn.addEventListener('click', function () {
      row.parentNode && row.parentNode.removeChild(row);
    });

    // 各カラムを wrapper div で包んでヘッダーと grid 位置を揃える
    var cellField = document.createElement('div');
    cellField.className = 'kc-permission-cell';
    cellField.appendChild(fieldSel);

    var cellPerm = document.createElement('div');
    cellPerm.className = 'kc-permission-cell';
    cellPerm.appendChild(permSel);

    var cellBgColor = document.createElement('div');
    cellBgColor.className = 'kc-permission-cell kc-permission-col-bgcolor';
    cellBgColor.appendChild(bgWidget);

    var cellTextColor = document.createElement('div');
    cellTextColor.className = 'kc-permission-cell kc-permission-col-textcolor';
    cellTextColor.appendChild(textWidget);

    var cellAction = document.createElement('div');
    cellAction.className = 'kc-permission-cell';
    cellAction.appendChild(delBtn);

    row.appendChild(cellField);
    row.appendChild(cellPerm);
    row.appendChild(cellBgColor);
    row.appendChild(cellTextColor);
    row.appendChild(cellAction);

    return row;
  }

  /**
   * フィールド選択ドロップダウンを生成して既存ルールを反映する
   * @param {Object|null} rule
   * @returns {HTMLSelectElement}
   */
  function buildPermissionFieldSelect(rule) {
    var fieldSel = document.createElement('select');
    fieldSel.className = 'kc-config-select kc-permission-field-select';

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- フィールドを選択 --';
    fieldSel.appendChild(emptyOpt);

    permissionFieldOptions.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.code;
      opt.textContent = f.label + ' (' + f.code + ')';
      fieldSel.appendChild(opt);
    });

    if (rule && rule.fieldCode) {
      fieldSel.value = rule.fieldCode;
      if (fieldSel.value !== rule.fieldCode) {
        var missingOpt = document.createElement('option');
        missingOpt.value = rule.fieldCode;
        missingOpt.textContent = rule.fieldCode + ' (フィールドが見つかりません)';
        missingOpt.className = 'kc-option-missing';
        fieldSel.appendChild(missingOpt);
        fieldSel.value = rule.fieldCode;
      }
    }
    // 生成時の選択状態に応じて空文字クラスを設定し、以降の変更も追跡する
    attachSelectEmptyClassSync(fieldSel);
    return fieldSel;
  }

  /**
   * 権限種別ドロップダウンを生成して既存ルールを反映する
   * @param {Object|null} rule
   * @returns {HTMLSelectElement}
   */
  function buildPermissionPermSelect(rule) {
    var permSel = document.createElement('select');
    permSel.className = 'kc-config-select kc-permission-perm-select';

    var permOptions = PERMISSION_OPTIONS_DEFAULT.slice();
    if (rule && rule.permission === 'delete') {
      permOptions.unshift({ value: 'delete', label: '管理者' });
    }

    permOptions.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      permSel.appendChild(opt);
    });

    if (rule && rule.permission) {
      permSel.value = rule.permission;
    } else {
      // 新規行追加ボタン経由（rule === null）のデフォルトは閲覧者
      permSel.value = 'view';
    }
    // 生成時の選択状態に応じて空文字クラスを設定し、以降の変更も追跡する
    attachSelectEmptyClassSync(permSel);
    return permSel;
  }

  /**
   * 権限設定行を DOM から収集して permissionRules 配列を返す
   * フィールドコードまたは権限が未選択の行はスキップする
   * fieldType は USER_SELECT 固定（§6.1 スキーマ互換のため常にセット）
   * bgColor / textColor は HTML5 カラーピッカーの値 (#RRGGBB)
   * @returns {Array<{fieldCode: string, fieldType: string, permission: string, bgColor: string, textColor: string}>}
   */
  function collectPermissionRules() {
    var rows = elPermissionRows.querySelectorAll('.kc-permission-row');
    var result = [];
    rows.forEach(function (row) {
      var fieldSel     = row.querySelector('.kc-permission-field-select');
      var permSel      = row.querySelector('.kc-permission-perm-select');
      var bgInput      = row.querySelector('.kc-permission-bgcolor');
      var textInput    = row.querySelector('.kc-permission-textcolor');
      if (!fieldSel || !permSel) return;

      var fieldCode  = fieldSel.value;
      var permission = permSel.value;
      if (!fieldCode || !permission) return;

      result.push({
        fieldCode:  fieldCode,
        fieldType:  'USER_SELECT',
        permission: permission,
        bgColor:    bgInput   ? bgInput.value   : '#1976d2',
        textColor:  textInput ? textInput.value : '#ffffff'
      });
    });
    return result;
  }

  /**
   * 保存済み permissionRules をフォームに反映する。
   * rules が空配列の場合は空の入力行を 1 つ表示する（UX 向上のため）。
   * 空行の保存時フィルタは collectPermissionRules() が担う（fieldCode 未入力行は除外）。
   * @param {Array} rules - permissionRules 配列
   */
  function applyPermissionRules(rules) {
    if (!elPermissionRows) return;
    elPermissionRows.innerHTML = '';
    if (!Array.isArray(rules) || rules.length === 0) {
      // 初期表示: 空行を 1 つ追加してユーザーに入力を促す
      elPermissionRows.appendChild(buildPermissionRow(null));
      return;
    }
    rules.forEach(function (rule) {
      elPermissionRows.appendChild(buildPermissionRow(rule));
    });
  }

  /* ====================================================================
   * 権限フィールド設定 UI (REQ_edit-permission-extension v6 §4.3)
   * ==================================================================== */

  /**
   * フィールドコードに対応する選択肢（values）リストを返す
   * DROPDOWN/RADIO_BUTTON/CHECK_BOX は fieldValueFieldOptions の options から、
   * STATUS は statusOptions から取得する。
   * @param {string} fieldCode - フィールドコード（'$status' の場合は STATUS 扱い）
   * @param {string} fieldType - フィールド型
   * @returns {string[]} 選択肢文字列の配列
   */
  function getFieldValueOptions(fieldCode, fieldType) {
    if (fieldType === 'STATUS') {
      return statusOptions.slice();
    }
    var found = fieldValueFieldOptions.filter(function (f) { return f.code === fieldCode; })[0];
    if (!found || !found.options) return [];
    return Object.keys(found.options).sort(function (a, b) {
      var ia = Number((found.options[a] || {}).index);
      var ib = Number((found.options[b] || {}).index);
      return ia - ib;
    });
  }

  /**
   * 値選択ドロップダウンの内容を更新する
   * フィールド選択変更時に呼び出す。
   * @param {HTMLSelectElement} valueSel - 値ドロップダウン要素
   * @param {string} fieldCode - 選択されたフィールドコード
   * @param {string} fieldType - 選択されたフィールド型
   * @param {string} [selectedValue] - 選択済み値（初期表示用）
   */
  function rebuildValueSelect(valueSel, fieldCode, fieldType, selectedValue) {
    while (valueSel.options.length > 0) { valueSel.remove(0); }

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = fieldCode ? '-- 値を選択 --' : '-- フィールドを選択してください --';
    emptyOpt.disabled = !fieldCode;
    valueSel.appendChild(emptyOpt);

    if (!fieldCode) {
      syncSelectEmptyClass(valueSel);
      return;
    }

    var opts = getFieldValueOptions(fieldCode, fieldType);
    opts.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      valueSel.appendChild(opt);
    });

    if (selectedValue) { valueSel.value = selectedValue; }
    syncSelectEmptyClass(valueSel);
  }

  /**
   * 権限フィールド設定 1 行を生成する
   * 6 セル: フィールド / 値 / 権限 / 背景色 / 文字色 / 削除
   * フィールド変更時に値ドロップダウンを動的更新する（§C-2）
   * @param {Object} [rule] - 既存ルール { fieldCode, fieldType, value, permission, bgColor, textColor }
   * @returns {HTMLElement} .kc-fieldvalue-row 要素
   */
  function buildFieldValueRow(rule) {
    var row = document.createElement('div');
    row.className = 'kc-fieldvalue-row';

    var fieldSel = buildFieldValueFieldSelect(rule);
    var valueSel = buildFieldValueValueSelect(rule, fieldSel);
    var permSel  = buildFieldValuePermSelect(rule);

    var bgColor   = (rule && rule.bgColor)   ? rule.bgColor   : '#1976d2';
    var textColor = (rule && rule.textColor)  ? rule.textColor : '#ffffff';
    var bgWidget   = buildColorPickerWidget(bgColor,   'kc-fieldvalue-bgcolor');
    var textWidget = buildColorPickerWidget(textColor, 'kc-fieldvalue-textcolor');

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'kc-config-btn kc-fieldvalue-del-btn';
    delBtn.textContent = '−';
    delBtn.addEventListener('click', function () {
      row.parentNode && row.parentNode.removeChild(row);
    });

    var cellField   = wrapCell(fieldSel);
    var cellValue   = wrapCell(valueSel);
    var cellPerm    = wrapCell(permSel);
    var cellBg      = wrapCellCenter('kc-fieldvalue-col-bgcolor', bgWidget);
    var cellText    = wrapCellCenter('kc-fieldvalue-col-textcolor', textWidget);
    var cellAction  = wrapCell(delBtn);

    row.appendChild(cellField);
    row.appendChild(cellValue);
    row.appendChild(cellPerm);
    row.appendChild(cellBg);
    row.appendChild(cellText);
    row.appendChild(cellAction);

    return row;
  }

  /**
   * セルラッパー（.kc-fieldvalue-cell）を生成して子要素を追加する
   * @param {HTMLElement} child
   * @returns {HTMLElement}
   */
  function wrapCell(child) {
    var cell = document.createElement('div');
    cell.className = 'kc-fieldvalue-cell';
    cell.appendChild(child);
    return cell;
  }

  /**
   * 中央揃えセルラッパーを生成する
   * @param {string} extraClass - 追加クラス名
   * @param {HTMLElement} child
   * @returns {HTMLElement}
   */
  function wrapCellCenter(extraClass, child) {
    var cell = document.createElement('div');
    cell.className = 'kc-fieldvalue-cell ' + extraClass;
    cell.appendChild(child);
    return cell;
  }

  /**
   * フィールド選択ドロップダウンを生成する（DROPDOWN/RADIO_BUTTON/CHECK_BOX + STATUS）
   * @param {Object|null} rule
   * @returns {HTMLSelectElement}
   */
  function buildFieldValueFieldSelect(rule) {
    var fieldSel = document.createElement('select');
    fieldSel.className = 'kc-config-select kc-fieldvalue-field-select';

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- フィールドを選択 --';
    fieldSel.appendChild(emptyOpt);

    // DROPDOWN/RADIO_BUTTON/CHECK_BOX フィールドを追加
    fieldValueFieldOptions.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.code;
      opt.dataset.fieldtype = f.type;
      opt.textContent = f.label + ' (' + f.code + ')';
      fieldSel.appendChild(opt);
    });

    // プロセス管理ステータスが有効な場合のみ STATUS を追加
    if (statusOptions.length > 0) {
      var statusOpt = document.createElement('option');
      statusOpt.value = '$status';
      statusOpt.dataset.fieldtype = 'STATUS';
      statusOpt.textContent = 'ステータス (STATUS)';
      fieldSel.appendChild(statusOpt);
    }

    if (rule && rule.fieldCode) {
      fieldSel.value = rule.fieldCode;
      if (fieldSel.value !== rule.fieldCode) {
        var missingOpt = document.createElement('option');
        missingOpt.value = rule.fieldCode;
        missingOpt.textContent = rule.fieldCode + ' (フィールドが見つかりません)';
        missingOpt.className = 'kc-option-missing';
        fieldSel.appendChild(missingOpt);
        fieldSel.value = rule.fieldCode;
      }
    }
    attachSelectEmptyClassSync(fieldSel);
    return fieldSel;
  }

  /**
   * 値選択ドロップダウンを生成する（フィールド選択変更時に動的更新）
   * @param {Object|null} rule
   * @param {HTMLSelectElement} fieldSel - 連動するフィールド選択ドロップダウン
   * @returns {HTMLSelectElement}
   */
  function buildFieldValueValueSelect(rule, fieldSel) {
    var valueSel = document.createElement('select');
    valueSel.className = 'kc-config-select kc-fieldvalue-value-select';

    var initCode  = rule ? rule.fieldCode  : '';
    var initType  = rule ? (rule.fieldType || '') : '';
    var initValue = rule ? rule.value : '';
    rebuildValueSelect(valueSel, initCode, initType, initValue);

    // フィールド選択変更時に値選択肢を更新する
    fieldSel.addEventListener('change', function () {
      var selOpt = fieldSel.options[fieldSel.selectedIndex];
      var newType = selOpt ? (selOpt.dataset.fieldtype || '') : '';
      rebuildValueSelect(valueSel, fieldSel.value, newType, '');
    });

    return valueSel;
  }

  /**
   * 権限種別ドロップダウンを生成する（権限ユーザー設定と同一の選択肢）
   * @param {Object|null} rule
   * @returns {HTMLSelectElement}
   */
  function buildFieldValuePermSelect(rule) {
    var permSel = document.createElement('select');
    permSel.className = 'kc-config-select kc-fieldvalue-perm-select';

    var permOptions = PERMISSION_OPTIONS_DEFAULT.slice();
    if (rule && rule.permission === 'delete') {
      permOptions.unshift({ value: 'delete', label: '管理者' });
    }

    permOptions.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      permSel.appendChild(opt);
    });

    if (rule && rule.permission) {
      permSel.value = rule.permission;
    } else {
      permSel.value = 'view';
    }
    attachSelectEmptyClassSync(permSel);
    return permSel;
  }

  /**
   * 権限フィールド設定行を DOM から収集して fieldValueRules 配列を返す
   * fieldCode または value が未選択の行はスキップする
   * @returns {Array<{fieldCode, fieldType, value, permission, bgColor, textColor}>}
   */
  function collectFieldValueRules() {
    if (!elFieldValueRows) return [];
    var rows = elFieldValueRows.querySelectorAll('.kc-fieldvalue-row');
    var result = [];
    rows.forEach(function (row) {
      var fieldSel = row.querySelector('.kc-fieldvalue-field-select');
      var valueSel = row.querySelector('.kc-fieldvalue-value-select');
      var permSel  = row.querySelector('.kc-fieldvalue-perm-select');
      var bgInput  = row.querySelector('.kc-fieldvalue-bgcolor');
      var txtInput = row.querySelector('.kc-fieldvalue-textcolor');
      if (!fieldSel || !valueSel || !permSel) return;

      var fieldCode = fieldSel.value;
      var value     = valueSel.value;
      if (!fieldCode || !value) return;

      var selOpt   = fieldSel.options[fieldSel.selectedIndex];
      var fieldType = selOpt ? (selOpt.dataset.fieldtype || '') : '';
      // フィールドコードが $status の場合は STATUS 型確定
      if (fieldCode === '$status') { fieldType = 'STATUS'; }

      result.push({
        fieldCode:  fieldCode,
        fieldType:  fieldType,
        value:      value,
        permission: permSel.value || 'view',
        bgColor:    bgInput  ? bgInput.value  : '#1976d2',
        textColor:  txtInput ? txtInput.value : '#ffffff'
      });
    });
    return result;
  }

  /**
   * 保存済み fieldValueRules をフォームに反映する
   * rules が空配列の場合は空の入力行を 1 つ表示する（UX 向上のため）
   * @param {Array} rules - fieldValueRules 配列
   */
  function applyFieldValueRules(rules) {
    if (!elFieldValueRows) return;
    elFieldValueRows.innerHTML = '';
    if (!Array.isArray(rules) || rules.length === 0) {
      elFieldValueRows.appendChild(buildFieldValueRow(null));
      return;
    }
    rules.forEach(function (rule) {
      elFieldValueRows.appendChild(buildFieldValueRow(rule));
    });
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
    selectValue(elFieldUserMail, fieldMapping.fieldUserMail || '');
    selectValue(elFieldMemo,     fieldMapping.fieldMemo     || '');

    // 値反映後に空文字状態を再同期する（selectValue が値を設定した後の状態に合わせる）
    syncSelectEmptyClass(elFieldTitle);
    syncSelectEmptyClass(elFieldStart);
    syncSelectEmptyClass(elFieldEnd);
    syncSelectEmptyClass(elFieldAllday);
    syncSelectEmptyClass(elFieldColor);
    syncSelectEmptyClass(elFieldPlace);
    syncSelectEmptyClass(elFieldUserMail);
    syncSelectEmptyClass(elFieldMemo);
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
      elNewViewNameField.style.display = 'block';
      // コピー元 select の選択肢を最新化する (モーダル open 時に参照)
      // elCopySection 自体は非表示のまま維持する (モーダルが UI を担うため)
      rebuildCopySourceSelect(null);
      // 新規作成モード: 「保存」は disabled、「保存して更新」は enabled
      setSubmitButtonsState(true);
      setSubmitDeployButtonsState(false);
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

    // 既存ビュー選択時: 新規ビュー名フィールドは非表示
    // elCopySection は非表示のまま維持する (モーダルが UI を担うため)
    elNewViewNameField.style.display = 'none';

    // 既存ビュー選択時: 「保存」「保存して更新」両方 enabled
    setSubmitButtonsState(false);
    setSubmitDeployButtonsState(false);

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
   * モーダル内 select (elCopySourceModal) の選択肢を最新のビュー一覧で更新する。
   * @param {string|null} excludeViewId - 除外するビュー ID。null の場合は全件表示 (新規作成モード)
   */
  function rebuildCopySourceSelect(excludeViewId) {
    // CUSTOM ビューを index 順でソートして抽出
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

    /**
     * 対象 select 要素に選択肢を設定する
     * @param {HTMLSelectElement} selectEl
     */
    function buildOptions(selectEl) {
      while (selectEl.options.length > 0) {
        selectEl.remove(0);
      }
      var emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '-- コピー元を選択 --';
      selectEl.appendChild(emptyOpt);

      entries.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = String(v.id);
        opt.textContent = v.name + ' (id: ' + v.id + ')';
        selectEl.appendChild(opt);
      });

      // 選択肢再構築後に空文字状態を反映する
      syncSelectEmptyClass(selectEl);
    }

    if (elCopySourceModal) { buildOptions(elCopySourceModal); }
  }

  /* ====================================================================
   * 初期設定取得
   * ==================================================================== */

  /**
   * v4 の color → bgColor / textColor に変換する（§8.7）
   * @param {Object} rule - v4 形式のルール { fieldCode, fieldType, permission, color }
   * @returns {Object} v5 形式のルール { fieldCode, fieldType, permission, bgColor, textColor }
   */
  function migrateRuleV4toV5(rule) {
    var bgColor = rule.color || '#1976d2';
    return {
      fieldCode:  rule.fieldCode,
      fieldType:  rule.fieldType || 'USER_SELECT',
      permission: rule.permission,
      bgColor:    bgColor,
      textColor:  pickTextColorByBg(bgColor)
    };
  }

  /**
   * v2/v3 → v5 マイグレーション（§8.1, §8.2, §8.7）
   * 1. fieldAccount を先頭 permissionRules に変換（値がある場合のみ）
   * 2. 既存 permissionRules の color → bgColor/textColor に変換
   * 3. color のないエントリは bgColor: #1976d2 / textColor: WCAG 自動判定
   * 4. fieldAccount を fieldMapping から削除
   * @param {Object} config - パース済み設定オブジェクト
   * @returns {Object} version 5 形式に変換した設定オブジェクト
   */
  function migrateToV5(config) {
    var newRules = [];
    var fm = config.fieldMapping || {};

    // 旧 fieldAccount を先頭エントリとして追加（値がある場合のみ）
    if (fm.fieldAccount) {
      var defaultBg = '#1976d2';
      newRules.push({
        fieldCode:  fm.fieldAccount,
        fieldType:  'USER_SELECT',
        permission: 'edit',
        bgColor:    defaultBg,
        textColor:  pickTextColorByBg(defaultBg)
      });
    }

    // 既存 permissionRules を後続に追加し color → bgColor/textColor に変換
    var existingRules = Array.isArray(config.permissionRules) ? config.permissionRules : [];
    existingRules.forEach(function (rule) {
      newRules.push(migrateRuleV4toV5(rule));
    });

    // fieldAccount を削除した fieldMapping を構築
    var newFm = {};
    Object.keys(fm).forEach(function (key) {
      if (key !== 'fieldAccount') { newFm[key] = fm[key]; }
    });

    return {
      version:         5,
      fieldMapping:    newFm,
      permissionRules: newRules,
      views:           config.views || {}
    };
  }

  /**
   * v5 → v6 マイグレーション（§8.8）
   * permissionRules はそのまま維持し、fieldValueRules を空配列で初期化する
   * @param {Object} config - version 5 形式の設定オブジェクト
   * @returns {Object} version 6 形式に変換した設定オブジェクト
   */
  function migrateRuleV5toV6(config) {
    if (!Array.isArray(config.fieldValueRules)) {
      config.fieldValueRules = [];
    }
    config.version = 6;
    return config;
  }

  /**
   * kintone.plugin.app.getConfig で設定を取得し currentConfig を初期化する。
   * - 旧フラット設定 (version 2 未満) は破棄して再初期化 (Q11 確定)
   * - version 2 / 3 / 4 は v5 マイグレーション → v6 マイグレーションをチェーン実行
   * - version 5 は v6 マイグレーションを実行
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
        parsed = rawConfig;
      }
    } catch (e) {
      console.warn('[KC Config] 設定のパース失敗、再初期化します:', e);
      parsed = null;
    }

    // version 2 未満は破棄 (Q11 確定: 旧フラット設定は再初期化)
    if (!parsed || !parsed.version || Number(parsed.version) < 2) {
      console.log('[KC Config] version 2 未満の設定を破棄し再初期化します');
      currentConfig = { version: 6, fieldMapping: {}, permissionRules: [], fieldValueRules: [], views: {} };
      return;
    }

    var ver = Number(parsed.version);

    // version 2 / 3 / 4 → 5 マイグレーション（§8.1, §8.2, §8.7）
    if (ver < 5) {
      console.log('[KC Config] version ' + ver + ' → 5 へマイグレーション実行');
      parsed = migrateToV5(parsed);
    }

    // version 5 → 6 マイグレーション（§8.8）
    if (Number(parsed.version) < 6) {
      console.log('[KC Config] version 5 → 6 へマイグレーション実行');
      parsed = migrateRuleV5toV6(parsed);
    }

    // bgColor / textColor が欠落したエントリを補完（念のため）
    var rules = Array.isArray(parsed.permissionRules) ? parsed.permissionRules : [];
    rules.forEach(function (rule) {
      if (!rule.bgColor) { rule.bgColor = '#1976d2'; }
      if (!rule.textColor) { rule.textColor = pickTextColorByBg(rule.bgColor); }
    });

    currentConfig = {
      version:          6,
      fieldMapping:     parsed.fieldMapping     || {},
      permissionRules:  rules,
      fieldValueRules:  Array.isArray(parsed.fieldValueRules) ? parsed.fieldValueRules : [],
      views:            parsed.views            || {}
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
      populateSelect(elFieldColor,    filterFields(props, COLOR_FIELD_TYPES),  true);
      populateSelect(elFieldPlace,    filterFields(props, TEXT_FIELD_TYPES),   true);
      populateSelect(elFieldUserMail, filterFields(props, TEXT_FIELD_TYPES),   true);
      populateSelect(elFieldMemo,     filterFields(props, MEMO_FIELD_TYPES),   true);

      // 権限ユーザー設定フィールド選択肢を収集する（USER_SELECT 型のみ）
      permissionFieldOptions = [];
      Object.keys(props).forEach(function (code) {
        var field = props[code];
        if (field.type === 'USER_SELECT') {
          permissionFieldOptions.push({
            code:  code,
            label: field.label || code
          });
        }
      });
      permissionFieldOptions.sort(function (a, b) {
        if (a.label < b.label) return -1;
        if (a.label > b.label) return 1;
        return 0;
      });

      // 権限フィールド設定フィールド選択肢を収集する（DROPDOWN/RADIO_BUTTON/CHECK_BOX のみ）
      fieldValueFieldOptions = [];
      Object.keys(props).forEach(function (code) {
        var field = props[code];
        var ftype = field.type;
        if (ftype === 'DROPDOWN' || ftype === 'RADIO_BUTTON' || ftype === 'CHECK_BOX') {
          fieldValueFieldOptions.push({
            code:    code,
            label:   field.label || code,
            type:    ftype,
            options: field.options || {}
          });
        }
      });
      fieldValueFieldOptions.sort(function (a, b) {
        if (a.label < b.label) return -1;
        if (a.label > b.label) return 1;
        return 0;
      });

      return props;
    }).catch(function (err) {
      console.error('[KC Config] フィールド一覧取得失敗:', err);
      showError('フィールド一覧の取得に失敗しました。ページを再読み込みしてください。');
      throw err;
    });
  }

  /**
   * kintone プロセス管理ステータス一覧を取得して statusOptions に設定する。
   * アプリにプロセス管理が設定されていない場合は空配列のまま（STATUS フィールドは非表示）。
   * 未検証: kintone 実機環境での /k/v1/app/status.json の挙動。
   * @returns {Promise<void>}
   */
  async function loadStatuses() {
    try {
      var resp = await kintone.api(
        kintone.api.url('/k/v1/app/status.json', true),
        'GET',
        { app: kintone.app.getId() }
      );
      if (!resp.enable) {
        statusOptions = [];
        return;
      }
      var states = resp.states || {};
      statusOptions = Object.keys(states).sort(function (a, b) {
        var ia = Number(states[a].index);
        var ib = Number(states[b].index);
        return ia - ib;
      });
    } catch (err) {
      console.warn('[KC Config] プロセス管理ステータス取得失敗（プロセス管理未設定の可能性）:', err);
      statusOptions = [];
    }
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
      opt.textContent = v.name;
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

    // ビュー選択プルダウンの値確定後に空文字クラスを同期する
    syncSelectEmptyClass(elPerViewSelect);
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
   * 「コピー実行」ボタンのハンドラ (35 行: 30 行規約超過だが分割しない判断)
   * 責務は「① バリデーション (6 行)」「② フォーム転記 (9 行)」「③ メッセージ生成・後処理 (8 行)」の 3 段階。
   * いずれも独立して抽出するほどの再利用性がないため、1 関数にまとめている。
   * - モーダル内の select (elCopySourceModal) から選択値を取得する
   * - コピー元の calendarTitle / defaultView を現在のフォームに転記する
   * - フィールドマッピングはコピー対象外 (共通のため)
   * - 成功時: モーダルを閉じて設定画面側の kc-config-error エリアに成功メッセージを表示する
   * - 失敗時: モーダル内の kc-copy-result にエラーを表示する
   */
  function handleCopyFromView() {
    var srcViewId = elCopySourceModal ? elCopySourceModal.value : '';
    if (!srcViewId) {
      if (elCopyResult) {
        elCopyResult.textContent = 'コピー元のビューを選択してください。';
        elCopyResult.className = 'kc-modal-msg kc-copy-result kc-copy-result--error';
      }
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
    console.log('[KC Config] コピー実行:', srcViewId, srcCfg);

    // 成功: モーダルを閉じてビュー選択にフォーカスを戻し、設定画面側に成功メッセージを表示する (REQ §3.3.1)
    closeModal(elPerViewSelect);
    showSuccess(msg);
  }

  /* ====================================================================
   * コピーモーダル開閉
   * ==================================================================== */

  /**
   * ESC キーでモーダルを閉じるハンドラ。
   * openModal で登録し closeModal で解除することで二重登録を防ぐ (REQ §6.2)。
   */
  function handleEscKey(e) {
    if (e.key === 'Escape') { closeModal(elCopyOpenModal); }
  }

  /**
   * コピーモーダルを開く
   * - コピー元ドロップダウンを最新化してから表示する
   * - モーダル内のエラーメッセージをリセットする
   * - #kc-copy-source-modal にフォーカスを移す (REQ §3.3.1)
   */
  function openModal() {
    if (!elCopyModal) { return; }
    // コピー元 select を最新のビュー状態で再構築する
    rebuildCopySourceSelect(currentViewId);
    // エラーメッセージをリセット
    if (elCopyResult) {
      elCopyResult.textContent = '';
      elCopyResult.className = 'kc-modal-msg kc-copy-result';
    }
    elCopyModal.removeAttribute('hidden');
    // ESC ハンドラを登録 (重複登録防止のため先に解除)
    document.removeEventListener('keydown', handleEscKey);
    document.addEventListener('keydown', handleEscKey);
    // フォーカスをモーダル内の最初の操作要素へ移す
    if (elCopySourceModal) { elCopySourceModal.focus(); }
  }

  /**
   * コピーモーダルを閉じる
   * @param {HTMLElement|null} focusTarget - 閉じた後にフォーカスを戻す要素。省略時は戻さない
   */
  function closeModal(focusTarget) {
    if (!elCopyModal) { return; }
    elCopyModal.setAttribute('hidden', '');
    document.removeEventListener('keydown', handleEscKey);
    if (focusTarget) { focusTarget.focus(); }
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
      newViewName = elNewViewName.value.trim();
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

    // 権限設定を収集して currentConfig.permissionRules を更新
    currentConfig.permissionRules = collectPermissionRules();

    // 権限フィールド設定を収集して currentConfig.fieldValueRules を更新
    currentConfig.fieldValueRules = collectFieldValueRules();

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

      // 最終的な保存オブジェクト (version 6 形式: permissionRules + fieldValueRules を含む)
      var finalConfig = {
        version: 6,
        fieldMapping:    currentConfig.fieldMapping,
        permissionRules: currentConfig.permissionRules  || [],
        fieldValueRules: currentConfig.fieldValueRules  || [],
        views:           mergedViews
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

    setSubmitButtonsState(true, '保存中...');

    var ok = await saveConfig({ updateViews: false });
    if (!ok) {
      setSubmitButtonsState(false, '保存');
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
    setSubmitButtonsState(true);
    setSubmitDeployButtonsState(true, '保存中...');

    var ok = await saveConfig({ updateViews: true });
    if (!ok) {
      setSubmitButtonsState(false);
      setSubmitDeployButtonsState(false, '保存して更新');
      return;
    }

    // 続けてデプロイ (本番反映)
    setSubmitDeployButtonsState(true, 'アプリを更新中...');

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
      setSubmitButtonsState(false);
      setSubmitDeployButtonsState(false, '保存して更新');
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
   * 設定画面の初期化処理 (統合版: Phase 7 + Phase 9 + v6)
   * 1. loadInitialConfig() で既存設定取得・初期化
   * 2. loadFields() でフィールドプルダウン構築
   * 2.5. loadStatuses() でプロセス管理ステータス取得
   * 3. applyFieldMapping() で共通設定を反映
   * 3.5. applyPermissionRules() で権限ユーザー設定を反映
   * 3.6. applyFieldValueRules() で権限フィールド設定を反映
   * 4. refreshPerViewSelect() でビュー個別設定プルダウン構築 (orphan 削除も実行)
   * 5. ボタン初期状態を applyViewConfig の結果に合わせて設定
   */
  async function init() {
    // 初期状態: 「保存」を disabled にしておく (refreshPerViewSelect 後に確定)
    setSubmitButtonsState(true);

    // 1. 既存設定を取得して currentConfig を初期化
    loadInitialConfig();

    // 2. フィールド一覧を取得してプルダウンに反映
    try {
      await loadFields();
    } catch (e) {
      // フィールド取得失敗時も続行 (既存設定値の表示は試みる)
      console.error('[KC Config] フィールド一覧取得失敗:', e);
    }

    // 2.5. プロセス管理ステータスを取得する（権限フィールド設定の STATUS 選択肢に使用）
    await loadStatuses();

    // 3. 共通設定 (fieldMapping) をフォームに反映
    applyFieldMapping(currentConfig.fieldMapping);

    // 3.5. 権限ユーザー設定 (permissionRules) をフォームに反映
    // loadFields が完了した後に呼ぶこと（permissionFieldOptions が確定している必要があるため）
    applyPermissionRules(currentConfig.permissionRules || []);

    // 3.6. 権限フィールド設定 (fieldValueRules) をフォームに反映
    // loadFields + loadStatuses 完了後に呼ぶこと
    applyFieldValueRules(currentConfig.fieldValueRules || []);

    // 4. ビュー一覧を取得してプルダウンを構築 (orphan 削除も実行)
    try {
      await refreshPerViewSelect();
    } catch (e) {
      console.error('[KC Config] ビュー一覧初期化失敗:', e);
    }

    // 静的 select に変更追跡リスナーを登録する（change 時に空文字クラスを切り替える）
    // populateSelect / applyFieldMapping での初期反映済みのため、ここでは change のみ追加する
    [
      elFieldTitle, elFieldStart, elFieldEnd, elFieldAllday,
      elFieldColor, elFieldPlace, elFieldUserMail, elFieldMemo
    ].forEach(function (sel) {
      if (!sel) { return; }
      sel.addEventListener('change', function () { syncSelectEmptyClass(sel); });
    });

    // ビュー選択プルダウンにも空文字クラス同期を登録する（初期状態も反映）
    attachSelectEmptyClassSync(elPerViewSelect);

    // ボタンイベントを登録 (上下 2 セット分を forEach で一括登録)
    elSubmits.forEach(function (btn) { btn.addEventListener('click', handleSubmit); });
    elSubmitDeploys.forEach(function (btn) { btn.addEventListener('click', handleSubmitAndDeploy); });
    elCancels.forEach(function (btn) { btn.addEventListener('click', handleCancel); });

    // ビュー個別設定
    elPerViewSelect.addEventListener('change', handleViewSelectChange);

    // コピーモーダル開閉
    if (elCopyOpenModal) {
      elCopyOpenModal.addEventListener('click', openModal);
    }
    if (elCopyModalClose) {
      // × ボタン: 閉じてコピーボタンへフォーカスを戻す (REQ §3.3.1)
      elCopyModalClose.addEventListener('click', function () { closeModal(elCopyOpenModal); });
    }
    if (elCopyModalCancel) {
      // キャンセル: 閉じてコピーボタンへフォーカスを戻す (REQ §3.3.1)
      elCopyModalCancel.addEventListener('click', function () { closeModal(elCopyOpenModal); });
    }
    // オーバーレイ背景クリックで閉じる (モーダル content 内はバブルを止めない)
    if (elCopyModal) {
      elCopyModal.addEventListener('click', function (e) {
        // 背景クリック時はフォーカス戻し先を指定しない (キャンセルと同等)
        if (e.target === elCopyModal) { closeModal(elCopyOpenModal); }
      });
    }

    // コピー実行ボタン (モーダル内)
    if (elCopyExecute) {
      elCopyExecute.addEventListener('click', handleCopyFromView);
    }

    // ESC キーハンドラは openModal/closeModal 内で登録・解除する (Med-1: 常時登録を廃止)

    // 権限ユーザー設定 − 行追加ボタン
    if (elPermissionAdd) {
      elPermissionAdd.addEventListener('click', function () {
        elPermissionRows.appendChild(buildPermissionRow(null));
      });
    }

    // 権限フィールド設定 − 行追加ボタン
    if (elFieldValueAdd) {
      elFieldValueAdd.addEventListener('click', function () {
        elFieldValueRows.appendChild(buildFieldValueRow(null));
      });
    }

    // カラーパレット − ポップオーバー外クリックで閉じる
    document.addEventListener('mousedown', function (e) {
      if (!e.target.closest('.kc-color-picker-wrapper')) {
        closeAllColorPopovers();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init().catch(function (e) {
      console.error('[KC Config] 初期化エラー:', e);
    });
  });

})(kintone.$PLUGIN_ID);
