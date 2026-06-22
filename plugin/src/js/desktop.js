/**
 * desktop.js
 * KC Calendar プラグイン — デスクトップカレンダー本体
 *
 * src/kc-calendar.js を基に以下の変更を適用したプラグイン対応版:
 *   - IIFE を (function(PLUGIN_ID) { ... })(kintone.$PLUGIN_ID) 形式に変更
 *   - KC.Config.loadFromPluginConfig() を追加し、起動時にプラグイン設定を読み込む
 *   - calendarTitle が設定済みの場合は detectAppName() をスキップする
 *   - defaultView が設定済みの場合は KC.State.view に反映する
 *
 * 前提: カスタマイズビューHTML に <div id="kc-root" class="kc-root"></div> が設定済み
 * フォールバック戦略: プラグイン設定なし → KC_プレフィックス自動検出 → エラー
 */
(function (PLUGIN_ID) {
  'use strict';

  /* ====================================================================
   * P-11: デバッグログ制御
   * KC_DEBUG = true に設定すると console.log の正常系ログが出力される。
   * 既定値は false（本番環境でのコンソール汚染防止）。
   * console.warn / console.error は KC_DEBUG によらず常に出力される（診断・エラーログ）。
   * ==================================================================== */
  var KC_DEBUG = (typeof window !== 'undefined' && window.KC_DEBUG === true);

  /* ====================================================================
   * ビルド識別子
   * 実機でどのビルドが動いているか確認するためのスタンプ。
   * console.warn は KC_DEBUG によらず常に出力される（上記コメント参照）。
   * ==================================================================== */
  var KC_BUILD = '2026-06-22-daygrid-phase1e';
  try { if (typeof window !== 'undefined') window.KC_BUILD = KC_BUILD; } catch (e) {}
  // eslint-disable-next-line no-console
  console.warn('[KC] build ' + KC_BUILD);

  /**
   * デバッグログ出力（KC_DEBUG が true の場合のみ出力）
   * console.log の直接呼び出しをこれに置き換えることで本番ログを抑制する
   */
  function _log() {
    if (!KC_DEBUG) return;
    // eslint-disable-next-line no-console
    console.log.apply(console, arguments);
  }

  /* ====================================================================
   * 名前空間
   * ==================================================================== */
  var KC = {};

  /* ====================================================================
   * KC.Config — フィールドコード定義
   * ==================================================================== */
  KC.Config = {
    getAppId: function () { return kintone.app.getId(); },

    // プレフィックス
    FIELD_PREFIX: 'KC_',

    // 固定サフィックス → 内部キーのマッピング
    FIELD_KEYS: {
      title:    { required: true,  type: 'SINGLE_LINE_TEXT' },
      start:    { required: true,  type: 'DATETIME' },
      end:      { required: true,  type: 'DATETIME' },
      allday:   { required: false, type: 'CHECK_BOX' },
      color:    { required: false, type: null },
      status:   { required: false, type: 'DROP_DOWN' },
      place:    { required: false, type: null },
      userMail: { required: false, type: null },
      account:  { required: false, type: 'USER_SELECT' },
      memo:     { required: false, type: null },
    },

    // 検出結果を格納（初期値はデフォルトのハードコード値 = 後方互換）
    FIELD: {
      title:    '予定タイトル',
      start:    '開始日時',
      end:      '終了日時',
      allday:   '終日',
      color:    '',
      status:   '貸出ステータス',
      place:    '場所',
      userMail: '利用者メールアドレス',
      account:  'アカウント',
      memo:     '説明欄'
    },

    // KC_start フィールドの型（detectFields で上書きされる）
    START_FIELD_TYPE: 'DATETIME',

    ALLDAY_LABEL: '終日',
    QUERY_LIMIT: 500,

    // フィールド自動検出メソッド
    detectFields: async function () {
      try {
        var url = kintone.api.url('/k/v1/app/form/fields.json', true);
        var resp = await kintone.api(url, 'GET', { app: this.getAppId() });
        var props = resp.properties;
        var prefix = this.FIELD_PREFIX;
        var detected = {};
        var count = 0;

        for (var code in props) {
          if (code.indexOf(prefix) === 0) {
            var key = code.substring(prefix.length);
            if (key in this.FIELD_KEYS) {
              detected[key] = code;
              count++;
            }
          }
        }

        if (count > 0) {
          // KC_ フィールドが見つかった → 検出結果で上書き
          for (var k in detected) {
            this.FIELD[k] = detected[k];
          }
          // 検出されなかった任意フィールドは空文字にする（デフォルト値を使わない）
          for (var k2 in this.FIELD_KEYS) {
            if (!(k2 in detected) && !this.FIELD_KEYS[k2].required) {
              this.FIELD[k2] = '';
            }
          }
          _log('[KC] フィールド自動検出完了:', detected);
        } else {
          _log('[KC] KC_プレフィックスのフィールドなし。デフォルト値を使用');
        }

        // 必須フィールドチェック
        var missing = [];
        for (var k3 in this.FIELD_KEYS) {
          if (this.FIELD_KEYS[k3].required && !this.FIELD[k3]) {
            missing.push(prefix + k3);
          }
        }
        if (missing.length > 0) {
          throw new Error('必須フィールドが見つかりません: ' + missing.join(', '));
        }

        // KC_start フィールドの型（DATETIME or DATE）を記録
        this.START_FIELD_TYPE = props[this.FIELD.start] ? props[this.FIELD.start].type : 'DATETIME';
        _log('[KC] START_FIELD_TYPE:', this.START_FIELD_TYPE);

        // P-2: properties を返して呼び出し元が _loadRefTableDefs に再利用できるようにする
        return props;
      } catch (e) {
        console.error('[KC] フィールド検出エラー:', e);
        // エラー時はデフォルト値で続行
        return null;
      }
    },

    /**
     * kintone アプリ名を REST API で取得して this.APP_NAME に格納
     * @returns {Promise<string>} アプリ名 (失敗時はフォールバック値)
     */
    detectAppName: async function () {
      try {
        var resp = await kintone.api(
          kintone.api.url('/k/v1/app.json', true),
          'GET',
          { id: this.getAppId() }
        );
        this.APP_NAME = resp.name || 'カレンダー';
        _log('[KC.Config] APP_NAME:', this.APP_NAME);
      } catch (err) {
        console.warn('[KC.Config] アプリ名取得失敗、フォールバック使用:', err);
        this.APP_NAME = 'カレンダー';
      }
      return this.APP_NAME;
    },

    /**
     * kintone プラグイン設定から KC.Config の各値を上書きする (Phase 9: 2 階層設計対応)。
     * プラグイン設定が存在しない / version 2 未満の場合はハードコード値を維持する（フォールバック）。
     * KC.Boot.init の冒頭で呼び出すこと。
     * @param {string|number|null} [viewId] - app.record.index.show イベントの event.viewId
     *
     * 保存形式 (version 6):
     *   getConfig 返り値の .config キーを JSON.parse した 2 階層オブジェクトを使用する
     *   {
     *     version: 6,
     *     fieldMapping: { ... },
     *     permissionRules: [{ fieldCode, fieldType, permission, bgColor, textColor }, ...],
     *     fieldValueRules: [{ fieldCode, fieldType, value, permission, bgColor, textColor }, ...],
     *     views: { "<viewId>": { calendarTitle, defaultView } }
     *   }
     *
     * 設定キーと KC.Config の対応 (fieldMapping 共通取得):
     *   fieldMapping.fieldTitle    → KC.Config.FIELD.title
     *   fieldMapping.fieldStart    → KC.Config.FIELD.start
     *   fieldMapping.fieldEnd      → KC.Config.FIELD.end
     *   fieldMapping.fieldAllday   → KC.Config.FIELD.allday
     *   fieldMapping.fieldColor    → KC.Config.FIELD.color
     *   fieldMapping.fieldPlace    → KC.Config.FIELD.place
     *   fieldMapping.fieldUserMail → KC.Config.FIELD.userMail
     *   fieldMapping.fieldMemo     → KC.Config.FIELD.memo
     *   fieldMapping.alldayLabel   → KC.Config.ALLDAY_LABEL
     *   (fieldMapping.fieldAccount は v4 で廃止。permissionRules に移行)
     *
     * 権限ルール設定:
     *   permissionRules → KC.Config.PERMISSION_RULES
     *   v2/v3 の設定（permissionRules なし）は空配列でフォールバック（全員 edit 扱い）
     *
     * ビュー個別設定 (views[viewId] から取得):
     *   calendarTitle → KC.Config.CALENDAR_TITLE / KC.Config.APP_NAME
     *   defaultView   → KC.State.view (初期ビュー)
     *
     * 旧フラット設定 (version キーなし): 破棄 (Q11 確定)。detectFields フォールバックへ。
     * (excludedStatuses は Phase 8 で廃止。旧設定値は無視する)
     */
    loadFromPluginConfig: function (viewId) {
      var rawConfig = kintone.plugin.app.getConfig(PLUGIN_ID);

      // 設定なし (初回インストール・設定未完了) はハードコード値を維持
      if (!rawConfig || Object.keys(rawConfig).length === 0) {
        _log('[KC.Config] プラグイン設定なし。ハードコード値 / detectFields を使用');
        return;
      }

      // config.js は { config: JSON.stringify(obj) } 形式で保存する
      var config;
      try {
        var jsonStr = rawConfig.config;
        if (jsonStr) {
          config = JSON.parse(jsonStr);
        } else {
          // 互換: rawConfig 全体がオブジェクトの場合を試みる (旧形式)
          config = rawConfig;
        }
      } catch (e) {
        console.error('[KC.Config] プラグイン設定のパース失敗:', e);
        return;
      }

      // version 2 未満は旧フラット設定として破棄 (Q11 確定)
      if (!config || !config.version || Number(config.version) < 2) {
        _log('[KC.Config] version 2 未満の設定を無視。detectFields フォールバックへ');
        return;
      }

      // 共通設定 (fieldMapping) を適用（fieldAccount は v4 で廃止のため参照しない）
      var fm = config.fieldMapping;
      if (fm) {
        if (fm.fieldTitle)    KC.Config.FIELD.title    = fm.fieldTitle;
        if (fm.fieldStart)    KC.Config.FIELD.start    = fm.fieldStart;
        if (fm.fieldEnd)      KC.Config.FIELD.end      = fm.fieldEnd;
        if (fm.fieldAllday)   KC.Config.FIELD.allday   = fm.fieldAllday;
        if (fm.fieldColor)    KC.Config.FIELD.color    = fm.fieldColor;
        if (fm.fieldPlace)    KC.Config.FIELD.place    = fm.fieldPlace;
        if (fm.fieldUserMail) KC.Config.FIELD.userMail = fm.fieldUserMail;
        if (fm.fieldMemo)     KC.Config.FIELD.memo     = fm.fieldMemo;
        if (fm.alldayLabel)   KC.Config.ALLDAY_LABEL   = fm.alldayLabel;
      }

      // ビュー個別設定 (views[viewId]) を適用
      // viewId は app.record.index.show の event.viewId を引数として受け取る
      // （kintone.app.getViewId() は存在しない API のため使用しない）
      if (config.views && viewId != null) {
        try {
          var viewIdStr = String(viewId);
          var viewCfg = config.views[viewIdStr];
          if (viewCfg) {
            // カレンダータイトル: 空文字なら detectAppName フォールバック
            if (viewCfg.calendarTitle && viewCfg.calendarTitle.trim()) {
              KC.Config.CALENDAR_TITLE = viewCfg.calendarTitle.trim();
              KC.Config.APP_NAME = viewCfg.calendarTitle.trim();
              _log('[KC.Config] calendarTitle (ビュー個別):', KC.Config.CALENDAR_TITLE);
            }
            // デフォルトビュー
            if (viewCfg.defaultView &&
                ['month', 'week', 'day'].indexOf(viewCfg.defaultView) !== -1) {
              KC.State.view = viewCfg.defaultView;
              _log('[KC.Config] defaultView (ビュー個別):', KC.State.view);
            }
          } else {
            _log('[KC.Config] views[' + viewIdStr + '] なし。共通設定でフォールバック動作');
          }
        } catch (e) {
          console.warn('[KC.Config] ビュー個別設定の適用に失敗。共通設定でフォールバック:', e);
        }
      } else if (config.views && viewId == null) {
        _log('[KC.Config] viewId 未取得のためビュー個別設定をスキップ。共通設定を使用');
      }

      // 権限ユーザールール (version 2 以降) を適用
      // v2/v3/v4 の設定は permissionRules なし / color プロパティのみ → 空配列 or フォールバック
      // bgColor/textColor が欠落したエントリは desktop.js 側で補完する（v4→v5 後方互換）
      var rawRules = Array.isArray(config.permissionRules) ? config.permissionRules : [];
      KC.Config.PERMISSION_RULES = rawRules.map(function (rule) {
        if (rule.bgColor) { return rule; }
        // v4 形式（color プロパティのみ）の後方互換処理
        var bgColor = rule.color || '#1976d2';
        return {
          fieldCode:  rule.fieldCode,
          fieldType:  rule.fieldType || 'USER_SELECT',
          permission: rule.permission,
          bgColor:    bgColor,
          textColor:  rule.textColor || pickTextColorByBg(bgColor)
        };
      });

      // フィールド値権限ルール (version 6 以降) を適用
      // v5 以前の設定では fieldValueRules が存在しないため空配列として初期化する（§8.3 後方互換）
      KC.Config.FIELDVALUE_RULES = Array.isArray(config.fieldValueRules) ? config.fieldValueRules : [];

      // 検索対象フィールド設定 (version 7 以降) を適用
      // v6 以前の設定では searchTargets が存在しないため空配列として初期化する
      // v7 マイグレーション済みの場合はタイトルフィールドが含まれるため、タイトル検索は継続する
      KC.Config.SEARCH_TARGETS = Array.isArray(config.searchTargets) ? config.searchTargets : [];

      // メールアドレス初期値設定 (fieldMapping.mailLoginUserDefault が存在しない場合は false: 後方互換デフォルト)
      KC.Config.MAIL_LOGIN_USER_DEFAULT =
        (config.fieldMapping && config.fieldMapping.mailLoginUserDefault === true);

      // DnD 重複チェック設定 (REQ_dnd-overlap-block §9B, version 9 以降)
      // version 8 以前の設定には overlapMode が存在しないため後方互換デフォルトを適用（NF-3）:
      //   overlapKeyFieldCode が空文字 → 'none'、非空 → 'fieldKey'（モード A として引き継ぐ）
      var fm9 = config.fieldMapping || {};
      KC.Config.OVERLAP_MODE =
        fm9.overlapMode ? fm9.overlapMode
        : (fm9.overlapKeyFieldCode ? 'fieldKey' : 'none');
      KC.Config.OVERLAP_KEY_FIELD_CODE = fm9.overlapKeyFieldCode || '';
      KC.Config.OVERLAP_KEY_FIELD_TYPE = fm9.overlapKeyFieldType || '';
      KC.Config.OVERLAP_REF_TABLE_FIELD_CODE         = fm9.overlapRefTableFieldCode          || '';
      KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD         = fm9.overlapRefTableJoinFieldCode       || '';
      KC.Config.OVERLAP_REF_TABLE_RELATED_JOIN_FIELD = fm9.overlapRefTableRelatedJoinFieldCode || '';
      KC.Config.OVERLAP_REF_TABLE_RELATED_APP        = fm9.overlapRefTableRelatedAppId         || '';
      KC.Config.OVERLAP_RESOURCE_FIELD_CODE          = fm9.overlapResourceFieldCode            || '';

      _log('[KC.Config] loadFromPluginConfig 完了。FIELD:', KC.Config.FIELD,
        'PERMISSION_RULES:', KC.Config.PERMISSION_RULES,
        'FIELDVALUE_RULES:', KC.Config.FIELDVALUE_RULES,
        'SEARCH_TARGETS:', KC.Config.SEARCH_TARGETS,
        'OVERLAP_MODE:', KC.Config.OVERLAP_MODE,
        'OVERLAP_KEY_FIELD_CODE:', KC.Config.OVERLAP_KEY_FIELD_CODE);

      // P-7: loadEvents が毎回再構築しているフィールドリストを Config 確定後に一度だけ構築してキャッシュする。
      // OVERLAP_MODE や PERMISSION_RULES 等が確定した後でないと正確なリストが作れないためここで構築する。
      KC.Config._buildCachedFieldList();
    }
  };

  // detectAppName 完了前のフォールバック用初期値
  KC.Config.APP_NAME = 'カレンダー';
  // calendarTitle 設定済みフラグ用プロパティ（空文字 = 未設定 = detectAppName を実行）
  KC.Config.CALENDAR_TITLE = '';
  /**
   * 権限ユーザールール配列 (REQ_edit-permission-extension v6 §6.1)
   * loadFromPluginConfig で上書きされる。初期値は空配列 = 全員 edit 権限（フォールバック）
   * @type {Array<{fieldCode: string, fieldType: string, permission: string, bgColor: string, textColor: string}>}
   */
  KC.Config.PERMISSION_RULES = [];
  /**
   * フィールド値権限ルール配列 (REQ_edit-permission-extension v6 §6.1)
   * loadFromPluginConfig で上書きされる。初期値は空配列 = フォールバック
   * @type {Array<{fieldCode: string, fieldType: string, value: string, permission: string, bgColor: string, textColor: string}>}
   */
  KC.Config.FIELDVALUE_RULES = [];
  /**
   * 検索対象フィールド配列 (REQ_search-bar v3 §6.1)
   * loadFromPluginConfig で上書きされる。初期値は空配列 = 何もマッチしない（検索無効化に近い動作）。
   * v7 以降は config.js のマイグレーションでタイトルフィールドが初期値として設定される。
   * @type {Array<{fieldCode: string}>}
   */
  KC.Config.SEARCH_TARGETS = [];
  /**
   * メールアドレス初期値設定フラグ
   * loadFromPluginConfig で上書きされる。初期値は false（後方互換デフォルト）
   * @type {boolean}
   */
  KC.Config.MAIL_LOGIN_USER_DEFAULT = false;
  /**
   * DnD 重複チェック判定モード (REQ_dnd-overlap-block §9B)
   * loadFromPluginConfig で上書きされる。
   * 'none': 無効（デフォルト） / 'fieldKey': モード A（通常フィールド方式） / 'refTable': モード B（関連レコード方式）
   * @type {string}
   */
  KC.Config.OVERLAP_MODE = 'none';
  /**
   * DnD 重複チェック用リソースキーフィールドコード (REQ_dnd-overlap-block §9A, モード A)
   * loadFromPluginConfig で上書きされる。空文字 = 重複チェック無効（後方互換デフォルト）
   * @type {string}
   */
  KC.Config.OVERLAP_KEY_FIELD_CODE = '';
  /**
   * DnD 重複チェック用リソースキーフィールド型 (REQ_dnd-overlap-block §9A, モード A)
   * loadFromPluginConfig で上書きされる。空文字 = 無効
   * 使用する演算子の決定に利用する: USER_SELECT → in、その他 → =
   * @type {string}
   */
  KC.Config.OVERLAP_KEY_FIELD_TYPE = '';
  /**
   * モード B: 予約アプリ側の REFERENCE_TABLE フィールドコード
   * @type {string}
   */
  KC.Config.OVERLAP_REF_TABLE_FIELD_CODE = '';
  /**
   * モード B: 紐付け条件の予約アプリ側フィールドコード（REFERENCE_TABLE の referenceTable.condition.field）
   * loadEvents の fieldList に追加され、KcEvent の rawRefTableJoinValue として保持される。
   * Step1 の fields 取得・Step2 の joinVal 収集に使用する。
   * @type {string}
   */
  KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD = '';
  /**
   * モード B: 紐付け条件の関連先アプリ側フィールドコード（REFERENCE_TABLE の referenceTable.condition.relatedField）
   * Step3 の in クエリと Step4 の取り出しに使用する（予約側の joinField とは別）。
   * @type {string}
   */
  KC.Config.OVERLAP_REF_TABLE_RELATED_JOIN_FIELD = '';
  /**
   * モード B: 関連先アプリ ID（文字列）
   * @type {string}
   */
  KC.Config.OVERLAP_REF_TABLE_RELATED_APP = '';
  /**
   * モード B: 関連先アプリ側のリソース識別フィールドコード
   * @type {string}
   */
  KC.Config.OVERLAP_RESOURCE_FIELD_CODE = '';

  /**
   * P-7: loadEvents が使う fields パラメータのキャッシュ。
   * loadFromPluginConfig の完了後に _buildCachedFieldList() で一度だけ構築する。
   * null の場合は loadEvents が従来通り毎回構築する（初回起動・設定変更後のフォールバック）。
   * @type {string[]|null}
   */
  KC.Config._cachedFieldList = null;

  /**
   * P-7: Config 確定後に loadEvents の fields リストを事前構築してキャッシュする。
   * loadFromPluginConfig の末尾から呼ばれる。
   */
  KC.Config._buildCachedFieldList = function () {
    var F = KC.Config.FIELD;
    var fieldList = ['$id', '$revision', '$created'];
    for (var key in F) {
      if (F[key]) fieldList.push(F[key]);
    }
    var permRules = KC.Config.PERMISSION_RULES || [];
    for (var pri = 0; pri < permRules.length; pri++) {
      var pfc = permRules[pri].fieldCode;
      if (pfc && fieldList.indexOf(pfc) === -1) fieldList.push(pfc);
    }
    var fvRules = KC.Config.FIELDVALUE_RULES || [];
    for (var fvri = 0; fvri < fvRules.length; fvri++) {
      var fvfc = fvRules[fvri].fieldCode;
      if (fvfc && fieldList.indexOf(fvfc) === -1) fieldList.push(fvfc);
    }
    var overlapKeyCode = KC.Config.OVERLAP_KEY_FIELD_CODE;
    if (KC.Config.OVERLAP_MODE === 'fieldKey' && overlapKeyCode && fieldList.indexOf(overlapKeyCode) === -1) {
      fieldList.push(overlapKeyCode);
    }
    var refJoinField = KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD;
    if (KC.Config.OVERLAP_MODE === 'refTable' && refJoinField && fieldList.indexOf(refJoinField) === -1) {
      fieldList.push(refJoinField);
    }
    KC.Config._cachedFieldList = fieldList;
  };

  /* ====================================================================
   * WCAG 輝度ユーティリティ (REQ §8.7)
   * config.js の同名関数と整合させる。
   * ==================================================================== */
  /**
   * WCAG 相対輝度を計算する (§8.7)
   * @param {string} hex - '#RRGGBB' 形式の色
   * @returns {number} 0〜1 の輝度値
   */
  function getRelativeLuminance(hex) {
    if (!hex || typeof hex !== 'string') return 0;
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

  /* ====================================================================
   * KC.Utils — 日付ユーティリティ
   * ==================================================================== */
  KC.Utils = {
    pad2: function (n) { return String(n).padStart(2, '0'); },

    fmtYMD: function (d) {
      return d.getFullYear() + '-' + this.pad2(d.getMonth() + 1) + '-' + this.pad2(d.getDate());
    },

    addDays: function (d, n) {
      var x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    },

    addMs: function (isoStr, ms) {
      return new Date(new Date(isoStr).getTime() + ms).toISOString();
    },

    /** ISO文字列 → datetime-local 用文字列 */
    toLocalInput: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      var m = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return m.toISOString().slice(0, 16);
    },

    /** datetime-local 値 → ISO文字列 */
    fromLocalInput: function (val) {
      if (!val) return null;
      var l = new Date(val);
      return new Date(l.getTime() - l.getTimezoneOffset() * 60000).toISOString();
    },

    /** XSS対策用エスケープ */
    escapeHtml: function (str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    /**
     * 日本の祝日判定（ハードコード版・フォールバック用）
     * _getHolidayNameHardcoded(date) → 祝日名 or null
     * 外部 API が利用できない場合のフォールバックとして KC.Holidays から呼ばれる。
     */
    _getHolidayNameHardcoded: function (date) {
      var y = date.getFullYear();
      var m = date.getMonth() + 1; // 1-12
      var d = date.getDate();
      var dow = date.getDay(); // 0=日

      // 第N月曜日を求めるヘルパー
      function nthMonday(year, month, n) {
        var first = new Date(year, month - 1, 1);
        var firstDow = first.getDay();
        var day = 1 + ((8 - firstDow) % 7) + (n - 1) * 7;
        return day;
      }

      // 春分の日（簡易計算）
      function vernalEquinox(year) {
        if (year >= 2000 && year <= 2099) {
          return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        }
        return 20; // フォールバック
      }

      // 秋分の日（簡易計算）
      function autumnalEquinox(year) {
        if (year >= 2000 && year <= 2099) {
          return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        }
        return 23; // フォールバック
      }

      // 固定祝日
      var fixedHolidays = {
        '1-1': '元日',
        '2-11': '建国記念の日',
        '2-23': '天皇誕生日',
        '4-29': '昭和の日',
        '5-3': '憲法記念日',
        '5-4': 'みどりの日',
        '5-5': 'こどもの日',
        '8-11': '山の日',
        '11-3': '文化の日',
        '11-23': '勤労感謝の日'
      };

      var key = m + '-' + d;
      if (fixedHolidays[key]) return fixedHolidays[key];

      // 可変祝日（第N月曜日）
      if (m === 1 && d === nthMonday(y, 1, 2)) return '成人の日';
      if (m === 7 && d === nthMonday(y, 7, 3)) return '海の日';
      if (m === 9 && d === nthMonday(y, 9, 3)) return '敬老の日';
      if (m === 10 && d === nthMonday(y, 10, 2)) return 'スポーツの日';

      // 春分の日
      if (m === 3 && d === vernalEquinox(y)) return '春分の日';

      // 秋分の日
      if (m === 9 && d === autumnalEquinox(y)) return '秋分の日';

      // 振替休日: 祝日が日曜の場合、翌月曜が振替休日
      if (dow === 1) { // 月曜日の場合、前日（日曜）が祝日かチェック
        var yesterday = new Date(y, m - 1, d - 1);
        var ym = yesterday.getMonth() + 1;
        var yd = yesterday.getDate();
        var ykey = ym + '-' + yd;
        var isYesterdayHoliday = !!fixedHolidays[ykey];
        if (!isYesterdayHoliday) {
          // 可変祝日チェック
          var yy = yesterday.getFullYear();
          if (ym === 1 && yd === nthMonday(yy, 1, 2)) isYesterdayHoliday = true;
          if (ym === 7 && yd === nthMonday(yy, 7, 3)) isYesterdayHoliday = true;
          if (ym === 9 && yd === nthMonday(yy, 9, 3)) isYesterdayHoliday = true;
          if (ym === 10 && yd === nthMonday(yy, 10, 2)) isYesterdayHoliday = true;
          if (ym === 3 && yd === vernalEquinox(yy)) isYesterdayHoliday = true;
          if (ym === 9 && yd === autumnalEquinox(yy)) isYesterdayHoliday = true;
        }
        if (isYesterdayHoliday) return '振替休日';
      }

      // 国民の休日: 祝日に挟まれた平日は休日
      // 前日と翌日がともに祝日であれば国民の休日
      var prevDate = new Date(y, m - 1, d - 1);
      var nextDate = new Date(y, m - 1, d + 1);
      var self = this;
      // 再帰を避けるため、直接チェック（振替休日・国民の休日は除く）
      function isBaseHoliday(dt) {
        var dm = dt.getMonth() + 1;
        var dd = dt.getDate();
        var dk = dm + '-' + dd;
        if (fixedHolidays[dk]) return true;
        var dy = dt.getFullYear();
        if (dm === 1 && dd === nthMonday(dy, 1, 2)) return true;
        if (dm === 7 && dd === nthMonday(dy, 7, 3)) return true;
        if (dm === 9 && dd === nthMonday(dy, 9, 3)) return true;
        if (dm === 10 && dd === nthMonday(dy, 10, 2)) return true;
        if (dm === 3 && dd === vernalEquinox(dy)) return true;
        if (dm === 9 && dd === autumnalEquinox(dy)) return true;
        return false;
      }
      if (isBaseHoliday(prevDate) && isBaseHoliday(nextDate)) return '国民の休日';

      return null;
    },

    /**
     * 日本の祝日名を返す（KC.Holidays 経由）
     * KC.Holidays が未初期化の場合はハードコードにフォールバック。
     * @param {Date} date
     * @returns {string|null} 祝日名 or null
     */
    getHolidayName: function (date) {
      return KC.Holidays.getName(date);
    }
  };

  /* ====================================================================
   * KC.Holidays — 祝日データ管理（外部 API + ハードコードフォールバック）
   * ==================================================================== */
  KC.Holidays = (function () {
    var API_URL = 'https://holidays-jp.github.io/api/v1/date.json';
    /** @type {Object|null} null: 未取得 / {}: 取得失敗 / {YYYY-MM-DD: name, ...}: 取得済み */
    var _data = null;
    var _fetchPromise = null;

    /**
     * 祝日データを外部 API から取得してキャッシュする。
     * CSP によりブロックされた場合は console.warn のみ出力し、アプリは継続動作する。
     * @returns {Promise<void>}
     */
    function fetchHolidays() {
      if (_fetchPromise) return _fetchPromise;
      _fetchPromise = fetch(API_URL, { cache: 'force-cache' })
        .then(function (resp) {
          if (!resp.ok) throw new Error('Holiday API status ' + resp.status);
          return resp.json();
        })
        .then(function (data) {
          _data = data;
          _log('[KC.Holidays] loaded', Object.keys(data).length, 'entries');
        })
        .catch(function (err) {
          console.warn('[KC.Holidays] API 取得失敗（CSP ブロックの可能性）、ハードコードにフォールバック:', err);
          _data = {};  // 空 = ハードコード使用
        });
      return _fetchPromise;
    }

    /**
     * 指定日の祝日名を返す（API データ優先、なければハードコード）。
     * fetchHolidays() 未完了の場合はハードコードで即時応答する。
     * @param {Date} date
     * @returns {string|null} 祝日名 or null
     */
    function getName(date) {
      // フェッチ未完了: ハードコードで即時応答
      if (_data === null) return KC.Utils._getHolidayNameHardcoded(date);

      var key = KC.Utils.fmtYMD(date);
      // API データに存在すればそちらを優先（振替休日等も含む）
      if (_data[key]) return _data[key];

      // API データにない場合もハードコード側で振替・国民の休日判定をチェック
      return KC.Utils._getHolidayNameHardcoded(date) || null;
    }

    return {
      fetchHolidays: fetchHolidays,
      getName: getName,
      /** @returns {boolean} API データ取得済みかどうか */
      isReady: function () { return _data !== null; }
    };
  })();

  /* ====================================================================
   * KC.State — アプリケーション状態管理
   * ==================================================================== */
  KC.State = {
    view: 'month',
    current: new Date(),
    events: [],
    editing: null,
    alldayExpanded: false,   /* レーン展開トグル状態。初期値 false（折りたたみ）*/
    eventFilter: 'all',      /* イベントフィルタ: 'all' | 'mine' | 'others'（localStorage 永続化）*/
    isAppAdmin: false,        /* アプリ管理権限の有無（_checkAppAdminPermission で更新）*/
    els: {},

    /** DOM参照の再取得 */
    refreshEls: function () {
      var $ = function (id) { return document.getElementById(id); };
      var els = this.els;
      els.root     = $('kc-root');
      els.days     = $('kc-days');
      els.allday   = $('kc-allday');
      els.rows     = $('kc-rows');
      els.timeCol  = $('kc-time-col');
      els.body     = $('kc-body');
      els.range    = $('kc-range-label');
      els.prevBtn  = document.querySelector('[data-action="prev"]');
      els.todayBtn = document.querySelector('[data-action="today"]');
      els.nextBtn  = document.querySelector('[data-action="next"]');
      els.viewWrap = $('kc-view');
      els.viewBtn  = $('kc-view-select');
    }
  };

  /* ====================================================================
   * KC.Api — kintone REST API ラッパー
   * ==================================================================== */
  KC.Api = {
    // in-flight ガード: 前リクエスト完了前の重複 GET を防ぐ
    _loading: false,
    _loadingPromise: null,

    /** kintoneレコード → KcEvent 変換 */
    /** フィールドの値を安全に読み取る（フィールドが存在しない場合は空文字） */
    _safeVal: function (rec, fieldCode, defaultVal) {
      if (defaultVal === undefined) defaultVal = '';
      if (!fieldCode || !rec[fieldCode]) return defaultVal;
      return rec[fieldCode].value || defaultVal;
    },

    /** kintoneレコード → KcEvent 変換 */
    _recordToEvent: function (rec) {
      var F = KC.Config.FIELD;
      var self = this;

      var startVal = self._safeVal(rec, F.start, null);
      var endVal = self._safeVal(rec, F.end, null);

      // 権限対象フィールドの value[].code を収集する（追加 API 呼び出し不要にするため）
      // permissionRules が空の場合は空オブジェクト（フォールバック: 全員 edit）
      var permissionFields = {};
      var rules = KC.Config.PERMISSION_RULES || [];
      for (var ri = 0; ri < rules.length; ri++) {
        var fieldCode = rules[ri].fieldCode;
        if (fieldCode && rec[fieldCode] && Array.isArray(rec[fieldCode].value)) {
          permissionFields[fieldCode] = rec[fieldCode].value.map(function (v) { return v.code || ''; });
        }
      }

      // フィールド値権限判定用のフィールド値を収集する（REQ_edit-permission-extension v6 §6.2）
      // CHECK_BOX は文字列配列、その他（DROP_DOWN/RADIO_BUTTON/STATUS）は文字列で格納する
      var valueFields = {};
      var fvRules = KC.Config.FIELDVALUE_RULES || [];
      for (var fvi = 0; fvi < fvRules.length; fvi++) {
        var fvCode = fvRules[fvi].fieldCode;
        var fvType = fvRules[fvi].fieldType;
        if (!fvCode) continue;
        if (fvCode === '$status') {
          // $status はプロセス管理の特殊フィールドコード（未検証: 実機での動作を要確認）
          valueFields[fvCode] = rec['$status'] ? (rec['$status'].value || '') : '';
        } else if (rec[fvCode]) {
          if (fvType === 'CHECK_BOX') {
            valueFields[fvCode] = Array.isArray(rec[fvCode].value) ? rec[fvCode].value : [];
          } else {
            valueFields[fvCode] = rec[fvCode].value || '';
          }
        }
      }

      // DnD 重複チェック用リソースキーフィールド値を格納（案 A: REQ_dnd-overlap-block §7.3, モード A）
      // USER_SELECT 型: value[].code 配列, その他: 文字列値
      var rawOverlapKeyValue = null;
      var overlapKeyCodeRec = KC.Config.OVERLAP_KEY_FIELD_CODE;
      var overlapKeyTypeRec = KC.Config.OVERLAP_KEY_FIELD_TYPE;
      if (KC.Config.OVERLAP_MODE === 'fieldKey' && overlapKeyCodeRec && rec[overlapKeyCodeRec]) {
        if (overlapKeyTypeRec === 'USER_SELECT') {
          // USER_SELECT: value は [{code, name, ...}, ...] 形式
          var usCodes = Array.isArray(rec[overlapKeyCodeRec].value)
            ? rec[overlapKeyCodeRec].value.map(function (v) { return v.code || ''; }).filter(Boolean)
            : [];
          rawOverlapKeyValue = usCodes;
        } else {
          // 文字列値フィールド（SINGLE_LINE_TEXT / DROP_DOWN / RADIO_BUTTON / NUMBER / LOOKUP 等）
          rawOverlapKeyValue = rec[overlapKeyCodeRec].value != null ? String(rec[overlapKeyCodeRec].value) : '';
        }
      }

      // DnD 重複チェック用紐付けキー値（モード B: 関連レコード方式 §9B）
      // 予約アプリ側の紐付けキーフィールド（例: 申請番号）の値を文字列として保持する
      var rawRefTableJoinValue = null;
      var refJoinFieldRec = KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD;
      if (KC.Config.OVERLAP_MODE === 'refTable' && refJoinFieldRec && rec[refJoinFieldRec]) {
        rawRefTableJoinValue = rec[refJoinFieldRec].value != null ? String(rec[refJoinFieldRec].value) : '';
      }

      var ev = {
        id:               rec.$id.value,
        rev:              rec.$revision.value,
        created:          rec.$created ? rec.$created.value : '',  /* 作成日時 (ISO 8601) — assignLanes のソートキー */
        title:            self._safeVal(rec, F.title),
        status:           self._safeVal(rec, F.status),
        color:            self._safeVal(rec, F.color),
        place:            self._safeVal(rec, F.place),
        userMail:         self._safeVal(rec, F.userMail),
        account:          F.account && rec[F.account] ? ((rec[F.account].value || [])[0]?.code || '') : '',
        memo:             self._safeVal(rec, F.memo),
        permissionFields:    permissionFields,    /* 権限ユーザー判定用フィールド値（REQ §6.2） */
        valueFields:         valueFields,         /* フィールド値権限判定用フィールド値（REQ v6 §6.2） */
        rawOverlapKeyValue:  rawOverlapKeyValue,  /* DnD 重複チェック用リソースキー値（モード A: §7.3 案 A） */
        rawRefTableJoinValue: rawRefTableJoinValue, /* DnD 重複チェック用紐付けキー値（モード B: §9B） */
        record:           rec               /* 元 kintone レコード（Phase 2 追加フィールド検索用） */
      };

      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        // DATE型 → 終日イベントとして扱う
        ev.allday = true;
        if (startVal) {
          // "2025-11-03" → "2025-11-03T00:00:00.000Z"
          ev.start = new Date(startVal + 'T00:00:00').toISOString();
        }
        if (endVal) {
          // 終了日の翌日0時（カレンダー上の終日イベント終端）
          var endDate = new Date(endVal + 'T00:00:00');
          endDate.setDate(endDate.getDate() + 1);
          ev.end = endDate.toISOString();
        }
      } else {
        // DATETIME型 → 通常処理
        ev.start = startVal;
        ev.end = endVal;
        ev.allday = F.allday ? (self._safeVal(rec, F.allday, []) || []).includes(KC.Config.ALLDAY_LABEL) : false;
      }

      return ev;
    },

    /**
     * 一覧取得（通常 GET /records.json: 最大 500 件）
     * @param {string} isoStart - 表示期間の開始日時 (ISO8601)
     * @param {string} isoEnd   - 表示期間の終了日時 (ISO8601)
     * @returns {Promise<Array>} イベントオブジェクトの配列
     *
     * クエリ組み立て仕様 (Phase 8):
     *   1. 期間絞り込み条件 (start < qEnd AND end >= qStart) を常に付与する
     *   2. kintone.app.getQueryCondition() で kintone 一覧の絞り込み条件を取得する
     *      非空文字の場合は AND で結合する (AC26 / AC27)
     *      null または空文字の場合はスキップし期間絞り込みのみで動作する
     *   3. order by 句を末尾に付与し、limit 500 を付与する
     *
     * 変更履歴:
     *   cursor API から通常 GET に切替（REQ_cursor-error-and-notify 案 B）。
     *   運用レコード件数が 500 件以内であることを前提とする。
     *   500 件に達した場合はバナーで超過を通知する（自動ページングは将来課題）。
     */
    loadEvents: function (isoStart, isoEnd) {
      // in-flight ガード: 前リクエストが完了していない場合は進行中の Promise を返す
      // 短時間に複数の refresh() が呼ばれても GET リクエストは 1 本に集約される
      if (this._loading) {
        _log('[KC.Api.loadEvents] 前リクエスト進行中のためスキップ（同 Promise を返す）');
        return this._loadingPromise;
      }

      this._loading = true;
      var self = this;

      this._loadingPromise = (async function () {
        try {
          var F = KC.Config.FIELD;

          // DATE型の場合は "YYYY-MM-DD" 形式でクエリを組む
          var qStart = isoStart;
          var qEnd = isoEnd;
          if (KC.Config.START_FIELD_TYPE === 'DATE') {
            qStart = isoStart.substring(0, 10);
            qEnd = isoEnd.substring(0, 10);
          }

          // クエリ構築（動的）
          var conditions = [];
          conditions.push('(' + F.start + ' < "' + qEnd + '")');
          // ">=" を使う理由:
          // 【DATE 型】kintone の end RAW 値 "YYYY-MM-DD" が qStart（同形式）と等しい
          // 当日限りのイベント（例: 5/1 単日終日）を含めるため。
          // クエリ構築時点では _recordToEvent による翌日変換は適用されておらず、
          // kintone への問い合わせは RAW 値同士の文字列比較となるため "> qStart" では
          // 当日終日イベントが除外されてしまう。
          // 【DATETIME 型】現運用アプリは DATE 型のため実機未検証。
          // eventToBarPosition の getDate()-1 処理によって誤表示は生じない想定だが、
          // DATETIME 型運用が発生した際に挙動を実機確認し、本コメントに追記すること。
          conditions.push('(' + F.end + ' >= "' + qStart + '")');

          // kintone 一覧の絞り込み条件を AND 結合する (Phase 8: AC26/AC27)
          // getQueryCondition() はビュー非表示時や絞り込み未設定時に null または空文字を返す
          var userCondition = kintone.app.getQueryCondition();
          if (userCondition) {
            conditions.push('(' + userCondition + ')');
          }

          // limit 500 を末尾に付与する（通常 GET の上限値）
          var query = conditions.join(' and ') + ' order by ' + F.start + ' asc limit 500';

          // P-7: fields パラメータはキャッシュ済みリストを優先使用する（loadFromPluginConfig 完了後に構築済み）。
          // キャッシュが null（初回 init 前や設定変更後）の場合はフォールバックで毎回構築する。
          var fieldList;
          if (KC.Config._cachedFieldList) {
            // キャッシュをスライスして使う（元配列の汚染防止）
            fieldList = KC.Config._cachedFieldList.slice();
          } else {
            // フォールバック: Config 確定前 or プラグイン設定なし環境
            // $created はシステムフィールドのため FIELD オブジェクトに含まれず明示追加
            fieldList = ['$id', '$revision', '$created'];
            for (var key in F) {
              if (F[key]) fieldList.push(F[key]);
            }
            var permRules = KC.Config.PERMISSION_RULES || [];
            for (var pri = 0; pri < permRules.length; pri++) {
              var pfc = permRules[pri].fieldCode;
              if (pfc && fieldList.indexOf(pfc) === -1) fieldList.push(pfc);
            }
            var fvRulesForField = KC.Config.FIELDVALUE_RULES || [];
            for (var fvri = 0; fvri < fvRulesForField.length; fvri++) {
              var fvfc = fvRulesForField[fvri].fieldCode;
              if (fvfc && fieldList.indexOf(fvfc) === -1) fieldList.push(fvfc);
            }
            var overlapKeyCode = KC.Config.OVERLAP_KEY_FIELD_CODE;
            if (KC.Config.OVERLAP_MODE === 'fieldKey' && overlapKeyCode && fieldList.indexOf(overlapKeyCode) === -1) {
              fieldList.push(overlapKeyCode);
            }
            var refJoinField = KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD;
            if (KC.Config.OVERLAP_MODE === 'refTable' && refJoinField && fieldList.indexOf(refJoinField) === -1) {
              fieldList.push(refJoinField);
            }
          }

          var recordsUrl = kintone.api.url('/k/v1/records.json', true);
          var params = {
            app:    KC.Config.getAppId(),
            query:  query,
            fields: fieldList
          };

          // 通常 GET によるレコード取得（表示期間内は 500 件以内を前提とする）
          var resp = await kintone.api(recordsUrl, 'GET', params);
          var records = resp.records || [];

          // 500 件到達時は表示件数上限に達した可能性をバナーで通知する
          if (records.length >= 500) {
            KC.Banner.show(
              '表示件数が上限（500件）に達しました。期間を絞るか管理者にお問い合わせください。',
              { hideReload: false }
            );
          }

          return records.map(function (r) { return self._recordToEvent(r); });
        } catch (err) {
          console.error('[KC.Api.loadEvents] GET /records.json エラー:', err);
          // 429 Too Many Requests を検知してフラグを付与（呼び出し元で判別用）
          if (err && (err.status === 429 || err.code === 'CB_AU01')) {
            err._isRateLimited = true;
          }
          throw err;
        } finally {
          // リクエスト完了後（成功・失敗問わず）フラグをリセット
          self._loading = false;
          self._loadingPromise = null;
        }
      })();

      return this._loadingPromise;
    },

    /** 作成 */
    /** レコードにフィールド値を安全にセットする（フィールドコードが空なら何もしない） */
    _safeSet: function (record, fieldCode, value) {
      if (fieldCode) record[fieldCode] = { value: value };
    },

    createEvent: async function (ev) {
      var F = KC.Config.FIELD;
      var record = {};
      this._safeSet(record, F.title,    ev.title || '');
      this._safeSet(record, F.status,   ev.status || '');

      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        // ISO → "YYYY-MM-DD"
        if (ev.start) record[F.start] = { value: ev.start.substring(0, 10) };
        if (ev.end) {
          // 終日イベントの end は翌日0時なので、1日戻す
          var d = new Date(ev.end);
          d.setDate(d.getDate() - 1);
          record[F.end] = { value: KC.Utils.fmtYMD(d) };
        }
      } else {
        // DATETIME → そのまま
        if (ev.start) record[F.start] = { value: ev.start };
        if (ev.end) record[F.end] = { value: ev.end };
      }

      if (F.allday) record[F.allday] = { value: ev.allday ? [KC.Config.ALLDAY_LABEL] : [] };
      if (F.color)  this._safeSet(record, F.color, ev.color || '');
      this._safeSet(record, F.place,    ev.place || '');
      this._safeSet(record, F.userMail, ev.userMail || '');
      if (F.account) {
        record[F.account] = ev.account ? { value: [{ code: ev.account }] } : { value: [] };
      }
      this._safeSet(record, F.memo,     ev.memo || '');

      var url = kintone.api.url('/k/v1/record.json', true);
      var resp = await kintone.api(url, 'POST', {
        app: KC.Config.getAppId(),
        record: record
      });
      return resp;
    },

    /**
     * DnD 重複チェッククエリを発行し、重複レコードの先頭 1 件を返す。
     *
     * スコープ: DnD（移動・リサイズ）による日時変更時のベストエフォートな事前チェック。
     * カレンダー JS 以外の保存経路（iframe モーダル・直接編集）は Customine で保護。
     * TOCTOU 競合（チェック後・PUT 前に他ユーザーが同一リソースに保存）は
     * Customine のサーバー側バリデーションが最終防衛線となる（§10.1）。
     *
     * @param {Object} ev - DnD 対象の KcEvent（id, rawOverlapKeyValue を含む）
     * @param {string} newStart - 移動後の開始日時 (ISO 8601)
     * @param {string} newEnd   - 移動後の終了日時 (ISO 8601)
     * @returns {Promise<Array>} 重複レコード配列（0 件 = 重複なし、1 件以上 = ブロック）
     * @throws {Error} API エラー時（FR-4: 呼び出し元でブロック扱いにする）
     *
     * REQ_dnd-overlap-block §7.1〜§7.4 準拠:
     *   - 期間重複条件 (DATE型):
     *       start_field < qNewEnd AND end_field >= qNewStart
     *       DATE RAW値は inclusive なので >= が正しい（loadEvents と同パターン）
     *       隣接（既存 end = 11/03, 新 start = 11/04 の場合）: "11/03" >= "11/04" = false → 非ヒット（AC-7 維持）
     *   - 期間重複条件 (DATETIME型):
     *       start_field < qNewEnd AND end_field > qNewStart（厳密不等号: 隣接は重複なし）
     *   - 自レコード除外: $id != ev.id（FR-6）
     *   - 除外ステータス: kintone.app.getQueryCondition() 条件を AND 結合（loadEvents と同メカニズム）
     *   - fields: $id + タイトルフィールドのみ（バナー表示用、NF-2 応答サイズ最小化）
     *   - limit 1（NF-2 応答サイズ最小化）
     */
    checkOverlapQuery: async function (ev, newStart, newEnd) {
      var F = KC.Config.FIELD;
      var overlapKeyCode = KC.Config.OVERLAP_KEY_FIELD_CODE;
      var overlapKeyType = KC.Config.OVERLAP_KEY_FIELD_TYPE;

      // DATE 型の場合は "YYYY-MM-DD" 形式に変換する（loadEvents の qStart/qEnd と同パターン）
      // DATE RAW 値は _recordToEvent で翌日 UTC に変換されているが、
      // クエリ側は kintone RAW 値（"YYYY-MM-DD"）同士の文字列比較のため -1 日は不要
      var qNewStart = newStart;
      var qNewEnd = newEnd;
      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        qNewStart = newStart.substring(0, 10);
        qNewEnd = newEnd.substring(0, 10);
      }

      // 重複条件: [A_start, A_end] と [newStart, newEnd] が重なるかを判定
      // DATE 型: end は kintone RAW 値が inclusive（当日が終了日）のため >= を使用（loadEvents と同様）
      // DATETIME 型: 厳密不等号（> / <）で隣接は重複なしとする
      var conditions = [];
      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        conditions.push('(' + F.start + ' < "' + qNewEnd + '")');
        conditions.push('(' + F.end + ' >= "' + qNewStart + '")');
      } else {
        conditions.push('(' + F.start + ' < "' + qNewEnd + '")');
        conditions.push('(' + F.end + ' > "' + qNewStart + '")');
      }

      // リソースキー条件（FR-2 / §7.2）
      if (overlapKeyType === 'USER_SELECT') {
        // USER_SELECT: value[].code 配列に対して in 演算子を使用（§7.4）
        var codes = Array.isArray(ev.rawOverlapKeyValue) ? ev.rawOverlapKeyValue : [];
        if (codes.length === 0) {
          // リソースキー値が空 = 判定不能としてスキップ（チェックしない）
          return [];
        }
        var inList = codes.map(function (c) { return '"' + c.replace(/"/g, '\\"') + '"'; }).join(',');
        conditions.push('(' + overlapKeyCode + ' in (' + inList + '))');
      } else {
        // 文字列・数値・ドロップダウン等: = 演算子
        var keyVal = (ev.rawOverlapKeyValue != null) ? String(ev.rawOverlapKeyValue) : '';
        if (keyVal === '') {
          // リソースキー値が空 = 判定不能としてスキップ（チェックしない）
          return [];
        }
        conditions.push('(' + overlapKeyCode + ' = "' + keyVal.replace(/"/g, '\\"') + '")');
      }

      // 自レコード除外（FR-6 / §7.2）
      conditions.push('($id != "' + String(ev.id) + '")');

      // 除外ステータス条件（FR-5 / §7.2）: loadEvents と同メカニズム（kintone.app.getQueryCondition() を AND 結合）
      // カレンダービューに設定された絞り込み条件（除外ステータス等）をそのまま引き継ぐことで
      // 表示除外レコードを重複チェック対象からも除外する
      // null・空文字・取得不能の場合は条件を付けない（フォールバック: より多くのレコードをチェック対象とする方向）
      var userCondition = null;
      try {
        userCondition = kintone.app.getQueryCondition();
      } catch (qcErr) {
        console.warn('[KC.DnD] getQueryCondition 取得失敗、除外条件なしで続行:', qcErr);
      }
      if (userCondition) {
        conditions.push('(' + userCondition + ')');
      }

      var query = conditions.join(' and ') + ' order by $id asc limit 1';

      var url = kintone.api.url('/k/v1/records.json', true);
      var params = {
        app:    KC.Config.getAppId(),
        query:  query,
        fields: ['$id', F.title].filter(Boolean)
      };

      var resp = await kintone.api(url, 'GET', params);
      return resp.records || [];
    },

    /**
     * モード B（関連レコード方式）の重複チェックを実行する（FR-9 / §7.5）
     *
     * ステップ 1: 期間重複候補を取得（リソースキー条件なし、limit 100）
     * ステップ 2: 自レコード + 候補の紐付けキー値を収集
     * ステップ 3: 関連先アプリに in クエリで一括照会 → 申請番号→リソース集合マップ構築
     * ステップ 4: リソース集合の交差判定
     *
     * 設計判断（§10 Q-7）: SearchFilter の _relatedRecordsCache は使用しない。
     * 重複チェックは予約の正確性に直結するため常に最新値を都度取得する（キャッシュ不使用）。
     *
     * @param {Object} ev      - DnD 対象の KcEvent（rawRefTableJoinValue を保持）
     * @param {string} newStart - 移動後の開始日時 (ISO 8601)
     * @param {string} newEnd   - 移動後の終了日時 (ISO 8601)
     * @returns {Promise<{ hasOverlap: boolean, firstRecord: Object|null, isPermissionError: boolean }>}
     */
    checkOverlapQueryModeB: async function (ev, newStart, newEnd) {
      var F = KC.Config.FIELD;
      // joinField:        予約アプリ側フィールドコード（Step1 fields 取得・Step2 値収集用）
      // relatedJoinField: 関連先アプリ側フィールドコード（Step3 in クエリ・Step4 取り出し用）
      var joinField        = KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD;
      var relatedJoinField = KC.Config.OVERLAP_REF_TABLE_RELATED_JOIN_FIELD;
      var relatedAppId     = KC.Config.OVERLAP_REF_TABLE_RELATED_APP;
      var resourceField    = KC.Config.OVERLAP_RESOURCE_FIELD_CODE;

      // 設定不備は安全側（ブロック）にフォールバックする
      if (!joinField || !relatedJoinField || !relatedAppId || !resourceField) {
        console.warn('[KC.Api.checkOverlapQueryModeB] モード B の設定が不完全です。ブロック扱いとします。',
          { joinField: joinField, relatedJoinField: relatedJoinField,
            relatedAppId: relatedAppId, resourceField: resourceField });
        return { hasOverlap: true, firstRecord: null, isPermissionError: false };
      }

      // DATE 型のクエリ形式変換（loadEvents / checkOverlapQuery と同パターン）
      var qNewStart = newStart;
      var qNewEnd   = newEnd;
      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        qNewStart = newStart.substring(0, 10);
        qNewEnd   = newEnd.substring(0, 10);
      }

      // ── ステップ 1: 期間重複候補の取得（リソースキー条件なし, limit 100 / §7.5 / Q-8） ──
      var step1Conditions = [];
      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        step1Conditions.push('(' + F.start + ' < "' + qNewEnd + '")');
        step1Conditions.push('(' + F.end   + ' >= "' + qNewStart + '")');
      } else {
        step1Conditions.push('(' + F.start + ' < "' + qNewEnd + '")');
        step1Conditions.push('(' + F.end   + ' > "' + qNewStart + '")');
      }
      step1Conditions.push('($id != "' + String(ev.id) + '")');

      var userCondition = null;
      try { userCondition = kintone.app.getQueryCondition(); } catch (e) {}
      if (userCondition) { step1Conditions.push('(' + userCondition + ')'); }

      var step1Query = step1Conditions.join(' and ') + ' order by $id asc limit 100';
      var recordsUrl = kintone.api.url('/k/v1/records.json', true);
      var step1Resp = await kintone.api(recordsUrl, 'GET', {
        app:    KC.Config.getAppId(),
        query:  step1Query,
        // joinField（予約側）を取得して Step2 の joinVal 収集に使う
        fields: ['$id', F.title, joinField].filter(Boolean)
      });
      var candidateRecords = step1Resp.records || [];

      // 候補 0 件 → 重複なし（AC-11）
      if (candidateRecords.length === 0) {
        return { hasOverlap: false, firstRecord: null, isPermissionError: false };
      }

      // ── ステップ 2: 紐付けキー値の収集（予約アプリ側 joinField を使う） ──
      // 自レコードの joinVal（KcEvent.rawRefTableJoinValue = loadEvents 時に予約側 joinField から取得済み）
      // joinVal が空 = 申請番号未設定 = リソース未確定 → Q-10 と同等で許可（FR-4 ブロックは API エラー時のみ）
      var selfJoinVal = (ev.rawRefTableJoinValue != null) ? String(ev.rawRefTableJoinValue) : '';
      if (!selfJoinVal) {
        // 自レコードの申請番号が空 → リソース未確定のため許可
        return { hasOverlap: false, firstRecord: null, isPermissionError: false };
      }

      // 候補レコードの joinVal を収集（空の候補はリソース無し扱い → 交差なし → スキップ）
      var joinValSet = {};
      joinValSet[selfJoinVal] = true;
      candidateRecords.forEach(function (r) {
        var jv = r[joinField] && r[joinField].value != null ? String(r[joinField].value) : '';
        // 空 joinVal の候補はリソース無し扱い。joinValSet に加えない → Step3 で取得されず交差なし
        if (jv) { joinValSet[jv] = true; }
      });
      var allJoinVals = Object.keys(joinValSet);

      // ── ステップ 3: 関連先アプリへの一括照会（関連先側 relatedJoinField in (...)） ──
      // Q-9 採用値: in の値数上限 100（候補 limit 100 + 自レコード分で最大 101 だが先頭 100 で判定）
      // クエリ長: 申請番号が数十文字以内なら ≈ 5000 文字 ≈ URL 安全範囲内
      var inList = allJoinVals
        .slice(0, 100)
        .map(function (v) { return '"' + v.replace(/"/g, '\\"') + '"'; })
        .join(',');
      // Step3 クエリは関連先アプリ側フィールド（relatedJoinField）を使う
      var step3Query = '(' + relatedJoinField + ' in (' + inList + '))';

      var step3Resp;
      var isPermissionError = false;
      try {
        step3Resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
          app:    relatedAppId,
          query:  step3Query,
          // relatedJoinField（関連先側）と resourceField を取得する
          fields: [relatedJoinField, resourceField].filter(Boolean)
        });
      } catch (step3Err) {
        console.warn('[KC.Api.checkOverlapQueryModeB] 関連先アプリへの GET 失敗:', step3Err);
        // 権限エラー判定（403 相当: code CB_AU01 or status 403）
        isPermissionError = !!(step3Err && (step3Err.code === 'CB_AU01' || step3Err.status === 403));
        return { hasOverlap: true, firstRecord: null, isPermissionError: isPermissionError };
      }
      var relatedRecords = step3Resp.records || [];

      // ── ステップ 4: リソース集合の交差判定 ──
      // relatedJoinField 値 → リソース識別フィールド値の集合（Set 相当）を構築する
      // resourceMap のキーは関連先アプリ側の relatedJoinField 値（= 予約側 joinVal と照合可能）
      var resourceMap = {};  // { relatedJoinVal → { resourceVal → true } }
      relatedRecords.forEach(function (r) {
        // relatedJoinField（関連先側）で取り出す
        var jv = r[relatedJoinField] && r[relatedJoinField].value != null
          ? String(r[relatedJoinField].value) : '';
        var rv = r[resourceField] && r[resourceField].value != null
          ? String(r[resourceField].value) : '';
        if (!jv || !rv) { return; }
        if (!resourceMap[jv]) { resourceMap[jv] = {}; }
        resourceMap[jv][rv] = true;
      });

      // 自レコードのリソース集合（selfJoinVal は relatedJoinField 値と対応）
      var selfResources = resourceMap[selfJoinVal] || {};

      // Q-10: 自リソース集合が空（機器未紐付け）→ 許可
      if (Object.keys(selfResources).length === 0) {
        return { hasOverlap: false, firstRecord: null, isPermissionError: false };
      }

      // 各候補レコードのリソース集合と交差チェック
      for (var ci = 0; ci < candidateRecords.length; ci++) {
        var cRec = candidateRecords[ci];
        // cJoinVal は予約アプリ側 joinField から取得（joinVal = relatedJoinField 値に対応）
        var cJoinVal = cRec[joinField] && cRec[joinField].value != null ? String(cRec[joinField].value) : '';
        // joinVal が空の候補はリソース無し扱い → 交差なし（Step2 で joinValSet に追加されていないため resourceMap にも存在しない）
        var cResources = cJoinVal ? (resourceMap[cJoinVal] || {}) : {};

        // 交差判定: 候補のリソース集合の各要素が自リソース集合に含まれるか
        var hasIntersection = false;
        var cResKeys = Object.keys(cResources);
        for (var ri2 = 0; ri2 < cResKeys.length; ri2++) {
          if (selfResources[cResKeys[ri2]]) {
            hasIntersection = true;
            break;
          }
        }
        if (hasIntersection) {
          return { hasOverlap: true, firstRecord: cRec, isPermissionError: false };
        }
      }

      // すべての候補と交差なし → 重複なし
      return { hasOverlap: false, firstRecord: null, isPermissionError: false };
    },

    /** 更新（差分フィールドのみ） */
    updateEvent: async function (ev) {
      var F = KC.Config.FIELD;
      var record = {};
      if ('title'    in ev && F.title)    record[F.title]    = { value: ev.title || '' };

      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        // ISO → "YYYY-MM-DD"
        if ('start' in ev && F.start && ev.start) record[F.start] = { value: ev.start.substring(0, 10) };
        if ('end' in ev && F.end && ev.end) {
          // 終日イベントの end は翌日0時なので、1日戻す
          var d = new Date(ev.end);
          d.setDate(d.getDate() - 1);
          record[F.end] = { value: KC.Utils.fmtYMD(d) };
        }
      } else {
        if ('start'  in ev && F.start)    record[F.start]    = { value: ev.start };
        if ('end'    in ev && F.end)      record[F.end]      = { value: ev.end };
      }

      if ('allday'   in ev && F.allday)   record[F.allday]   = { value: ev.allday ? [KC.Config.ALLDAY_LABEL] : [] };
      if ('color'    in ev && F.color)    record[F.color]    = { value: ev.color || '' };
      if ('status'   in ev && F.status)   record[F.status]   = { value: ev.status || '' };
      if ('userMail' in ev && F.userMail) record[F.userMail] = { value: ev.userMail || '' };
      if ('account'  in ev && F.account)  record[F.account]  = ev.account ? { value: [{ code: ev.account }] } : { value: [] };
      if ('place'    in ev && F.place)    record[F.place]    = { value: ev.place || '' };
      if ('memo'     in ev && F.memo)     record[F.memo]     = { value: ev.memo || '' };

      if (Object.keys(record).length === 0) return { ok: true };

      var url = kintone.api.url('/k/v1/record.json', true);
      var resp = await kintone.api(url, 'PUT', {
        app: KC.Config.getAppId(),
        id: ev.id,
        revision: ev.rev,   // 楽観ロック: 競合時は kintone が 409 を返す（要件 §3.10.2）
        record: record
      });
      return { ok: true, revision: resp.revision };
    },

    /** 削除 */
    deleteEvent: async function (id) {
      var url = kintone.api.url('/k/v1/records.json', true);
      await kintone.api(url, 'DELETE', {
        app: KC.Config.getAppId(),
        ids: [id]
      });
      return { ok: true };
    },

    /**
     * 単一レコードの存在確認用 GET
     * Phase 2 URL 復元時に record=<id> のレコードが存在するかを検証する（Q-5 対応）
     * 成功時は kintone API レスポンスオブジェクト、失敗時は例外を throw する
     * @param {string|number} recordId
     * @returns {Promise<Object>}
     */
    getRecord: async function (recordId) {
      var url = kintone.api.url('/k/v1/record.json', true);
      return kintone.api(url, 'GET', {
        app: KC.Config.getAppId(),
        id: recordId
      });
    },

    /** ログインユーザー情報 */
    getLoginUser: function () {
      return kintone.getLoginUser();
    }
  };

  /* ====================================================================
   * KC.Popup — kintone標準画面をモーダル（iframe埋め込み）で開く
   *
   * 変更履歴:
   *   旧実装: window.open による別ウィンドウポップアップ（背面落ち問題あり）
   *   新実装: 同一 DOM 内 iframe オーバーレイモーダル（REQ_popup-behavior-fix §3 案 B-1）
   * ==================================================================== */
  KC.Popup = {
    /**
     * モーダル静的 DOM キャッシュ（シングルトン）。
     * backdrop/modal/header/closeBtn/loading/body は初回のみ生成して使い回す。
     * iframe だけは開くたびに新規生成・閉じるたびに DOM から削除する（無限ループ防止）。
     */
    _backdrop: null,
    _modal: null,
    _body: null,
    _loading: null,
    _iframe: null,
    /** ESC キーハンドラ（addEventListener/removeEventListener で同一参照を使うため保持） */
    _onKeydown: null,
    /** URL ポーリング監視タイマー ID（SPA 遷移検知用。null = 停止中） */
    _urlWatcher: null,
    /**
     * キャンセルボタン検知用 MutationObserver（動的生成対応。null = 未使用 or 停止済み）。
     * _close() 時に disconnect() してリークを防ぐ。
     */
    _cancelObserver: null,
    /**
     * 保存ボタンがクリックされた（保存処理を通過中）ことを示すフラグ。
     * true の間は load/ポーリングで保存成功 URL を検知してモーダルを閉じる。
     * _show() でリセット、_close() でもリセット。
     */
    _savePending: false,
    /**
     * 保存ボタン検知用 MutationObserver（動的生成対応。null = 未使用 or 停止済み）。
     * _close() 時に disconnect() してリークを防ぐ。
     */
    _saveObserver: null,
    /**
     * 現在開いている iframe の「正常ロード完了回数」カウンタ。
     * 0 = まだ 1 度も許可 URL へ到達していない（初期ロード中 / リダイレクト中）。
     * _show() 呼び出し時にリセット（0）。
     * load ハンドラで _isAllowedUrl が true を返したときだけインクリメントする。
     *
     * 用途: 初回ロード中の cross-origin 例外（SAML/SSO リダイレクト等）を
     * 「閉じる」ではなく「待機」として扱うための判定に使用する。
     * _loadCount === 0 の間は cross-origin 例外でモーダルを閉じない。
     */
    _loadCount: 0,

    /**
     * sandbox 化した iframe 内の kintone「キャンセル」ボタンを検知してモーダルを閉じる。
     *
     * sandbox の allow-top-navigation 除外により kintone のキャンセル（history.back() 等）が
     * ブロックされ、ボタンが無反応になる問題への対処。
     * allow-same-origin + same-origin（同一 cybozu.com）なので contentDocument へのアクセスが可能。
     *
     * 【実機未検証】
     * 動的生成される DOM への MutationObserver の適用タイミングや、
     * キャンセルボタンの textContent が「キャンセル」以外の場合（英語ロケール等）は未確認。
     *
     * @param {HTMLIFrameElement} iframe - 対象の iframe 要素
     */
    _attachCancelHandler: function (iframe) {
      var doc;
      try {
        doc = iframe.contentDocument;
      } catch (e) {
        // cross-origin 例外（通常は発生しないが念のため）
        console.warn('[KC.Popup._attachCancelHandler] contentDocument アクセス不可:', e);
        return;
      }
      if (!doc || !doc.body) return;

      // キャンセルボタンを探してクリックリスナーを付与する。
      // kintone のキャンセルボタンは a タグまたは button タグでテキストが「キャンセル」。
      // capture phase（true）で kintone 自身のハンドラより先に実行し、
      // history.back() 等を e.preventDefault() で阻止した上でモーダルを閉じる。
      var bindCancelButtons = function () {
        var allEls = doc.querySelectorAll('a, button');
        var found = false;
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          if ((el.textContent || '').trim() !== 'キャンセル') continue;
          if (el.__kcCancelBound) { found = true; continue; }
          el.__kcCancelBound = true;
          found = true;
          el.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            _log('[KC.Popup] キャンセルボタンを検知、モーダルを閉じます');
            KC.Popup._close();
          }, true); // capture phase
        }
        return found;
      };

      // 即時試行
      if (!bindCancelButtons()) {
        // DOM がまだ構築されていない場合は MutationObserver で動的生成を監視
        var obs = new MutationObserver(function () {
          bindCancelButtons();
          // ボタンが見つかっても監視を継続する（SPAナビゲーションで再生成される場合に対応）
        });
        obs.observe(doc.body, { childList: true, subtree: true });
        KC.Popup._cancelObserver = obs;
      }
    },

    /**
     * iframe 内の kintone「保存」ボタンを検知して _savePending フラグを立てる。
     *
     * キャンセルハンドラと異なり、保存処理は kintone に通す（preventDefault しない）。
     * 保存成功時は iframe が詳細画面（show#record=N、mode=edit なし）へ遷移するので、
     * その遷移を load ハンドラ / URL ポーリングで検知してモーダルを閉じる。
     *
     * バリデーションエラー時は画面遷移が発生しないため、_savePending が true のまま残るが
     * _close() は呼ばれず、ユーザーが修正して再度保存 → 遷移 → 閉じるという正しい動作になる。
     *
     * 【実機未検証】
     * kintone の保存ボタンのテキストは「保存」で固定だが、英語ロケール等では異なる可能性がある。
     *
     * @param {HTMLIFrameElement} iframe - 対象の iframe 要素
     */
    _attachSaveHandler: function (iframe) {
      var doc;
      try {
        doc = iframe.contentDocument;
      } catch (e) {
        console.warn('[KC.Popup._attachSaveHandler] contentDocument アクセス不可:', e);
        return;
      }
      if (!doc || !doc.body) return;

      // 保存ボタン（テキストが「保存」の button/a タグ）にフラグ立てリスナーを付与する。
      // capture phase で登録するがキャンセルと違い preventDefault は行わない。
      var bindSaveButtons = function () {
        var allEls = doc.querySelectorAll('a, button');
        var found = false;
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          if ((el.textContent || '').trim() !== '保存') continue;
          if (el.__kcSaveBound) { found = true; continue; }
          el.__kcSaveBound = true;
          found = true;
          el.addEventListener('click', function () {
            _log('[KC.Popup] 保存ボタンを検知、保存待ちフラグを立てます');
            KC.Popup._savePending = true;
          }, true); // capture phase（kintone ハンドラより前に実行されるが処理は通す）
        }
        return found;
      };

      // 即時試行（DOM 構築済みの場合）
      if (!bindSaveButtons()) {
        // DOM がまだ構築されていない場合は MutationObserver で動的生成を監視する
        // キャンセルと共用するのではなく独立した処理として登録する
        var obs = new MutationObserver(function () {
          bindSaveButtons();
        });
        obs.observe(doc.body, { childList: true, subtree: true });
        // MutationObserver は _cancelObserver とは別管理。_close() で disconnect は不要
        // （iframe が DOM から削除されると自動的に無効化されるため）。
        // ただし明示的に解放したい場合は _saveObserver として管理する。
        KC.Popup._saveObserver = obs;
      }
    },

    /**
     * iframe の現在の URL が「保存成功」後の詳細表示状態かどうかを判定する。
     *
     * 保存成功の条件:
     *   - pathname が /k/{appId}/show である
     *   - hash に record=数字 が含まれる
     *   - hash に mode=edit が含まれない（編集モードでない）
     *
     * 新規作成保存: /k/{appId}/edit → /k/{appId}/show#record=N
     * 編集保存:     /k/{appId}/show#record=N&mode=edit → /k/{appId}/show#record=N
     * バリデーションエラー: 遷移なし（edit のまま or show#record=N&mode=edit のまま）
     *
     * @param {Location} loc - iframe.contentWindow.location オブジェクト
     * @returns {boolean} 保存成功後の詳細表示であれば true
     */
    _isSaveSuccessUrl: function (loc) {
      var appId = kintone.app.getId();
      var p = loc.pathname;
      var h = loc.hash;
      // pathname が /k/{appId}/show かつ hash に record=数字 があり mode=edit がない
      return (
        p === '/k/' + appId + '/show' &&
        /[#&]record=\d+/.test(h) &&
        !/mode=edit/.test(h)
      );
    },

    /**
     * iframe 内の遷移先 URL が許可されているかどうかを判定する。
     * 許可対象: 現在の appId に限定した詳細・編集・新規追加・アプリ設定画面。
     *
     * 判定仕様（§8.7）:
     * - 詳細/編集（show 形式）: pathname === /k/{appId}/show かつ hash に record=数字 を含む
     * - 新規/編集（edit 形式）: pathname === /k/{appId}/edit（query/hash 任意）
     * - アプリ設定: pathname が /k/admin/app/{appId}/ で始まる
     * - フロー設定: pathname === /k/admin/app/flow かつ search に app={appId} を含む
     * - 上記以外（一覧 /show?view= で record hash なし、ルート、他アプリ等）は不許可
     *
     * 一覧 URL (/k/{appId}/show?view=...) はこの判定で意図的に弾く。
     * 旧実装の前方一致 ^/k/{appId}/show では一覧も許可されてしまい、
     * 「追加→キャンセル→一覧遷移」でモーダルが閉じない不具合の原因だった。
     *
     * @param {Location} loc - iframe.contentWindow.location オブジェクト
     * @returns {boolean} 許可されていれば true
     */
    _isAllowedUrl: function (loc) {
      // about:blank は中間状態であり、許可でも不許可でもない。false を返す。
      // 呼び出し元で about:blank を先にスキップしているが、念のため防護。
      if (!loc || loc.href === 'about:blank') return false;
      var appId = kintone.app.getId();
      var p = loc.pathname;
      var h = loc.hash;
      var s = loc.search;
      // 詳細・編集（show 形式）: pathname 完全一致 かつ hash に record=数字
      if (p === '/k/' + appId + '/show' && /[#&]record=\d+/.test(h)) return true;
      // 新規・編集（edit 形式）: pathname 完全一致（query/hash は問わない）
      if (p === '/k/' + appId + '/edit') return true;
      // アプリ設定: pathname 前方一致
      if (p.indexOf('/k/admin/app/' + appId + '/') === 0) return true;
      // フロー設定: pathname 完全一致 かつ search に app={appId}
      if (p === '/k/admin/app/flow' && s.indexOf('app=' + appId) !== -1) return true;
      return false;
    },

    /**
     * モーダル静的 DOM（backdrop/modal/loading）を生成して body に追加する。
     * 初回呼び出し時のみ実行。iframe はここでは生成しない（_show() で毎回生成）。
     */
    _init: function () {
      if (this._backdrop) return; // 既に初期化済み

      // backdrop
      var backdrop = document.createElement('div');
      backdrop.id = 'kc-modal-backdrop';
      backdrop.className = 'kc-modal-backdrop';
      backdrop.setAttribute('hidden', '');

      // モーダル本体
      var modal = document.createElement('div');
      modal.id = 'kc-modal';
      modal.className = 'kc-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'レコード詳細');

      // ヘッダー（×ボタン）
      var header = document.createElement('div');
      header.className = 'kc-modal-header';

      var closeBtn = document.createElement('button');
      closeBtn.className = 'kc-modal-close';
      closeBtn.setAttribute('aria-label', '閉じる');
      closeBtn.textContent = '×';
      header.appendChild(closeBtn);

      // モーダルボディ（iframe の親。_show で iframe をここに追加する）
      var body = document.createElement('div');
      body.className = 'kc-modal-body';

      // ローディング表示
      var loading = document.createElement('div');
      loading.id = 'kc-modal-loading';
      loading.className = 'kc-modal-loading';
      loading.textContent = '読み込み中...';

      body.appendChild(loading);
      modal.appendChild(header);
      modal.appendChild(body);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // backdrop クリック（モーダル外の暗い領域のみ）で閉じる
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) {
          KC.Popup._close();
        }
      });

      // ×ボタンクリックで閉じる
      closeBtn.addEventListener('click', function () {
        KC.Popup._close();
      });

      // ESC キーハンドラを保持（開閉のたびに add/remove するため参照を保存）
      this._onKeydown = function (e) {
        if (e.key === 'Escape') {
          KC.Popup._close();
        }
      };

      this._backdrop = backdrop;
      this._modal = modal;
      this._body = body;
      this._loading = loading;
    },

    /**
     * iframe を新規生成してモーダルを表示する。
     * 開くたびに iframe を生成し、閉じるたびに DOM から削除する方式とすることで、
     * _close() 後に about:blank への load イベントが発火しなくなり無限ループを防ぐ。
     * @param {string} url - iframe に読み込む URL
     */
    _show: function (url) {
      this._init();

      // モーダルを開くときに保存待ちフラグ・ロードカウンタをリセット（前回の状態が残らないようにする）
      this._savePending = false;
      this._loadCount = 0;

      // 既に iframe が残っている場合は削除してからやり直す（連続クリック対応）
      if (this._iframe && this._iframe.parentNode) {
        this._body.removeChild(this._iframe);
        this._iframe = null;
      }

      // ローディング表示にリセット
      this._loading.style.display = '';

      // iframe を新規生成（開くたびに作り直すことで閉じ後の load 発火を原理的に排除）
      var iframe = document.createElement('iframe');
      iframe.className = 'kc-modal-iframe';
      iframe.title = 'レコード詳細';
      iframe.style.visibility = 'hidden';

      // --- frame busting 対策: sandbox 属性 ---
      // allow-top-navigation を除外することで、iframe 内から window.top.location を変更する
      // 操作（frame busting）をブロックする。
      //
      // 【重要・実機未検証】
      // kintone 標準の「キャンセル」は history.back() を呼ぶ。
      // history.back() がセッション履歴を top-level（親ウィンドウ）まで遡るかどうかは
      // ブラウザ実装依存であり、sandbox の allow-top-navigation 除外だけで防げるかは
      // 不確定。必ず実機で動作確認すること。
      //
      // また sandbox によって kintone の一部機能（下記）が壊れる可能性がある。
      // 実機確認必須の機能:
      //   - レコード保存（allow-forms が必要）
      //   - 添付ファイルのプレビュー / ダウンロード（allow-popups / allow-downloads が必要）
      //   - ルックアップ・ユーザー選択などのポップアップ（allow-popups が必要）
      //   - alert / confirm ダイアログ（allow-modals が必要）
      //   - SAML 認証セッション（allow-same-origin が必要）
      iframe.setAttribute(
        'sandbox',
        'allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads'
      );

      var loading = this._loading;

      // iframe ロード完了: ローディング非表示 + 遷移先 URL 監視 + キャンセルボタン検知
      iframe.addEventListener('load', function () {
        // この iframe が既に DOM から切り離されている場合は処理しない
        if (!iframe.parentNode) return;

        loading.style.display = 'none';
        iframe.style.visibility = 'visible';

        // sandbox でブロックされたキャンセルボタンをキャプチャして代替クローズ処理を登録
        // ページロードのたびに再バインドする（SPA ナビゲーションでも対応）
        KC.Popup._attachCancelHandler(iframe);

        // 保存ボタンを検知してフラグを立てるハンドラを登録
        // ページロードのたびに再バインドする（SPA ナビゲーションでも対応）
        KC.Popup._attachSaveHandler(iframe);

        // 遷移先 URL が許可パターン外なら自動クローズ
        try {
          var loc = iframe.contentWindow.location;

          // about:blank は iframe 生成直後の初期状態であり監視不要。スキップ。
          // （src 未設定の直後など、ブラウザによって load が発火する場合がある）
          if (loc.href === 'about:blank') return;

          // 保存成功の検知（_savePending が true の状態で詳細表示 URL に遷移した場合）
          // キャンセル検知・一覧遷移検知より先に評価する
          if (KC.Popup._savePending && KC.Popup._isSaveSuccessUrl(loc)) {
            _log('[KC.Popup] 保存成功を検知、カレンダー再描画してモーダルを閉じます:', loc.pathname + loc.hash);
            KC.Popup._savePending = false;
            // P-6: 保存後は関連レコードキャッシュを無効化して次回の loadRelatedRecords で強制再取得させる
            if (KC.SearchFilter && typeof KC.SearchFilter._invalidateRelatedRecordsCache === 'function') {
              KC.SearchFilter._invalidateRelatedRecordsCache();
            }
            if (KC.Render && typeof KC.Render._refreshImmediate === 'function') {
              KC.Render._refreshImmediate();
            }
            KC.Popup._close();
            return;
          }

          if (KC.Popup._isAllowedUrl(loc)) {
            // 許可 URL へ到達したことを記録（以降の cross-origin 例外は「閉じる」扱いにする）
            KC.Popup._loadCount++;
          } else {
            _log('[KC.Popup] 許可外 URL への遷移を検知、モーダルを閉じます:', loc.pathname + loc.search + loc.hash);
            KC.Popup._close();
          }
        } catch (e) {
          // cross-origin 例外: iframe がまだリダイレクト中（SAML/SSO 等）の可能性がある。
          // _loadCount === 0（まだ許可 URL へ一度も到達していない）場合は
          // 初期ロード中の中間リダイレクトとみなして「待機」とし、モーダルを閉じない。
          if (KC.Popup._loadCount === 0) {
            _log('[KC.Popup] 初期ロード中の cross-origin 状態を検知、到達を待機します:', e.message || e);
          } else {
            // 許可 URL 到達後に別ドメインへ遷移 → 閉じる
            _log('[KC.Popup] cross-origin 遷移を検知、モーダルを閉じます:', e);
            KC.Popup._close();
          }
        }
      });

      // CSP frame-ancestors などによる読み込み失敗の検知
      iframe.addEventListener('error', function () {
        console.error('[KC.Popup] iframe の読み込みに失敗しました。CSP の frame-ancestors 制約を確認してください。');
      });

      iframe.src = url;
      this._body.appendChild(iframe);
      this._iframe = iframe;

      // backdrop 表示
      this._backdrop.removeAttribute('hidden');

      // body スクロール禁止（アクセシビリティ §8.6）
      document.body.style.overflow = 'hidden';

      // ESC キーリスナー登録（モーダル表示中のみ有効）
      document.addEventListener('keydown', this._onKeydown);

      // P-5: URL 遷移監視（イベント駆動を主、ポーリングをフォールバック）
      // kintone の一覧⇔詳細⇔編集の遷移は pushState / hashchange で完結することがあり、
      // load イベントだけでは一覧遷移（キャンセル等）を取りこぼす場合がある（実機未検証）。
      // allow-same-origin かつ同一オリジンのため iframe.contentWindow への hashchange リスナー登録が可能。
      // hashchange イベント駆動で即時検知し、ポーリングは 1500ms のフォールバックとする（検知漏れ対策を維持）。
      var _checkIframeUrl = function (source) {
        var iframe = KC.Popup._iframe;
        if (!iframe || !iframe.parentNode) return;
        try {
          var loc = iframe.contentWindow.location;

          // about:blank は初期状態 or リセット中。スキップ。
          if (loc.href === 'about:blank') return;

          // 保存成功の検知（SPA 遷移で load が発火しないケースを補完）
          if (KC.Popup._savePending && KC.Popup._isSaveSuccessUrl(loc)) {
            _log('[KC.Popup] ' + source + ': 保存成功を検知、カレンダー再描画してモーダルを閉じます:', loc.pathname + loc.hash);
            KC.Popup._savePending = false;
            // P-6: 保存後は関連レコードキャッシュを無効化して次回の loadRelatedRecords で強制再取得させる
            if (KC.SearchFilter && typeof KC.SearchFilter._invalidateRelatedRecordsCache === 'function') {
              KC.SearchFilter._invalidateRelatedRecordsCache();
            }
            if (KC.Render && typeof KC.Render._refreshImmediate === 'function') {
              KC.Render._refreshImmediate();
            }
            KC.Popup._close();
            return;
          }

          if (KC.Popup._isAllowedUrl(loc)) {
            // 許可 URL に到達（load ハンドラが発火しなかったケースを補完）
            KC.Popup._loadCount++;
          } else {
            _log('[KC.Popup] ' + source + ': 許可外 URL を検知、モーダルを閉じます:', loc.pathname + loc.search + loc.hash);
            KC.Popup._close();
          }
        } catch (e) {
          // cross-origin 例外: _loadCount === 0 の間は初期リダイレクト中とみなして待機。
          if (KC.Popup._loadCount === 0) {
            _log('[KC.Popup] ' + source + ': 初期ロード中の cross-origin 状態を検知、到達を待機します:', e.message || e);
          } else {
            // 許可 URL 到達後に別ドメインへ遷移 → 閉じる
            _log('[KC.Popup] ' + source + ': cross-origin 遷移を検知、モーダルを閉じます:', e);
            KC.Popup._close();
          }
        }
      };

      // イベント駆動: iframe 内 hashchange を検知（kintone の SPA ナビゲーションを即時捕捉）
      // allow-same-origin があるため contentWindow へのアクセス・リスナー登録が可能
      // （cross-origin 状態の場合は try-catch で吸収）
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.addEventListener('hashchange', function () {
            _checkIframeUrl('hashchange');
          });
        }
      } catch (e) {
        // cross-origin 状態でのリスナー登録失敗は無視（ポーリングで補完）
      }

      // フォールバックポーリング（1500ms: SPA 遷移で hashchange が発火しないケースを補完）
      KC.Popup._urlWatcher = setInterval(function () {
        _checkIframeUrl('polling');
      }, 1500);
    },

    /**
     * モーダルを閉じ、カレンダーを再描画する。
     * iframe を DOM から削除することで about:blank の load イベントが発火しなくなり、
     * 遷移監視ハンドラが再帰的に呼ばれる無限ループを原理的に防ぐ。
     * ×ボタン・ESC・backdrop クリック・許可外 URL 遷移の共通クローズ処理。
     */
    _close: function () {
      if (!this._backdrop) return;

      // FR-4/FR-5: モーダルクローズ時に record/new パラメータを URL から除去する（replaceState）
      // ×ボタン / backdrop / ESC / 保存後自動クローズ / 許可外URL遷移 すべての経路でここを通る
      if (KC.UrlState) {
        KC.UrlState.remove('record');
        KC.UrlState.remove('new');
      }

      // ポーリング監視を停止（先に停止してから iframe 削除）。
      // clearInterval を先に行うことで、削除後にポーリングが走り続けるリークを防ぐ。
      clearInterval(KC.Popup._urlWatcher);
      KC.Popup._urlWatcher = null;

      // キャンセルボタン検知の MutationObserver を解除
      if (KC.Popup._cancelObserver) {
        KC.Popup._cancelObserver.disconnect();
        KC.Popup._cancelObserver = null;
      }

      // 保存ボタン検知の MutationObserver を解除
      if (KC.Popup._saveObserver) {
        KC.Popup._saveObserver.disconnect();
        KC.Popup._saveObserver = null;
      }

      // 保存待ちフラグをリセット（閉じたので保留中の保存状態はクリア）
      KC.Popup._savePending = false;

      // iframe を DOM から削除（これにより以降の load イベントは発火しない）
      if (this._iframe && this._iframe.parentNode) {
        this._body.removeChild(this._iframe);
      }
      this._iframe = null;

      // backdrop 非表示
      this._backdrop.setAttribute('hidden', '');

      // body スクロール禁止を解除
      document.body.style.overflow = '';

      // ESC キーリスナー解除
      document.removeEventListener('keydown', this._onKeydown);

      // カレンダー再描画（方法 X: 閉じる時に再描画）
      KC.Render.refresh();
    },

    /**
     * 新規作成モーダルを開く。
     * sessionStorage へのコンテキスト書き込みは既存ロジックをそのまま維持し、
     * 開く手段のみ window.open からモーダルに変更する。
     * @param {{ date: string, hour: number, minute: number, allday: boolean }} options
     */
    openCreate: function (options) {
      // options: { date, hour, minute, allday }
      sessionStorage.setItem('KC_CREATE_CONTEXT', JSON.stringify(options));
      // 親ウィンドウで検出済みの FIELD 設定を保存（iframe 側の detectFields 未完了を補完）
      sessionStorage.setItem('KC_FIELD_CONFIG', JSON.stringify(KC.Config.FIELD));
      // START_FIELD_TYPE（DATE / DATETIME）も保存する（iframe 側で値フォーマットの判定に使用）
      sessionStorage.setItem('KC_START_FIELD_TYPE', KC.Config.START_FIELD_TYPE || 'DATETIME');
      // ALLDAY_LABEL（終日チェックボックスのラベル文字列）も保存する
      // iframe 側では KC.Config.ALLDAY_LABEL がデフォルト値のままになるケースがあり、
      // アプリで設定されたラベルと不一致だと終日 ON が反映されない（DATETIME + 終日 不具合）
      sessionStorage.setItem('KC_ALLDAY_LABEL', KC.Config.ALLDAY_LABEL || '終日');
      // メールアドレス初期値設定フラグを iframe へ渡す
      sessionStorage.setItem('KC_MAIL_LOGIN_USER_DEFAULT', KC.Config.MAIL_LOGIN_USER_DEFAULT ? '1' : '0');
      // FR-5: 新規作成モーダルオープンを URL ハッシュに記録（pushState）
      // new=YYYY-MM-DD または new=YYYY-MM-DDTHH:mm 形式で記録する（AC-6 相当）
      if (KC.UrlState) {
        var newParam = options.date || '';
        if (!options.allday && options.date && options.hour !== undefined && options.minute !== undefined) {
          newParam = options.date + 'T' + KC.Utils.pad2(options.hour) + ':' + KC.Utils.pad2(options.minute);
        }
        // URL に既に同値が載っている場合はスキップ（リロード復元・popstate 進む の二重化防止）
        if (newParam && KC.UrlState.get('new') !== newParam) {
          KC.UrlState.push('new', newParam);
        }
      }
      var appId = KC.Config.getAppId();
      var url = '/k/' + appId + '/edit';
      this._show(url);
    },

    /**
     * 編集（レコード詳細）モーダルを開く。
     * URL 組み立てロジックは旧 openEdit から流用し、開く手段のみモーダルに変更する。
     * @param {string|number} recordId - kintone レコード ID
     */
    openEdit: function (recordId) {
      if (recordId === undefined || recordId === null || recordId === '') {
        console.error('[KC.Popup.openEdit] recordId が取得できていません:', recordId);
        alert('レコードIDの取得に失敗しました。コンソールを確認してください。');
        return;
      }
      // FR-4: 編集モーダルオープンを URL ハッシュに記録（pushState）
      // URL に既に同値が載っている場合はスキップ（リロード復元・popstate 進む の二重化防止）
      if (KC.UrlState && KC.UrlState.get('record') !== String(recordId)) {
        KC.UrlState.push('record', String(recordId));
      }
      var appId = KC.Config.getAppId();
      var url = '/k/' + appId + '/show#record=' + recordId;
      _log('[KC.Popup.openEdit] open modal:', url);
      this._show(url);
    }
  };

  /* ====================================================================
   * KC.DnD — ドラッグ&ドロップ（移動/リサイズ）
   *
   * Phase 1: 終日予定の DnD（移動・左右リサイズ）＋共通基盤
   * Phase 2: 時間予定の DnD（移動・上下リサイズ）+ 日跨ぎ表示
   * ==================================================================== */
  KC.DnD = (function () {
    /** DnD 定数 */
    var DND_THRESHOLD    = 5;    // ドラッグ発動閾値（px）
    var DND_SNAP_MIN     = 15;   // 時間予定の分スナップ粒度（分）
    var DND_MIN_DURATION = 15;   // リサイズ時の最小持続時間（分）

    /** DnD 中の状態（null = 非ドラッグ中） */
    var _drag = null;

    // =========================================================================
    // 共通内部ヘルパー
    // =========================================================================

    /**
     * .kc-adcell[data-date] から列インデックスと日付文字列を取得する
     * @param {number} clientX - カーソルの clientX
     * @returns {{ colIdx: number, dateYMD: string } | null}
     */
    function _adcellFromX(clientX) {
      var cells = document.querySelectorAll('.kc-adcell[data-date]');
      for (var i = 0; i < cells.length; i++) {
        var r = cells[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) {
          return { colIdx: i, dateYMD: cells[i].dataset.date };
        }
      }
      return null;
    }

    /**
     * 終日予定ゴースト要素を生成する
     * @param {Object} ev - KcEvent
     * @param {string} labelText - ゴースト内の日付ラベル文字列
     * @returns {HTMLElement}
     */
    function _buildAlldayGhost(ev, labelText) {
      var ghost = document.createElement('div');
      ghost.className = 'kc-ad-event kc-event--ghost';
      ghost.style.position = 'absolute';
      ghost.style.zIndex = '9999';
      ghost.style.pointerEvents = 'none';

      if (ev.color) {
        ghost.style.background = ev.color;
        ghost.style.borderColor = ev.color;
      }

      var dot = document.createElement('span');
      dot.className = 'dot';
      if (ev.color) dot.style.background = ev.color;

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-ad-evt-title';
      titleSpan.textContent = ev.title || '(無題)';

      var timeSpan = document.createElement('span');
      timeSpan.className = 'kc-evt-ghost-time';
      timeSpan.textContent = labelText;

      ghost.appendChild(dot);
      ghost.appendChild(titleSpan);
      ghost.appendChild(timeSpan);
      return ghost;
    }

    /**
     * 終日ゴーストの位置・幅を更新する
     * @param {HTMLElement} ghost
     * @param {number} colStart - 開始列インデックス（0〜6）
     * @param {number} span - 列数（1〜）
     * @param {number} lane - レーン番号（元バーの lane）
     */
    function _positionAlldayGhost(ghost, colStart, span, lane, colCount) {
      var BAR_H   = 20;  /* --kc-ad-bar-h (font-size 14px 対応: 旧 24px) */
      var BAR_GAP = 3;
      var BAR_TOP = 4;
      var cc = colCount || _getWeekYMDs().length || 7;
      ghost.style.left   = ((colStart / cc) * 100) + '%';
      ghost.style.width  = ((span / cc) * 100) + '%';
      ghost.style.top    = (BAR_TOP + lane * (BAR_H + BAR_GAP)) + 'px';
      ghost.style.height = BAR_H + 'px';
    }

    /**
     * ゴーストの日付ラベルを更新する（終日予定用: "M/D ~ M/D" or "M/D"）
     * @param {HTMLElement} ghost
     * @param {Date} newStart - 新しい開始日
     * @param {Date} newEnd - 新しい終了日（exclusive: 翌日0時）
     */
    function _updateAlldayGhostLabel(ghost, newStart, newEnd) {
      var timeSpan = ghost.querySelector('.kc-evt-ghost-time');
      if (!timeSpan) return;
      var s = newStart;
      // end は翌日0時なので1日戻して表示
      var e = new Date(newEnd.getTime() - 86400000);
      var sStr = (s.getMonth() + 1) + '/' + s.getDate();
      var eStr = (e.getMonth() + 1) + '/' + e.getDate();
      timeSpan.textContent = (sStr === eStr) ? sStr : sStr + ' ~ ' + eStr;
    }

    /**
     * ESC キーのキャンセルハンドラ
     */
    function _onKeyDown(e) {
      if (e.key !== 'Escape') return;
      _cancel();
    }

    /**
     * 共通キャンセル処理（ESC / window blur 時）
     */
    function _cancel() {
      if (!_drag) return;
      var drag = _drag;
      _drag = null;

      // ゴースト除去
      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      // 元バーの薄表示解除
      if (drag.origBar) {
        drag.origBar.classList.remove('kc-ad-event--dragging');
        drag.origBar.classList.remove('kc-event--dragging');
      }
      // 日跨ぎ時は全セグメントの薄表示も解除
      if (drag.origBars) {
        drag.origBars.forEach(function (b) { b.classList.remove('kc-event--dragging'); });
      }

      // リスナ除去（終日 + 時間予定 + 月ビュー chip 全て）
      document.removeEventListener('mousemove', _onMouseMoveAllday);
      document.removeEventListener('mouseup', _onMouseUpAllday);
      document.removeEventListener('mousemove', _onMouseMoveTime);
      document.removeEventListener('mouseup', _onMouseUpTime);
      document.removeEventListener('mousemove', _onMouseMoveMonthChip);
      document.removeEventListener('mouseup', _onMouseUpMonthChip);
      document.removeEventListener('keydown', _onKeyDown);
      window.removeEventListener('blur', _cancel);

      document.body.classList.remove('kc-dnd-active');
      document.body.style.userSelect = '';
    }

    /**
     * DnD 確定処理: 楽観先行更新 → 重複チェック → 送信 or ブロック
     *
     * フロー (REQ_dnd-overlap-block §6.1 / FR-7):
     *   1. State をインプレース更新 + renderGrid()（即時 UI 反映: 楽観先行フェーズ）
     *   2. OVERLAP_MODE が 'fieldKey'/'refTable' で有効設定あれば重複チェックを await で実行
     *      モード A: checkOverlapQuery（GET 1 回, limit 1）
     *      モード B: checkOverlapQueryModeB（GET 最大 2 回: 候補 limit 100 + 関連先 in クエリ）
     *   3. 重複なし → updateEvent 送信（送信フェーズ）
     *   4. 重複あり or エラー → State を元に戻して renderGrid() + バナー表示（ブロックフェーズ）
     *
     * スコープ: DnD のみ。フォーム保存（iframe モーダル・直接編集）は Customine で保護。
     * TOCTOU 競合（チェック後〜PUT の間に他ユーザーが保存）は Customine が最終防衛線（§10.1）。
     *
     * @param {Object} origEv  - DnD 開始時点の KcEvent（変更前）
     * @param {string} newStart - 移動後の開始日時 (ISO 8601)
     * @param {string} newEnd   - 移動後の終了日時 (ISO 8601)
     */
    async function _commitOptimistic(origEv, newStart, newEnd) {
      // NOTE: origEv は drag.ev = KC.State.events[i] への直接参照（live reference）。
      //       以下の楽観先行フェーズで origEv.start / origEv.end を書き換えてしまうと
      //       ブロックフェーズで「元の値」が失われるため、上書き前に退避する。
      var savedStart = origEv.start;
      var savedEnd   = origEv.end;

      // ── 楽観先行フェーズ ────────────────────────────────────────────────────
      // State をインプレース更新（Object.assign でコピーせず live reference を維持する）
      // NOTE: Object.assign でオブジェクトを置き換えると rev が古いままになり、
      //       連続ドラッグ時に 2 回目以降が 409 エラーになるため、直接プロパティを更新する
      var currentEv = null;
      for (var i = 0; i < KC.State.events.length; i++) {
        if (KC.State.events[i].id === origEv.id) { currentEv = KC.State.events[i]; break; }
      }
      if (currentEv) {
        currentEv.start = newStart;
        currentEv.end = newEnd;
      }

      // 即時 UI 反映（楽観先行: ユーザーには移動後の状態が見える）
      KC.Render.renderGrid();

      // ── チェックフェーズ ─────────────────────────────────────────────────────
      var overlapMode = KC.Config.OVERLAP_MODE;
      var isCheckEnabled = (overlapMode === 'fieldKey' && KC.Config.OVERLAP_KEY_FIELD_CODE) ||
                           (overlapMode === 'refTable' && KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD);
      if (isCheckEnabled) {
        // バナーを閉じてから重複チェック（前回のエラーバナーを消す）
        KC.Banner.hide();

        var hasOverlap = false;
        var bannerMsg = '';

        if (overlapMode === 'fieldKey') {
          // ── モード A: 通常フィールド方式 ────────────────────────────────────
          var overlapRecordsA;
          var checkFailedA = false;
          try {
            overlapRecordsA = await KC.Api.checkOverlapQuery(origEv, newStart, newEnd);
          } catch (checkErrA) {
            console.error('[KC.DnD] 重複チェッククエリ（モード A）失敗:', checkErrA);
            checkFailedA = true;
            overlapRecordsA = [];
          }

          hasOverlap = checkFailedA || (overlapRecordsA.length > 0);
          if (hasOverlap) {
            if (checkFailedA) {
              bannerMsg = '重複チェック中にエラーが発生しました。再度操作してください。';
            } else {
              var firstTitleA = KC.Config.FIELD.title && overlapRecordsA[0][KC.Config.FIELD.title]
                ? overlapRecordsA[0][KC.Config.FIELD.title].value
                : '(無題)';
              bannerMsg = '「' + firstTitleA + '」と期間が重複しています。';
            }
          }
        } else {
          // ── モード B: 関連レコード方式 ────────────────────────────────────
          var resultB;
          var checkFailedB = false;
          try {
            resultB = await KC.Api.checkOverlapQueryModeB(origEv, newStart, newEnd);
          } catch (checkErrB) {
            console.error('[KC.DnD] 重複チェッククエリ（モード B）失敗:', checkErrB);
            checkFailedB = true;
            resultB = { hasOverlap: true, firstRecord: null, isPermissionError: false };
          }

          hasOverlap = checkFailedB || resultB.hasOverlap;
          if (hasOverlap) {
            if (checkFailedB) {
              bannerMsg = '重複チェック中にエラーが発生しました。再度操作してください。';
            } else if (resultB.isPermissionError) {
              bannerMsg = '重複チェック中にエラーが発生しました。関連先アプリの閲覧権限を確認してください。';
            } else if (resultB.firstRecord) {
              var firstTitleB = KC.Config.FIELD.title && resultB.firstRecord[KC.Config.FIELD.title]
                ? resultB.firstRecord[KC.Config.FIELD.title].value
                : '(無題)';
              bannerMsg = '「' + firstTitleB + '」と期間が重複しています。';
            } else {
              bannerMsg = '重複チェック中にエラーが発生しました。再度操作してください。';
            }
          }
        }

        if (hasOverlap) {
          // ── ブロックフェーズ ────────────────────────────────────────────────
          // savedStart / savedEnd（楽観更新前に退避した元値）で State を巻き戻す
          if (currentEv) {
            currentEv.start = savedStart;
            currentEv.end   = savedEnd;
          }
          KC.Render.renderGrid();
          KC.Banner.show(bannerMsg);
          return; // updateEvent は送信しない
        }

        // 重複なし: バナーを閉じてから送信（正常移動後のバナー消去 T-7）
        KC.Banner.hide();
      }

      // ── 送信フェーズ ─────────────────────────────────────────────────────────
      // API を非同期送信（楽観的: レスポンスを待たない）
      // クロージャが保持する origEv.rev は古い可能性があるため、State の currentEv.rev を使う
      var payload = Object.assign({}, origEv, { start: newStart, end: newEnd, rev: currentEv ? currentEv.rev : origEv.rev });
      KC.Api.updateEvent(payload)
        .then(function (resp) {
          // API 成功時、戻り値の revision を State に反映（要件 §3.10.1）
          // resp は { ok: true, revision: "N" } 形式
          // currentEv は live reference なので、ここで更新すれば次回ドラッグ時も最新 rev が使われる
          if (resp && resp.revision && currentEv) {
            currentEv.rev = resp.revision;
          }
        })
        .catch(function (err) {
          var msg = (err && err.message) ? err.message : String(err);
          // 409 競合も含む全エラーで alert + ロールバック
          alert('予定の更新に失敗しました: ' + msg);
          KC.Render.refresh();
        });
    }

    // =========================================================================
    // 終日予定 DnD — 移動（Phase 1）
    // =========================================================================

    /** mousemove ハンドラ（終日予定移動・リサイズ共用） */
    function _onMouseMoveAllday(e) {
      if (!_drag) return;

      // 5px 閾値判定（バグ E 修正）
      if (!_drag.started) {
        var dist = Math.hypot(e.clientX - _drag.startX, e.clientY - _drag.startY);
        if (dist < DND_THRESHOLD) return;

        // 閾値を超えた: DnD 開始
        _drag.started = true;
        document.body.classList.add('kc-dnd-active');
        document.body.style.userSelect = 'none';

        // 元バーを薄表示
        if (_drag.origBar) {
          _drag.origBar.classList.add('kc-ad-event--dragging');
        }

        // ゴーストを配置（月ビューは body 直下 fixed、週ビューは allday レイヤ内）
        if (_drag.ghost) {
          if (_drag.view === 'month') {
            document.body.appendChild(_drag.ghost);
          } else {
            var alldayWrap = document.getElementById('kc-allday');
            var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
            if (eventsLayer) {
              eventsLayer.appendChild(_drag.ghost);
            }
          }
        }

        // ESC / blur キャンセル登録
        document.addEventListener('keydown', _onKeyDown);
        window.addEventListener('blur', _cancel);
      }

      if (_drag.type === 'move-allday') {
        _onMoveAlldayMove(e);
      } else if (_drag.type === 'resize-left' || _drag.type === 'resize-right') {
        _onResizeAlldayMove(e);
      } else if (_drag.type === 'resize-left-timed-span' || _drag.type === 'resize-right-timed-span') {
        _onResizeTimedSpanMoveMonth(e);
      }
    }

    /** 終日移動の mousemove 処理 */
    function _onMoveAlldayMove(e) {
      // 月ビューは専用処理に分岐
      if (_drag.view === 'month') {
        _onMoveAlldayMoveMonth(e);
        return;
      }

      var info = _adcellFromX(e.clientX);
      if (!info) return;

      var origEv = _drag.ev;
      var U = KC.Utils;

      // 元の期間を日数で計算（終日予定は end が翌日0時）
      var origStartD = new Date(origEv.start);
      var origEndD   = new Date(origEv.end);
      var origStartDate = new Date(origStartD.getFullYear(), origStartD.getMonth(), origStartD.getDate());
      var origEndDate   = new Date(origEndD.getFullYear(), origEndD.getMonth(), origEndD.getDate());
      var spanDays = Math.round((origEndDate.getTime() - origStartDate.getTime()) / 86400000);
      if (spanDays < 1) spanDays = 1;

      // 開始列インデックスから新しい開始日を算出
      var weekYMDs = _getWeekYMDs();
      var newStartYMD = weekYMDs[info.colIdx];
      if (!newStartYMD) return;

      // ISO 文字列を生成（kintone 形式: T00:00:00+09:00 で送信）
      var newStart = new Date(newStartYMD + 'T00:00:00');
      var newEnd   = U.addDays(newStart, spanDays);

      _drag.newStart = KC.Utils.fmtYMD(newStart) + 'T00:00:00+09:00';
      _drag.newEnd   = KC.Utils.fmtYMD(newEnd)   + 'T00:00:00+09:00';

      // ゴースト位置更新
      var clampedSpan = Math.min(spanDays, weekYMDs.length - info.colIdx);
      _positionAlldayGhost(_drag.ghost, info.colIdx, clampedSpan, _drag.lane, weekYMDs.length);
      _updateAlldayGhostLabel(_drag.ghost, newStart, newEnd);
    }

    /**
     * 月ビュー終日移動の mousemove 処理
     * @param {MouseEvent} e
     */
    function _onMoveAlldayMoveMonth(e) {
      var info = _monthCellFromXY(e.clientX, e.clientY);
      if (!info) return;

      var origEv = _drag.ev;
      var U = KC.Utils;

      // 元の期間を日数で計算（終日予定は end が翌日0時）
      var origStartD    = new Date(origEv.start);
      var origEndD      = new Date(origEv.end);
      var origStartDate = new Date(origStartD.getFullYear(), origStartD.getMonth(), origStartD.getDate());
      var origEndDate   = new Date(origEndD.getFullYear(), origEndD.getMonth(), origEndD.getDate());
      var spanDays = Math.round((origEndDate.getTime() - origStartDate.getTime()) / 86400000);
      if (spanDays < 1) spanDays = 1;

      var newStart = new Date(info.dateYMD + 'T00:00:00');
      var newEnd   = U.addDays(newStart, spanDays);

      _drag.newStart = U.fmtYMD(newStart) + 'T00:00:00+09:00';
      _drag.newEnd   = U.fmtYMD(newEnd)   + 'T00:00:00+09:00';

      _positionMonthGhost(_drag.ghost, info.dateYMD, spanDays, info.colIdx);
      _updateAlldayGhostLabel(_drag.ghost, newStart, newEnd);
    }

    /** mouseup ハンドラ（終日予定移動・リサイズ共用） */
    function _onMouseUpAllday(e) {
      document.removeEventListener('mousemove', _onMouseMoveAllday);
      document.removeEventListener('mouseup', _onMouseUpAllday);
      document.removeEventListener('keydown', _onKeyDown);
      window.removeEventListener('blur', _cancel);

      if (!_drag) return;

      var drag = _drag;
      _drag = null;

      // ゴースト除去
      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      // 元バー薄表示解除
      if (drag.origBar) {
        drag.origBar.classList.remove('kc-ad-event--dragging');
      }

      document.body.classList.remove('kc-dnd-active');
      document.body.style.userSelect = '';

      // DnD が発動していない（5px 未満）場合はクリックとして通過（AC4.3）
      if (!drag.started) return;

      // DnD 発動後は次の click イベントをキャプチャフェーズで一度だけブロック（誤ポップアップ防止）
      function suppressClick(ev) {
        ev.stopPropagation();
        document.removeEventListener('click', suppressClick, true);
      }
      document.addEventListener('click', suppressClick, true);

      // delta なし（移動・リサイズがゼロ）場合は何もしない
      if (!drag.newStart || !drag.newEnd) return;
      if (drag.newStart === drag.ev.start && drag.newEnd === drag.ev.end) return;

      // _commitOptimistic は async のため未処理 rejection を防ぐ .catch を付与（§6.2）
      _commitOptimistic(drag.ev, drag.newStart, drag.newEnd).catch(function (err) {
        console.error('[KC.DnD] _commitOptimistic 未処理エラー:', err);
      });
    }

    /**
     * 終日予定の移動 DnD を開始する（バグ B 修正）
     * @param {Object} ev - KcEvent
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - クリックされた .kc-ad-event 要素
     */
    function startMoveAllday(ev, mousedown, barEl) {
      mousedown.preventDefault();

      var ghost = _buildAlldayGhost(ev, '');
      var weekYMDs = _getWeekYMDs();
      _positionAlldayGhost(ghost, ev.colStart || 0, ev.span || 1, ev.lane || 0, weekYMDs.length);

      _drag = {
        view:     KC.State.view === 'day' ? 'day' : 'week',
        type:     'move-allday',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        lane:     ev.lane || 0,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveAllday);
      document.addEventListener('mouseup', _onMouseUpAllday);
    }

    // =========================================================================
    // 終日予定 DnD — リサイズ（左端・右端）（Phase 1）
    // =========================================================================

    /** 終日リサイズの mousemove 処理 */
    function _onResizeAlldayMove(e) {
      // 月ビューは専用処理に分岐
      if (_drag.view === 'month') {
        _onResizeAlldayMoveMonth(e);
        return;
      }

      var info = _adcellFromX(e.clientX);
      if (!info) return;

      var origEv = _drag.ev;
      var U = KC.Utils;

      // 元のイベントの日付（ローカル日付ベース）
      var origStartD = new Date(origEv.start);
      var origEndD   = new Date(origEv.end);
      var origStartDate = new Date(origStartD.getFullYear(), origStartD.getMonth(), origStartD.getDate());
      // end は翌日0時: そのまま使う（end の日付が終了日の翌日を指す）
      var origEndDate = new Date(origEndD.getFullYear(), origEndD.getMonth(), origEndD.getDate());

      var weekYMDs = _getWeekYMDs();
      var targetYMD = weekYMDs[info.colIdx];
      if (!targetYMD) return;

      var targetDate = new Date(targetYMD + 'T00:00:00');
      var newStartDate, newEndDate;

      if (_drag.type === 'resize-left') {
        // 左端リサイズ: 開始日を変更（終了日は固定）
        newStartDate = targetDate;
        newEndDate   = origEndDate;
        // 最小スパン: 1 日（newStartDate < newEndDate）
        if (newStartDate.getTime() >= newEndDate.getTime()) {
          newStartDate = U.addDays(newEndDate, -1);
        }
      } else {
        // 右端リサイズ: 終了日を変更（開始日は固定）
        // targetYMD はドラッグ先の表示終了日 → kintone の end は翌日なので +1 日
        newStartDate = origStartDate;
        newEndDate   = U.addDays(targetDate, 1);
        // 最小スパン: 1 日
        if (newEndDate.getTime() <= newStartDate.getTime()) {
          newEndDate = U.addDays(newStartDate, 1);
        }
      }

      // ISO 文字列（kintone 形式）
      _drag.newStart = U.fmtYMD(newStartDate) + 'T00:00:00+09:00';
      _drag.newEnd   = U.fmtYMD(newEndDate)   + 'T00:00:00+09:00';

      // ゴースト位置更新
      var colStart = weekYMDs.indexOf(U.fmtYMD(newStartDate));
      // 表示終了日は newEndDate の1日前
      var displayEndDate = U.addDays(newEndDate, -1);
      var colEnd   = weekYMDs.indexOf(U.fmtYMD(displayEndDate));
      if (colStart < 0) colStart = 0;
      if (colEnd < 0) colEnd = weekYMDs.length - 1;
      var span = colEnd - colStart + 1;
      if (span < 1) span = 1;

      _positionAlldayGhost(_drag.ghost, colStart, span, _drag.lane, weekYMDs.length);
      _updateAlldayGhostLabel(_drag.ghost, newStartDate, newEndDate);
    }

    /**
     * 月ビュー終日リサイズの mousemove 処理
     * @param {MouseEvent} e
     */
    function _onResizeAlldayMoveMonth(e) {
      var info = _monthCellFromXY(e.clientX, e.clientY);
      if (!info) return;

      var origEv = _drag.ev;
      var U = KC.Utils;

      var origStartD    = new Date(origEv.start);
      var origEndD      = new Date(origEv.end);
      var origStartDate = new Date(origStartD.getFullYear(), origStartD.getMonth(), origStartD.getDate());
      var origEndDate   = new Date(origEndD.getFullYear(), origEndD.getMonth(), origEndD.getDate());
      var targetDate    = new Date(info.dateYMD + 'T00:00:00');
      var newStartDate, newEndDate;

      if (_drag.type === 'resize-left') {
        newStartDate = targetDate;
        newEndDate   = origEndDate;
        if (newStartDate.getTime() >= newEndDate.getTime()) {
          newStartDate = U.addDays(newEndDate, -1);
        }
      } else {
        // 右端: targetYMD = 表示終了日 → kintone end は翌日
        newStartDate = origStartDate;
        newEndDate   = U.addDays(targetDate, 1);
        if (newEndDate.getTime() <= newStartDate.getTime()) {
          newEndDate = U.addDays(newStartDate, 1);
        }
      }

      _drag.newStart = U.fmtYMD(newStartDate) + 'T00:00:00+09:00';
      _drag.newEnd   = U.fmtYMD(newEndDate)   + 'T00:00:00+09:00';

      var spanDays = Math.round((newEndDate.getTime() - newStartDate.getTime()) / 86400000);
      if (spanDays < 1) spanDays = 1;
      // newStartDate.getDay() は 0=日曜〜6=土曜 で colIdx と一致する
      _positionMonthGhost(_drag.ghost, U.fmtYMD(newStartDate), spanDays, newStartDate.getDay());
      _updateAlldayGhostLabel(_drag.ghost, newStartDate, newEndDate);
    }

    /**
     * 月ビュー日跨ぎ時間予定リサイズの mousemove 処理
     * 日付のみ伸縮し、時刻は元の値を維持する（_buildChipISO を流用）
     * @param {MouseEvent} e
     */
    function _onResizeTimedSpanMoveMonth(e) {
      var info = _monthCellFromXY(e.clientX, e.clientY);
      if (!info) return;

      var origEv = _drag.ev;
      var U = KC.Utils;

      var origStartDate = new Date(origEv.start.substring(0, 10) + 'T00:00:00');
      var origEndDate   = new Date(origEv.end.substring(0, 10)   + 'T00:00:00');
      var targetDate    = new Date(info.dateYMD + 'T00:00:00');
      var newStartDate, newEndDate;

      if (_drag.type === 'resize-left-timed-span') {
        newStartDate = targetDate;
        newEndDate   = origEndDate;
        // 最小スパン: 開始日 < 終了日（単日にはなれるが逆転は防ぐ）
        if (newStartDate.getTime() >= newEndDate.getTime()) {
          newStartDate = origStartDate;
        }
      } else {
        // 右端: targetYMD = 表示終了日（終日と異なり +1 しない）
        newStartDate = origStartDate;
        newEndDate   = targetDate;
        if (newEndDate.getTime() <= newStartDate.getTime()) {
          newEndDate = origEndDate;
        }
      }

      // 時刻は元の ISO 文字列の時刻部分を維持
      _drag.newStart = _buildChipISO(origEv.start, U.fmtYMD(newStartDate));
      _drag.newEnd   = _buildChipISO(origEv.end,   U.fmtYMD(newEndDate));

      var spanDays = Math.round((newEndDate.getTime() - newStartDate.getTime()) / 86400000) + 1;
      if (spanDays < 1) spanDays = 1;
      _positionMonthGhost(_drag.ghost, U.fmtYMD(newStartDate), spanDays, newStartDate.getDay());
    }

    /**
     * 終日予定のリサイズ DnD を開始する（左端・右端）
     * @param {Object} ev - KcEvent
     * @param {'left'|'right'} side
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - .kc-ad-event 要素
     */
    function startResizeAllday(ev, side, mousedown, barEl) {
      mousedown.preventDefault();

      var ghost = _buildAlldayGhost(ev, '');
      var weekYMDs = _getWeekYMDs();
      _positionAlldayGhost(ghost, ev.colStart || 0, ev.span || 1, ev.lane || 0, weekYMDs.length);

      _drag = {
        view:     KC.State.view === 'day' ? 'day' : 'week',
        type:     side === 'left' ? 'resize-left' : 'resize-right',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        lane:     ev.lane || 0,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveAllday);
      document.addEventListener('mouseup', _onMouseUpAllday);
    }

    // =========================================================================
    // 時間予定 DnD — Phase 2 実装
    // =========================================================================

    /**
     * .kc-rows 要素の getBoundingClientRect を取得する
     * @returns {DOMRect|null}
     */
    function _getRowsRect() {
      var rows = document.getElementById('kc-rows');
      return rows ? rows.getBoundingClientRect() : null;
    }

    /**
     * clientY 座標からスナップ済みの分数（0〜24*60）を計算する
     * @param {number} clientY - カーソルの clientY
     * @param {DOMRect} rowsRect - .kc-rows の getBoundingClientRect()
     * @returns {number} スナップ済み分数（0〜1440、DND_SNAP_MIN 単位）
     */
    function _yToSnappedMin(clientY, rowsRect) {
      var totalMin = 24 * 60;
      // 30 分スロット高 = rows高 / 24 / 2
      var rowHeightPx = rowsRect.height / 24 / 2;
      var slotMin = 30;
      var rawMin = (clientY - rowsRect.top) / rowHeightPx * slotMin;
      var snapped = Math.round(rawMin / DND_SNAP_MIN) * DND_SNAP_MIN;
      return Math.max(0, Math.min(snapped, totalMin));
    }

    /**
     * clientX から週内列インデックス（0〜6）を返す
     * .kc-cell[data-date] の位置から判定する
     * @param {number} clientX
     * @returns {number} 列インデックス（-1 = グリッド外）
     */
    function _xToColIdx(clientX) {
      var cells = document.querySelectorAll('.kc-rows .kc-row:first-child .kc-cell');
      for (var i = 0; i < cells.length; i++) {
        var r = cells[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return i;
      }
      return -1;
    }

    /**
     * 分数を "HH:MM" 文字列に変換する
     * @param {number} totalMin
     * @returns {string}
     */
    function _minToHHMM(totalMin) {
      var U = KC.Utils;
      var h = Math.floor(totalMin / 60) % 24;
      var m = totalMin % 60;
      return U.pad2(h) + ':' + U.pad2(m);
    }

    /**
     * ISO 文字列 + 分数オフセットから新しい ISO 文字列を生成する
     * 日付は baseDate の YYYY-MM-DD を使い、分数は totalMin で置き換える
     * @param {string} baseDateYMD - "YYYY-MM-DD"
     * @param {number} totalMin - 0〜1440（1440 = 翌日 00:00）
     * @returns {string} ISO 文字列
     */
    function _ymdhMinToISO(baseDateYMD, totalMin) {
      var h = Math.floor(totalMin / 60);
      var m = totalMin % 60;
      if (h >= 24) {
        // 翌日にまたがる場合は日付を +1 して時刻を補正
        var nextDay = KC.Utils.addDays(new Date(baseDateYMD + 'T00:00:00'), 1);
        var nextYMD = KC.Utils.fmtYMD(nextDay);
        var nh = h - 24;
        return nextYMD + 'T' + KC.Utils.pad2(nh) + ':' + KC.Utils.pad2(m) + ':00+09:00';
      }
      return baseDateYMD + 'T' + KC.Utils.pad2(h) + ':' + KC.Utils.pad2(m) + ':00+09:00';
    }

    /**
     * 時間予定ゴースト要素を生成する（position: fixed で body に直接 append）
     * @param {Object} ev - KcEvent
     * @returns {HTMLElement}
     */
    function _buildTimeGhost(ev) {
      var ghost = document.createElement('div');
      ghost.className = 'kc-event kc-event--ghost';
      ghost.style.position = 'fixed';
      ghost.style.zIndex = '9999';
      ghost.style.pointerEvents = 'none';

      if (ev.color) {
        ghost.style.background = ev.color;
        ghost.style.borderColor = ev.color;
      }

      var titleDiv = document.createElement('div');
      titleDiv.className = 'kc-evt-title';
      titleDiv.textContent = ev.title || '(無題)';

      var timeDiv = document.createElement('div');
      timeDiv.className = 'kc-evt-ghost-time';
      timeDiv.textContent = '';

      ghost.appendChild(titleDiv);
      ghost.appendChild(timeDiv);
      return ghost;
    }

    /**
     * 時間予定ゴーストの位置・サイズを更新する
     * @param {HTMLElement} ghost
     * @param {number} colIdx - 列インデックス（0〜6）
     * @param {number} startMin - 開始分（0〜1440）
     * @param {number} endMin - 終了分（startMin+duration）
     * @param {DOMRect} rowsRect - .kc-rows の getBoundingClientRect()
     */
    function _positionTimeGhost(ghost, colIdx, startMin, endMin, rowsRect) {
      var totalMin = 24 * 60;
      var cells = document.querySelectorAll('.kc-rows .kc-row:first-child .kc-cell');
      if (colIdx < 0 || colIdx >= cells.length) return;
      var cellRect = cells[colIdx].getBoundingClientRect();

      var topPx = rowsRect.top + (startMin / totalMin) * rowsRect.height;
      var heightPx = ((endMin - startMin) / totalMin) * rowsRect.height;
      if (heightPx < 2) heightPx = 2;

      ghost.style.left   = (cellRect.left + 6) + 'px';
      ghost.style.width  = (cellRect.width - 12) + 'px';
      ghost.style.top    = topPx + 'px';
      ghost.style.height = heightPx + 'px';
    }

    /**
     * 時間予定ゴーストの時刻ラベルを更新する
     * @param {HTMLElement} ghost
     * @param {number} startMin
     * @param {number} endMin
     */
    function _updateTimeGhostLabel(ghost, startMin, endMin) {
      var timeDiv = ghost.querySelector('.kc-evt-ghost-time');
      if (!timeDiv) return;
      // 終了分が 1440 以上の場合は翌日時刻として表示
      var displayEnd = endMin >= 1440 ? endMin - 1440 : endMin;
      timeDiv.textContent = _minToHHMM(startMin) + '〜' + _minToHHMM(displayEnd);
    }

    /**
     * mousemove ハンドラ（時間予定 移動・リサイズ共用）
     */
    function _onMouseMoveTime(e) {
      if (!_drag) return;

      if (!_drag.started) {
        var dist = Math.hypot(e.clientX - _drag.startX, e.clientY - _drag.startY);
        if (dist < DND_THRESHOLD) return;

        // DnD 開始
        _drag.started = true;
        document.body.classList.add('kc-dnd-active');
        document.body.style.userSelect = 'none';

        // 元バー(複数セグメント含む)を薄表示
        if (_drag.origBar) _drag.origBar.classList.add('kc-event--dragging');
        if (_drag.origBars) {
          _drag.origBars.forEach(function (b) { b.classList.add('kc-event--dragging'); });
        }

        // ゴーストを body に追加
        if (_drag.ghost) document.body.appendChild(_drag.ghost);

        // ESC / blur キャンセル登録
        document.addEventListener('keydown', _onKeyDown);
        window.addEventListener('blur', _cancel);
      }

      var rowsRect = _getRowsRect();
      if (!rowsRect) return;

      if (_drag.type === 'move') {
        _onMoveTimeMove(e, rowsRect);
      } else if (_drag.type === 'resize-top' || _drag.type === 'resize-bottom') {
        _onResizeTimeMove(e, rowsRect);
      }
    }

    /**
     * 時間予定移動の mousemove 処理
     * @param {MouseEvent} e
     * @param {DOMRect} rowsRect
     */
    function _onMoveTimeMove(e, rowsRect) {
      var ev = _drag.ev;
      var origStart = new Date(ev.start);
      var origEnd   = new Date(ev.end);
      var durationMin = Math.round((origEnd.getTime() - origStart.getTime()) / 60000);

      // Y 座標 → スナップ分
      var rawMin = _yToSnappedMin(e.clientY, rowsRect);
      var startMin = rawMin - _drag.offsetMin;
      startMin = Math.round(startMin / DND_SNAP_MIN) * DND_SNAP_MIN;
      // 開始分は 0 以上（00:00 未満は不可）。終了が 24:00 超えは翌日として許容
      startMin = Math.max(0, startMin);
      var endMin = startMin + durationMin;

      // X 座標 → 列インデックス
      var colIdx = _xToColIdx(e.clientX);
      if (colIdx < 0) colIdx = _drag.lastColIdx || 0;
      _drag.lastColIdx = colIdx;

      // 新しい日付
      var weekYMDs = _getWeekYMDs();
      var newDateYMD = weekYMDs[colIdx] || weekYMDs[0];

      _drag.newStart = _ymdhMinToISO(newDateYMD, startMin);
      _drag.newEnd   = _ymdhMinToISO(newDateYMD, endMin);

      // ゴースト追従
      _positionTimeGhost(_drag.ghost, colIdx, startMin, endMin, rowsRect);
      _updateTimeGhostLabel(_drag.ghost, startMin, endMin);
    }

    /**
     * 時間予定リサイズの mousemove 処理
     * @param {MouseEvent} e
     * @param {DOMRect} rowsRect
     */
    function _onResizeTimeMove(e, rowsRect) {
      var ev = _drag.ev;
      var origStart = new Date(ev.start);
      var origEnd   = new Date(ev.end);
      var origStartMin = origStart.getHours() * 60 + origStart.getMinutes();

      // NG#1 修正: 日跨ぎ予定の origEndMin を絶対分数で計算する
      // 例: 22:00〜翌02:00 の場合 origEndMin = 2*60 + (1日分)1440 = 1560 分
      var origEndMin = origEnd.getHours() * 60 + origEnd.getMinutes();
      var startYMD = KC.Utils.fmtYMD(origStart);
      var endYMD   = KC.Utils.fmtYMD(origEnd);
      if (startYMD !== endYMD) {
        var startDate0 = new Date(origStart.getFullYear(), origStart.getMonth(), origStart.getDate());
        var endDate0   = new Date(origEnd.getFullYear(),   origEnd.getMonth(),   origEnd.getDate());
        var diffDays   = Math.round((endDate0 - startDate0) / 86400000);
        origEndMin += diffDays * 24 * 60;
      }

      var curMin = _yToSnappedMin(e.clientY, rowsRect);
      var newStartMin, newEndMin;

      if (_drag.type === 'resize-top') {
        // 上端リサイズ: 開始時刻のみ変更
        newStartMin = curMin;
        newEndMin   = origEndMin;
        // 最小長: DND_MIN_DURATION 分
        if (newEndMin - newStartMin < DND_MIN_DURATION) {
          newStartMin = newEndMin - DND_MIN_DURATION;
        }
        // 0 分未満不可
        if (newStartMin < 0) newStartMin = 0;
      } else {
        // 下端リサイズ: 終了時刻のみ変更
        newStartMin = origStartMin;
        newEndMin   = curMin;
        // 最小長: DND_MIN_DURATION 分
        if (newEndMin - newStartMin < DND_MIN_DURATION) {
          newEndMin = newStartMin + DND_MIN_DURATION;
        }
        // NG#2 修正: 24:00 跨ぎリサイズを許可（上限を 48*60 に緩和）
        // _ymdhMinToISO は h >= 24 で翌日に繰り越すため、そのまま流用可能
        if (newEndMin > 48 * 60) newEndMin = 48 * 60;
      }

      // 日付は元の開始日を維持
      var origYMD = KC.Utils.fmtYMD(origStart);
      _drag.newStart = _ymdhMinToISO(origYMD, newStartMin);
      _drag.newEnd   = _ymdhMinToISO(origYMD, newEndMin);

      // ゴースト位置更新（列は元の列）
      var colIdx = _drag.colIdx || 0;
      _positionTimeGhost(_drag.ghost, colIdx, newStartMin, newEndMin, rowsRect);
      _updateTimeGhostLabel(_drag.ghost, newStartMin, newEndMin);
    }

    /**
     * mouseup ハンドラ（時間予定 移動・リサイズ共用）
     */
    function _onMouseUpTime(e) {
      document.removeEventListener('mousemove', _onMouseMoveTime);
      document.removeEventListener('mouseup', _onMouseUpTime);
      document.removeEventListener('keydown', _onKeyDown);
      window.removeEventListener('blur', _cancel);

      if (!_drag) return;

      var drag = _drag;
      _drag = null;

      // ゴースト除去
      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      // 元バー薄表示解除
      if (drag.origBar) drag.origBar.classList.remove('kc-event--dragging');
      if (drag.origBars) {
        drag.origBars.forEach(function (b) { b.classList.remove('kc-event--dragging'); });
      }

      document.body.classList.remove('kc-dnd-active');
      document.body.style.userSelect = '';

      // 5px 未満の場合はクリックとして通過
      if (!drag.started) return;

      // DnD 発動後はクリックを一度だけキャプチャフェーズでブロック
      function suppressClick(ev) {
        ev.stopPropagation();
        document.removeEventListener('click', suppressClick, true);
      }
      document.addEventListener('click', suppressClick, true);

      if (!drag.newStart || !drag.newEnd) return;
      if (drag.newStart === drag.ev.start && drag.newEnd === drag.ev.end) return;

      // _commitOptimistic は async のため未処理 rejection を防ぐ .catch を付与（§6.2）
      _commitOptimistic(drag.ev, drag.newStart, drag.newEnd).catch(function (err) {
        console.error('[KC.DnD] _commitOptimistic 未処理エラー:', err);
      });
    }

    /**
     * 時間予定の移動 DnD を開始する（Phase 2 実装）
     * @param {Object} ev - KcEvent
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - クリックされた .kc-event 要素
     * @param {HTMLElement[]} allBars - 同イベントの全セグメント（日跨ぎ用）
     */
    function startMove(ev, mousedown, barEl, allBars) {
      mousedown.preventDefault();

      var origStart = new Date(ev.start);
      var rowsRect = _getRowsRect();
      var offsetMin = 0;
      if (rowsRect) {
        // バー内のクリック位置を分単位に換算してオフセットとして保持
        var rawMin = _yToSnappedMin(mousedown.clientY, rowsRect);
        var evStartMin = origStart.getHours() * 60 + origStart.getMinutes();
        offsetMin = rawMin - evStartMin;
        if (offsetMin < 0) offsetMin = 0;
      }

      // 初期列インデックス
      var weekYMDs = _getWeekYMDs();
      var colIdx = weekYMDs.indexOf(KC.Utils.fmtYMD(origStart));
      if (colIdx < 0) colIdx = 0;

      var ghost = _buildTimeGhost(ev);

      _drag = {
        type:       'move',
        ev:         ev,
        ghost:      ghost,
        origBar:    barEl,
        origBars:   allBars || [],
        startX:     mousedown.clientX,
        startY:     mousedown.clientY,
        started:    false,
        offsetMin:  offsetMin,
        colIdx:     colIdx,
        lastColIdx: colIdx,
        newStart:   null,
        newEnd:     null
      };

      document.addEventListener('mousemove', _onMouseMoveTime);
      document.addEventListener('mouseup', _onMouseUpTime);
    }

    /**
     * 時間予定のリサイズ DnD を開始する（Phase 2 実装）
     * @param {Object} ev - KcEvent
     * @param {'top'|'bottom'} side
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - .kc-event 要素
     */
    function startResize(ev, side, mousedown, barEl) {
      mousedown.preventDefault();

      var origStart = new Date(ev.start);
      var weekYMDs = _getWeekYMDs();
      var colIdx = weekYMDs.indexOf(KC.Utils.fmtYMD(origStart));
      if (colIdx < 0) colIdx = 0;

      var ghost = _buildTimeGhost(ev);

      _drag = {
        type:     side === 'top' ? 'resize-top' : 'resize-bottom',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        origBars: [],
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        colIdx:   colIdx,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveTime);
      document.addEventListener('mouseup', _onMouseUpTime);
    }

    // =========================================================================
    // ユーティリティ
    // =========================================================================

    /**
     * 現在表示週の 7 日分（日ビュー時は当日 1 日分）の YYYY-MM-DD 文字列配列を返す
     * @returns {string[]}
     */
    function _getWeekYMDs() {
      var S = KC.State;
      var U = KC.Utils;

      // 日ビュー: 当日 1 要素のみ返す（§3.9）
      if (S.view === 'day') {
        return [U.fmtYMD(S.current)];
      }

      var d = new Date(S.current);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      var res = [];
      for (var i = 0; i < 7; i++) {
        res.push(U.fmtYMD(U.addDays(d, i)));
      }
      return res;
    }

    // =========================================================================
    // 月ビュー DnD ヘルパー
    // =========================================================================

    /**
     * clientX / clientY から月ビューの .kc-month-cell[data-date] を走査し
     * 対応するセル情報を返す。X・Y 両座標で判定するため別週またぎ DnD が正常に動作する。
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{ colIdx: number, dateYMD: string, cellEl: HTMLElement } | null}
     */
    function _monthCellFromXY(clientX, clientY) {
      var cells = document.querySelectorAll('.kc-month-cell[data-date]');
      for (var i = 0; i < cells.length; i++) {
        var r = cells[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right &&
            clientY >= r.top  && clientY <= r.bottom) {
          return {
            colIdx:  i % 7,
            dateYMD: cells[i].dataset.date,
            cellEl:  cells[i]
          };
        }
      }
      return null;
    }

    /**
     * 月ビュー終日ゴーストを body 直下 fixed で追従させる
     * ゴースト幅は週末（土曜=colIdx 6）までの残り列数でクランプして週をまたぐ表示を防ぐ。
     * @param {HTMLElement} ghost
     * @param {string} dateYMD - ゴーストが乗るセルの YYYY-MM-DD
     * @param {number} spanDays - 表示上の日数
     * @param {number} [colIdx] - 開始セルの列インデックス（0=日曜...6=土曜）。省略時はセルの位置から算出
     */
    function _positionMonthGhost(ghost, dateYMD, spanDays, colIdx) {
      var cell = document.querySelector('.kc-month-cell[data-date="' + dateYMD + '"]');
      if (!cell) return;
      var r    = cell.getBoundingClientRect();
      var cellW = r.width;

      // colIdx が渡されない場合はセルの DOM 順から算出
      if (colIdx === undefined) {
        var allCells = document.querySelectorAll('.kc-month-cell[data-date]');
        var cellIdx = 0;
        for (var i = 0; i < allCells.length; i++) {
          if (allCells[i] === cell) { cellIdx = i; break; }
        }
        colIdx = cellIdx % 7;
      }

      // 週末（土曜=6）までの残り列数でクランプ（翌週にはみ出さないようにする）
      var remainingCols = 7 - colIdx;
      var clampedSpan = Math.min(spanDays, remainingCols);

      ghost.style.position = 'fixed';
      ghost.style.left     = r.left + 'px';
      ghost.style.top      = (r.top + 4) + 'px';
      ghost.style.width    = (cellW * clampedSpan) + 'px';
      ghost.style.height   = '22px';
    }

    /**
     * 月ビュー終日バー移動 DnD を開始する（スコープ A）
     * @param {Object} ev - KcEvent
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - .kc-ad-event 要素
     */
    function startMoveAlldayMonth(ev, mousedown, barEl) {
      mousedown.preventDefault();

      var ghost = _buildAlldayGhost(ev, '');
      ghost.style.position = 'fixed';
      ghost.style.zIndex   = '9999';
      ghost.style.pointerEvents = 'none';

      _drag = {
        view:     'month',
        type:     'move-allday',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        lane:     ev.lane || 0,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveAllday);
      document.addEventListener('mouseup', _onMouseUpAllday);
    }

    /**
     * 月ビュー終日バーリサイズ DnD を開始する（スコープ B）
     * @param {Object} ev - KcEvent
     * @param {'left'|'right'} side
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - .kc-ad-event 要素
     */
    function startResizeAlldayMonth(ev, side, mousedown, barEl) {
      mousedown.preventDefault();

      var ghost = _buildAlldayGhost(ev, '');
      ghost.style.position = 'fixed';
      ghost.style.zIndex   = '9999';
      ghost.style.pointerEvents = 'none';

      _drag = {
        view:     'month',
        type:     side === 'left' ? 'resize-left' : 'resize-right',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        lane:     ev.lane || 0,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveAllday);
      document.addEventListener('mouseup', _onMouseUpAllday);
    }

    // =========================================================================
    // 月ビュー chip DnD — スコープ C（Phase B）
    // =========================================================================

    /**
     * 月ビュー chip ゴースト要素を生成する（position: fixed / body 直下方式）
     * @param {Object} ev - KcEvent
     * @returns {HTMLElement}
     */
    function _buildMonthChipGhost(ev) {
      // bgColor 未指定時のフォールバック: #818cf8（インジゴ）で統一
      // ただしゴーストは kc-event--ghost CSS で白（#ffffff !important）に上書きされるため表示上は影響なし
      var color = ev.color || '#818cf8';
      var ghost = document.createElement('div');
      ghost.className = 'kc-month-chip kc-event--ghost';
      ghost.style.position = 'fixed';
      ghost.style.zIndex = '9999';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.85';

      var dot = document.createElement('span');
      dot.className = 'kc-month-chip-dot';
      dot.style.background = color;

      var evStart = new Date(ev.start);
      var timeSpan = document.createElement('span');
      timeSpan.className = 'kc-month-chip-time';
      timeSpan.textContent = KC.Utils.pad2(evStart.getHours()) + ':' + KC.Utils.pad2(evStart.getMinutes());

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-month-chip-title';
      titleSpan.textContent = ev.title || '(無題)';

      ghost.appendChild(dot);
      ghost.appendChild(timeSpan);
      ghost.appendChild(titleSpan);
      return ghost;
    }

    /**
     * chip 移動の mousemove ハンドラ（閾値判定 → セル検出 → newStart/newEnd 更新）
     * @param {MouseEvent} e
     */
    function _onMouseMoveMonthChip(e) {
      if (!_drag) return;

      // 5px 閾値判定
      if (!_drag.started) {
        var dist = Math.hypot(e.clientX - _drag.startX, e.clientY - _drag.startY);
        if (dist < DND_THRESHOLD) return;

        _drag.started = true;
        document.body.classList.add('kc-dnd-active');
        document.body.style.userSelect = 'none';
        _drag.origBar.classList.add('kc-event--dragging');
        document.body.appendChild(_drag.ghost);
        document.addEventListener('keydown', _onKeyDown);
        window.addEventListener('blur', _cancel);
      }

      var info = _monthCellFromXY(e.clientX, e.clientY);
      if (!info) return;

      _drag.newStart = _buildChipISO(_drag.ev.start, info.dateYMD);
      _drag.newEnd   = _buildChipISO(_drag.ev.end,   _calcChipEndYMD(_drag.ev, info.dateYMD));

      // ゴーストをカーソル位置に追従（body 直下 fixed）
      _drag.ghost.style.left = (e.clientX - 20) + 'px';
      _drag.ghost.style.top  = (e.clientY - 8)  + 'px';
    }

    /**
     * chip 移動: 元の開始→終了の日数差を維持して終了日 YMD を算出する
     * @param {Object} ev - KcEvent
     * @param {string} newStartYMD - 新しい開始日 YYYY-MM-DD
     * @returns {string} 新しい終了日 YYYY-MM-DD
     */
    function _calcChipEndYMD(ev, newStartYMD) {
      var origStartDate = new Date(ev.start.substring(0, 10) + 'T00:00:00');
      var origEndDate   = new Date(ev.end.substring(0, 10)   + 'T00:00:00');
      var diffMs   = origEndDate.getTime() - origStartDate.getTime();
      var newStart = new Date(newStartYMD + 'T00:00:00');
      var newEnd   = new Date(newStart.getTime() + diffMs);
      return KC.Utils.fmtYMD(newEnd);
    }

    /**
     * ISO 文字列の日付部分のみを newDateYMD に置き換える（時刻部分は維持）
     * DATE 型フィールドでは ev.start が UTC Z 形式（例: "2026-05-08T00:00:00.000Z"）になるため
     * Z 形式を検出して JST 固定の ISO に変換する。
     * @param {string} origISO - 元の ISO 文字列
     * @param {string} newDateYMD - 新しい日付 "YYYY-MM-DD"
     * @returns {string} 新しい ISO 文字列
     */
    function _buildChipISO(origISO, newDateYMD) {
      if (!origISO) return null;
      // DATE 型 (UTC Z 形式: "...T00:00:00.000Z" or "...Z") → JST 固定
      if (/Z$/.test(origISO)) {
        return newDateYMD + 'T00:00:00+09:00';
      }
      // DATETIME 型 → 時刻部分（"THH:MM:SS+09:00"）を維持
      return newDateYMD + origISO.substring(10);
    }

    /**
     * chip 移動の mouseup ハンドラ（commit or キャンセル）
     * @param {MouseEvent} e
     */
    function _onMouseUpMonthChip(e) {
      document.removeEventListener('mousemove', _onMouseMoveMonthChip);
      document.removeEventListener('mouseup', _onMouseUpMonthChip);
      document.removeEventListener('keydown', _onKeyDown);
      window.removeEventListener('blur', _cancel);

      if (!_drag) return;

      var drag = _drag;
      _drag = null;

      // ゴースト除去
      if (drag.ghost && drag.ghost.parentNode) {
        drag.ghost.parentNode.removeChild(drag.ghost);
      }

      // 元 chip の薄表示解除
      if (drag.origBar) {
        drag.origBar.classList.remove('kc-event--dragging');
      }

      document.body.classList.remove('kc-dnd-active');
      document.body.style.userSelect = '';

      // 5px 未満の場合はクリックとして通過
      if (!drag.started) return;

      // DnD 発動後はクリックを一度だけキャプチャフェーズでブロック（誤ポップアップ防止）
      function suppressClick(ev) {
        ev.stopPropagation();
        document.removeEventListener('click', suppressClick, true);
      }
      document.addEventListener('click', suppressClick, true);

      if (!drag.newStart || !drag.newEnd) return;
      if (drag.newStart === drag.ev.start && drag.newEnd === drag.ev.end) return;

      // _commitOptimistic は async のため未処理 rejection を防ぐ .catch を付与（§6.2）
      _commitOptimistic(drag.ev, drag.newStart, drag.newEnd).catch(function (err) {
        console.error('[KC.DnD] _commitOptimistic 未処理エラー:', err);
      });
    }

    /**
     * 月ビュー chip 移動 DnD を開始する（スコープ C）
     * @param {Object} ev - KcEvent（時間予定）
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} chipEl - クリックされた .kc-month-chip 要素
     */
    function startMoveMonthChip(ev, mousedown, chipEl) {
      mousedown.preventDefault();

      var ghost = _buildMonthChipGhost(ev);

      _drag = {
        view:     'month',
        type:     'move-month-chip',
        ev:       ev,
        ghost:    ghost,
        origBar:  chipEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveMonthChip);
      document.addEventListener('mouseup', _onMouseUpMonthChip);
    }

    /**
     * 月ビュー日跨ぎ時間予定バーのリサイズ DnD を開始する（スコープ C-resize）
     * 終日の startResizeAlldayMonth と同構造だが type が異なり、
     * mousemove 側で時刻維持ロジック（_onResizeTimedSpanMoveMonth）を呼ぶ。
     * @param {Object} ev - KcEvent（時間予定）
     * @param {'left'|'right'} side
     * @param {MouseEvent} mousedown
     * @param {HTMLElement} barEl - .kc-month-chip--span 要素
     */
    function startResizeMonthTimedSpan(ev, side, mousedown, barEl) {
      mousedown.preventDefault();

      var ghost = _buildMonthChipGhost(ev);
      ghost.style.position    = 'fixed';
      ghost.style.zIndex      = '9999';
      ghost.style.pointerEvents = 'none';

      _drag = {
        view:     'month',
        type:     side === 'left' ? 'resize-left-timed-span' : 'resize-right-timed-span',
        ev:       ev,
        ghost:    ghost,
        origBar:  barEl,
        startX:   mousedown.clientX,
        startY:   mousedown.clientY,
        started:  false,
        lane:     ev.lane || 0,
        newStart: null,
        newEnd:   null
      };

      document.addEventListener('mousemove', _onMouseMoveAllday);
      document.addEventListener('mouseup', _onMouseUpAllday);
    }

    /**
     * KC.DnD.beginSelection — DESIGN.md §206 に記載があるが未実装（スタブ）
     * Phase 2 以降で範囲選択による新規作成が必要な場合に実装する
     */
    function beginSelection() {
      // スタブ: 未実装
    }

    // =========================================================================
    // 公開 API
    // =========================================================================
    return {
      get _drag() { return _drag; },
      startMoveAllday:           startMoveAllday,
      startResizeAllday:         startResizeAllday,
      startMoveAlldayMonth:      startMoveAlldayMonth,
      startResizeAlldayMonth:    startResizeAlldayMonth,
      startMoveMonthChip:        startMoveMonthChip,
      startResizeMonthTimedSpan: startResizeMonthTimedSpan,
      startMove:                 startMove,
      startResize:               startResize,
      beginSelection:         beginSelection,
      _cancel:                _cancel
    };
  }());

  /* ====================================================================
   * KC.LoginContext — ログインユーザー情報と権限判定ユーティリティ
   * KC.Boot.init で init() を呼ぶこと（同期）。
   * ==================================================================== */
  KC.LoginContext = (function () {
    var _user = null;

    /**
     * ログインユーザー情報をキャッシュする（同期）
     * USER_SELECT のみ対応のため API 呼び出しは不要
     * @returns {void}
     */
    function init() {
      _user = kintone.getLoginUser();
    }

    /**
     * ログインユーザーのコードを返す
     * @returns {string|null}
     */
    function getUserCode() {
      return _user ? _user.code : null;
    }

    /**
     * permissionRules の 1 エントリを評価する（USER_SELECT のみ対応）
     * フィールドの value[].code にログインユーザーコードが含まれるか判定する
     * @param {Object} rule - { fieldCode, permission, color }
     * @param {Object} evt  - KcEvent（permissionFields を含む）
     * @returns {string|null} マッチした場合は権限文字列、非マッチは null
     */
    function _evalEntry(rule, evt) {
      if (!_user) return null;
      var codes = evt.permissionFields && evt.permissionFields[rule.fieldCode]
        ? evt.permissionFields[rule.fieldCode]
        : [];
      var matched = codes.indexOf(_user.code) !== -1;
      return matched ? rule.permission : null;
    }

    /**
     * 権限レベルを数値化して比較に使う（高いほど強い権限）
     * @param {string|null} perm
     * @returns {number}
     */
    function _permLevel(perm) {
      if (perm === 'delete') return 3;
      if (perm === 'edit')   return 2;
      if (perm === 'view')   return 1;
      return 0;  // null / 'none'
    }

    /**
     * 色決定ロジック: permissionRules を上から走査し最初にマッチした行の bgColor/textColor を返す（§5.8）
     * @param {Array} rules - PERMISSION_RULES
     * @param {Object} evt  - KcEvent（permissionFields を含む）
     * @returns {{ bgColor: string|null, textColor: string|null }}
     */
    function _resolveColors(rules, evt) {
      if (!rules || rules.length === 0) return { bgColor: null, textColor: null };
      for (var i = 0; i < rules.length; i++) {
        var granted = _evalEntry(rules[i], evt);
        if (granted !== null) {
          return {
            bgColor:   rules[i].bgColor   || null,
            textColor: rules[i].textColor || null
          };
        }
      }
      return { bgColor: null, textColor: null };
    }

    /**
     * フィールド値権限ルール 1 エントリの値マッチを判定する（REQ v6 §5.10）
     * CHECK_BOX は任意要素一致（§10 U-7）、その他は完全一致
     * @param {string|string[]} fieldValue - レコードのフィールド値
     * @param {string} ruleValue - ルールの条件値
     * @param {string} fieldType - フィールド型
     * @returns {boolean}
     */
    function _matchFieldValue(fieldValue, ruleValue, fieldType) {
      if (fieldType === 'CHECK_BOX') {
        return Array.isArray(fieldValue) && fieldValue.indexOf(ruleValue) !== -1;
      }
      return fieldValue === ruleValue;
    }

    /**
     * イベントに対するログインユーザーの権限と表示色を返す（v6: フィールド値ルール優先）
     * 優先順位: fieldValueRules → permissionRules → フォールバック（§5.10）
     * - 両配列が空配列の場合: edit 相当（フォールバック: 全員編集可）・bgColor/textColor: null
     * - 設定あり・非マッチ: view 相当・色: null
     * @param {Object} evt - KcEvent（permissionFields / valueFields を含む）
     * @returns {{ canEdit: boolean, canDelete: boolean, canOpenDialog: boolean, bgColor: string|null, textColor: string|null, source: string }}
     */
    function getPermission(evt) {
      var fvRules   = KC.Config.FIELDVALUE_RULES  || [];
      var permRules = KC.Config.PERMISSION_RULES  || [];

      // 1. フィールド値ルールを先にチェック（§5.10）
      for (var fi = 0; fi < fvRules.length; fi++) {
        var fvRule    = fvRules[fi];
        var fieldVal  = evt.valueFields ? evt.valueFields[fvRule.fieldCode] : undefined;
        if (fieldVal === undefined) continue;
        if (!_matchFieldValue(fieldVal, fvRule.value, fvRule.fieldType)) continue;
        return {
          canEdit:       _permLevel(fvRule.permission) >= 2,
          canDelete:     _permLevel(fvRule.permission) >= 3,
          canOpenDialog: true,
          bgColor:       fvRule.bgColor   || null,
          textColor:     fvRule.textColor || null,
          source:        'field'
        };
      }

      // 2. ユーザー権限ルール（§5.3 / §5.8）
      if (permRules.length > 0) {
        var best = null;
        for (var pi = 0; pi < permRules.length; pi++) {
          var granted = _evalEntry(permRules[pi], evt);
          if (_permLevel(granted) > _permLevel(best)) { best = granted; }
        }
        var colors = _resolveColors(permRules, evt);
        if (best !== null) {
          return {
            canEdit:       _permLevel(best) >= _permLevel('edit'),
            canDelete:     _permLevel(best) >= _permLevel('delete'),
            canOpenDialog: true,
            bgColor:       colors.bgColor,
            textColor:     colors.textColor,
            source:        'user'
          };
        }
        // 設定あり・非マッチ: view 相当・色なし
        return { canEdit: false, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'user' };
      }

      // 3. 両配列空: フォールバック（全員 edit）
      return { canEdit: true, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'fallback' };
    }

    return {
      init:          init,
      getUserCode:   getUserCode,
      getPermission: getPermission
    };
  }());

  /* ====================================================================
   * KC.Lanes — レーン計算ユーティリティ（週ビュー・月ビュー共通）
   * KC.RenderWeek から切り出し。KC.RenderWeek より前に定義すること。
   * ==================================================================== */
  KC.Lanes = (function () {
    var U = KC.Utils;

    // isLightColor の結果キャッシュ（color 文字列 → boolean）
    var _colorCache = {};

    /**
     * 色が明るいかどうかを判定する（文字色選択に使用）
     * 同一 color 文字列の再計算を省くため結果をキャッシュする
     * @param {string} color - CSS カラー文字列
     * @returns {boolean} true = 明るい色（文字を黒にする）
     */
    function isLightColor(color) {
      if (_colorCache[color] !== undefined) return _colorCache[color];
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      var data = ctx.getImageData(0, 0, 1, 1).data;
      var luminance = (0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2]) / 255;
      var result = luminance > 0.6;
      _colorCache[color] = result;
      return result;
    }

    /**
     * 表示期間内でのイベントのバー位置を算出する
     * @param {Object} evt - KcEvent（start, end を含む）
     * @param {string[]} weekYMD - 表示列の YYYY-MM-DD 配列（週ビュー=7要素, 日ビュー=1要素）
     * @returns {{ colStart: number, span: number, adDateRange: string } | null}
     *   表示範囲に重なりがない場合は null
     */
    function eventToBarPosition(evt, weekYMD) {
      var s = new Date(evt.start);
      var e = new Date(evt.end);

      // kintone は終日イベントの end を「翌日 0 時 UTC」で保存する想定。
      // JST 環境では getDate() - 1 が正しく実日付の終了日を返す（国内 kintone 環境前提）。
      var startDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      var endDate   = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1);

      // 日付レンジ表示用文字列
      var adStartStr  = (startDate.getMonth() + 1) + '/' + startDate.getDate();
      var adEndStr    = (endDate.getMonth() + 1) + '/' + endDate.getDate();
      var adDateRange = (adStartStr === adEndStr) ? adStartStr : (adStartStr + ' ~ ' + adEndStr);

      // 表示期間の開始・終了を YYYY-MM-DD で取得（日ビュー=1要素, 週ビュー=7要素に対応）
      var weekStartYMD = weekYMD[0];
      var weekEndYMD   = weekYMD[weekYMD.length - 1];

      // 表示する開始列: max(イベント開始日, 週開始日)
      var evStartYMD = U.fmtYMD(startDate);
      var evEndYMD   = U.fmtYMD(endDate);

      // 当週に重なりがなければ null を返す
      if (evStartYMD > weekEndYMD || evEndYMD < weekStartYMD) return null;

      // 週内でクランプ
      var clampedStartYMD = (evStartYMD < weekStartYMD) ? weekStartYMD : evStartYMD;
      var clampedEndYMD   = (evEndYMD > weekEndYMD)     ? weekEndYMD   : evEndYMD;

      var colStart = weekYMD.indexOf(clampedStartYMD);
      var colEnd   = weekYMD.indexOf(clampedEndYMD);

      if (colStart < 0 || colEnd < 0) return null;

      return {
        colStart:    colStart,
        span:        colEnd - colStart + 1,
        adDateRange: adDateRange
      };
    }

    /**
     * 週イベント配列にレーン番号を付与する（破壊的変更）
     * ソート規則: 自分の予定（color あり）降順 → 開始日時昇順 → 終了日時降順 → created 昇順 → id 昇順
     * 色付き予定を最上位レーンに配置し、開始が早い予定を優先、同開始なら終了が遅い予定を優先する。
     * @param {Array} weekEvents - { colStart, span, start, end, created, id } を含む配列
     * @returns {Array} lane プロパティが付与された配列
     */
    function assignLanes(weekEvents) {
      // 色あり降順 → 開始日時昇順 → 終了日時降順 → 作成日時昇順 → ID 昇順でソート
      weekEvents.sort(function (a, b) {
        var aHasColor = KC.LoginContext.getPermission(a).bgColor ? 0 : 1;
        var bHasColor = KC.LoginContext.getPermission(b).bgColor ? 0 : 1;
        if (aHasColor !== bHasColor) return aHasColor - bHasColor;
        var aStart = new Date(a.start).getTime();
        var bStart = new Date(b.start).getTime();
        if (aStart !== bStart) return aStart - bStart;
        var aEnd = new Date(a.end).getTime();
        var bEnd = new Date(b.end).getTime();
        if (bEnd !== aEnd) return bEnd - aEnd;
        if (a.created !== b.created) return a.created < b.created ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });

      // レーン占有テーブル: laneOccupied[lane] = [{ endCol: number }, ...]
      var laneOccupied = [];

      weekEvents.forEach(function (ev) {
        var lane = 0;

        // 最小の空きレーンをグリーディに探す
        while (true) {
          if (!laneOccupied[lane]) {
            laneOccupied[lane] = [];
            break;
          }
          var conflict = laneOccupied[lane].some(function (r) {
            // 既存バーの終端が今回の開始より後ならば衝突
            return r.endCol > ev.colStart;
          });
          if (!conflict) break;
          lane++;
        }

        laneOccupied[lane].push({ endCol: ev.colStart + ev.span });
        ev.lane = lane;
      });

      return weekEvents;
    }

    /**
     * 時間予定（allday=false）用バー位置算出
     * eventToBarPosition は終日用（end を day-1 換算）のため時間予定では誤差が出る。
     * 時間予定の end は実際の終了日時なので endDate に -1 換算は不要。
     * @param {Object} evt - KcEvent（allday=false, start/end を含む）
     * @param {string[]} weekYMD - 表示列の YYYY-MM-DD 配列（7要素）
     * @returns {{ colStart: number, span: number, adDateRange: string } | null}
     *   当週に重なりがない場合は null。span が 1 のとき（単日）は null を返す。
     */
    function timedEventToBarPosition(evt, weekYMD) {
      var s = new Date(evt.start);
      var e = new Date(evt.end);

      // 時間予定は end が実終了時刻なので day-1 換算なし
      var startDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      var endDate   = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      // 終了時刻が 0:00 ちょうどの場合は前日終了とみなす（例: ~24:00 = ~翌0:00）
      if (e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0) {
        endDate = new Date(endDate.getTime() - 86400000);
      }

      var evStartYMD = U.fmtYMD(startDate);
      var evEndYMD   = U.fmtYMD(endDate);

      // 単日（開始日 = 終了日）は日跨ぎバーではなく chip で描画するため null を返す
      if (evStartYMD === evEndYMD) return null;

      var weekStartYMD = weekYMD[0];
      var weekEndYMD   = weekYMD[weekYMD.length - 1];

      // 当週に重なりがなければ null
      if (evStartYMD > weekEndYMD || evEndYMD < weekStartYMD) return null;

      var clampedStartYMD = (evStartYMD < weekStartYMD) ? weekStartYMD : evStartYMD;
      var clampedEndYMD   = (evEndYMD > weekEndYMD)     ? weekEndYMD   : evEndYMD;

      var colStart = weekYMD.indexOf(clampedStartYMD);
      var colEnd   = weekYMD.indexOf(clampedEndYMD);
      if (colStart < 0 || colEnd < 0) return null;

      var startStr  = (startDate.getMonth() + 1) + '/' + startDate.getDate();
      var endStr    = (endDate.getMonth() + 1) + '/' + endDate.getDate();
      var adDateRange = (startStr === endStr) ? startStr : (startStr + ' ~ ' + endStr);

      return {
        colStart:    colStart,
        span:        colEnd - colStart + 1,
        adDateRange: adDateRange
      };
    }

    return {
      isLightColor:            isLightColor,
      eventToBarPosition:      eventToBarPosition,
      timedEventToBarPosition: timedEventToBarPosition,
      assignLanes:             assignLanes
    };
  }());

  /* ====================================================================
   * KC.RenderShared — 週ビュー・日ビュー共通描画ヘルパー
   * ==================================================================== */
  KC.RenderShared = (function () {
    var U = KC.Utils;
    var S = KC.State;

    /**
     * 折りたたみ時の表示レーン数を算出する
     * @param {number} maxLane - 最大レーン番号（0 始まり）
     * @returns {number} 表示レーン数（1〜3 の範囲）
     */
    function calcCollapsedLanes(maxLane) {
      return Math.max(1, Math.min(maxLane + 1, 3));
    }

    /**
     * .kc-ad-event DOM 要素を生成する（1イベント = 1バー）
     * @param {Object} ev - 位置情報付き KcEvent（colStart, span, lane, adDateRange を含む）
     * @param {Object} locator - { colCount: number } 列数（週=7、日=1）
     * @returns {HTMLElement}
     */
    function buildAlldayBar(ev, locator) {
      var colCount = (locator && locator.colCount > 0) ? locator.colCount : 7;
      var BAR_H   = 20;  /* --kc-ad-bar-h (font-size 14px 対応: 旧 24px) */
      var BAR_GAP = 3;
      var BAR_TOP = 4;

      var perm    = KC.LoginContext.getPermission(ev);
      var canEdit = perm.canEdit;
      var el = document.createElement('div');
      el.className = 'kc-ad-event';
      // 編集権限なし（DnD 不可）はポインターカーソルに変更（クリックでダイアログは全員開ける）
      if (!canEdit) el.style.cursor = 'pointer';
      el.dataset.eventId = ev.id;  // SearchFilter プルダウン逆引き用

      el.style.left   = ((ev.colStart / colCount) * 100) + '%';
      el.style.width  = ((ev.span    / colCount) * 100) + '%';
      el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';

      // 権限ルールにマッチした bgColor を優先し、なければイベント自体の色フィールドを使用
      var displayBgColor = perm.bgColor || ev.color || null;
      if (displayBgColor) {
        el.style.backgroundColor = displayBgColor;
        el.style.borderColor     = displayBgColor;
        el.style.color = perm.textColor || (KC.Lanes.isLightColor(displayBgColor) ? '#1f2937' : '#ffffff');
      }

      el.title = (ev.title || '(無題)') + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      var dot = document.createElement('span');
      dot.className = 'dot';
      if (displayBgColor) {
        var dotColor = perm.textColor || (KC.Lanes.isLightColor(displayBgColor) ? '#1f2937' : '#ffffff');
        dot.style.background = dotColor;
      }

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-ad-evt-title';
      titleSpan.textContent = ev.title || '(無題)';

      el.appendChild(dot);
      el.appendChild(titleSpan);

      var leftHandle = document.createElement('div');
      leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
      leftHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAllday(ev, 'left', mdEvt, el);
      });

      var rightHandle = document.createElement('div');
      rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
      rightHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAllday(ev, 'right', mdEvt, el);
      });

      el.appendChild(leftHandle);
      el.appendChild(rightHandle);

      el.addEventListener('click', function (clickEvt) {
        clickEvt.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      el.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        KC.DnD.startMoveAllday(ev, mdEvt, el);
      });

      return el;
    }

    /**
     * レーン展開トグル UI を更新する
     * @param {HTMLElement} toggleEl - .kc-allday-toggle 要素
     * @param {number} maxLane - 最大レーン番号（0 始まり）
     * @param {boolean} expanded - 現在の展開状態
     * @param {number} hiddenCount - 折りたたみ時に非表示になるイベント数
     */
    function updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount) {
      if (!toggleEl) return;

      if (maxLane < 3) {
        toggleEl.style.display = 'none';
        return;
      }

      toggleEl.style.display = 'flex';
      toggleEl.textContent = '';
      if (expanded) {
        toggleEl.textContent = '▲ 折りたたむ';
      } else {
        toggleEl.textContent = '▼ もっと表示 (+' + hiddenCount + ')';
      }
    }

    /** 時間ガター描画（00〜23時、view 非依存） */
    function renderTimeGutter() {
      var col = S.els.timeCol;
      if (!col) return;
      col.innerHTML = '';
      for (var h = 0; h < 24; h++) {
        var t = document.createElement('div');
        t.className = 'kc-time';
        t.textContent = (h === 0) ? '' : U.pad2(h) + ':00';
        col.appendChild(t);
      }
    }

    return {
      calcCollapsedLanes: calcCollapsedLanes,
      buildAlldayBar:     buildAlldayBar,
      updateAlldayToggle: updateAlldayToggle,
      renderTimeGutter:   renderTimeGutter
    };
  }());

  /* ====================================================================
   * KC.RenderWeek — 週ビューレンダラー
   * ==================================================================== */
  KC.RenderWeek = (function () {
    var U = KC.Utils;
    var S = KC.State;

    /** 週の開始日（日曜）を返す */
    function weekStart(date) {
      var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d;
    }

    /** 週の開始〜終了を返す */
    function weekRange(date) {
      var start = weekStart(date);
      var end = U.addDays(start, 6);
      return { start: start, end: end };
    }

    /** 曜日ヘッダー描画 */
    function renderDayHeaders() {
      var days = S.els.days;
      if (!days) return;

      // 既存の .kc-day を削除
      Array.from(days.querySelectorAll('.kc-day')).forEach(function (n) { n.remove(); });

      var labels = ['日', '月', '火', '水', '木', '金', '土'];
      var rightSpacer = days.querySelector('.kc-day-spacer-right');
      var range = weekRange(S.current);
      var today = U.fmtYMD(new Date());

      for (var i = 0; i < 7; i++) {
        var d = new Date(range.start);
        d.setDate(range.start.getDate() + i);
        var ymd = U.fmtYMD(d);
        var isToday = (ymd === today);
        var dayOfWeek = d.getDay();
        var holidayName = U.getHolidayName(d);

        var div = document.createElement('div');
        div.className = 'kc-day';
        if (dayOfWeek === 6) div.classList.add('kc-day--sat');
        if (dayOfWeek === 0) div.classList.add('kc-day--sun');
        if (holidayName) div.classList.add('kc-day--holiday');

        var head = document.createElement('div');
        head.className = 'kc-day-head' + (isToday ? ' is-today' : '');

        // XSS安全: textContent 使用
        var wSpan = document.createElement('span');
        wSpan.className = 'w';
        wSpan.textContent = labels[d.getDay()];

        var numSpan = document.createElement('span');
        numSpan.className = 'num';
        numSpan.textContent = d.getDate();

        head.appendChild(wSpan);
        head.appendChild(numSpan);

        // 祝日名表示
        if (holidayName) {
          var holidaySpan = document.createElement('span');
          holidaySpan.className = 'kc-holiday-name';
          holidaySpan.textContent = holidayName;
          head.appendChild(holidaySpan);
        }

        div.appendChild(head);

        if (rightSpacer) {
          days.insertBefore(div, rightSpacer);
        } else {
          days.appendChild(div);
        }
      }
    }

    /** 終日スロット行の描画 */
    function renderAlldayRow() {
      var wrap = S.els.allday || document.getElementById('kc-allday');
      if (!wrap) return;
      wrap.innerHTML = '';

      var range = weekRange(S.current);

      // 左ガター
      var gutter = document.createElement('div');
      gutter.className = 'kc-gutter';
      wrap.appendChild(gutter);

      // 7日分のセル（背景色・クリック領域・border-left 担当のみ。イベントバーは .kc-ad-events に分離）
      for (var i = 0; i < 7; i++) {
        var d = U.addDays(range.start, i);
        var cell = document.createElement('div');
        cell.className = 'kc-adcell';
        var adDow = d.getDay();
        var adHoliday = U.getHolidayName(d);
        if (adDow === 6) cell.classList.add('kc-adcell--sat');
        if (adDow === 0) cell.classList.add('kc-adcell--sun');
        if (adHoliday) cell.classList.add('kc-adcell--holiday');
        cell.dataset.date = U.fmtYMD(d);
        wrap.appendChild(cell);
      }

      // 右端のスクロールバー幅ダミー列
      var spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      wrap.appendChild(spacer);

      // イベントバー専用絶対配置レイヤ（.kc-ad-events）
      var eventsLayer = document.createElement('div');
      eventsLayer.className = 'kc-ad-events';
      wrap.appendChild(eventsLayer);

      // 行最下部横断トグルバー（必要レーン数 > 3 のときのみ表示、初期は非表示）
      var toggleEl = document.createElement('div');
      toggleEl.className = 'kc-allday-toggle';
      toggleEl.style.display = 'none';
      wrap.appendChild(toggleEl);

      S.els.allday = wrap;
    }

    /** セルグリッド描画 */
    function renderRows() {
      // DOM キャッシュが未設定の場合は再取得する（ビュー切替後の再描画で S.els.rows が未初期化のケースに対応）
      var rows = S.els.rows || document.getElementById('kc-rows');
      if (!rows) return;
      rows.innerHTML = '';
      document.documentElement.style.setProperty('--kc-col-count', 7);
      document.documentElement.style.setProperty('--kc-hours', 24);

      // 各列の曜日・祝日情報を事前に計算
      var range = weekRange(S.current);
      var colInfo = [];
      for (var ci = 0; ci < 7; ci++) {
        var colDate = U.addDays(range.start, ci);
        colInfo.push({
          dow: colDate.getDay(),
          holiday: !!U.getHolidayName(colDate)
        });
      }

      for (var h = 0; h < 24; h++) {
        var row = document.createElement('div');
        row.className = 'kc-row';
        row.dataset.hour = String(h);

        for (var c = 0; c < 7; c++) {
          var cell = document.createElement('div');
          cell.className = 'kc-cell';
          if (colInfo[c].dow === 6) cell.classList.add('kc-cell--sat');
          if (colInfo[c].dow === 0) cell.classList.add('kc-cell--sun');
          if (colInfo[c].holiday) cell.classList.add('kc-cell--holiday');
          // バグ A 修正: DnD の _dayFromEvent が正常動作するよう data-date を付与
          var cellDate = U.addDays(range.start, c);
          cell.dataset.date = U.fmtYMD(cellDate);
          row.appendChild(cell);
        }
        rows.appendChild(row);
      }

      // 描画後に DOM キャッシュを更新する（日ビューと同パターン）
      S.els.rows = rows;
    }

    /** イベント配置 */
    function placeEvents() {
      var alldayWrap = S.els.allday;

      // イベントバーレイヤをクリア
      var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
      var toggleEl    = alldayWrap ? alldayWrap.querySelector('.kc-allday-toggle') : null;
      if (eventsLayer) eventsLayer.innerHTML = '';

      // 通常イベントのオーバーレイをクリア（セル自体は保持）
      // DOM キャッシュが未設定の場合は再取得する（renderRows 未実行時のフォールバック）
      var rows = S.els.rows || document.getElementById('kc-rows');
      if (!rows) return;
      rows.querySelectorAll('.kc-overlay').forEach(function (o) { o.remove(); });

      var range = weekRange(S.current);
      var weekYMD = [];
      for (var wi = 0; wi < 7; wi++) {
        weekYMD.push(U.fmtYMD(U.addDays(range.start, wi)));
      }

      // フィルタ適用（all: 全件, mine: 自分のみ, others: 他人のみ）→ 検索フィルタ
      var filteredEvents = KC.SearchFilter.apply(KC.EventFilter.apply(S.events || []));

      // ===== 終日イベント: Google カレンダー方式（単一絶対配置バー）=====
      var weekEvents = [];
      filteredEvents.forEach(function (evt) {
        if (!evt.allday) return;
        var pos = KC.Lanes.eventToBarPosition(evt, weekYMD);
        if (!pos) return;
        // イベントオブジェクトと位置情報をマージ（元オブジェクトは破壊しない）
        weekEvents.push(Object.assign({}, evt, pos));
      });

      // レーン割り当て（期間降順 → created 昇順 → id 昇順ソート後にレーン計算）
      KC.Lanes.assignLanes(weekEvents);

      // 最大レーン番号を算出（イベントが 0 件のときは -1）
      var maxLane = weekEvents.reduce(function (m, ev) {
        return Math.max(m, ev.lane || 0);
      }, -1);

      // 折りたたみ時の表示レーン数: min(必要レーン数, 3)
      var collapsedLaneCount = KC.RenderShared.calcCollapsedLanes(maxLane);

      // 展開時に隠れるイベント数（トグルラベル "+N" 用）
      var hiddenCount = weekEvents.filter(function (ev) { return ev.lane >= 3; }).length;

      // トグル UI を更新（maxLane < 3 のときは非表示）
      if (toggleEl) KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount);

      // トグルクリックハンドラ（毎回新規バインド: renderAlldayRow で再生成されるため）
      if (toggleEl && maxLane >= 3) {
        toggleEl.onclick = function () {
          S.alldayExpanded = !S.alldayExpanded;
          KC.Render.renderGrid();
        };
      }

      // 各イベントをバーとして .kc-ad-events レイヤに追加
      weekEvents.forEach(function (ev) {
        if (!eventsLayer) return;
        var bar = KC.RenderShared.buildAlldayBar(ev, { colCount: 7 });
        eventsLayer.appendChild(bar);
      });

      // ===== 行高の動的制御（AC 4.10・4.11・4.12 対応）=====
      if (alldayWrap) {
        // 高さ計算定数（CSS 変数と同値）
        var BAR_H    = 20;   /* --kc-ad-bar-h (font-size 14px 対応: 旧 24px) */
        var BAR_GAP  = 3;    /* --kc-ad-bar-gap */
        var BAR_TOP  = 4;    /* --kc-ad-bar-top */
        var BAR_BTM  = 4;    /* 下部パディング */
        var TOGGLE_H = 24;   /* --kc-allday-toggle-h */

        var displayLanes = S.alldayExpanded ? (maxLane + 1) : collapsedLaneCount;
        // 終日イベントが 0 件でも最低 1 レーン分の高さを確保
        if (displayLanes < 1) displayLanes = 1;

        var totalH = BAR_TOP + (BAR_H + BAR_GAP) * displayLanes - BAR_GAP + BAR_BTM + TOGGLE_H;
        alldayWrap.style.height = totalH + 'px';

        // .kc-gutter の高さも同期（grid 行高と合わせるため）
        var gutter = alldayWrap.querySelector('.kc-gutter');
        if (gutter) gutter.style.height = totalH + 'px';

        // .kc-ad-events の overflow を展開/折りたたみで切り替える
        if (eventsLayer) {
          eventsLayer.style.overflow = S.alldayExpanded ? 'visible' : 'hidden';
        }
      }

      // ===== 通常イベント配置（日跨ぎ対応 + カラム分割）=====
      // 2パス方式:
      //   第1パス: 全イベントを走査し、日インデックスごとにセグメント情報を収集
      //   colIdx 計算: 貪欲法でカラム割り当て（境界接触は重なりなし: a.end <= b.start）
      //   第2パス: DOM 生成時に colIdx / maxCols を参照して left / width をインラインで設定
      //
      // REQ_overlap-rendering §6.1（設計案 A: Google カレンダー方式）準拠
      // AC4.4: 1件のみの日はインラインスタイル未設定（CSS の left:6px/right:6px が有効）

      /**
       * セグメント配列（同一日の時間予定）にカラム情報を付与する（貪欲法）
       * 境界値が接するだけ（a.endMin === b.startMin）は重なりに含めない（§5.1）
       * @param {Array} segs - { startMin, endMin, ... } を持つオブジェクトの配列（破壊的変更あり）
       */
      function _calcOverlapLayout(segs) {
        // 開始時刻昇順でソート（同時刻の場合は終了時刻が遅いものを先に）
        segs.sort(function (a, b) {
          return a.startMin !== b.startMin
            ? a.startMin - b.startMin
            : b.endMin - a.endMin;
        });

        // endTimes[colIdx] = そのカラムに最後に配置したセグメントの endMin
        var endTimes = [];

        segs.forEach(function (seg) {
          // 空きカラムを探す: endMin <= startMin なら境界接触のみ = 重なりなし
          var freeCol = -1;
          for (var ci = 0; ci < endTimes.length; ci++) {
            if (endTimes[ci] <= seg.startMin) {
              freeCol = ci;
              break;
            }
          }
          if (freeCol >= 0) {
            seg.colIdx = freeCol;
            endTimes[freeCol] = seg.endMin;
          } else {
            seg.colIdx = endTimes.length;
            endTimes.push(seg.endMin);
          }
        });

        var maxCols = endTimes.length || 1;
        segs.forEach(function (seg) { seg.maxCols = maxCols; });
      }

      // 日インデックスごとのセグメント情報を収集する
      // segments[dayIdx] = [{ evt, hitDayIndices, segStartMin, segEndMin, topPct, heightPct, colIdx, maxCols }]
      var daySegmentsMap = {};
      for (var dsi = 0; dsi < 7; dsi++) { daySegmentsMap[dsi] = []; }

      filteredEvents.forEach(function (evt) {
        if (evt.allday) return;

        var evStart = new Date(evt.start);
        var evEnd   = new Date(evt.end);
        var totalMin = 24 * 60;

        var sTimeStr = U.pad2(evStart.getHours()) + ':' + U.pad2(evStart.getMinutes());
        var eTimeStr = U.pad2(evEnd.getHours())   + ':' + U.pad2(evEnd.getMinutes());
        var sDateStr = (evStart.getMonth() + 1) + '/' + evStart.getDate();
        var eDateStr = (evEnd.getMonth()   + 1) + '/' + evEnd.getDate();
        var sameDay = U.fmtYMD(evStart) === U.fmtYMD(evEnd);
        var fullTimeStr = sameDay
          ? (sDateStr + ' ' + sTimeStr + ' ~ ' + eTimeStr)
          : (sDateStr + ' ' + sTimeStr + ' ~ ' + eDateStr + ' ' + eTimeStr);

        // 表示週内でオーバーラップする日インデックスを収集
        var hitDayIndices = [];
        for (var di = 0; di < 7; di++) {
          var dayYMD  = weekYMD[di];
          var dayStart0 = new Date(dayYMD + 'T00:00:00');
          var dayEnd0   = new Date(dayYMD + 'T00:00:00');
          dayEnd0.setDate(dayEnd0.getDate() + 1);
          if (evStart < dayEnd0 && evEnd > dayStart0) {
            hitDayIndices.push(di);
          }
        }
        if (hitDayIndices.length === 0) return;

        // 各日セグメントをマップに追加
        hitDayIndices.forEach(function (dayIdx) {
          var dayYMD2  = weekYMD[dayIdx];
          var dayStart2 = new Date(dayYMD2 + 'T00:00:00');
          var dayEnd2   = U.addDays(dayStart2, 1);

          var segStartMs = Math.max(evStart.getTime(), dayStart2.getTime());
          var segEndMs   = Math.min(evEnd.getTime(),   dayEnd2.getTime());
          var segStartMin = Math.round((segStartMs - dayStart2.getTime()) / 60000);
          var segEndMin   = Math.round((segEndMs   - dayStart2.getTime()) / 60000);
          if (segEndMin > totalMin) segEndMin = totalMin;
          if (segStartMin < 0) segStartMin = 0;
          if (segEndMin <= segStartMin) return;

          daySegmentsMap[dayIdx].push({
            evt: evt,
            hitDayIndices: hitDayIndices,
            fullTimeStr: fullTimeStr,
            segStartMin: segStartMin,
            segEndMin: segEndMin,
            topPct: (segStartMin / totalMin) * 100,
            heightPct: ((segEndMin - segStartMin) / totalMin) * 100,
            colIdx: 0,    // _calcOverlapLayout で上書き
            maxCols: 1    // _calcOverlapLayout で上書き
          });
        });
      });

      // 各日ごとにカラム分割を計算する
      for (var calcDi = 0; calcDi < 7; calcDi++) {
        var segsForDay = daySegmentsMap[calcDi];
        if (segsForDay.length > 1) {
          _calcOverlapLayout(segsForDay);
        }
        // 1件のみの場合は colIdx=0, maxCols=1 のまま（インラインスタイル未設定でフル幅: AC4.4）
      }

      // イベント別セグメント DOM を収集するマップ（DnD の allBars 渡し用）
      // キー: evt.id, 値: [div, ...]
      var evtSegElsMap = {};

      // 第2パス: DOM を生成して overlay に追加する
      for (var domDi = 0; domDi < 7; domDi++) {
        var domSegs = daySegmentsMap[domDi];
        domSegs.forEach(function (seg) {
          var evt = seg.evt;

          var firstHourRow = rows.children[0];
          if (!firstHourRow) return;
          var colCell = firstHourRow.children[domDi];
          if (!colCell) return;

          var overlay = colCell.querySelector('.kc-overlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'kc-overlay';
            overlay.style.position = 'relative';
            overlay.style.height = 'calc(var(--kc-hours) * var(--kc-hour-height))';
            overlay.style.width = '100%';
            overlay.style.pointerEvents = 'none';
            colCell.appendChild(overlay);
          }

          var evtPerm    = KC.LoginContext.getPermission(evt);
          var evtCanEdit = evtPerm.canEdit;
          var evtBgColor = evtPerm.bgColor || evt.color || null;
          var isMultiDay = seg.hitDayIndices.length > 1;

          var div = document.createElement('div');
          div.className = 'kc-event';
          if (!evtCanEdit) div.style.cursor = 'pointer';
          div.dataset.eventId = evt.id;
          div.style.top    = 'calc(' + seg.topPct + '% + 0px)';
          div.style.height = 'calc(' + seg.heightPct + '% - 2px)';
          div.style.pointerEvents = 'auto';

          // 等分割＋半重ね＋右側余白方式（REQ_overlap-rendering §3.1 FR-1 確定版第6版）
          // colWidth = usableW / (1 + (N-1) * 0.5)   usableW = overlayWidth - GUTTER - RIGHT_MARGIN_PX
          // left     = GUTTER + colIdx * colWidth * 0.5
          // width    = colWidth（全列同幅）
          // right    = 'auto'（CSS の right:6px を上書き）
          // z-index  = 10 + colIdx（後方カラムほど前面: AC4.9）
          // 1件のみ（maxCols===1）はインラインスタイル未設定のため CSS left:6px/right:6px が有効（AC4.4）
          if (seg.maxCols > 1) {
            var OVERLAP_RATIO   = 0.5; // 後発カラムを colWidth の 50% 右にオフセット
            var RIGHT_MARGIN_PX = 24;  // 新規追加用の右側余白
            var GUTTER          = 6;   // CSS left:6px に対応する左余白（px）
            var N               = seg.maxCols;
            var overlayW        = overlay.offsetWidth;
            if (overlayW > 0) {
              // px で計算可能な場合
              var usableW    = overlayW - GUTTER - RIGHT_MARGIN_PX;
              var colWidth   = usableW / (1 + (N - 1) * OVERLAP_RATIO);
              var overlapOff = colWidth * OVERLAP_RATIO;
              div.style.left  = (GUTTER + seg.colIdx * overlapOff) + 'px';
              div.style.width = colWidth + 'px';
            } else {
              // overlayWidth が 0 の場合: パーセント近似（RIGHT_MARGIN_PX=24 ≈ 12% / GUTTER=6 ≈ 3%）
              var RIGHT_MARGIN_PCT = 12;
              var GUTTER_PCT       = 3;
              var usableW_pct      = 100 - GUTTER_PCT - RIGHT_MARGIN_PCT; // 85%
              var colWidth_pct     = usableW_pct / (1 + (N - 1) * OVERLAP_RATIO);
              var overlapOff_pct   = colWidth_pct * OVERLAP_RATIO;
              div.style.left  = (GUTTER_PCT + seg.colIdx * overlapOff_pct) + '%';
              div.style.width = colWidth_pct + '%';
            }
            div.style.right   = 'auto';
            div.style.zIndex  = String(10 + seg.colIdx);
          }

          // 日跨ぎセグメントのクラス付与（AC4.25）
          if (isMultiDay) {
            var hitDays = seg.hitDayIndices;
            var isFirst = domDi === hitDays[0];
            var isLast  = domDi === hitDays[hitDays.length - 1];
            if (isFirst && !isLast)        div.classList.add('kc-event--span-start');
            else if (isLast && !isFirst)   div.classList.add('kc-event--span-end');
            else if (!isFirst && !isLast)  div.classList.add('kc-event--span-middle');
          }

          if (evtBgColor) {
            div.style.backgroundColor = evtBgColor;
            div.style.borderColor     = evtBgColor;
            div.style.color = evtPerm.textColor || (KC.Lanes.isLightColor(evtBgColor) ? '#1f2937' : '#ffffff');
          }

          var titleDiv = document.createElement('div');
          titleDiv.className = 'kc-evt-title';
          titleDiv.textContent = evt.title || '(無題)';

          var metaDiv = document.createElement('div');
          metaDiv.className = 'kc-evt-meta';
          metaDiv.textContent = seg.fullTimeStr;
          if (evtBgColor) {
            var metaTc = evtPerm.textColor
              ? (evtPerm.textColor === '#ffffff' ? 'rgba(255,255,255,0.8)' : '#6b7280')
              : (KC.Lanes.isLightColor(evtBgColor) ? '#6b7280' : 'rgba(255,255,255,0.8)');
            metaDiv.style.color = metaTc;
          }

          // リサイズハンドルは開始セグメント（hitDayIndices[0] の日）のみ追加
          // 翌日セグメントにハンドルを付与すると見た目は出るが mousedown 未配線となるため省略
          var isStartSeg = (domDi === seg.hitDayIndices[0]);
          if (isStartSeg) {
            var topHandle = document.createElement('div');
            topHandle.className = 'kc-resize-handle kc-resize-handle--top';
            var btmHandle = document.createElement('div');
            btmHandle.className = 'kc-resize-handle kc-resize-handle--bottom';
            div.appendChild(topHandle);
          }

          div.appendChild(titleDiv);
          div.appendChild(metaDiv);

          if (isStartSeg) {
            div.appendChild(btmHandle);
          }

          div.title = (evt.title || '') + '\n' + seg.fullTimeStr;

          // クリック → 新規タブで kintone レコード詳細（AC4.6）
          div.addEventListener('click', (function (capturedEvt) {
            return function (clickEvt) {
              clickEvt.stopPropagation();
              KC.Popup.openEdit(capturedEvt.id);
            };
          }(evt)));

          // イベント別セグメント DOM を収集（DnD の allBars 渡し用）
          if (!evtSegElsMap[evt.id]) { evtSegElsMap[evt.id] = []; }
          evtSegElsMap[evt.id].push(div);

          overlay.appendChild(div);
        });
      }

      // mousedown DnD 配線（開始日セグメントのみ受け付ける）
      // allBars に全セグメントを渡して薄表示を全体に適用する
      Object.keys(evtSegElsMap).forEach(function (evtId) {
        var allSegs = evtSegElsMap[evtId];
        if (!allSegs || allSegs.length === 0) return;
        var startEl = allSegs[0];

        // evt オブジェクトは filteredEvents から id 一致で取得する
        var foundEvt = null;
        filteredEvents.forEach(function (e) { if (String(e.id) === String(evtId)) { foundEvt = e; } });
        if (!foundEvt) return;

        (function (capEvt, startDiv, allDivs) {
          startDiv.addEventListener('mousedown', function (mdEvt) {
            if (mdEvt.button !== 0) return;
            if (!KC.LoginContext.getPermission(capEvt).canEdit) return;
            KC.DnD.startMove(capEvt, mdEvt, startDiv, allDivs);
          });

          var tHandle = startDiv.querySelector('.kc-resize-handle--top');
          var bHandle = startDiv.querySelector('.kc-resize-handle--bottom');
          if (tHandle) {
            tHandle.addEventListener('mousedown', function (mdEvt) {
              if (mdEvt.button !== 0) return;
              if (!KC.LoginContext.getPermission(capEvt).canEdit) return;
              mdEvt.stopPropagation();
              KC.DnD.startResize(capEvt, 'top', mdEvt, startDiv);
            });
          }
          if (bHandle) {
            bHandle.addEventListener('mousedown', function (mdEvt) {
              if (mdEvt.button !== 0) return;
              if (!KC.LoginContext.getPermission(capEvt).canEdit) return;
              mdEvt.stopPropagation();
              KC.DnD.startResize(capEvt, 'bottom', mdEvt, startDiv);
            });
          }
        }(foundEvt, startEl, allSegs));
      });
    }

    /** グリッド描画（ヘッダー + 終日 + 行 + イベント配置） */
    function renderGrid() {
      renderDayHeaders();
      renderAlldayRow();
      renderRows();
      placeEvents();
    }

    /** 表示期間を返す */
    function gridRange() {
      return weekRange(S.current);
    }

    /** 完全リフレッシュ（描画 + データ取得） */
    async function refresh() {
      KC.RenderShared.renderTimeGutter();
      // KC.Render.renderGrid 経由で呼ぶことで KC.TimeSlots のパッチを通過させる
      KC.Render.renderGrid();

      // データ取得
      var range = gridRange();
      var toISO = function (d) {
        var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        return new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString();
      };
      var isoStart = toISO(range.start);
      var isoEnd   = toISO(U.addDays(range.end, 1));

      try {
        KC.Banner.hide();
        S.events = await KC.Api.loadEvents(isoStart, isoEnd);
        // P-9: events 更新後は SearchFilter のクエリキャッシュを無効化して次回の _computeMatchList で再スキャンさせる
        KC.SearchFilter._lastQuery = null;
        KC.Render.renderGrid();
        KC.Render.refreshTitle();
      } catch (err) {
        console.error('[KC] loadEvents error:', err);
        var msg;
        if (err && err._isRateLimited) {
          msg = 'アクセスが集中しています。しばらく待ってから再読み込みしてください。';
        } else if (err && err.code === 'GAIA_TM12') {
          msg = 'カーソルの上限に達しました。しばらく待ってから再読み込みしてください。';
        } else {
          msg = 'データの読み込みに失敗しました。再読み込みしてください。';
        }
        KC.Banner.show(msg);
      }
    }

    return {
      refresh: refresh,
      renderGrid: renderGrid,
      gridRange: gridRange,
      placeEvents: placeEvents
    };
  })();

  /* ====================================================================
   * KC.RenderMonth — 月ビュー実装（Phase 1B-1: 骨格のみ）
   * REQ_month-view §6.3 準拠
   * ==================================================================== */
  KC.RenderMonth = (function () {
    var U = KC.Utils;
    var S = KC.State;

    // 月ビュー DOM ルート要素（_ensureMonthDOM で生成・キャッシュ）
    var _monthRoot = null;


    /**
     * 月ビューの表示範囲（42日分 = 6行 × 7列）を算出する
     * 月初日が含まれる週の日曜から始め、常に 42 マスを確保する
     * @param {Date} date - 表示基準月の任意の日
     * @returns {{ start: Date, end: Date }}
     */
    function monthRange(date) {
      var y = date.getFullYear();
      var m = date.getMonth();
      var monthFirst = new Date(y, m, 1);
      // 月初の曜日分遡って当週の日曜へ
      var rangeStart = new Date(monthFirst);
      rangeStart.setDate(monthFirst.getDate() - monthFirst.getDay());
      rangeStart.setHours(0, 0, 0, 0);
      // 必要週数: ceil((月初曜日オフセット + 月の日数) / 7)（4〜6）
      var offset     = monthFirst.getDay();
      var daysInMonth = new Date(y, m + 1, 0).getDate();
      var weekCount  = Math.ceil((offset + daysInMonth) / 7);
      // weekCount × 7日 - 1 日後が末端
      var rangeEnd = U.addDays(rangeStart, weekCount * 7 - 1);
      return { start: rangeStart, end: rangeEnd, weekCount: weekCount };
    }

    /**
     * 月ビュー DOM (.kc-month-root) を生成する（初回のみ）
     * .kc-grid-wrap と並行して .kc-root 直下に配置する
     */
    function _ensureMonthDOM() {
      // _monthRoot が存在しても、ライブ DOM から切り離されている場合は再生成する。
      // parentNode が非 null でも #kc-root が再生成された場合に detached になりうる。
      if (_monthRoot && document.contains(_monthRoot)) return;

      var root = document.getElementById('kc-root');
      if (!root) return;

      // .kc-month-root 生成
      var monthRootEl = document.createElement('div');
      monthRootEl.className = 'kc-month-root';
      monthRootEl.id = 'kc-month-root';

      // 曜日ヘッダー (.kc-month-days)
      var daysEl = document.createElement('div');
      daysEl.className = 'kc-month-days';
      monthRootEl.appendChild(daysEl);

      // グリッド本体 (.kc-month-grid)
      var gridEl = document.createElement('div');
      gridEl.className = 'kc-month-grid';
      monthRootEl.appendChild(gridEl);

      // .kc-grid-wrap の後に挿入
      var gridWrap = root.querySelector('.kc-grid-wrap');
      if (gridWrap && gridWrap.nextSibling) {
        root.insertBefore(monthRootEl, gridWrap.nextSibling);
      } else {
        root.appendChild(monthRootEl);
      }

      _monthRoot = monthRootEl;
    }

    /**
     * 曜日ヘッダー 7列（日〜土）を描画する
     */
    function renderMonthDayHeaders() {
      if (!_monthRoot) return;
      var daysEl = _monthRoot.querySelector('.kc-month-days');
      if (!daysEl) return;

      daysEl.innerHTML = '';
      var labels = ['日', '月', '火', '水', '木', '金', '土'];
      labels.forEach(function (label, idx) {
        var cell = document.createElement('div');
        cell.className = 'kc-month-dayhead';
        if (idx === 0) cell.classList.add('kc-month-dayhead--sun');
        if (idx === 6) cell.classList.add('kc-month-dayhead--sat');
        cell.textContent = label;
        daysEl.appendChild(cell);
      });
    }

    /**
     * N週 × 7セルのグリッドを描画する（N = 4〜6、月によって動的に決定）
     * 各セルに data-date, 当月外フラグ, 当日フラグを付与
     */
    function renderMonthGrid() {
      if (!_monthRoot) return;
      var gridEl = _monthRoot.querySelector('.kc-month-grid');
      if (!gridEl) return;

      gridEl.innerHTML = '';

      var range = monthRange(S.current);
      var weekCount = range.weekCount;
      var currentMonth = S.current.getMonth();
      var todayYMD = U.fmtYMD(new Date());

      // 週数分のループ（4〜6 週）
      for (var week = 0; week < weekCount; week++) {
        _buildWeekRow(gridEl, range, week, currentMonth, todayYMD);
      }

      // CSS の repeat(6,...) を週数に合わせてインラインスタイルで上書きする。
      // 通常モード・全画面モード（.kc-expanded）ともにインラインスタイルが CSS を上書きするため
      // grid-template-rows を一括設定する。
      var rowsDef = 'repeat(' + weekCount + ', minmax(0, 1fr))';
      gridEl.style.gridTemplateRows = rowsDef;
      // min-height も週数に追従させて各セルが 90px を下回らないよう保証する
      gridEl.style.minHeight = 'calc(' + weekCount + ' * var(--kc-month-cell-min-h, 90px))';
    }

    /**
     * 週行（7セル + .kc-month-ad-events）を構築してグリッドに追加する
     * @param {HTMLElement} gridEl - .kc-month-grid 要素
     * @param {{ start: Date, end: Date }} range - 月表示範囲
     * @param {number} week - 週インデックス（0〜5）
     * @param {number} currentMonth - 表示月（0〜11）
     * @param {string} todayYMD - 今日の YYYY-MM-DD
     */
    function _buildWeekRow(gridEl, range, week, currentMonth, todayYMD) {
      // 週行ラッパー（display: grid で 7列 + position: relative で絶対配置の基準）
      var weekEl = document.createElement('div');
      weekEl.className = 'kc-month-week';
      weekEl.dataset.week = String(week);

      // 7日分のセル
      for (var day = 0; day < 7; day++) {
        var cellDate = U.addDays(range.start, week * 7 + day);
        var ymd = U.fmtYMD(cellDate);
        var isOtherMonth = cellDate.getMonth() !== currentMonth;
        var isToday = (ymd === todayYMD);

        var cell = document.createElement('div');
        cell.className = 'kc-month-cell';
        cell.dataset.date = ymd;
        if (isOtherMonth) cell.classList.add('kc-month-cell--other-month');
        if (isToday) cell.classList.add('kc-month-cell--today');

        // 土日祝クラス付与
        var dow = cellDate.getDay();
        if (dow === 0) cell.classList.add('kc-month-cell--sun');
        if (dow === 6) cell.classList.add('kc-month-cell--sat');
        var holidayName = U.getHolidayName(cellDate);
        if (holidayName) cell.classList.add('kc-month-cell--holiday');

        // 日付数字 + 祝日名を 1 行（インライン）で並べるラッパー
        // .kc-month-dateline は flex コンテナで、日付数字（青丸スタイル維持）の右隣に
        // 祝日名を ellipsis で詰める。祝日がない日は dateline の中に datehead のみ。
        var dateline = document.createElement('div');
        dateline.className = 'kc-month-dateline';

        // 日付数字（.kc-month-cell--today の青丸スタイルを維持するため className は変更しない）
        var datehead = document.createElement('div');
        datehead.className = 'kc-month-datehead';
        datehead.textContent = String(cellDate.getDate());
        dateline.appendChild(datehead);

        // 祝日名表示（祝日のみ。textContent で XSS 安全。inline の span として並べる）
        if (holidayName) {
          var holidayLabel = document.createElement('span');
          holidayLabel.className = 'kc-month-holiday-name';
          holidayLabel.textContent = holidayName;
          dateline.appendChild(holidayLabel);
        }

        cell.appendChild(dateline);

        // dayGrid Phase1: セル内セグメント配置レイヤ
        // .kc-month-seg-layer は dateline の直後に配置される絶対配置レイヤ。
        // セル幅いっぱいに広がり、セグメント要素を top: lane*(BAR_H+BAR_GAP) で絶対配置する。
        // chip/more は引き続き in-flow（flex 子）として dateline の下に積まれるが、
        // spacer の代わりに seg-layer の height（= usedSlots * PITCH）が確保した空間の上に
        // chip が来るよう、seg-layer は flex-shrink: 0 / height を JS でセット。
        var segLayer = document.createElement('div');
        segLayer.className = 'kc-month-seg-layer';
        cell.appendChild(segLayer);

        // セルクリック → 新規作成（Phase 1B-1: クリックハンドラ配線）
        cell.addEventListener('click', (function (capturedYMD) {
          return function (e) {
            KC.Popup.openCreate({ date: capturedYMD, allday: true });
          };
        }(ymd)));

        weekEl.appendChild(cell);
      }

      // 終日バー専用絶対配置レイヤ（週行全幅。DnD ゴーストの配置基準として残す。
      // Phase1 ではセグメント描画には使わず DOM 構造だけ維持する）
      var adEvents = document.createElement('div');
      adEvents.className = 'kc-month-ad-events';
      weekEl.appendChild(adEvents);

      gridEl.appendChild(weekEl);
    }

    /**
     * グリッド全体を再描画する（曜日ヘッダー → セルグリッド）
     */
    function renderGrid() {
      renderMonthDayHeaders();
      renderMonthGrid();
    }

    /**
     * 月ビュー DOM の表示状態を保証する（CSS 初期値 none への安全弁）
     * setActiveView('month') が .kc-grid-wrap の非表示と #kc-month-root の表示を担うため、
     * ここでは _monthRoot の flex 明示のみ行う。
     */
    function _showMonthDOM() {
      // setActiveView('month') が .kc-grid-wrap の非表示と #kc-month-root の表示を担う。
      // ここでは _monthRoot の flex 明示のみ行う（CSS 初期値 none への安全弁として残す）。
      if (_monthRoot) _monthRoot.style.display = 'flex';
    }

    /**
     * 月ビューの表示期間を返す
     * @returns {{ start: Date, end: Date }}
     */
    function gridRange() {
      return monthRange(S.current);
    }

    // バー高さ定数（週ビューの buildAlldayBar と同値）
    var BAR_H   = 20;  /* --kc-ad-bar-h (font-size 14px 対応: 旧 24px) */
    var BAR_GAP = 3;   /* --kc-ad-bar-gap */
    // BAR_TOP: .kc-month-ad-events の top が CSS で --kc-month-dateline-h (28px) に設定されたため
    // adLayer 自体が dateline の下から始まる。バー個別の top オフセットは 0 で OK。
    var BAR_TOP = 0;   /* adLayer top = --kc-month-dateline-h (CSS) で日付行を回避済み */
    // 横方向の隙間定数（隣接バーの境目を視覚的に分離するため width を右側に詰める）
    var BAR_X_GAP = 3; /* px。left は据え置き、width を calc(xx% - BAR_X_GAP px) に設定 */

    /** セル内の表示件数上限（フォールバック用） */
    var MAX_CELL_ITEMS = 5;

    /**
     * セル実高から表示可能な最大イベント件数を動的計算する（ダミー要素実測版・統一ピッチ方式）
     * DOM が未構築の場合は MAX_CELL_ITEMS をフォールバックとして返す
     *
     * 設計: chip・adbar・span バーの縦ピッチを BAR_H + BAR_GAP = 23px に統一する
     *   - adLayer バー（終日/span）: lane * (BAR_H + BAR_GAP) でピッチ 23px
     *   - chip（.kc-month-chip）: CSS height = BAR_H(20px), margin-top = BAR_GAP(3px) → ピッチ 23px
     *   - spacer: usedSlots * BAR_H + (usedSlots-1) * BAR_GAP = usedSlots * 23 - 3
     *     （= adLayer 最下バーの底端高さと一致）
     *   ⇒ 全スロットが同一ピッチなので available / PITCH が正確な収容本数になる
     *
     * PITCH 実測方式:
     *   placeMonthEvents 冒頭で chip/more を全削除するため DOM 上に計測対象が存在しない。
     *   ダミー chip を 2 本 in-flow（visibility:hidden）で挿入し、getBoundingClientRect の
     *   top 差分でピッチを実測する。CSS の height・margin-top 変更に自動追従する。
     *
     *   dateHeadH: .kc-month-dateline は削除されないため常に実測可能。
     *   moreH: ダミー .kc-month-more を 1 本 in-flow 挿入して実測。
     *
     * @returns {number} 最低 0、最大 10
     */
    function _calcMaxItems() {
      // _monthRoot スコープで検索（document-wide 検索は切り離されたツリーの要素を拾うリスクあり）
      var firstCell = _monthRoot ? _monthRoot.querySelector('.kc-month-cell') : null;
      if (!firstCell) return MAX_CELL_ITEMS;
      var cellH = firstCell.getBoundingClientRect().height;
      if (!cellH || cellH <= 0) return MAX_CELL_ITEMS;

      // --- dateHeadH: 日付行（dateline）の実占有高 ---
      // dateline は placeMonthEvents で削除されないため常に DOM 上に存在する
      var dateHeadH = 28;  // フォールバック（dateline min-height 24px + padding-bottom 4px）
      var dateline = firstCell.querySelector('.kc-month-dateline');
      if (dateline) {
        var dlH = dateline.getBoundingClientRect().height;
        if (dlH > 0) dateHeadH = dlH;
      }

      // --- padding: セル自体の上下 padding ---
      var padding = 4;  // CSS: padding: 2px → 上下計 4px

      // --- PITCH: chip・adbar 共通レーンピッチを 2 枚 in-flow ダミーの top 差分で実測 ---
      // chip は placeMonthEvents 冒頭で削除済み → ダミー 2 枚を in-flow（visibility:hidden）で挿入
      // top 差分 = height + margin-top = 実際の 1 レーン占有高（BAR_H + BAR_GAP）に一致
      var PITCH = BAR_H + BAR_GAP;  // フォールバック（20 + 3 = 23px）
      var dummy1 = document.createElement('div');
      var dummy2 = document.createElement('div');
      dummy1.className = 'kc-month-chip';
      dummy2.className = 'kc-month-chip';
      dummy1.style.cssText = 'visibility:hidden;';
      dummy2.style.cssText = 'visibility:hidden;';
      firstCell.appendChild(dummy1);
      firstCell.appendChild(dummy2);
      try {
        var t1 = dummy1.getBoundingClientRect().top;
        var t2 = dummy2.getBoundingClientRect().top;
        var diff = t2 - t1;
        if (diff > 0) PITCH = diff;
      } finally {
        firstCell.removeChild(dummy1);
        firstCell.removeChild(dummy2);
      }

      // --- moreH: ダミー .kc-month-more の実占有高（実高 + margin-top）---
      // more も placeMonthEvents 冒頭で削除済み → ダミーを in-flow で挿入して実測
      var moreH = 20;  // フォールバック
      var dummyMore = document.createElement('div');
      dummyMore.className = 'kc-month-more';
      dummyMore.style.cssText = 'visibility:hidden;';
      dummyMore.textContent = '+1 more';
      firstCell.appendChild(dummyMore);
      try {
        // more の占有高 = セル内での「前の要素 bottom」から「more bottom」までの距離
        // ここでは margin-top 込みの実占有分として (mH + margin) を計算する
        var mH = dummyMore.getBoundingClientRect().height;
        if (mH > 0) {
          var moreMarginTop = 1;  // フォールバック（.kc-month-more: margin-top: 1px）
          var mcs = window.getComputedStyle(dummyMore);
          var mmTop = parseFloat(mcs.marginTop);
          if (!isNaN(mmTop)) moreMarginTop = mmTop;
          moreH = mH + moreMarginTop;
        }
      } finally {
        firstCell.removeChild(dummyMore);
      }

      // moreH は baseCapacity 計算には使わない（overflow 非確定の段階で more スロットを先取りしない）。
      // overflow ありセルでのみ more 用 1 スロットが確保される（placeMonthEvents のセルループで制御）。
      var available = cellH - dateHeadH - padding;
      // available <= 0 のときは chip を 1 本も置けない（more 行だけ確保する）ため 0 を返す。
      // 呼び出し元で hiddenCount > 0 なら more が追加され、more 単体（dateline + more ≈ 48px）は
      // min-height(90px) 未満の極小セルでも収まる。
      if (available <= 0) {
        _log('[KC.maxitems] cellH=' + cellH + ' dateHeadH=' + dateHeadH + ' padding=' + padding +
             ' moreH=' + moreH.toFixed(1) + ' PITCH=' + PITCH.toFixed(1) +
             ' available=' + available.toFixed(1) + ' → baseCapacity=0 (available<=0)');
        return 0;
      }
      var max = Math.floor(available / PITCH);
      var result = Math.min(max, 10);
      _log('[KC.maxitems] cellH=' + cellH.toFixed(1) + ' dateHeadH=' + dateHeadH.toFixed(1) +
           ' padding=' + padding + ' moreH=' + moreH.toFixed(1) +
           ' PITCH=' + PITCH.toFixed(1) + ' available=' + available.toFixed(1) +
           ' floor=' + max + ' → baseCapacity=' + result);
      return result;
    }

    /**
     * .kc-ad-event 要素を月ビュー用に生成する（DnD 対応版）
     * @param {Object} ev - 位置情報付き KcEvent（colStart, span, lane, adDateRange を含む）
     * @returns {HTMLElement}
     */
    function buildMonthAlldayBar(ev) {
      var perm    = KC.LoginContext.getPermission(ev);
      var canEdit = perm.canEdit;
      var el = document.createElement('div');
      // kc-ad-event--month: 月ビュー専用デザイン（左線ストライプ型）を適用
      el.className = 'kc-ad-event kc-ad-event--month';
      // 編集権限なし（DnD 不可）はポインターカーソルに変更（クリックでダイアログは全員開ける）
      if (!canEdit) el.style.cursor = 'pointer';
      el.dataset.eventId = ev.id;  // SearchFilter プルダウン逆引き用

      // 絶対配置の位置計算
      el.style.left   = ((ev.colStart / 7) * 100) + '%';
      // 右端に BAR_X_GAP px の余白を設けて隣接バーの境目を視覚的に分離
      el.style.width  = 'calc(' + ((ev.span / 7) * 100) + '% - ' + BAR_X_GAP + 'px)';
      el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';
      el.style.pointerEvents = 'auto';

      // 月ビュー終日バーは全面塗り型（Google カレンダー風）:
      //   - bgColor を background に適用（フォールバック込みで必ず色を確定）
      //   - 左線ストライプ廃止、isLightColor で文字色を自動判定
      var displayBgColor = perm.bgColor || ev.color || '#818cf8';
      el.style.background = displayBgColor;
      el.style.borderLeft = 'none';  // 左線ストライプ廃止
      el.style.color = perm.textColor || (KC.Lanes.isLightColor(displayBgColor) ? '#1f2937' : '#ffffff');

      el.title = (ev.title || '(無題)') + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      // dot は CSS で非表示（.kc-ad-event--month .dot { display: none }）にするが
      // DOM 構造は後方互換のため残す
      var dot = document.createElement('span');
      dot.className = 'dot';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-ad-evt-title';
      titleSpan.textContent = ev.title || '(無題)';

      el.appendChild(dot);
      el.appendChild(titleSpan);

      // 左端リサイズハンドル（§3.4）
      var leftHandle = document.createElement('div');
      leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
      leftHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAlldayMonth(ev, 'left', mdEvt, el);
      });

      // 右端リサイズハンドル（§3.4）
      var rightHandle = document.createElement('div');
      rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
      rightHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAlldayMonth(ev, 'right', mdEvt, el);
      });

      el.appendChild(leftHandle);
      el.appendChild(rightHandle);

      el.addEventListener('click', function (clickEvt) {
        clickEvt.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      // mousedown → 月ビュー終日移動 DnD 開始（§3.3）
      // stopPropagation でセル側の click ハンドラ（新規作成ポップアップ）への伝播を防ぐ
      el.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        if (!KC.LoginContext.getPermission(ev).canEdit) return;
        mdEvt.stopPropagation();
        KC.DnD.startMoveAlldayMonth(ev, mdEvt, el);
      });

      return el;
    }

    /**
     * 月ビュー終日バーのセグメント要素（dayGrid Phase1e）を生成する
     * .kc-month-ad-events（週行全幅オーバーレイ）に配置される絶対配置要素。
     * left = colIndex/7 * 100%, width = 100%/7 で週行基準の座標を使用し、
     * セルの border-left より高い z-index（.kc-month-ad-events の z-index で制御）で描画する。
     * これにより複数日バーがセルの縦罫線を上から覆い、1本に連続して見える。
     *
     * @param {Object} ev              - 位置情報付き KcEvent（lane, adDateRange を含む）
     * @param {boolean} isStart        - このセグメントがイベント開始日（または週先頭）か
     * @param {boolean} isEnd          - このセグメントがイベント終了日（または週末尾）か
     * @param {boolean} [isDndEnabled=false] - DnD ハンドラを付ける（フェーズ2用、Phase1 では false）
     * @param {boolean} [isVisibleStart=false] - 可視セグメントの先頭か（+more 非表示後の先頭）
     * @param {number}  [visibleCells=1]       - この可視先頭から末尾まで連続して可視なセル数
     * @param {number}  [colIndex=0]           - セルの列インデックス（0〜6）。週行基準の left 計算に使用
     * @returns {HTMLElement}
     */
    function buildMonthAlldaySegment(ev, isStart, isEnd, isDndEnabled, isVisibleStart, visibleCells, colIndex) {
      var perm    = KC.LoginContext.getPermission(ev);
      var canEdit = perm.canEdit;
      var el = document.createElement('div');
      // kc-ad-event--month: 月ビュー専用デザイン（全面塗り型）を適用
      el.className = 'kc-ad-event kc-ad-event--month kc-ad-event--seg';
      if (!canEdit) el.style.cursor = 'pointer';
      el.dataset.eventId = ev.id;

      // dayGrid Phase1e: 週行オーバーレイ（.kc-month-ad-events）内に週行基準座標で絶対配置
      // left  = colIndex / 7 * 100%（週行の左端から何列目か）
      // width = 1/7 * 100% だが右端セグメント（isEnd）には BAR_X_GAP の隙間を付ける
      // この方式により、セルの border-left（罫線）より高い z-index の adEvents 層に描かれ
      // バーが罫線を上書きして連続して見える。
      var ci = colIndex || 0;
      el.style.position = 'absolute';
      el.style.left   = (ci / 7 * 100) + '%';
      el.style.width  = isEnd ? ('calc(100% / 7 - ' + BAR_X_GAP + 'px)') : 'calc(100% / 7)';
      el.style.top    = (ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';
      el.style.pointerEvents = 'auto';
      // タイトルが可視幅いっぱいに伸びるために overflow: visible にする
      // （タイトル span は position:absolute で後述の幅制限を使う）
      el.style.overflow = 'visible';

      // 角丸制御: Google カレンダー方式
      //   isStart && isEnd → 両端角丸（単セル）
      //   isStart のみ    → 左端のみ角丸（バー先頭）
      //   isEnd のみ      → 右端のみ角丸（バー末尾）
      //   どちらでもない   → 角丸なし（中間セル: 連結して見える）
      var rl = isStart ? '4px' : '0';
      var rr = isEnd   ? '4px' : '0';
      el.style.borderRadius = rl + ' ' + rr + ' ' + rr + ' ' + rl;

      // 色設定（buildMonthAlldayBar と同一ロジック）
      var displayBgColor = perm.bgColor || ev.color || '#818cf8';
      el.style.background = displayBgColor;
      el.style.borderLeft = 'none';
      el.style.color = perm.textColor || (KC.Lanes.isLightColor(displayBgColor) ? '#1f2937' : '#ffffff');

      el.title = (ev.title || '(無題)') + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      // テキスト: 可視先頭セグメント（isVisibleStart）のみタイトルを表示
      // タイトルは position:absolute で可視区間幅いっぱいに伸ばし、末尾を ellipsis でクリップする
      //
      // 幅の計算:
      //   可視先頭 seg-layer の left=0 を基準に、visibleCells 個分のセル幅を確保する。
      //   1セル = seg-layer 幅 100% なので、visibleCells セル = visibleCells * 100%。
      //   ただし末尾セルの BAR_X_GAP(3px) と padding(6px*2) を差し引く。
      //   タイトル span 自体は position:absolute なのでセグメントの overflow:visible から
      //   はみ出すが、幅が可視区間内に収まるため別バー・別予定の上には被さらない。
      if (isVisibleStart) {
        var vc = visibleCells || 1;
        var dot = document.createElement('span');
        dot.className = 'dot';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'kc-ad-evt-title kc-seg-title';
        titleSpan.textContent = ev.title || '(無題)';
        // 可視区間幅いっぱいのタイトル領域を確保する
        // position: absolute で left=0 から可視区間末端まで伸ばし、overflow:hidden でクリップ。
        //
        // 100% の基準 = セグメント幅（position:absolute の包含ブロック）
        //   - vc=1 (単セル): セグメント幅 = calc(セル幅 - BAR_X_GAP) なので 100%=セル幅-3px
        //     タイトル幅 = 100% - padding12px = calc(100% - 12px)
        //   - vc>1 (複数セル先頭): セグメント幅 = セル幅（width:100%）なので 100%=セル幅
        //     タイトル幅 = vc*セル幅 - BAR_X_GAP - padding12px = calc(vc*100% - 3px - 12px)
        titleSpan.style.position = 'absolute';
        titleSpan.style.left = '0';
        titleSpan.style.top = '0';
        titleSpan.style.height = '100%';
        titleSpan.style.width = vc > 1
          ? ('calc(' + vc + ' * 100% - ' + BAR_X_GAP + 'px - 12px)')
          : 'calc(100% - 12px)';  // 単セル: セグメント自体が BAR_X_GAP 分短いので引かない
        titleSpan.style.display = 'flex';
        titleSpan.style.alignItems = 'center';
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.whiteSpace = 'nowrap';
        titleSpan.style.textOverflow = 'ellipsis';
        titleSpan.style.paddingLeft = '6px';
        titleSpan.style.paddingRight = '6px';
        titleSpan.style.boxSizing = 'border-box';

        el.appendChild(dot);
        el.appendChild(titleSpan);
      }

      // クリック → ダイアログ（全セグメントに付ける）
      el.addEventListener('click', function (clickEvt) {
        clickEvt.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      // フェーズ1: DnD は最小対応（isDndEnabled=false のときはハンドルを非表示に保つ）
      // mousedown は一応付けるが、barEl が seg-layer 内の 1 要素のみを指すため
      // DnD は全セグメントにわたって正常動作しない。フェーズ2 で全面再配線予定。
      if (isDndEnabled && canEdit) {
        // 左端リサイズハンドル（開始セグメントにのみ有意）
        if (isStart) {
          var leftHandle = document.createElement('div');
          leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
          leftHandle.addEventListener('mousedown', function (mdEvt) {
            if (mdEvt.button !== 0) return;
            mdEvt.stopPropagation();
            KC.DnD.startResizeAlldayMonth(ev, 'left', mdEvt, el);
          });
          el.appendChild(leftHandle);
        }
        // 右端リサイズハンドル（終了セグメントにのみ有意）
        if (isEnd) {
          var rightHandle = document.createElement('div');
          rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
          rightHandle.addEventListener('mousedown', function (mdEvt) {
            if (mdEvt.button !== 0) return;
            mdEvt.stopPropagation();
            KC.DnD.startResizeAlldayMonth(ev, 'right', mdEvt, el);
          });
          el.appendChild(rightHandle);
        }
        el.addEventListener('mousedown', function (mdEvt) {
          if (mdEvt.button !== 0) return;
          mdEvt.stopPropagation();
          KC.DnD.startMoveAlldayMonth(ev, mdEvt, el);
        });
      } else {
        // フェーズ1: mousedown の伝播を止めてセル click（新規作成）を誤爆させない
        el.addEventListener('mousedown', function (mdEvt) {
          if (mdEvt.button !== 0) return;
          mdEvt.stopPropagation();
          // DnD は無効（フェーズ2 で再配線）
        });
      }

      return el;
    }

    /**
     * 月ビュー日跨ぎ時間予定バーのセグメント要素（dayGrid Phase1e）を生成する
     * buildMonthAlldaySegment と同様の週行オーバーレイ方式。時計アイコン・時刻表示が追加される。
     *
     * @param {Object} ev              - 位置情報付き KcEvent（lane, adDateRange を含む）
     * @param {boolean} isStart        - このセグメントがイベント開始日（または週先頭）か
     * @param {boolean} isEnd          - このセグメントがイベント終了日（または週末尾）か
     * @param {boolean} [isVisibleStart=false] - 可視セグメントの先頭か
     * @param {number}  [visibleCells=1]       - 可視先頭から末尾まで連続して可視なセル数
     * @param {number}  [colIndex=0]           - セルの列インデックス（0〜6）
     * @returns {HTMLElement}
     */
    function buildMonthTimedSpanSegment(ev, isStart, isEnd, isVisibleStart, visibleCells, colIndex) {
      var perm    = KC.LoginContext.getPermission(ev);
      var canEdit = perm.canEdit;
      var bgColor = perm.bgColor || ev.color || null;
      var el = document.createElement('div');
      el.className = 'kc-month-chip--span kc-ad-event--seg';
      if (!canEdit) el.style.cursor = 'pointer';
      el.dataset.evId    = ev.id;
      el.dataset.eventId = ev.id;

      // dayGrid Phase1e: 週行オーバーレイ（.kc-month-ad-events）内に週行基準座標で絶対配置
      var ci = colIndex || 0;
      el.style.position = 'absolute';
      el.style.left   = (ci / 7 * 100) + '%';
      el.style.width  = isEnd ? ('calc(100% / 7 - ' + BAR_X_GAP + 'px)') : 'calc(100% / 7)';
      el.style.top    = (ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';
      el.style.pointerEvents = 'auto';
      // タイトルが可視幅いっぱいに伸びるために overflow: visible にする
      el.style.overflow = 'visible';

      // 角丸制御（buildMonthAlldaySegment と同一ロジック）
      var rl = isStart ? '4px' : '0';
      var rr = isEnd   ? '4px' : '0';
      el.style.borderRadius = rl + ' ' + rr + ' ' + rr + ' ' + rl;

      if (bgColor) {
        el.style.background = bgColor;
        el.style.color = perm.textColor || (KC.Lanes.isLightColor(bgColor) ? '#1f2937' : '#ffffff');
      }

      var evStart = new Date(ev.start);
      var timeStr = KC.Utils.pad2(evStart.getHours()) + ':' + KC.Utils.pad2(evStart.getMinutes());
      el.title = (ev.title || '(無題)') + '\n' + timeStr + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      // 可視先頭セグメントのみ時計アイコン・時刻・タイトルを表示
      // タイトルは可視区間幅いっぱいに伸ばす
      if (isVisibleStart) {
        var vc = visibleCells || 1;
        var clockSpan = document.createElement('span');
        clockSpan.className = 'kc-month-chip--span-icon';
        clockSpan.textContent = '⏱';

        var timeSpan = document.createElement('span');
        timeSpan.className = 'kc-month-chip--span-time';
        timeSpan.textContent = timeStr;

        // タイトルを可視区間幅いっぱいに伸ばす（position:absolute で幅確保）
        var titleSpan = document.createElement('span');
        titleSpan.className = 'kc-month-chip--span-title kc-seg-title';
        titleSpan.textContent = ev.title || '(無題)';
        titleSpan.style.position = 'absolute';
        // アイコン(9px+margin)+時刻(~30px)+gap(4px*2) ≒ 50px を left オフセットとして確保
        titleSpan.style.left = '50px';
        titleSpan.style.top = '0';
        titleSpan.style.height = '100%';
        // 幅 = visibleCells × 100% - left(50px) - BAR_X_GAP(末尾) - right padding(6px)
        // 100% の基準 = セグメント幅
        //   vc=1 (単セル): セグメント幅 = calc(セル幅-BAR_X_GAP) → calc(100% - 50px - 6px)
        //   vc>1 (複数): セグメント幅 = セル幅 → calc(vc*100% - 50px - BAR_X_GAP - 6px)
        titleSpan.style.width = vc > 1
          ? ('calc(' + vc + ' * 100% - 50px - ' + BAR_X_GAP + 'px - 6px)')
          : 'calc(100% - 50px - 6px)';  // 単セル: セグメント自体が BAR_X_GAP 分短い
        titleSpan.style.display = 'flex';
        titleSpan.style.alignItems = 'center';
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.whiteSpace = 'nowrap';
        titleSpan.style.textOverflow = 'ellipsis';
        titleSpan.style.boxSizing = 'border-box';

        el.appendChild(clockSpan);
        el.appendChild(timeSpan);
        el.appendChild(titleSpan);
      }

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      // フェーズ1: DnD は無効（mousedown 伝播のみ止める）
      el.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        mdEvt.stopPropagation();
      });

      return el;
    }

    /**
     * .kc-month-chip 要素を生成する
     * @param {Object} evt - KcEvent
     * @returns {HTMLElement}
     */
    function buildMonthChip(evt) {
      var chipPerm    = KC.LoginContext.getPermission(evt);
      var chipCanEdit = chipPerm.canEdit;
      // 権限ルールにマッチした bgColor を優先し、なければイベント自体の色フィールドを使用
      var bgColor = chipPerm.bgColor || evt.color || null;
      var chip = document.createElement('div');
      chip.className = 'kc-month-chip';
      // 編集権限なし（DnD 不可）はポインターカーソルに変更（クリックでダイアログは全員開ける）
      if (!chipCanEdit) chip.style.cursor = 'pointer';
      chip.dataset.evId = evt.id;
      chip.dataset.eventId = evt.id;  // SearchFilter プルダウン逆引き用（evId と同値）
      // 透明背景に変更（Google カレンダー風: 先頭ドットで色を表現）
      // bgColor の有無によらず background は transparent、文字色は濃色固定
      chip.style.background = 'transparent';
      chip.style.color = '#1f2937';  // kintone 白背景前提で濃色固定

      var dot = document.createElement('span');
      dot.className = 'kc-month-chip-dot';
      // bgColor 未指定時のフォールバック: #dbeafe 背景に合わせたインジゴ（#818cf8）で統一
      dot.style.background = bgColor || '#818cf8';

      var evStart = new Date(evt.start);
      var timeSpan = document.createElement('span');
      timeSpan.className = 'kc-month-chip-time';
      timeSpan.textContent = U.pad2(evStart.getHours()) + ':' + U.pad2(evStart.getMinutes());

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-month-chip-title';
      titleSpan.textContent = evt.title || '(無題)';

      chip.appendChild(dot);
      chip.appendChild(timeSpan);
      chip.appendChild(titleSpan);

      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        KC.Popup.openEdit(evt.id);
      });

      // mousedown → 月ビュー chip 移動 DnD 開始（スコープ C）
      // クロージャで evt を捕捉し、chip 要素の参照も渡す
      chip.addEventListener('mousedown', (function (capturedEvt, capturedChip) {
        return function (mdEvt) {
          if (mdEvt.button !== 0) return;
          if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
          mdEvt.stopPropagation();
          KC.DnD.startMoveMonthChip(capturedEvt, mdEvt, capturedChip);
        };
      }(evt, chip)));

      return chip;
    }

    /**
     * 日跨ぎ時間予定バー（.kc-month-chip--span）を生成する
     * chip 風の全面塗り、時刻表示付き。週をまたぐ場合は複数バーに分割される。
     * @param {Object} ev - 位置情報付き KcEvent（colStart, span, lane, adDateRange を含む）
     * @returns {HTMLElement}
     */
    function buildMonthTimedSpanBar(ev) {
      var perm    = KC.LoginContext.getPermission(ev);
      var canEdit = perm.canEdit;
      var bgColor = perm.bgColor || ev.color || null;
      var el = document.createElement('div');
      el.className = 'kc-month-chip--span';
      if (!canEdit) el.style.cursor = 'pointer';
      el.dataset.evId    = ev.id;
      el.dataset.eventId = ev.id;  // SearchFilter プルダウン逆引き用

      // 絶対配置（.kc-month-ad-events 内、終日バー下層）
      el.style.left   = ((ev.colStart / 7) * 100) + '%';
      // 右端に BAR_X_GAP px の余白を設けて隣接バーの境目を視覚的に分離
      el.style.width  = 'calc(' + ((ev.span / 7) * 100) + '% - ' + BAR_X_GAP + 'px)';
      el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';
      el.style.pointerEvents = 'auto';

      if (bgColor) {
        el.style.background = bgColor;
        el.style.color = perm.textColor || (KC.Lanes.isLightColor(bgColor) ? '#1f2937' : '#ffffff');
      }

      var evStart = new Date(ev.start);
      var timeStr = KC.Utils.pad2(evStart.getHours()) + ':' + KC.Utils.pad2(evStart.getMinutes());
      el.title = (ev.title || '(無題)') + '\n' + timeStr + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      // 時計アイコン（B案: DOM span）: 終日バーとの視覚区別用
      // 擬似要素(A案)ではなく DOM span を採用した理由:
      //   JS の appendChild パターンと一貫しており、
      //   リサイズハンドルが後から追加されても先頭順序が確実に保持される。
      var clockSpan = document.createElement('span');
      clockSpan.className = 'kc-month-chip--span-icon';
      clockSpan.textContent = '⏱';  // U+23F1 STOPWATCH

      var timeSpan = document.createElement('span');
      timeSpan.className = 'kc-month-chip--span-time';
      timeSpan.textContent = timeStr;

      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-month-chip--span-title';
      titleSpan.textContent = ev.title || '(無題)';

      el.appendChild(clockSpan);
      el.appendChild(timeSpan);
      el.appendChild(titleSpan);

      // 左端リサイズハンドル（canEdit の場合のみ機能）
      var leftHandle = document.createElement('div');
      leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
      leftHandle.addEventListener('mousedown', (function (capturedEvt, capturedEl) {
        return function (mdEvt) {
          if (mdEvt.button !== 0) return;
          if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
          mdEvt.stopPropagation();
          KC.DnD.startResizeMonthTimedSpan(capturedEvt, 'left', mdEvt, capturedEl);
        };
      }(ev, el)));

      // 右端リサイズハンドル（canEdit の場合のみ機能）
      var rightHandle = document.createElement('div');
      rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
      rightHandle.addEventListener('mousedown', (function (capturedEvt, capturedEl) {
        return function (mdEvt) {
          if (mdEvt.button !== 0) return;
          if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
          mdEvt.stopPropagation();
          KC.DnD.startResizeMonthTimedSpan(capturedEvt, 'right', mdEvt, capturedEl);
        };
      }(ev, el)));

      el.appendChild(leftHandle);
      el.appendChild(rightHandle);

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      el.addEventListener('mousedown', (function (capturedEvt, capturedEl) {
        return function (mdEvt) {
          if (mdEvt.button !== 0) return;
          if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
          mdEvt.stopPropagation();
          KC.DnD.startMoveMonthChip(capturedEvt, mdEvt, capturedEl);
        };
      }(ev, el)));

      return el;
    }

    /**
     * 月ビューの終日イベントを dayGrid セグメント方式で配置する（Phase1 改修版）
     *
     * 変更点:
     *   - 従来: 1 要素が週全幅を横断する絶対配置（.kc-month-ad-events 内）
     *   - 新方式: イベントを日ごとのセグメントとして各セルの .kc-month-seg-layer に配置
     *   - overflow 判定はセル単位: lane < cellCapacity のセルのみ描画、超えるセルは hiddenByCol に計上
     *   - セグメントが連続する場合、中間セルは角丸なし → 視覚的に 1 本のバーに見える
     *
     * @param {HTMLElement} weekEl - .kc-month-week 要素
     * @param {string[]} weekYMD - 7要素 YYYY-MM-DD 配列
     * @param {Array} alldayEvents - 当週の終日イベント配列
     * @param {number} [baseCapacity] - セルの物理収容スロット数（省略時は全件描画）
     * @param {HTMLElement[]} cellEls - .kc-month-cell 要素配列（7要素）
     * @returns {{ colLaneCounts: number[], hiddenByCol: Array[] }}
     *   colLaneCounts: 各列（0〜6）で実際に描画したレーン数（= usedSlots の終日分）
     *   hiddenByCol:   各列（0〜6）で非表示になった終日イベント配列
     */
    function placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, baseCapacity, cellEls) {
      var result = {
        colLaneCounts: [0, 0, 0, 0, 0, 0, 0],
        hiddenByCol:   [[], [], [], [], [], [], []]
      };
      if (!alldayEvents || alldayEvents.length === 0) return result;

      // Phase1e: バーの描画先は .kc-month-ad-events（週行全幅オーバーレイ）
      // これによりセルの border-left（罫線）より高い z-index 層にバーが描かれ、罫線を覆う。
      var adEventsEl = weekEl.querySelector('.kc-month-ad-events');

      // 各イベントに対して barPosition を求める（他月セルも含む全列が対象）
      var weekEvents = [];
      alldayEvents.forEach(function (evt) {
        var pos = KC.Lanes.eventToBarPosition(evt, weekYMD);
        if (!pos) return;
        weekEvents.push(Object.assign({}, evt, {
          colStart:    pos.colStart,
          span:        pos.span,
          adDateRange: pos.adDateRange
        }));
      });

      if (weekEvents.length === 0) return result;

      // 週内で lane を割り当て（ソート: 色あり降順→開始昇順→終了降順→created昇順→id昇順）
      KC.Lanes.assignLanes(weekEvents);

      // イベントの元の開始日・終了日を YYYY-MM-DD で持っておく（isStart/isEnd 判定用）
      weekEvents.forEach(function (ev) {
        var s = new Date(ev.start);
        var e = new Date(ev.end);
        ev._evStartYMD = KC.Utils.fmtYMD(new Date(s.getFullYear(), s.getMonth(), s.getDate()));
        var endDate = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1);
        ev._evEndYMD = KC.Utils.fmtYMD(endDate);
      });

      // セルごとにセグメントを生成して adEventsEl（週行オーバーレイ）に追加
      weekEvents.forEach(function (ev) {
        var lane = ev.lane || 0;
        var cellCap = (baseCapacity != null) ? baseCapacity : Infinity;

        if (lane >= cellCap) {
          // このイベントは全セルで容量超え → hidden に全列分登録して描画しない
          for (var hci = ev.colStart; hci < ev.colStart + ev.span; hci++) {
            if (hci >= 0 && hci < 7) result.hiddenByCol[hci].push(ev);
          }
          return;
        }

        // 可視セグメントを先行列挙して「可視先頭」と「残り可視セル数」を確定する
        var visibleCols = [];
        for (var ci2 = ev.colStart; ci2 < ev.colStart + ev.span; ci2++) {
          if (ci2 >= 0 && ci2 < 7) visibleCols.push(ci2);
        }

        // 各セルのセグメントを adEventsEl に追加
        for (var cii = 0; cii < visibleCols.length; cii++) {
          var ci = visibleCols[cii];

          var cellYMD = weekYMD[ci];
          var isStart = (cellYMD === ev._evStartYMD) || (ci === ev.colStart && ev._evStartYMD < weekYMD[0]);
          var isEnd   = (cellYMD === ev._evEndYMD)   || (ci === ev.colStart + ev.span - 1 && ev._evEndYMD > weekYMD[6]);

          // isVisibleStart: 可視セグメントの先頭（この週内では常に最初のセル）
          var isVisibleStart = (cii === 0);
          // visibleCells: 可視先頭から末尾まで連続して可視なセル数（タイトル幅計算に使用）
          var visibleCells = visibleCols.length - cii;

          if (!adEventsEl) continue;

          // colIndex(ci) を渡して週行基準の left/width を計算させる（Phase1e）
          var seg = buildMonthAlldaySegment(ev, isStart, isEnd, false, isVisibleStart, visibleCells, ci);
          adEventsEl.appendChild(seg);

          // seg-layer の高さ確保（バー描画はしないが、chip 押し下げのための height セットは継続）
          // colLaneCounts を更新（描画確定したセグメントの lane+1 が使用スロット数）
          result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], lane + 1);
        }
      });

      return result;
    }

    /**
     * 当週の日跨ぎ時間予定バーを dayGrid セグメント方式で配置する（Phase1 改修版）
     *
     * 変更点:
     *   - 従来: 1 要素が週全幅を横断する絶対配置（.kc-month-ad-events 内）、localMax オフセット方式
     *   - 新方式: 終日バーと同じ seg-layer に、終日バーの colLaneCounts[ci] の下にオフセットして配置
     *   - offsetLane = alldayColLaneCounts[ci] + ev.lane （セル局所値を使用）
     *   - overflow 判定はセル単位: offsetLane >= baseCapacity のセルは非表示
     *
     * @param {HTMLElement} weekEl - .kc-month-week 要素
     * @param {string[]} weekYMD - 7要素 YYYY-MM-DD 配列
     * @param {Array} spanEvents - 当週にかかる日跨ぎ時間予定
     * @param {number} alldayLaneCount - 後方互換（現在は alldayColLaneCounts を優先）
     * @param {number[]|null} alldayColLaneCounts - セル局所の終日バー描画数配列（7要素）
     * @param {number} [baseCapacity] - セル物理収容スロット数
     * @param {HTMLElement[]} cellEls - .kc-month-cell 要素配列（7要素）
     * @returns {{ colLaneCounts: number[], hiddenByCol: Array[] }}
     */
    function placeMonthTimedSpanEvents(weekEl, weekYMD, spanEvents, alldayLaneCount, alldayColLaneCounts, baseCapacity, cellEls) {
      // 後方互換: alldayColLaneCounts が数値の場合はシフトする
      if (typeof alldayColLaneCounts === 'number') {
        baseCapacity = alldayColLaneCounts;
        alldayColLaneCounts = null;
      }
      var result = {
        colLaneCounts: [0, 0, 0, 0, 0, 0, 0],
        hiddenByCol:   [[], [], [], [], [], [], []]
      };
      if (!spanEvents || spanEvents.length === 0) return result;

      // Phase1e: バーの描画先は .kc-month-ad-events（週行全幅オーバーレイ）
      var adEventsEl = weekEl.querySelector('.kc-month-ad-events');

      var weekEvents = _buildTimedSpanWeekEvents(spanEvents, weekYMD);
      if (weekEvents.length === 0) return result;

      // 終日バーとは独立したレーン割り当て（0 始まり）
      KC.Lanes.assignLanes(weekEvents);

      var spanLimit = (baseCapacity != null) ? baseCapacity : Infinity;

      // イベントの元の開始日・終了日を YYYY-MM-DD で保持（isStart/isEnd 判定用）
      weekEvents.forEach(function (ev) {
        var s = new Date(ev.start);
        var startDate = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        ev._evStartYMD = KC.Utils.fmtYMD(startDate);
        var e = new Date(ev.end);
        var endDate = new Date(e.getFullYear(), e.getMonth(), e.getDate());
        if (e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0) {
          endDate = new Date(endDate.getTime() - 86400000);
        }
        ev._evEndYMD = KC.Utils.fmtYMD(endDate);
      });

      weekEvents.forEach(function (ev) {
        var spanLane = ev.lane || 0;

        // 可視セルを先行列挙（isVisibleStart / visibleCells 計算用）
        // offsetLane が spanLimit 未満のセルのみ可視とする
        var visibleCols = [];
        for (var ci2 = ev.colStart; ci2 < ev.colStart + ev.span; ci2++) {
          if (ci2 < 0 || ci2 >= 7) continue;
          var adLanes2 = alldayColLaneCounts
            ? (alldayColLaneCounts[ci2] || 0)
            : alldayLaneCount;
          var offsetLane2 = adLanes2 + spanLane;
          if (offsetLane2 < spanLimit) {
            visibleCols.push(ci2);
          }
        }

        for (var cii = 0; cii < visibleCols.length; cii++) {
          var ci = visibleCols[cii];

          var adLanes = alldayColLaneCounts
            ? (alldayColLaneCounts[ci] || 0)
            : alldayLaneCount;
          var offsetLane = adLanes + spanLane;

          var cellYMD = weekYMD[ci];
          var isStart = (cellYMD === ev._evStartYMD) || (ci === ev.colStart && ev._evStartYMD < weekYMD[0]);
          var isEnd   = (cellYMD === ev._evEndYMD)   || (ci === ev.colStart + ev.span - 1 && ev._evEndYMD > weekYMD[6]);

          var isVisibleStart = (cii === 0);
          var visibleCells = visibleCols.length - cii;

          if (!adEventsEl) continue;

          // colIndex(ci) を渡して週行基準の left/width を計算させる（Phase1e）
          var evWithOffset = Object.assign({}, ev, { lane: offsetLane });
          var seg = buildMonthTimedSpanSegment(evWithOffset, isStart, isEnd, isVisibleStart, visibleCells, ci);
          adEventsEl.appendChild(seg);

          // colLaneCounts を更新（終日 + span の合計スロット数）
          result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], offsetLane + 1);
        }

        // overflow セルを hidden に登録（可視でないセル）
        for (var ci3 = ev.colStart; ci3 < ev.colStart + ev.span; ci3++) {
          if (ci3 < 0 || ci3 >= 7) continue;
          var adLanes3 = alldayColLaneCounts
            ? (alldayColLaneCounts[ci3] || 0)
            : alldayLaneCount;
          if (adLanes3 + spanLane >= spanLimit) {
            result.hiddenByCol[ci3].push(ev);
          }
        }
      });

      return result;
    }

    /**
     * spanEvents から weekEvents 配列を構築する（バー位置付与）
     * @param {Array} spanEvents - 日跨ぎ時間予定配列
     * @param {string[]} weekYMD - 7要素 YYYY-MM-DD 配列
     * @returns {Array} colStart/span/adDateRange 付き配列
     */
    function _buildTimedSpanWeekEvents(spanEvents, weekYMD) {
      var weekEvents = [];
      spanEvents.forEach(function (evt) {
        var pos = KC.Lanes.timedEventToBarPosition(evt, weekYMD);
        if (!pos) return;
        weekEvents.push(Object.assign({}, evt, {
          colStart:    pos.colStart,
          span:        pos.span,
          adDateRange: pos.adDateRange
        }));
      });
      return weekEvents;
    }

    /**
     * セルに時間予定 chip を配置する（dayGrid Phase1 改修版）
     *
     * 変更点:
     *   - 旧 spacer（.kc-month-chip-spacer）廃止
     *   - 代わりに .kc-month-seg-layer の height を JS でセットし、chip との位置関係を確保する
     *   - seg-layer は in-flow（flex 子, flex-shrink:0）のため、高さを設定するだけで
     *     chip が seg-layer の下に来る
     *
     * @param {HTMLElement} cellEl - .kc-month-cell 要素
     * @param {Array} timedEvents - 当日の時間予定（時刻昇順）
     * @param {number} usedSlots - 終日バー+span バーで使用済みのスロット数
     * @param {number} maxItems - chip 表示上限（usedSlots + chipCap）
     * @returns {number} 追加した chip 数
     */
    function placeMonthTimedEvents(cellEl, timedEvents, usedSlots, maxItems) {
      // dayGrid Phase1: spacer の代わりに seg-layer の高さをセットする
      // seg-layer は in-flow (display: block, flex: 0 0 auto) で dateline の次に来るため、
      // seg-layer.height = usedSlots 本分のバー高 = chip の開始位置として機能する。
      // usedSlots=0 のときは seg-layer.height=0 のまま（クリア時に 0 にリセット済み）。
      if (usedSlots > 0) {
        var segLayer = cellEl.querySelector('.kc-month-seg-layer');
        if (segLayer) {
          var segLayerH = usedSlots * BAR_H + (usedSlots - 1) * BAR_GAP;
          segLayer.style.height = segLayerH + 'px';
        }
      }

      if (!timedEvents || timedEvents.length === 0) return 0;

      var remaining = maxItems - usedSlots;
      var added = 0;

      for (var i = 0; i < timedEvents.length; i++) {
        if (remaining <= 0) break;
        var chip = buildMonthChip(timedEvents[i]);
        cellEl.appendChild(chip);
        added++;
        remaining--;
      }

      return added;
    }

    /**
     * +N more 要素を追加する
     * @param {HTMLElement} cellEl       - .kc-month-cell 要素
     * @param {number}      remaining    - 非表示件数
     * @param {Array}       hiddenEvents - 非表示予定オブジェクト配列（終日・時間予定混在）
     */
    function applyOverflow(cellEl, remaining, hiddenEvents) {
      if (remaining <= 0) return;
      var more = document.createElement('div');
      more.className = 'kc-month-more';
      more.textContent = '+' + remaining + ' more';
      // click リスナーは document capture phase の委譲ハンドラで処理する
      // （拡張機能の DOM mutation で直接リスナーが消えるバグを回避）
      cellEl.appendChild(more);
      KC.MonthOverflowPopup.registerHiddenEvents(more, hiddenEvents || []);
    }

    /**
     * 月グリッドの各週・各セルにイベントを配置するオーケストレーター
     * 順序: 終日バー → 日跨ぎ時間予定バー → 単日時間予定 chip
     */
    function placeMonthEvents() {
      // ポップオーバーを先に閉じる（_monthRoot ガード前に実行して確実に閉じる）
      if (KC.MonthOverflowPopup) KC.MonthOverflowPopup.close();

      if (!_monthRoot) return;
      // _monthRoot がライブ DOM から切り離されていないか確認（デバッグ用）
      if (!document.contains(_monthRoot)) {
        console.warn('[KC.RenderMonth] placeMonthEvents: _monthRoot is detached from live DOM. Attempting re-init.');
        _monthRoot = null;
        _ensureMonthDOM();
        if (!_monthRoot) return;
        // グリッドを再構築してから続行する
        KC.Render.setActiveView('month');
        renderGrid();
      }
      var gridEl = _monthRoot.querySelector('.kc-month-grid');
      if (!gridEl) return;

      // 冪等化: 重複呼び出し時に chip が二重描画されないよう、既存要素を事前クリアする。
      // DnD ゴースト（.kc-event--ghost）は DnD 操作中も視覚的に残す必要があるため除外する。
      // クリア対象:
      //   - .kc-month-cell 内の .kc-month-chip（単日時間予定 chip）
      //   - .kc-month-cell 内の .kc-month-chip-spacer（旧 spacer: 残存している場合に備え除去）
      //   - .kc-month-cell 内の .kc-month-more（+N more ラベル）
      //   - .kc-month-seg-layer 内の全子要素（Phase1: セグメント要素）
      //   - .kc-month-ad-events 内の全子要素（旧バー要素 / DnD ゴーストは除外）
      Array.from(gridEl.querySelectorAll(
        '.kc-month-cell .kc-month-chip:not(.kc-event--ghost),' +
        '.kc-month-cell .kc-month-chip-spacer,' +
        '.kc-month-cell .kc-month-more'
      )).forEach(function (el) { el.parentNode.removeChild(el); });

      // seg-layer 内をクリア（高さリセット込み）
      Array.from(gridEl.querySelectorAll('.kc-month-seg-layer')).forEach(function (layer) {
        Array.from(layer.children).forEach(function (el) {
          if (!el.classList.contains('kc-event--ghost')) {
            layer.removeChild(el);
          }
        });
        layer.style.height = '0px';
      });

      Array.from(gridEl.querySelectorAll('.kc-month-ad-events')).forEach(function (layer) {
        Array.from(layer.children).forEach(function (el) {
          if (!el.classList.contains('kc-event--ghost')) {
            layer.removeChild(el);
          }
        });
      });

      // セル実高から物理収容スロット数を動的計算（画面サイズ・全画面モードに追従）
      // baseCapacity = moreH を差し引かない純粋な物理収容スロット数。
      // overflow 有無はセルごとに判定し、overflow 時のみ more 用 1 スロットを確保する。
      var baseCapacity = _calcMaxItems();

      var range = monthRange(S.current);

      // フィルタ適用（all: 全件, mine: 自分のみ, others: 他人のみ）→ 検索フィルタ
      var filteredMonthEvents = KC.SearchFilter.apply(KC.EventFilter.apply(S.events || []));

      // デバッグ: イベント件数が 0 のとき、または baseCapacity が極小のときに原因調査用ログを出力
      if (filteredMonthEvents.length === 0 && (S.events || []).length > 0) {
        console.warn('[KC.RenderMonth] placeMonthEvents: フィルタ後のイベント数が 0 です。eventFilter=' + (KC.State.eventFilter || 'all'));
      }
      if (baseCapacity === 0) {
        console.warn('[KC.RenderMonth] placeMonthEvents: baseCapacity=0 (セル高不足)。chipは非表示になり +N more のみ表示されます。');
      }
      if ((S.events || []).length === 0) {
        _log('[KC.RenderMonth] placeMonthEvents: S.events が空です (件数=0)。イベント配置をスキップします。');
      }

      var weekEls = Array.from(gridEl.querySelectorAll('.kc-month-week'));
      weekEls.forEach(function (weekEl, weekIdx) {
        // この週の 7 日分の YYYY-MM-DD を算出
        var weekYMD = [];
        for (var d = 0; d < 7; d++) {
          weekYMD.push(U.fmtYMD(U.addDays(range.start, weekIdx * 7 + d)));
        }

        // dayGrid Phase1: cellEls を週ループ先頭で取得し、各関数に渡す
        var cellEls = Array.from(weekEl.querySelectorAll('.kc-month-cell'));

        // 当週にかかる終日イベントを抽出（週内に 1 日でも重なるもの）
        var weekAllday = filteredMonthEvents.filter(function (evt) {
          if (!evt.allday) return false;
          return KC.Lanes.eventToBarPosition(evt, weekYMD) !== null;
        });

        // 終日バーをセグメント方式で配置（dayGrid Phase1）
        // baseCapacity を渡してセル単位の overflow 判定を行う
        var alldayResult = placeMonthAlldayEvents(weekEl, weekYMD, weekAllday, baseCapacity, cellEls);

        // 当週にかかる日跨ぎ時間予定を抽出（allday=false かつ複数日にまたがるもの）
        var weekTimedSpan = filteredMonthEvents.filter(function (evt) {
          if (evt.allday) return false;
          return KC.Lanes.timedEventToBarPosition(evt, weekYMD) !== null;
        });

        // 日跨ぎ時間予定バーをセグメント方式で配置（dayGrid Phase1）
        // alldayResult.colLaneCounts: セル局所終日バー数（オフセット計算に使用）
        // セル局所オフセットにより「そのセルに終日バーがない場合は余白なし」を実現
        var spanResult = placeMonthTimedSpanEvents(
          weekEl, weekYMD, weekTimedSpan,
          0,                            // alldayLaneCount: 後方互換フォールバック（未使用）
          alldayResult.colLaneCounts,   // セル局所終日バー数配列（セル別オフセット計算に使用）
          baseCapacity,
          cellEls
        );

        // セルごとに単日時間予定 chip を配置（他月セルも含む）
        // dayGrid Phase1: placeMonthAlldayEvents / placeMonthTimedSpanEvents が
        // セル単位 overflow 判定を行うため、ここではバー超過分の hiddenByCol を参照する。
        // ただし「lane >= baseCapacity のセグメントを全て非表示」の方式では
        // overflow 確定時の -1 補正（more 用スロット確保）がバー側でできない。
        // → セルループで hiddenAllday/hiddenSpan を計算してから chipCap を調整する。
        cellEls.forEach(function (cellEl, colIdx) {
          var ymd = weekYMD[colIdx];

          // hiddenByCol からセル単位の非表示バー数を取得
          var hiddenAllday = alldayResult.hiddenByCol[colIdx] || [];
          var hiddenSpan   = spanResult.hiddenByCol[colIdx]   || [];

          // usedSlots: このセルで実際に描画されたバーのスロット数（終日+span 合計）
          var usedSlots = spanResult.colLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0;

          // このセルの単日時間予定を抽出（開始日 = このセルの日付、かつ日跨ぎなし）
          var dayTimedEvents = filteredMonthEvents.filter(function (evt) {
            if (evt.allday) return false;
            if (U.fmtYMD(new Date(evt.start)) !== ymd) return false;
            // 日跨ぎ予定はバー表示済みなので chip から除外
            return KC.Lanes.timedEventToBarPosition(evt, weekYMD) === null;
          });
          dayTimedEvents.sort(function (a, b) {
            return (a.start < b.start) ? -1 : (a.start > b.start) ? 1 : 0;
          });

          // overflow 判定（dayGrid Phase1 改良版）:
          // placeMonthAlldayEvents では lane >= baseCapacity を単純に非表示にしているが、
          // overflow 確定時の「more 用に -1」補正は後段のセルループで行う。
          //
          // 手順:
          //   1. 実際の hiddenAllday/hiddenSpan + timedEvents 全件で overflow を判定
          //   2. overflow 確定なら usedSlots を再計算して chipCap から -1 する
          //      （バー側で「overflow 時に lane = baseCapacity-1 を表示しない」補正が
          //        できていないため、chipCap で吸収する）
          //
          // なお placeMonthAlldayEvents の lane >= cellCap 判定は「baseCapacity 以上の lane を
          // 非表示にする」であり、overflow 確定時の最終スロットは表示されたまま。
          // chipCap = 0 になれば chip は表示されないので実質的に同じ結果になる。
          var hiddenBarCount = hiddenAllday.length + hiddenSpan.length;
          var total = usedSlots + dayTimedEvents.length + hiddenBarCount;
          var isOverflow = total > baseCapacity;

          // chipCap: placeMonthTimedEvents に渡す chip 表示上限
          //   overflow 時: more 用に 1 枠確保 → baseCapacity - 1 - usedSlots
          //   収まる時: 全件表示 → baseCapacity - usedSlots
          // ただし非表示バーがある時点で overflow 確定なので hiddenBarCount > 0 も overflow
          var chipCap = (isOverflow || hiddenBarCount > 0)
            ? Math.max(0, baseCapacity - 1 - usedSlots)   // overflow 時: more 用に 1 枠確保
            : Math.max(0, baseCapacity - usedSlots);       // 収まる時: 全件

          // chip を配置
          var chipsAdded = placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, usedSlots + chipCap);

          // 非表示件数を計算して +N more を表示
          var hiddenTimed  = dayTimedEvents.slice(chipsAdded);
          var hiddenCount  = hiddenAllday.length + hiddenSpan.length + hiddenTimed.length;
          var alldayShown  = alldayResult.colLaneCounts[colIdx] || 0;
          var spanShown    = Math.max(0, (spanResult.colLaneCounts[colIdx] || 0) - alldayShown);
          _log('[KC.place] ' + ymd +
               ' baseCapacity=' + baseCapacity +
               ' usedSlots=' + usedSlots +
               ' total=' + total +
               ' overflow=' + isOverflow +
               ' chipCap=' + chipCap +
               ' allday=' + alldayShown +
               ' span=' + spanShown +
               ' chip=' + chipsAdded +
               ' hidden=' + hiddenCount +
               ' (hiddenAllday=' + hiddenAllday.length +
               ' hiddenSpan=' + hiddenSpan.length +
               ' hiddenTimed=' + hiddenTimed.length + ')');
          if (hiddenCount > 0) {
            // ポップオーバーには 終日超過（先）→ span 超過 → 時間予定超過（後）の順で渡す
            applyOverflow(cellEl, hiddenCount, hiddenAllday.concat(hiddenSpan).concat(hiddenTimed));
          }
        });
      });
    }

    /**
     * 完全リフレッシュ（DOM 確保 → DOM 切替 → データ取得 → グリッド描画）
     */
    async function refresh() {
      _ensureMonthDOM();
      _showMonthDOM();

      // 仮描画（データ取得前に空グリッドを表示）
      renderGrid();

      // データ取得
      var range = gridRange();
      var toISO = function (d) {
        var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        return new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString();
      };
      var isoStart = toISO(range.start);
      var isoEnd   = toISO(U.addDays(range.end, 1));

      try {
        KC.Banner.hide();
        S.events = await KC.Api.loadEvents(isoStart, isoEnd);
        // P-9: events 更新後は SearchFilter のクエリキャッシュを無効化して次回の _computeMatchList で再スキャンさせる
        KC.SearchFilter._lastQuery = null;
        // グリッドを再描画してからイベントを配置する（Phase 1B-2）
        renderGrid();
        // 1 フレーム待ってセル高が確定してから placeMonthEvents を呼ぶ
        // （renderGrid 直後は flex layout が未確定で _calcMaxItems が
        // フォールバック値で計算してしまうケースがある = chip が日付と被る原因）
        requestAnimationFrame(function () {
          placeMonthEvents();
        });
      } catch (err) {
        console.error('[KC.RenderMonth] loadEvents error:', err);
        var msg;
        if (err && err._isRateLimited) {
          msg = 'アクセスが集中しています。しばらく待ってから再読み込みしてください。';
        } else if (err && err.code === 'GAIA_TM12') {
          msg = 'カーソルの上限に達しました。しばらく待ってから再読み込みしてください。';
        } else {
          msg = 'データの読み込みに失敗しました。再読み込みしてください。';
        }
        KC.Banner.show(msg);
      }
    }

    return {
      refresh:   refresh,
      renderGrid: renderGrid,
      gridRange:  gridRange,
      // Phase 1B-2 実装済み
      placeMonthAlldayEvents:    placeMonthAlldayEvents,
      placeMonthTimedEvents:     placeMonthTimedEvents,
      placeMonthTimedSpanEvents: placeMonthTimedSpanEvents,
      applyOverflow:             applyOverflow,
      placeMonthEvents:          placeMonthEvents,
      _showMonthDOM: _showMonthDOM
    };
  }());

  /* ====================================================================
   * KC.RenderDay — 日ビューレンダラー（REQ_day-view Phase 月-Day-1）
   * ==================================================================== */
  KC.RenderDay = (function () {
    var U = KC.Utils;
    var S = KC.State;

    /**
     * 単日の表示範囲を返す（open-end: 翌日 0:00）
     * @param {Date} date - 基準日
     * @returns {{ start: Date, end: Date }}
     */
    function dayRange(date) {
      var start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
      var end = U.addDays(start, 1);  // 翌日 0:00（open-end: §10.2 確定済み）
      return { start: start, end: end };
    }

    /**
     * 表示期間を返す（KC.Render ファサードが参照する公開 API）
     * @returns {{ start: Date, end: Date }}
     */
    function gridRange() {
      return dayRange(S.current);
    }

    /** 曜日ヘッダー描画（1 列分） */
    function renderDayHeaders() {
      var days = S.els.days;
      if (!days) return;

      Array.from(days.querySelectorAll('.kc-day')).forEach(function (n) { n.remove(); });

      var labels = ['日', '月', '火', '水', '木', '金', '土'];
      var rightSpacer = days.querySelector('.kc-day-spacer-right');
      var d = S.current;
      var ymd = U.fmtYMD(d);
      var today = U.fmtYMD(new Date());
      var isToday = (ymd === today);
      var dayOfWeek = d.getDay();
      var holidayName = U.getHolidayName(d);

      var div = document.createElement('div');
      div.className = 'kc-day';
      if (dayOfWeek === 6) div.classList.add('kc-day--sat');
      if (dayOfWeek === 0) div.classList.add('kc-day--sun');
      if (holidayName) div.classList.add('kc-day--holiday');

      var head = document.createElement('div');
      head.className = 'kc-day-head' + (isToday ? ' is-today' : '');

      var wSpan = document.createElement('span');
      wSpan.className = 'w';
      wSpan.textContent = labels[dayOfWeek];

      var numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = d.getDate();

      head.appendChild(wSpan);
      head.appendChild(numSpan);

      if (holidayName) {
        var holidaySpan = document.createElement('span');
        holidaySpan.className = 'kc-holiday-name';
        holidaySpan.textContent = holidayName;
        head.appendChild(holidaySpan);
      }

      div.appendChild(head);

      if (rightSpacer) {
        days.insertBefore(div, rightSpacer);
      } else {
        days.appendChild(div);
      }
    }

    /** 終日スロット行の描画（1 列分） */
    function renderAlldayRow() {
      var wrap = S.els.allday || document.getElementById('kc-allday');
      if (!wrap) return;
      wrap.innerHTML = '';

      var gutter = document.createElement('div');
      gutter.className = 'kc-gutter';
      wrap.appendChild(gutter);

      var d = S.current;
      var cell = document.createElement('div');
      cell.className = 'kc-adcell';
      var adDow = d.getDay();
      var adHoliday = U.getHolidayName(d);
      if (adDow === 6) cell.classList.add('kc-adcell--sat');
      if (adDow === 0) cell.classList.add('kc-adcell--sun');
      if (adHoliday) cell.classList.add('kc-adcell--holiday');
      cell.dataset.date = U.fmtYMD(d);
      wrap.appendChild(cell);

      var spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      wrap.appendChild(spacer);

      var eventsLayer = document.createElement('div');
      eventsLayer.className = 'kc-ad-events';
      wrap.appendChild(eventsLayer);

      var toggleEl = document.createElement('div');
      toggleEl.className = 'kc-allday-toggle';
      toggleEl.style.display = 'none';
      wrap.appendChild(toggleEl);

      S.els.allday = wrap;
    }

    /** セルグリッド描画（24行 × 1 列） */
    function renderRows() {
      // DOM キャッシュが未設定の場合は再取得する（ビュー切替後の再描画で S.els.rows が未初期化のケースに対応）
      var rows = S.els.rows || document.getElementById('kc-rows');
      if (!rows) return;
      rows.innerHTML = '';
      document.documentElement.style.setProperty('--kc-hours', 24);

      var d = S.current;
      var dow = d.getDay();
      var holiday = !!U.getHolidayName(d);
      var ymd = U.fmtYMD(d);

      for (var h = 0; h < 24; h++) {
        var row = document.createElement('div');
        row.className = 'kc-row';
        row.dataset.hour = String(h);

        var cell = document.createElement('div');
        cell.className = 'kc-cell';
        if (dow === 6) cell.classList.add('kc-cell--sat');
        if (dow === 0) cell.classList.add('kc-cell--sun');
        if (holiday) cell.classList.add('kc-cell--holiday');
        cell.dataset.date = ymd;
        row.appendChild(cell);
        rows.appendChild(row);
      }

      // 描画後に DOM キャッシュを更新する（週ビューと同パターン）
      S.els.rows = rows;
    }

    /** 当日のイベントを配置する */
    function placeEvents() {
      var alldayWrap = S.els.allday;
      var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
      var toggleEl    = alldayWrap ? alldayWrap.querySelector('.kc-allday-toggle') : null;
      if (eventsLayer) eventsLayer.innerHTML = '';

      // DOM キャッシュが未設定の場合は再取得する（renderRows 未実行時のフォールバック）
      var rows = S.els.rows || document.getElementById('kc-rows');
      if (!rows) return;
      rows.querySelectorAll('.kc-overlay').forEach(function (o) { o.remove(); });

      var ymd = U.fmtYMD(S.current);
      var dayYMDs = [ymd];

      // フィルタ適用（all: 全件, mine: 自分のみ, others: 他人のみ）→ 検索フィルタ
      var filteredEvents = KC.SearchFilter.apply(KC.EventFilter.apply(S.events || []));

      // ===== 終日イベント配置 =====
      var dayEvents = [];
      filteredEvents.forEach(function (evt) {
        if (!evt.allday) return;
        var pos = KC.Lanes.eventToBarPosition(evt, dayYMDs);
        if (!pos) return;
        dayEvents.push(Object.assign({}, evt, pos));
      });

      KC.Lanes.assignLanes(dayEvents);

      var maxLane = dayEvents.reduce(function (m, ev) {
        return Math.max(m, ev.lane || 0);
      }, -1);

      var collapsedLaneCount = KC.RenderShared.calcCollapsedLanes(maxLane);
      var hiddenCount = dayEvents.filter(function (ev) { return ev.lane >= 3; }).length;

      if (toggleEl) KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount);

      if (toggleEl && maxLane >= 3) {
        toggleEl.onclick = function () {
          S.alldayExpanded = !S.alldayExpanded;
          KC.Render.renderGrid();
        };
      }

      dayEvents.forEach(function (ev) {
        if (!eventsLayer) return;
        var bar = KC.RenderShared.buildAlldayBar(ev, { colCount: dayYMDs.length });
        eventsLayer.appendChild(bar);
      });

      if (alldayWrap) {
        var BAR_H    = 20;  /* --kc-ad-bar-h (font-size 14px 対応: 旧 24px) */
        var BAR_GAP  = 3;
        var BAR_TOP  = 4;
        var BAR_BTM  = 4;
        var TOGGLE_H = 24;

        var displayLanes = S.alldayExpanded ? (maxLane + 1) : collapsedLaneCount;
        if (displayLanes < 1) displayLanes = 1;

        var totalH = BAR_TOP + (BAR_H + BAR_GAP) * displayLanes - BAR_GAP + BAR_BTM + TOGGLE_H;
        alldayWrap.style.height = totalH + 'px';

        var gutter = alldayWrap.querySelector('.kc-gutter');
        if (gutter) gutter.style.height = totalH + 'px';

        if (eventsLayer) {
          eventsLayer.style.overflow = S.alldayExpanded ? 'visible' : 'hidden';
        }
      }

      // ===== 時間イベント配置（当日分のみ・24:00 でクランプ + カラム分割）=====
      // 2パス方式（週ビューと同等のアルゴリズムを日ビュー 1 列に適用）
      // REQ_overlap-rendering §6.1（設計案 A）準拠
      var dayStart = new Date(ymd + 'T00:00:00');
      var dayEnd   = U.addDays(dayStart, 1);
      var totalMin = 24 * 60;

      /**
       * セグメント配列（同一日の時間予定）にカラム情報を付与する（貪欲法）
       * 境界値が接するだけ（a.endMin === b.startMin）は重なりに含めない（§5.1）
       * @param {Array} segs - { startMin, endMin, ... } を持つオブジェクトの配列（破壊的変更あり）
       */
      function _calcOverlapLayoutDay(segs) {
        segs.sort(function (a, b) {
          return a.startMin !== b.startMin
            ? a.startMin - b.startMin
            : b.endMin - a.endMin;
        });

        var endTimes = [];
        segs.forEach(function (seg) {
          var freeCol = -1;
          for (var ci = 0; ci < endTimes.length; ci++) {
            if (endTimes[ci] <= seg.startMin) {
              freeCol = ci;
              break;
            }
          }
          if (freeCol >= 0) {
            seg.colIdx = freeCol;
            endTimes[freeCol] = seg.endMin;
          } else {
            seg.colIdx = endTimes.length;
            endTimes.push(seg.endMin);
          }
        });

        var maxCols = endTimes.length || 1;
        segs.forEach(function (seg) { seg.maxCols = maxCols; });
      }

      // 第1パス: 当日にオーバーラップする時間予定のセグメントを収集
      var daySegs = [];

      filteredEvents.forEach(function (evt) {
        if (evt.allday) return;

        var evStart = new Date(evt.start);
        var evEnd   = new Date(evt.end);

        if (evStart >= dayEnd || evEnd <= dayStart) return;

        var sTimeStr = U.pad2(evStart.getHours()) + ':' + U.pad2(evStart.getMinutes());
        var eTimeStr = U.pad2(evEnd.getHours())   + ':' + U.pad2(evEnd.getMinutes());
        var sDateStr = (evStart.getMonth() + 1) + '/' + evStart.getDate();
        var eDateStr = (evEnd.getMonth()   + 1) + '/' + evEnd.getDate();
        var sameDay = U.fmtYMD(evStart) === U.fmtYMD(evEnd);
        var fullTimeStr = sameDay
          ? (sDateStr + ' ' + sTimeStr + ' ~ ' + eTimeStr)
          : (sDateStr + ' ' + sTimeStr + ' ~ ' + eDateStr + ' ' + eTimeStr);

        var segStartMs = Math.max(evStart.getTime(), dayStart.getTime());
        var segEndMs   = Math.min(evEnd.getTime(),   dayEnd.getTime());
        var segStartMin = Math.round((segStartMs - dayStart.getTime()) / 60000);
        var segEndMin   = Math.round((segEndMs   - dayStart.getTime()) / 60000);
        if (segEndMin > totalMin) segEndMin = totalMin;
        if (segStartMin < 0) segStartMin = 0;
        if (segEndMin <= segStartMin) return;

        daySegs.push({
          evt: evt,
          fullTimeStr: fullTimeStr,
          segStartMin: segStartMin,
          segEndMin: segEndMin,
          topPct: (segStartMin / totalMin) * 100,
          heightPct: ((segEndMin - segStartMin) / totalMin) * 100,
          colIdx: 0,
          maxCols: 1
        });
      });

      // カラム分割計算（2件以上の場合のみ）
      if (daySegs.length > 1) {
        _calcOverlapLayoutDay(daySegs);
      }

      // overlay は共通なので先に確保する
      var firstHourRowDay = rows.children[0];
      var colCellDay = firstHourRowDay ? firstHourRowDay.children[0] : null;
      var overlayDay = null;
      if (colCellDay) {
        overlayDay = colCellDay.querySelector('.kc-overlay');
        if (!overlayDay) {
          overlayDay = document.createElement('div');
          overlayDay.className = 'kc-overlay';
          overlayDay.style.position = 'relative';
          overlayDay.style.height = 'calc(var(--kc-hours) * var(--kc-hour-height))';
          overlayDay.style.width = '100%';
          overlayDay.style.pointerEvents = 'none';
          colCellDay.appendChild(overlayDay);
        }
      }

      // 第2パス: DOM 生成
      daySegs.forEach(function (seg) {
        if (!overlayDay) return;

        var evt = seg.evt;
        var evtPerm    = KC.LoginContext.getPermission(evt);
        var evtCanEdit = evtPerm.canEdit;
        var evtBgColor = evtPerm.bgColor || evt.color || null;

        var div = document.createElement('div');
        div.className = 'kc-event';
        if (!evtCanEdit) div.style.cursor = 'pointer';
        div.dataset.eventId = evt.id;
        div.style.top    = 'calc(' + seg.topPct + '% + 0px)';
        div.style.height = 'calc(' + seg.heightPct + '% - 2px)';
        div.style.pointerEvents = 'auto';

        // 等分割＋半重ね＋右側余白方式（REQ_overlap-rendering §3.1 FR-1 確定版第6版）
        // colWidth = usableW / (1 + (N-1) * 0.5)   usableW = overlayWidth - GUTTER - RIGHT_MARGIN_PX
        // left     = GUTTER + colIdx * colWidth * 0.5
        // width    = colWidth（全列同幅）
        // right    = 'auto'（CSS の right:6px を上書き）
        // z-index  = 10 + colIdx（後方カラムほど前面: AC4.9）
        // 1件のみ（maxCols===1）はインラインスタイル未設定のため CSS left:6px/right:6px が有効（AC4.4）
        if (seg.maxCols > 1) {
          var OVERLAP_RATIO_DAY   = 0.5; // 後発カラムを colWidth の 50% 右にオフセット
          var RIGHT_MARGIN_PX_DAY = 24;  // 新規追加用の右側余白
          var GUTTER_DAY          = 6;   // CSS left:6px に対応する左余白（px）
          var N_DAY               = seg.maxCols;
          var overlayWDay         = overlayDay.offsetWidth;
          if (overlayWDay > 0) {
            // px で計算可能な場合
            var usableWDay    = overlayWDay - GUTTER_DAY - RIGHT_MARGIN_PX_DAY;
            var colWidthDay   = usableWDay / (1 + (N_DAY - 1) * OVERLAP_RATIO_DAY);
            var overlapOffDay = colWidthDay * OVERLAP_RATIO_DAY;
            div.style.left  = (GUTTER_DAY + seg.colIdx * overlapOffDay) + 'px';
            div.style.width = colWidthDay + 'px';
          } else {
            // overlayWidth が 0 の場合: パーセント近似（RIGHT_MARGIN_PX=24 ≈ 12% / GUTTER=6 ≈ 3%）
            var RIGHT_MARGIN_PCT_DAY = 12;
            var GUTTER_PCT_DAY       = 3;
            var usableWDay_pct       = 100 - GUTTER_PCT_DAY - RIGHT_MARGIN_PCT_DAY; // 85%
            var colWidthDay_pct      = usableWDay_pct / (1 + (N_DAY - 1) * OVERLAP_RATIO_DAY);
            var overlapOffDay_pct    = colWidthDay_pct * OVERLAP_RATIO_DAY;
            div.style.left  = (GUTTER_PCT_DAY + seg.colIdx * overlapOffDay_pct) + '%';
            div.style.width = colWidthDay_pct + '%';
          }
          div.style.right  = 'auto';
          div.style.zIndex = String(10 + seg.colIdx);
        }

        if (evtBgColor) {
          div.style.backgroundColor = evtBgColor;
          div.style.borderColor     = evtBgColor;
          div.style.color = evtPerm.textColor || (KC.Lanes.isLightColor(evtBgColor) ? '#1f2937' : '#ffffff');
        }

        var titleDiv = document.createElement('div');
        titleDiv.className = 'kc-evt-title';
        titleDiv.textContent = evt.title || '(無題)';

        var metaDiv = document.createElement('div');
        metaDiv.className = 'kc-evt-meta';
        metaDiv.textContent = seg.fullTimeStr;
        if (evtBgColor) {
          var mTc = evtPerm.textColor
            ? (evtPerm.textColor === '#ffffff' ? 'rgba(255,255,255,0.8)' : '#6b7280')
            : (KC.Lanes.isLightColor(evtBgColor) ? '#6b7280' : 'rgba(255,255,255,0.8)');
          metaDiv.style.color = mTc;
        }

        var topHandle = document.createElement('div');
        topHandle.className = 'kc-resize-handle kc-resize-handle--top';
        var btmHandle = document.createElement('div');
        btmHandle.className = 'kc-resize-handle kc-resize-handle--bottom';

        div.appendChild(topHandle);
        div.appendChild(titleDiv);
        div.appendChild(metaDiv);
        div.appendChild(btmHandle);

        div.title = (evt.title || '') + '\n' + seg.fullTimeStr;

        // クリック → 新規タブで kintone レコード詳細（AC4.6）
        div.addEventListener('click', (function (capturedEvt) {
          return function (clickEvt) {
            clickEvt.stopPropagation();
            KC.Popup.openEdit(capturedEvt.id);
          };
        }(evt)));

        (function (capturedEvt, el) {
          el.addEventListener('mousedown', function (mdEvt) {
            if (mdEvt.button !== 0) return;
            if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
            KC.DnD.startMove(capturedEvt, mdEvt, el, [el]);
          });

          var tHandle = el.querySelector('.kc-resize-handle--top');
          var bHandle = el.querySelector('.kc-resize-handle--bottom');
          if (tHandle) {
            tHandle.addEventListener('mousedown', function (mdEvt) {
              if (mdEvt.button !== 0) return;
              if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
              mdEvt.stopPropagation();
              KC.DnD.startResize(capturedEvt, 'top', mdEvt, el);
            });
          }
          if (bHandle) {
            bHandle.addEventListener('mousedown', function (mdEvt) {
              if (mdEvt.button !== 0) return;
              if (!KC.LoginContext.getPermission(capturedEvt).canEdit) return;
              mdEvt.stopPropagation();
              KC.DnD.startResize(capturedEvt, 'bottom', mdEvt, el);
            });
          }
        }(evt, div));

        overlayDay.appendChild(div);
      });
    }

    /**
     * グリッド描画（ヘッダー + 終日 + 行 + イベント配置）
     * --kc-col-count を 1 にセットして 1 列レイアウトに切替える
     */
    function renderGrid() {
      document.documentElement.style.setProperty('--kc-col-count', '1');
      renderDayHeaders();
      renderAlldayRow();
      renderRows();
      placeEvents();
    }

    /**
     * 完全リフレッシュ（描画 + データ取得）
     */
    async function refresh() {
      document.documentElement.style.setProperty('--kc-col-count', '1');
      KC.RenderShared.renderTimeGutter();
      // KC.Render.renderGrid 経由で呼ぶことで KC.TimeSlots のパッチを通過させる
      KC.Render.renderGrid();

      var range = gridRange();
      var toISO = function (d) {
        var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        return new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString();
      };
      var isoStart = toISO(range.start);
      var isoEnd   = toISO(range.end);  // 翌日 0:00（open-end: dayRange が addDays(start,1) を返す）

      try {
        KC.Banner.hide();
        S.events = await KC.Api.loadEvents(isoStart, isoEnd);
        // P-9: events 更新後は SearchFilter のクエリキャッシュを無効化して次回の _computeMatchList で再スキャンさせる
        KC.SearchFilter._lastQuery = null;
        KC.Render.renderGrid();
        KC.Render.refreshTitle();
      } catch (err) {
        console.error('[KC.RenderDay] loadEvents error:', err);
        var msg;
        if (err && err._isRateLimited) {
          msg = 'アクセスが集中しています。しばらく待ってから再読み込みしてください。';
        } else if (err && err.code === 'GAIA_TM12') {
          msg = 'カーソルの上限に達しました。しばらく待ってから再読み込みしてください。';
        } else {
          msg = 'データの読み込みに失敗しました。再読み込みしてください。';
        }
        KC.Banner.show(msg);
      }
    }

    return {
      refresh:    refresh,
      renderGrid: renderGrid,
      gridRange:  gridRange,
      placeEvents: placeEvents
    };
  }());

  /* ====================================================================
   * KC.Banner — エラー通知バナー（REQ_cursor-error-and-notify §3 FR-2）
   *
   * カレンダー上部に固定表示するシングルトンバナー。
   * loadEvents 失敗時に show()、成功時に hide() を呼ぶ。
   * 再読み込みボタン: KC.Render.refresh() を再実行し、成功したら自動消去。
   * ==================================================================== */
  KC.Banner = {
    /**
     * バナーを表示する（既存バナーがある場合はメッセージだけ更新する）
     * @param {string} message - 表示するエラーメッセージ
     * @param {Object} [opts]
     * @param {boolean} [opts.hideReload=false] - true のとき「再読み込み」ボタンを非表示にする
     */
    show: function (message, opts) {
      var hideReload = opts && opts.hideReload === true;
      var root = document.getElementById('kc-root');
      if (!root) return;

      // シングルトン: 既存バナーを更新する
      var existing = root.querySelector('.kc-error-banner');
      if (existing) {
        var msgEl = existing.querySelector('.kc-error-banner__msg');
        if (msgEl) msgEl.textContent = message;
        return;
      }

      // バナー DOM 構築
      var banner = document.createElement('div');
      banner.className = 'kc-error-banner';
      banner.setAttribute('role', 'alert');

      var msgSpan = document.createElement('span');
      msgSpan.className = 'kc-error-banner__msg';
      msgSpan.textContent = message;
      banner.appendChild(msgSpan);

      var actions = document.createElement('span');
      actions.className = 'kc-error-banner__actions';

      // 「再読み込み」ボタン
      if (!hideReload) {
        var reloadBtn = document.createElement('button');
        reloadBtn.className = 'kc-error-banner__btn kc-error-banner__btn--reload';
        reloadBtn.type = 'button';
        reloadBtn.textContent = '再読み込み';
        reloadBtn.addEventListener('click', function () {
          // in-flight 中は無効（loadEvents が進行中のためスキップ）
          if (KC.Api && KC.Api._loading) return;
          // 連打防止: クリック後 3 秒間ボタンを無効化する
          reloadBtn.disabled = true;
          setTimeout(function () { reloadBtn.disabled = false; }, 3000);
          // _refreshImmediate を直接呼ぶ（debounce を経由せず即座にリロード）
          if (KC.Render && typeof KC.Render._refreshImmediate === 'function') {
            KC.Render._refreshImmediate();
          }
        });
        actions.appendChild(reloadBtn);
      }

      // 「×」閉じるボタン
      var closeBtn = document.createElement('button');
      closeBtn.className = 'kc-error-banner__btn kc-error-banner__btn--close';
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'バナーを閉じる');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function () {
        KC.Banner.hide();
      });
      actions.appendChild(closeBtn);

      banner.appendChild(actions);

      // .kc-root の先頭に挿入する
      root.insertBefore(banner, root.firstChild);
    },

    /** バナーを除去する */
    hide: function () {
      var root = document.getElementById('kc-root');
      if (!root) return;
      var banner = root.querySelector('.kc-error-banner');
      if (banner) banner.parentNode.removeChild(banner);
    }
  };

  /* ====================================================================
   * KC.Render — レンダラーファサード
   * ==================================================================== */
  KC.Render = {
    /**
     * 指定ビューの DOM ルートを表示状態にし、他ビューの DOM ルートを非表示にする。
     * ビュー切替に伴う DOM 表示制御の唯一のエントリポイント。
     * 同一 DOM を共用するビュー (week/day は .kc-grid-wrap 共用) を考慮し、
     * active view の el を識別したうえで、それ以外の el のみ display:'none' を適用する。
     * 2 段階処理: 非表示ループ (active と同じ el はスキップ) → 表示設定。
     * @param {string} viewName - 'week' | 'month' | 'day'
     */
    setActiveView: function (viewName) {
      // VIEW_ROOTS: ビュー名 → { el取得関数, 表示時のdisplay値 } のレジストリ
      // KC.Render はオブジェクトリテラルのため IIFE 化せず、ローカル定数で定義する（C 案）
      // activeDisplay: 表示時に適用する display 値（month は CSS 初期値 none を上書きするため 'flex' を明示）
      var VIEW_ROOTS = {
        week:  { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' },
        month: { el: function () { return document.getElementById('kc-month-root'); }, activeDisplay: 'flex' },
        day:   { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' }
        // 将来ビューを追加する場合はここに 1 エントリ追加するだけで済む
      };
      var activeEntry = VIEW_ROOTS[viewName];
      var activeEl = activeEntry ? activeEntry.el() : null;
      // 非表示ループ: active と同じ要素は触らない (共用 DOM の上書き回避)
      Object.keys(VIEW_ROOTS).forEach(function (v) {
        var el = VIEW_ROOTS[v].el();
        if (!el || el === activeEl) return;
        el.style.display = 'none';
      });
      // 表示設定: active view の el を最後に activeDisplay で明示
      if (activeEl) {
        activeEl.style.display = activeEntry.activeDisplay;
      }
    },

    /** ビューに対応するモジュールを取得 */
    _pickModule: function () {
      var v = KC.State.view || 'week';
      if (v === 'week')  return KC.RenderWeek;
      if (v === 'month') return KC.RenderMonth;
      if (v === 'day')   return KC.RenderDay;
      return KC.RenderWeek;
    },

    /**
     * 共通 refresh 入口（debounce ラッパー）
     * 300ms 以内の連続呼び出しは 1 回に集約し、GET リクエストの連発を防ぐ。
     * モーダル閉じ直後など即時反映が必要な箇所は refresh.immediate() を呼ぶこと。
     */
    refresh: function () {
      var self = this;
      clearTimeout(self._refreshTimer);
      // B-P2: resize debounce（200ms）と統一（従来 300ms）
      self._refreshTimer = setTimeout(function () {
        self._refreshImmediate();
      }, 200);
    },

    /** debounce タイマー（内部管理用） */
    _refreshTimer: null,

    /**
     * refresh の即時実行版。debounce を経由せず直ちに描画・データ取得を行う。
     * 通常の UI イベントからは refresh() を使うこと。
     */
    _refreshImmediate: async function () {
      var root = document.getElementById('kc-root');
      if (!root) return;

      // ビュー切替: 現在の view のみ表示、他を非表示にする（唯一のエントリポイント）
      this.setActiveView(KC.State.view);

      var m = this._pickModule();
      if (m && typeof m.refresh === 'function') {
        await m.refresh();
      } else if (m && typeof m.renderGrid === 'function') {
        m.renderGrid();
      }

      // P-12: REFERENCE_TABLE フィールドが searchTargets にある場合のみ loadRelatedRecords を呼ぶ
      // _hasRefTableTarget が false（REFERENCE_TABLE なし）なら呼び出し自体をスキップして async コストを排除する
      if (KC.SearchFilter._hasRefTableTarget) {
        try {
          await KC.SearchFilter.loadRelatedRecords();
        } catch (err) {
          console.error('[KC Render] loadRelatedRecords 失敗:', err);
        }
        // キャッシュ更新後にフローティング一覧を再構築する
        if (KC.SearchFilter.query) {
          KC.SearchFilter._computeMatchList();
        }
      }

      this.refreshTitle();
      // view 切替後も aria-label が正しい単位を示すよう更新する（REQ_day-view §3.6）
      if (KC.Boot && typeof KC.Boot._updateNavAriaLabels === 'function') {
        KC.Boot._updateNavAriaLabels();
      }
    },

    /** renderGrid ファサード */
    renderGrid: function () {
      var root = document.getElementById('kc-root');
      if (!root) return;
      var m = this._pickModule();
      if (m && typeof m.renderGrid === 'function') {
        m.renderGrid();
      }
      // 月ビュー時は DOM 再生成後に 1 フレーム待ってイベント配置まで連鎖させる（§3.8・§10.1）
      if (KC.State.view === 'month' && KC.RenderMonth) {
        requestAnimationFrame(function () {
          KC.RenderMonth.placeMonthEvents();
          // 月ビューは placeMonthEvents 完了後にフローティング一覧を更新する
          KC.SearchFilter._computeMatchList();
        });
      } else {
        // 週ビュー・日ビューは同期的にフローティング一覧を更新する
        KC.SearchFilter._computeMatchList();
      }
      this.refreshTitle();
    },

    /** 年月ラベル更新 */
    refreshTitle: function () {
      var el = KC.State.els.range || document.getElementById('kc-range-label');
      if (!el) return;

      var date = KC.State.current || new Date();
      var label = this._formatWeekMonthRange(date);
      el.textContent = label;
    },

    /** 表示期間を返す */
    gridRange: function () {
      var m = this._pickModule();
      if (m && typeof m.gridRange === 'function') {
        return m.gridRange();
      }
      // フォールバック
      return KC.RenderWeek.gridRange();
    },

    /** 週の開始〜終了 */
    _weekRange: function (date) {
      var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      var start = d;
      var end = KC.Utils.addDays(start, 6);
      return { start: start, end: end };
    },

    /**
     * ヘッダーラベル生成（view 別分岐）
     * @param {Date} date - 表示基準日
     * @returns {string} ラベル文字列
     */
    _formatWeekMonthRange: function (date) {
      var S = KC.State;
      var p2 = KC.Utils.pad2;

      // 月ビュー: "2026年04月"（ゼロ埋め月）— REQ_month-view §3.11
      if (S.view === 'month') {
        return date.getFullYear() + '年' + p2(date.getMonth() + 1) + '月';
      }

      // 日ビュー: "2026年04月30日(木)" 形式（REQ_day-view §3.7）
      if (S.view === 'day') {
        var DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
        return date.getFullYear() + '年'
          + p2(date.getMonth() + 1) + '月'
          + p2(date.getDate()) + '日'
          + '(' + DAY_LABELS[date.getDay()] + ')';
      }

      // 週ビュー: 既存ロジック維持
      var range = this._weekRange(date);
      var sy = range.start.getFullYear();
      var sm = range.start.getMonth() + 1;
      var ey = range.end.getFullYear();
      var em = range.end.getMonth() + 1;

      if (sy === ey && sm === em) {
        return sy + '年' + p2(sm) + '月';
      }
      if (sy === ey) {
        return sy + '年' + p2(sm) + '月~' + p2(em) + '月';
      }
      return sy + '年' + p2(sm) + '月~' + ey + '年' + p2(em) + '月';
    }
  };

  /* ====================================================================
   * KC.TimeSlots — 30分スロット・終日クリック
   * ==================================================================== */
  KC.TimeSlots = {
    _patched: false,

    /** 列ごとの日付配列を返す */
    _getColumnDates: function (colCount) {
      var S = KC.State;
      var U = KC.Utils;
      var base = S.current || new Date();

      if (S.view === 'week') {
        var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        var res = [];
        for (var i = 0; i < colCount; i++) {
          res.push(U.fmtYMD(U.addDays(d, i)));
        }
        return res;
      }

      // 日ビュー等
      var ymd = U.fmtYMD(base);
      return Array(colCount).fill(ymd);
    },

    /** 30分刻み時間セル追加 */
    buildTimeSlots: function () {
      var S = KC.State;
      // DOM キャッシュが未設定の場合は再取得する（renderRows 未実行時のフォールバック）
      var rows = S.els.rows || document.getElementById('kc-rows');
      if (!rows) return;

      var rowElems = Array.from(rows.children);
      if (!rowElems.length) return;
      var firstRow = rowElems[0];
      var colCount = firstRow.children.length || 0;
      if (!colCount) return;

      var columnDates = this._getColumnDates(colCount);

      rowElems.forEach(function (row, hour) {
        var cells = Array.from(row.children);
        cells.forEach(function (cell, colIdx) {
          var date = columnDates[colIdx];
          if (!date) return;

          // 再描画時の残骸を削除
          cell.querySelectorAll('.kc-time-slot').forEach(function (n) { n.remove(); });

          for (var half = 0; half < 2; half++) {
            var slot = document.createElement('div');
            slot.className = 'kc-time-slot';
            slot.dataset.date = date;
            slot.dataset.hour = String(hour);
            slot.dataset.half = String(half);
            // 個別 click リスナは登録しない（kc-body への event delegation で処理）
            cell.appendChild(slot);
          }
        });
      });

      // kc-body への click 委譲リスナを初回のみ登録する
      // kc-body は _buildGrid で一度だけ生成される安定要素のため renderGrid をまたいで有効
      this._bindDelegation();
    },

    /**
     * kc-body に .kc-time-slot の click 委譲リスナを登録する
     * _delegationBound フラグで多重登録を防ぐ
     */
    _bindDelegation: function () {
      if (this._delegationBound) return;
      var body = document.getElementById('kc-body');
      if (!body) return;
      var self = this;
      body.addEventListener('click', function (e) {
        var slot = e.target.closest('.kc-time-slot');
        if (!slot) return;
        self._onTimeSlotClick(e, slot);
      });
      this._delegationBound = true;
    },

    /** 終日セルにクリックイベント付与（.kc-adbox 廃止につき .kc-adcell に変更） */
    bindAllDayBoxes: function () {
      var self = this;
      var cells = document.querySelectorAll('.kc-adcell');
      cells.forEach(function (cell) {
        if (cell.dataset.kcClickBound === '1') return;
        cell.dataset.kcClickBound = '1';
        cell.addEventListener('click', function (e) { self._onAllDayClick(e); });
      });
    },

    /** 6:30 付近にスクロール */
    scrollToDefaultTime: function () {
      var body = document.getElementById('kc-body');
      var timeCol = document.getElementById('kc-time-col');
      if (!body || !timeCol) return;

      var firstTick = timeCol.querySelector('.kc-time');
      var hourHeight = 60;
      if (firstTick) {
        var rect = firstTick.getBoundingClientRect();
        if (rect.height) hourHeight = rect.height;
      }

      body.scrollTop = hourHeight * 6.5;
    },

    /**
     * 時間セルクリック → ダイアログ表示
     * event delegation 経由で呼ばれるため slot 要素を第2引数で受け取る
     * @param {MouseEvent} e
     * @param {HTMLElement} slot - .kc-time-slot 要素（closest で取得済み）
     */
    _onTimeSlotClick: function (e, slot) {
      e.preventDefault();
      e.stopPropagation();
      var date = slot.dataset.date;
      var hour = Number(slot.dataset.hour || 0);
      var half = Number(slot.dataset.half || 0);
      var minute = half === 0 ? 0 : 30;

      KC.Popup.openCreate({
        date: date,
        hour: hour,
        minute: minute,
        allday: false
      });
    },

    /** 終日セルクリック → ダイアログ表示（.kc-adcell を直接イベント発火元として使用） */
    _onAllDayClick: function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cell = e.currentTarget;
      var date = cell.dataset.date || KC.Utils.fmtYMD(new Date());

      KC.Popup.openCreate({
        date: date,
        allday: true
      });
    },

    /** Render.renderGrid の後処理をパッチ */
    patchRenderGrid: function () {
      if (this._patched) return;
      if (!KC.Render || typeof KC.Render.renderGrid !== 'function') return;

      var original = KC.Render.renderGrid.bind(KC.Render);
      var self = this;

      KC.Render.renderGrid = function () {
        var result = original.apply(KC.Render, arguments);
        // 月ビュー時は週ビュー専用処理をスキップ（REQ_month-view §3.12）
        if (KC.State.view === 'month') return result;
        try {
          self.buildTimeSlots();
          self.bindAllDayBoxes();
          self.scrollToDefaultTime();
          // FR-8: デフォルトスクロール位置（6:30 付近）を URL ハッシュに同期する（replaceState）
          // 初回描画時のデフォルト位置として記録する。ユーザースクロール後はイベントリスナーが上書きする
          if (KC.UrlState) {
            var bodyEl = document.getElementById('kc-body');
            if (bodyEl) {
              var timeColEl = document.getElementById('kc-time-col');
              var hh = 60;
              if (timeColEl) {
                var ft = timeColEl.querySelector('.kc-time');
                if (ft) { var rc = ft.getBoundingClientRect(); if (rc.height) hh = rc.height; }
              }
              var totalMin = Math.round((bodyEl.scrollTop / hh) * 60);
              var hVal = Math.floor(totalMin / 60);
              var mVal = totalMin % 60;
              if (hVal > 23) hVal = 23;
              var scrollStr = KC.Utils.pad2(hVal) + ':' + KC.Utils.pad2(mVal);
              KC.UrlState.update('scroll', scrollStr);
            }
          }
        } catch (err) {
          console.error('[KC.TimeSlots] decorate error', err);
        }
        return result;
      };

      this._patched = true;
    }
  };

  /* ====================================================================
   * KC.MonthOverflowPopup — 月ビュー +N more ポップオーバー
   * +N more クリックで非表示予定をフローティングポップオーバーに一覧表示する
   * ==================================================================== */
  KC.MonthOverflowPopup = (function () {
    // 現在表示中のポップオーバー要素（null = 非表示）
    var _popupEl = null;
    // 現在表示中の日付 YMD（同日トグル判定用）
    var _anchorYMD = null;
    // リサイズリスナー参照（close 時に解除）
    var _onResize = null;
    // 外側クリックリスナー参照（close 時に解除）
    var _onDocClick = null;
    // ESC キーリスナー参照（close 時に解除）
    var _onKeydown = null;
    // リサイズ debounce タイマー（close 時にクリア可能なようモジュールスコープに置く）
    var _resizeTimer = null;
    // .kc-month-more 要素 → 非表示予定配列 のマッピング（WeakMap: 要素 GC 時に自動解放）
    var _hiddenEventsMap = new WeakMap();
    // 委譲リスナーを登録済みの document 集合（WeakSet: document 破棄時に entry が自動解放される）
    var _boundDocs = new WeakSet();
    // open() 時に登録した document / window の参照（close() で同じオブジェクトから remove するために保持）
    var _listenerDoc = null;
    var _listenerWin = null;

    /**
     * 'YYYY-MM-DD' を「水, 5月28日」形式に変換する
     * @param {string} dateYMD
     * @returns {string}
     */
    function _formatDateHeader(dateYMD) {
      var parts = dateYMD.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var days = ['日', '月', '火', '水', '木', '金', '土'];
      var dow = days[d.getDay()];
      return dow + ', ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    /**
     * Date オブジェクトを「HH:MM」形式に変換する
     * @param {Date} dateObj
     * @returns {string}
     */
    function _formatTime(dateObj) {
      var h = dateObj.getHours();
      var m = dateObj.getMinutes();
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    /**
     * 期間ラベル「5/26 – 5/30」を生成する（同年なら年省略、年跨ぎ時のみ年表示）
     * @param {string} startYMD - 'YYYY-MM-DD'
     * @param {string} endYMD   - 'YYYY-MM-DD'
     * @returns {string}
     */
    function _formatSpanLabel(startYMD, endYMD) {
      var sp = startYMD.split('-');
      var ep = endYMD.split('-');
      var sy = parseInt(sp[0], 10);
      var ey = parseInt(ep[0], 10);
      var sm = parseInt(sp[1], 10);
      var em = parseInt(ep[1], 10);
      var sd = parseInt(sp[2], 10);
      var ed = parseInt(ep[2], 10);
      var startStr = (sy !== ey) ? (sy + '/' + sm + '/' + sd) : (sm + '/' + sd);
      var endStr   = (sy !== ey) ? (ey + '/' + em + '/' + ed) : (em + '/' + ed);
      return startStr + ' – ' + endStr;
    }

    /**
     * イベントの予定色を返す（KC.Config 互換）
     * @param {Object} evt - KcEvent オブジェクト
     * @returns {string} CSS カラー文字列
     */
    function _getEventColor(evt) {
      var perm = KC.LoginContext && typeof KC.LoginContext.getPermission === 'function'
        ? KC.LoginContext.getPermission(evt)
        : null;
      if (perm && perm.bgColor) return perm.bgColor;
      return evt.color || '#4285f4';
    }

    /**
     * ポップオーバーの DOM ツリーを生成して返す
     * @param {string} dateYMD
     * @param {Array}  eventsList - 非表示予定オブジェクト配列（終日・時間予定混在）
     * @returns {HTMLElement}
     */
    function _buildDOM(dateYMD, eventsList) {
      var popup = document.createElement('div');
      popup.className = 'kc-month-overflow-popup';
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-modal', 'false');
      popup.setAttribute('aria-labelledby', 'kc-mop-header-label');

      // ヘッダー
      var header = document.createElement('div');
      header.className = 'kc-month-overflow-header';

      var headerLabel = document.createElement('span');
      headerLabel.className = 'kc-month-overflow-header-label';
      headerLabel.id = 'kc-mop-header-label';
      headerLabel.textContent = _formatDateHeader(dateYMD);

      var closeBtn = document.createElement('button');
      closeBtn.className = 'kc-month-overflow-close';
      closeBtn.setAttribute('aria-label', '閉じる');
      closeBtn.textContent = '×';

      header.appendChild(headerLabel);
      header.appendChild(closeBtn);
      popup.appendChild(header);

      // 予定一覧
      var list = document.createElement('div');
      list.className = 'kc-month-overflow-list';

      // 終日 → 時間順に並べる（要件 §3.2）
      var alldayEvents = eventsList.filter(function (e) { return e.allday; });
      var timedEvents  = eventsList.filter(function (e) { return !e.allday; });
      timedEvents.sort(function (a, b) {
        return (a.start < b.start) ? -1 : (a.start > b.start) ? 1 : 0;
      });

      alldayEvents.forEach(function (evt) {
        var item = document.createElement('div');
        item.className = 'kc-month-overflow-item kc-month-overflow-item--allday';

        var bar = document.createElement('div');
        bar.className = 'kc-month-overflow-bar';
        bar.style.backgroundColor = _getEventColor(evt);

        // 期間ラベルをバー内 1 行に統合する。
        // kintone 終日予定の end は「翌日 0 時」で格納されるため、表示用終了日は end-1日。
        // 単日（start 日 = end-1日）の場合は期間を付けずタイトルのみ表示する。
        var startDate = new Date(evt.start);
        var endRaw    = new Date(evt.end);
        var endDate   = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate() - 1);
        var startYMD  = KC.Utils.fmtYMD(startDate);
        var endYMD    = KC.Utils.fmtYMD(endDate);
        if (startYMD !== endYMD) {
          // 複数日: title と date を 2 span に分割して flex レイアウト（CSS で省略・固定を制御）
          // 形式: 「タイトル M/D – M/D」（括弧なし・スペース区切り）
          var titleSpan = document.createElement('span');
          titleSpan.className = 'kc-month-overflow-bar-title';
          titleSpan.textContent = evt.title || '(無題)';
          var dateSpan = document.createElement('span');
          dateSpan.className = 'kc-month-overflow-bar-date';
          dateSpan.textContent = _formatSpanLabel(startYMD, endYMD);
          bar.appendChild(titleSpan);
          bar.appendChild(dateSpan);
        } else {
          // 単日: タイトルのみ（span 不使用、textContent で直接設定）
          bar.textContent = evt.title || '(無題)';
        }
        item.appendChild(bar);

        item.addEventListener('click', function (e) {
          e.stopPropagation();
          close();
          KC.Popup.openEdit(evt.id);
        });

        list.appendChild(item);
      });

      timedEvents.forEach(function (evt) {
        var item = document.createElement('div');
        item.className = 'kc-month-overflow-item kc-month-overflow-item--timed';

        var dot = document.createElement('span');
        dot.className = 'kc-month-overflow-dot';
        dot.style.backgroundColor = _getEventColor(evt);

        var timeSpan = document.createElement('span');
        timeSpan.className = 'kc-month-overflow-time';
        timeSpan.textContent = _formatTime(new Date(evt.start));

        var titleSpan = document.createElement('span');
        titleSpan.className = 'kc-month-overflow-title';
        titleSpan.textContent = evt.title || '(無題)';

        item.appendChild(dot);
        item.appendChild(timeSpan);
        item.appendChild(titleSpan);

        item.addEventListener('click', function (e) {
          e.stopPropagation();
          close();
          KC.Popup.openEdit(evt.id);
        });

        list.appendChild(item);
      });

      popup.appendChild(list);

      // ヘッダーラベルクリック: 日ビューへ遷移
      headerLabel.addEventListener('click', function (e) {
        e.stopPropagation();
        close();
        var parts = dateYMD.split('-');
        KC.State.current = new Date(
          parseInt(parts[0], 10),
          parseInt(parts[1], 10) - 1,
          parseInt(parts[2], 10)
        );
        KC.State.view = 'day';
        KC.Render.refresh();
      });

      // × ボタンクリック
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        close();
      });

      return popup;
    }

    /**
     * アンカー要素の位置からポップオーバーの top/left を計算する
     * flip → clamp → 中央フォールバック の順で処理する
     * @param {HTMLElement} anchorEl
     * @param {HTMLElement} popupEl
     * @returns {{ top: number, left: number, fallback: boolean }}
     */
    function _calcPosition(anchorEl, popupEl) {
      try {
        var ar = anchorEl.getBoundingClientRect();
        var ownerWin = (anchorEl && anchorEl.ownerDocument && anchorEl.ownerDocument.defaultView) || window;
        var vw = ownerWin.innerWidth;
        var vh = ownerWin.innerHeight;
        var pw = popupEl.offsetWidth  || 320;
        var ph = popupEl.offsetHeight || 200;
        var MARGIN = 4;

        // デフォルト: アンカー直下
        var top  = ar.bottom + MARGIN;
        var left = ar.left;

        // 右端 flip
        if (left + pw > vw - MARGIN) {
          left = ar.right - pw;
        }

        // 下端 flip
        if (top + ph > vh - MARGIN) {
          top = ar.top - ph - MARGIN;
        }

        // clamp
        if (left < MARGIN) left = MARGIN;
        if (left + pw > vw - MARGIN) left = vw - pw - MARGIN;
        if (top < MARGIN) top = MARGIN;
        if (top + ph > vh - MARGIN) top = vh - ph - MARGIN;

        // 中央フォールバック: clamp 後もはみ出す場合
        var tooWide = pw > vw - MARGIN * 2;
        var tooTall = ph > vh - MARGIN * 2;
        if (tooWide || tooTall) {
          return { fallback: true };
        }

        return { top: top, left: left, fallback: false };
      } catch (err) {
        return { fallback: true };
      }
    }

    /**
     * 計算した位置をポップオーバーに適用する（中央フォールバック含む）
     * @param {HTMLElement} anchorEl
     */
    function _applyPosition(anchorEl) {
      if (!_popupEl) return;
      var pos = _calcPosition(anchorEl, _popupEl);
      if (pos.fallback) {
        _popupEl.style.top  = '50%';
        _popupEl.style.left = '50%';
        _popupEl.style.transform = 'translate(-50%, -50%)';
      } else {
        _popupEl.style.top  = pos.top  + 'px';
        _popupEl.style.left = pos.left + 'px';
        _popupEl.style.transform = '';
      }
    }

    /**
     * .kc-month-more 要素と非表示予定配列を WeakMap に登録し、
     * document への capture phase 委譲リスナーを初回のみ設定する
     * @param {HTMLElement} moreEl       - .kc-month-more 要素
     * @param {Array}       hiddenEvents - 非表示予定オブジェクト配列
     */
    function registerHiddenEvents(moreEl, hiddenEvents) {
      _hiddenEventsMap.set(moreEl, hiddenEvents);
      _bindDocDelegateOnce(moreEl);
    }

    /**
     * document への capture phase クリック委譲リスナーを 1 回だけ登録する
     * 拡張機能が .kc-month-more の直接リスナーを消しても、
     * document 側のリスナーは消えないため影響を受けない
     * 全画面表示時は anchorEl.ownerDocument 経由で正しい document を取得する
     * @param {HTMLElement} referenceEl - ownerDocument 取得に使う参照要素
     */
    function _bindDocDelegateOnce(referenceEl) {
      var doc = (referenceEl && referenceEl.ownerDocument) || document;
      if (_boundDocs.has(doc)) return;
      _boundDocs.add(doc);
      doc.addEventListener('click', _onDocClickDelegate, true); // capture phase
    }

    /**
     * document の capture phase クリックハンドラ（委譲）
     * .kc-month-more がクリックされた場合のみ open を呼ぶ
     * @param {MouseEvent} e
     */
    function _onDocClickDelegate(e) {
      var moreEl = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('.kc-month-more')
        : null;
      if (!moreEl) return;
      e.stopPropagation();
      e.preventDefault();
      var cellEl = moreEl.parentElement;
      var ymd = cellEl ? cellEl.dataset.date : null;
      var hiddenEvents = _hiddenEventsMap.get(moreEl) || [];
      if (ymd) open(moreEl, ymd, hiddenEvents);
    }

    /**
     * ESC / 外側クリック / リサイズ の各イベントリスナーを設定する
     * 全画面表示時は anchorEl.ownerDocument / defaultView 経由で正しい context に登録する
     * @param {HTMLElement} anchorEl
     */
    function _bindEvents(anchorEl) {
      _onKeydown = function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          close();
        }
      };

      // 外側クリック: ポップオーバー内クリックは stopPropagation で到達しない
      _onDocClick = function () {
        close();
      };

      _onResize = function () {
        // debounce 100ms
        if (_resizeTimer) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          if (_popupEl && _anchorYMD) _applyPosition(anchorEl);
        }, 100);
      };

      _listenerDoc.addEventListener('keydown', _onKeydown);
      _listenerDoc.addEventListener('click', _onDocClick);
      _listenerWin.addEventListener('resize', _onResize);
    }

    /**
     * ポップオーバーを開く
     * @param {HTMLElement} anchorEl  - .kc-month-more 要素
     * @param {string}      dateYMD   - 'YYYY-MM-DD'
     * @param {Array}       eventsList - 非表示予定オブジェクト配列
     */
    function open(anchorEl, dateYMD, eventsList) {
      // 同日再クリック: トグル（閉じる）
      if (_anchorYMD === dateYMD) {
        close();
        return;
      }

      // 別日クリック: 既存を閉じる
      close();

      var popup = _buildDOM(dateYMD, eventsList);
      // ポップオーバー内クリックが外側クリックハンドラに到達しないよう伝播を止める
      popup.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      // 全画面表示時は anchorEl.ownerDocument / defaultView 経由で正しい context を取得する
      _listenerDoc = (anchorEl && anchorEl.ownerDocument) || document;
      _listenerWin = _listenerDoc.defaultView || window;
      _listenerDoc.body.appendChild(popup);
      _popupEl    = popup;
      _anchorYMD  = dateYMD;

      // FR-6: +N more ポップオーバーオープンを URL ハッシュに記録（pushState）
      // URL に既に同値が載っている場合はスキップ（リロード復元・popstate 進む の二重化防止）
      if (KC.UrlState && KC.UrlState.get('more') !== dateYMD) {
        KC.UrlState.push('more', dateYMD);
      }

      // DOM に追加してから位置計算（offsetWidth/Height が確定するため）
      _applyPosition(anchorEl);
      _bindEvents(anchorEl);
    }

    /**
     * ポップオーバーを閉じる（冪等: 既に閉じていても安全）
     */
    function close() {
      if (!_popupEl) return;

      if (_popupEl.parentNode) {
        _popupEl.parentNode.removeChild(_popupEl);
      }
      _popupEl   = null;
      _anchorYMD = null;

      // FR-6: +N more クローズ時に more パラメータを URL から除去する（replaceState）
      // ESC / 外側クリック / リサイズ / 同日トグル すべての経路で close() を経由するため網羅済み
      if (KC.UrlState) KC.UrlState.remove('more');

      if (_listenerDoc) {
        if (_onKeydown)  { _listenerDoc.removeEventListener('keydown', _onKeydown); }
        if (_onDocClick) { _listenerDoc.removeEventListener('click', _onDocClick); }
      }
      if (_listenerWin) {
        if (_onResize)   { _listenerWin.removeEventListener('resize', _onResize); }
      }
      _onKeydown  = null;
      _onDocClick = null;
      _onResize   = null;
      _listenerDoc = null;
      _listenerWin = null;
      if (_resizeTimer) { clearTimeout(_resizeTimer); _resizeTimer = null; }
    }

    /**
     * .kc-month-more 要素に紐付く非表示予定配列を返す（URL 復元時の more 復元に使用）
     * WeakMap に登録されていない場合は空配列を返す
     * @param {HTMLElement} moreEl
     * @returns {Array}
     */
    function getHiddenEvents(moreEl) {
      return _hiddenEventsMap.get(moreEl) || [];
    }

    /**
     * ポップオーバーが現在開いているかを返す
     * @returns {boolean}
     */
    function isOpen() {
      return !!_popupEl;
    }

    return {
      open:                open,
      close:               close,
      isOpen:              isOpen,
      registerHiddenEvents: registerHiddenEvents,
      getHiddenEvents:     getHiddenEvents
    };
  }());

  /* ====================================================================
   * KC.EventFilter — イベントフィルタリングユーティリティ
   * KC.State.eventFilter の値に基づいてイベント配列を絞り込む
   * ==================================================================== */
  KC.EventFilter = {
    /**
     * KC.State.eventFilter に基づいてイベント配列を絞り込む
     * - 'all': 全件返す
     * - 'mine': 自分のイベントのみ（いずれかのルールにマッチ = color が null でない）
     * - 'others': 他人のイベントのみ（いずれのルールにもマッチしない = color が null）
     * @param {Array} events - KcEvent 配列
     * @returns {Array} フィルタ済み配列
     */
    apply: function (events) {
      var filter = KC.State.eventFilter || 'all';
      if (filter === 'mine') {
        // bgColor が null でない（いずれかのルールにマッチ）= 自分の予定として扱う（§5.9）
        return events.filter(function (e) { return KC.LoginContext.getPermission(e).bgColor !== null; });
      }
      if (filter === 'others') {
        // bgColor が null の予定（マッチなし）を「他人扱い」として表示（§5.9）
        return events.filter(function (e) { return KC.LoginContext.getPermission(e).bgColor === null; });
      }
      return events;  // 'all': フィルタなし
    }
  };

  /* ====================================================================
   * KC.SearchFilter — 検索欄フィルタ（Phase 2: REQ_search-bar v3）
   * ヘッダー右側に検索入力欄を追加し、タイトル + 追加フィールドのキーワードで予定を絞り込む
   * ==================================================================== */
  KC.SearchFilter = {
    /** 現在の検索クエリ（空文字 = 無効） */
    query: '',
    /** デバウンス用タイマーID */
    _timer: null,
    /** IME 入力中フラグ（compositionstart〜compositionend 間は true） */
    _composing: false,
    /** アクティブ候補の index（-1 = 未選択） */
    activeIndex: -1,
    /** 現在のマッチ候補 KcEvent オブジェクト配列（開始日時昇順） */
    _matchList: [],
    /** document 外側クリックリスナー登録済みフラグ（多重登録防止） */
    _outsideClickBound: false,

    // Phase 2 追加プロパティ
    /** 関連レコードキャッシュ: { [fieldCode]: { [recordId]: kintoneRecord } } */
    _relatedRecordsCache: {},
    /**
     * P-6: 関連レコード最終取得タイムスタンプ (Date.now() ms)。
     * 0 = 未取得（強制再取得）。TTL_MS 以内の場合は再取得をスキップする。
     */
    _relatedRecordsFetchedAt: 0,
    /** プラグイン設定から読み込んだ検索対象フィールド一覧 */
    _searchTargets: [],
    /**
     * P-12: _searchTargets に REFERENCE_TABLE 型が存在するかを示すフラグ。
     * false の場合は _refreshImmediate での loadRelatedRecords 呼び出し自体をスキップする。
     */
    _hasRefTableTarget: false,
    /** REFERENCE_TABLE フィールド定義キャッシュ: { [fieldCode]: { appId, displayFields } } */
    _refTableDefs: {},
    /** _loadRefTableDefs 完了フラグ（二重取得防止） */
    _refTableDefsLoaded: false,
    /** matchField で一度 warn 済みのフィールドコード（コンソール汚染防止: 初回のみ出力） */
    _warnedFields: new Set(),
    /**
     * P-9: _computeMatchList のクエリキャッシュ。
     * _lastQuery と KC.State.events が変化していない場合は全スキャンをスキップして _lastMatchList を返す。
     * KC.Api.loadEvents 完了後（events が更新された時）は _lastQuery をリセットして強制再計算する。
     */
    _lastQuery: null,
    _lastMatchList: [],

    /**
     * kintone.api のエラーオブジェクトを診断可能な文字列に変換する。
     * kintone REST API エラーは err.message が空で err.code / err.id / err.errors に
     * 情報が入るパターンが多いため、これらを明示的に出力する。
     * @param {unknown} err - catch で受け取ったエラー値
     * @returns {string}
     */
    _fmtErr: function (err) {
      if (!err) return String(err);
      var parts = [];
      if (err.code)    parts.push('code=' + err.code);
      if (err.id)      parts.push('id=' + err.id);
      if (err.message) parts.push('message=' + err.message);
      if (err.errors) {
        try { parts.push('errors=' + JSON.stringify(err.errors)); } catch (e) {}
      }
      if (parts.length > 0) return parts.join(', ');
      // code/id/message/errors のいずれもない場合は JSON 全体を出力する
      try { return JSON.stringify(err); } catch (e) {}
      return String(err);
    },

    /**
     * 検索クエリを設定し、再描画をトリガーする
     * @param {string} q - 新しいクエリ
     */
    setQuery: function (q) {
      this.query = q;
      this._syncClearBtn(q);
      this.activeIndex = -1;
      // FR-3: 検索クエリを URL ハッシュに同期する（replaceState）
      // searchTargets が空（検索バー非表示）の場合は q パラメータを除去する
      if (KC.UrlState) {
        if (q && this._searchTargets && this._searchTargets.length > 0) {
          KC.UrlState.update('q', q);
        } else {
          KC.UrlState.remove('q');
        }
      }
      KC.Render.renderGrid();
    },

    /**
     * events 配列をそのまま返す（カレンダー表示はフィルタしない）。
     * マッチ結果はフローティング一覧（#kc-search-dropdown）のみで表示するため、
     * カレンダー DOM への予定配置は変更しない。
     * @param {Array} events - KcEvent 配列
     * @returns {Array} 入力をそのまま返す
     */
    apply: function (events) {
      return events;
    },

    /**
     * クエリを半角/全角スペースで分割してトークン配列を返す
     * @returns {string[]}
     */
    _getTokens: function () {
      return this.query.trim().toLowerCase()
        .split(/[\s　]+/)
        .filter(function (t) { return t !== ''; });
    },

    /**
     * kintone レコードの指定フィールドから検索対象テキストを取得する（Phase 2 新規）
     * フィールド型に応じて以下のように処理する:
     *   - SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT: value をそのまま返す
     *   - USER_SELECT: 各エントリの name と code を結合して返す（OR 検索対応）
     *   - REFERENCE_TABLE: _relatedRecordsCache から該当レコードの displayFields 値を結合して返す
     * @param {Object} record - kintone 元レコードオブジェクト
     * @param {string} fieldCode - フィールドコード
     * @returns {string} 検索対象文字列
     */
    matchField: function (record, fieldCode) {
      var field = record[fieldCode];
      if (!field) {
        if (!this._warnedFields.has(fieldCode)) {
          this._warnedFields.add(fieldCode);
          console.warn('[KC.SearchFilter] searchTargets フィールド未存在: ' + fieldCode);
        }
        return '';
      }

      if (field.type === 'USER_SELECT') {
        if (!Array.isArray(field.value) || field.value.length === 0) return '';
        return field.value.map(function (u) {
          return (u.name || '') + ' ' + (u.code || '');
        }).join(' ');
      }

      if (field.type === 'REFERENCE_TABLE') {
        var def = this._refTableDefs[fieldCode];
        if (!def || !def.displayFields || def.displayFields.length === 0) return '';
        var cache = this._relatedRecordsCache[fieldCode];
        if (!cache) return '';

        var rows = field.value || [];
        return rows.map(function (row) {
          var rowRecord = row.record;
          if (!rowRecord || !rowRecord.$id) return '';
          var relRecord = cache[rowRecord.$id.value];
          if (!relRecord) return '';
          return def.displayFields.map(function (df) {
            var f = relRecord[df.fieldCode];
            return f ? (f.value || '') : '';
          }).join(' ');
        }).join(' ');
      }

      // SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / LOOKUP (元フィールド型) 等
      return field.value || '';
    },

    /**
     * 1件の予定が全トークンにマッチするか判定する（フィールド間 OR、トークン間 AND）（Phase 2 更新）
     * searchTargets に設定されたフィールドのいずれかにトークンが含まれれば一致とする。
     * タイトルフィールドは searchTargets に含まれていれば対象になる（暗黙的な特別扱いを廃止）。
     * searchTargets が空の場合は何もマッチしない（検索無効化に近い動作）。
     * @param {Object} evt - KcEvent（record プロパティで元の kintone レコードを参照）
     * @param {string[]} tokens
     * @returns {boolean}
     */
    _matchesTokens: function (evt, tokens) {
      var self = this;

      // searchTargets が空 = 検索対象なし → 何もマッチしない
      if (self._searchTargets.length === 0) return false;

      // searchTargets の各フィールドテキストを収集する
      var fieldTexts = [];
      self._searchTargets.forEach(function (target) {
        if (!evt.record) return;
        var text = self.matchField(evt.record, target.fieldCode);
        fieldTexts.push(text.toLowerCase());
      });

      // トークン間 AND、フィールド間 OR
      return tokens.every(function (token) {
        return fieldTexts.some(function (text) {
          return text.indexOf(token) !== -1;
        });
      });
    },

    /**
     * クエリが空または該当予定かどうかを判定する（単体チェック用）
     * @param {Object} evt - KcEvent
     * @returns {boolean}
     */
    _matches: function (evt) {
      if (!this.query) return true;
      var tokens = this._getTokens();
      if (tokens.length === 0) return true;
      return this._matchesTokens(evt, tokens);
    },

    /**
     * /k/v1/app/form/fields.json から REFERENCE_TABLE フィールド定義を取得して _refTableDefs に格納する
     * searchTargets に REFERENCE_TABLE が含まれる場合に呼ばれる
     * @returns {Promise<void>}
     */
    /**
     * P-2: properties を引数として受け取れるようにする。
     * detectFields が返した resp.properties を渡せば API 呼び出しを省略できる。
     * @param {Object|null} [existingProps] - 既に取得済みの resp.properties。null/undefined なら API を叩く
     */
    _loadRefTableDefs: async function (existingProps) {
      if (this._refTableDefsLoaded) return;

      if (this._searchTargets.length === 0) {
        this._refTableDefsLoaded = true;
        return;
      }

      try {
        var props;
        if (existingProps) {
          // P-2: detectFields から渡された properties を再利用（API 呼び出し不要）
          props = existingProps;
        } else {
          var resp = await kintone.api(
            kintone.api.url('/k/v1/app/form/fields', true),
            'GET',
            { app: kintone.app.getId() }
          );
          props = resp.properties || {};
        }

        this._refTableDefs = {};
        Object.keys(props).forEach(function (code) {
          var field = props[code];
          if (field.type !== 'REFERENCE_TABLE') return;
          var refTable = field.referenceTable;
          if (!refTable) return;
          // displayFields の fieldCode が空文字 / null のエントリを除去する（カーソル作成時の CB_VA01 対策）
          var displayFields = Array.isArray(refTable.displayFields)
            ? refTable.displayFields.filter(function (df) { return df && df.fieldCode; })
            : [];
          this._refTableDefs[code] = {
            appId: refTable.relatedApp && refTable.relatedApp.app
              ? String(refTable.relatedApp.app)
              : null,
            displayFields: displayFields
          };
        }.bind(this));

        this._refTableDefsLoaded = true;
        _log('[KC SearchFilter] _refTableDefs 取得完了:', this._refTableDefs);
      } catch (err) {
        console.error('[KC SearchFilter] フィールド定義取得失敗: ' + this._fmtErr(err));
        this._refTableDefsLoaded = true;
      }
    },

    /**
     * 全 REFERENCE_TABLE フィールドの関連先レコードをカーソル API で一括取得してキャッシュする
     * - 権限のない関連先アプリは除外して警告ログを出力する（AC-P2-8）
     * - ビュー切替・月送り時にも呼び出す（FR-15）
     * - P-6: TTL 5 分以内の場合は再取得をスキップする（_relatedRecordsFetchedAt で管理）
     *   保存後は _invalidateRelatedRecordsCache() でタイムスタンプをリセットして強制再取得する
     * @param {boolean} [force] - true の場合は TTL を無視して強制再取得する
     * @returns {Promise<void>}
     */
    loadRelatedRecords: async function (force) {
      // P-6: TTL チェック（5 分 = 300,000ms）
      var TTL_MS = 5 * 60 * 1000;
      if (!force && this._relatedRecordsFetchedAt > 0) {
        var elapsed = Date.now() - this._relatedRecordsFetchedAt;
        if (elapsed < TTL_MS) return; // TTL 内なのでキャッシュを再利用
      }

      // searchTargets のうち REFERENCE_TABLE 型のフィールドを特定する
      var refTargets = this._searchTargets.filter(function (t) {
        var def = this._refTableDefs[t.fieldCode];
        return def && def.appId && def.displayFields.length > 0;
      }.bind(this));

      if (refTargets.length === 0) {
        this._relatedRecordsFetchedAt = Date.now(); // 空でも fetch 済みとして記録
        return;
      }

      // 最大 10 並列（kintone レート制限考慮）でチャンク処理
      var CHUNK_SIZE = 10;
      var self = this;

      for (var i = 0; i < refTargets.length; i += CHUNK_SIZE) {
        var chunk = refTargets.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(function (target) {
          return self._fetchAllRelatedRecords(target.fieldCode);
        }));
      }

      // P-6: 取得完了タイムスタンプを記録
      this._relatedRecordsFetchedAt = Date.now();
    },

    /**
     * P-6: 関連レコードキャッシュを無効化する（TTL をリセットして次回呼び出し時に強制再取得させる）。
     * レコード保存後（KC.Popup の保存検知時）に呼び出すこと。
     */
    _invalidateRelatedRecordsCache: function () {
      this._relatedRecordsFetchedAt = 0;
    },

    /**
     * 指定 REFERENCE_TABLE フィールドの関連先アプリの全レコードをカーソル API で取得する
     * @param {string} fieldCode - REFERENCE_TABLE フィールドコード
     * @returns {Promise<void>}
     */
    _fetchAllRelatedRecords: async function (fieldCode) {
      var def = this._refTableDefs[fieldCode];
      if (!def || !def.appId) return;

      var cursorId = null;
      var records = [];

      try {
        // カーソル作成
        var createResp = await kintone.api(
          kintone.api.url('/k/v1/records/cursor', true),
          'POST',
          {
            app: def.appId,
            size: 500,
            // .filter(Boolean) で万一空文字・null が混入しても CB_VA01 エラーを防ぐ（二重防御）
            fields: def.displayFields.map(function (df) { return df.fieldCode; }).concat(['$id']).filter(Boolean)
          }
        );
        cursorId = createResp.id;

        // 全件取得（ページング）
        while (true) {
          var fetchResp = await kintone.api(
            kintone.api.url('/k/v1/records/cursor', true),
            'GET',
            { id: cursorId }
          );
          records = records.concat(fetchResp.records);
          if (!fetchResp.next) break;
        }

        // Record ID をキーにしたマップとして格納する
        var recordMap = {};
        records.forEach(function (r) {
          var id = r.$id && r.$id.value;
          if (id) recordMap[String(id)] = r;
        });
        this._relatedRecordsCache[fieldCode] = recordMap;
        _log('[KC SearchFilter] ' + fieldCode + ' 関連レコード取得完了: ' + records.length + '件');

        // カーソルは取得完了後に自動破棄されるが、明示的に DELETE して確実にリソース解放する
        // next=false で終了後は API が既に破棄済みのため 404 が返る可能性がある点に注意
        try {
          await kintone.api(kintone.api.url('/k/v1/records/cursor', true), 'DELETE', { id: cursorId });
        } catch (delErr) {
          // DELETE 失敗はキャッシュ側に影響しないため警告のみ
          console.warn('[KC.SearchFilter] カーソル DELETE 失敗（取得は成功）: ' + this._fmtErr(delErr));
        }
      } catch (err) {
        console.warn('[KC SearchFilter] REFERENCE_TABLE "' + fieldCode + '" のキャッシュ取得失敗: ' + this._fmtErr(err));
        // 失敗した場合はキャッシュを空にして、そのフィールドを検索対象外とする
        this._relatedRecordsCache[fieldCode] = {};
        // カーソルが残存している場合は破棄を試みる
        if (cursorId) {
          try {
            await kintone.api(
              kintone.api.url('/k/v1/records/cursor', true),
              'DELETE',
              { id: cursorId }
            );
          } catch (delErr) {
            // 既に破棄済みの場合は無視する
          }
        }
      }
    },

    /**
     * KC.State.events をスキャンしてマッチ候補 KcEvent 配列を構築し、
     * フローティング一覧（#kc-search-dropdown）を更新する。
     * カレンダー DOM（.kc-event 等）には一切手を加えない。
     * P-9: クエリが変化していない場合（_lastQuery と一致）は全スキャンをスキップして
     * キャッシュ済み _lastMatchList を使用する。
     * loadEvents 完了後は _lastQuery をリセットして強制再計算させること（loadEvents 呼び出し元で実施）。
     */
    _computeMatchList: function () {
      if (!this.query) {
        this._matchList = [];
        this._lastQuery = null; // キャッシュを無効化（クエリ空の場合は次回必ず再計算）
        this.activeIndex = -1;
        this._updateEmptyMsg(false, '');
        // B-P4: クエリ空の場合は _renderDropdown 不要（ドロップダウンは非表示のはず）
        // ただし既存挙動を維持するため _renderDropdown は呼ぶ
        this._renderDropdown();
        return;
      }

      var tokens = this._getTokens();

      if (tokens.length === 0) {
        this._matchList = [];
        this._lastQuery = null;
        this._updateEmptyMsg(false, '');
        this._renderDropdown();
        return;
      }

      // P-9: 同一クエリかつ events が変化していない（_lastQuery が一致）ならキャッシュを返す
      if (this._lastQuery === this.query && this._lastMatchList !== null) {
        // キャッシュ済み matchList をそのまま使用（_matchList に同期）
        this._matchList = this._lastMatchList;
        var cachedCount = this._matchList.length;
        this._updateEmptyMsg(cachedCount === 0, this.query);
        if (cachedCount === 0) {
          this.activeIndex = -1;
        } else if (this.activeIndex < 0 || this.activeIndex >= cachedCount) {
          this.activeIndex = 0;
        }
        this._renderDropdown();
        this._updateDropdownActive();
        return;
      }

      var self = this;
      var events = KC.State.events || [];

      // マッチする KcEvent を収集して開始日時昇順にソートする
      var matched = events.filter(function (evt) {
        return self._matchesTokens(evt, tokens);
      });
      matched.sort(function (a, b) {
        var ta = a.start ? new Date(a.start).getTime() : 0;
        var tb = b.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      });

      this._matchList = matched;
      // P-9: キャッシュを更新
      this._lastQuery = this.query;
      this._lastMatchList = matched;

      var count = matched.length;
      this._updateEmptyMsg(count === 0, this.query);

      if (count === 0) {
        this.activeIndex = -1;
      } else if (this.activeIndex < 0 || this.activeIndex >= count) {
        this.activeIndex = 0;
      }

      this._renderDropdown();
      this._updateDropdownActive();
    },

    /**
     * activeIndex を変更してフローティング一覧のアクティブ行を切り替える。
     * @param {number} newIndex - 新しい activeIndex
     */
    _activateAt: function (newIndex) {
      var count = this._matchList.length;
      if (count === 0) return;
      this.activeIndex = newIndex;
      this._updateDropdownActive();
    },

    /** ↓ キー押下時: フローティング一覧内で次候補に移動（循環あり） */
    focusNext: function () {
      var count = this._matchList.length;
      if (count === 0) return;
      var next = (this.activeIndex + 1) % count;
      this._activateAt(next);
    },

    /** ↑ キー押下時: フローティング一覧内で前候補に移動（循環あり） */
    focusPrev: function () {
      var count = this._matchList.length;
      if (count === 0) return;
      var prev = (this.activeIndex - 1 + count) % count;
      this._activateAt(prev);
    },

    /**
     * Enter キー押下時: アクティブ候補の予定詳細モーダルを開く
     */
    _openActive: function () {
      if (this.activeIndex < 0 || this.activeIndex >= this._matchList.length) return;
      var evt = this._matchList[this.activeIndex];
      if (!evt || !evt.id) return;
      this._hideDropdown();
      KC.Popup.openEdit(evt.id);
    },

    /**
     * 0件メッセージの表示/非表示を制御する
     * @param {boolean} show - true なら表示
     * @param {string} query - 現在のクエリ（メッセージ文字列に使用）
     */
    _updateEmptyMsg: function (show, query) {
      var el = document.getElementById('kc-search-empty');
      if (!el) return;
      if (show) {
        el.textContent = '「' + query + '」に一致する予定はありません';
        el.style.display = 'block';
      } else {
        el.textContent = '';
        el.style.display = 'none';
      }
    },

    /**
     * クリアボタンの表示/非表示を同期する
     * @param {string} val - 判定に使う文字列（空文字なら非表示）
     */
    _syncClearBtn: function (val) {
      var btn = document.getElementById('kc-search-clear');
      if (!btn) return;
      if (val) {
        btn.removeAttribute('hidden');
      } else {
        btn.setAttribute('hidden', '');
      }
    },

    /**
     * 検索欄 DOM を生成して headRight の先頭（FilterDropdown より左）に挿入する
     * @param {HTMLElement} headRight - .kc-head-right 要素
     */
    buildDOM: function (headRight) {
      // searchTargets が未設定の場合は検索欄を生成しない（イベント登録もスキップ）
      if (this._searchTargets.length === 0) return;

      // 多重挿入防止
      if (document.getElementById('kc-search')) return;

      var wrap = document.createElement('div');
      wrap.id = 'kc-search';
      wrap.className = 'kc-search';
      wrap.setAttribute('role', 'search');

      var icon = document.createElement('span');
      icon.className = 'kc-search-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '🔍';

      var input = document.createElement('input');
      input.type = 'search';
      input.id = 'kc-search-input';
      input.className = 'kc-search-input';
      input.placeholder = '予定を検索';
      input.setAttribute('aria-label', '予定を検索');
      input.setAttribute('autocomplete', 'off');

      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.id = 'kc-search-clear';
      clearBtn.className = 'kc-search-clear';
      clearBtn.setAttribute('aria-label', '検索をクリア');
      clearBtn.setAttribute('hidden', '');
      clearBtn.textContent = '×';

      wrap.appendChild(icon);
      wrap.appendChild(input);
      wrap.appendChild(clearBtn);

      // プルダウン（#kc-search-dropdown）を wrap の子として追加
      // wrap に position: relative を付与して absolute 配置の基準点にする
      var dropdown = document.createElement('div');
      dropdown.id = 'kc-search-dropdown';
      dropdown.className = 'kc-search-dropdown';
      dropdown.setAttribute('role', 'listbox');
      dropdown.setAttribute('hidden', '');
      wrap.appendChild(dropdown);

      // FilterDropdown より左: headRight の先頭に挿入
      headRight.insertBefore(wrap, headRight.firstChild);

      // 0件メッセージ要素をカレンダーグリッド直前に追加
      this._buildEmptyMsg();

      // イベントリスナー登録
      this._bindEvents(input, clearBtn);

      // 外側クリックでプルダウンを閉じる（多重登録防止フラグで一度だけ登録）
      this._bindOutsideClick();
    },

    /** 0件メッセージ DOM を生成する */
    _buildEmptyMsg: function () {
      if (document.getElementById('kc-search-empty')) return;
      var msg = document.createElement('div');
      msg.id = 'kc-search-empty';
      msg.className = 'kc-search-empty';
      msg.setAttribute('aria-live', 'polite');
      msg.style.display = 'none';
      var root = document.getElementById('kc-root');
      if (root) root.appendChild(msg);
    },

    /**
     * document に外側クリックリスナーを登録する。
     * 多重登録防止のためフラグで一度だけ登録する。
     * #kc-search / #kc-search-dropdown の外をクリックしたときにプルダウンを閉じる。
     */
    _bindOutsideClick: function () {
      if (this._outsideClickBound) return;
      this._outsideClickBound = true;
      var self = this;
      document.addEventListener('click', function (e) {
        var dd = document.getElementById('kc-search-dropdown');
        if (!dd || dd.hasAttribute('hidden')) return;
        var searchEl = document.getElementById('kc-search');
        if (searchEl && searchEl.contains(e.target)) return;
        if (dd.contains(e.target)) return;
        self._hideDropdown();
      });
    },

    /**
     * input と clearBtn にイベントリスナーを設定する
     * @param {HTMLInputElement} input
     * @param {HTMLButtonElement} clearBtn
     */
    _bindEvents: function (input, clearBtn) {
      var self = this;

      // IME 管理
      input.addEventListener('compositionstart', function () {
        self._composing = true;
      });
      input.addEventListener('compositionend', function () {
        self._composing = false;
        // IME 確定後にデバウンスを開始する
        self._scheduleSearch(input.value);
      });

      // 通常入力（デバウンス）
      input.addEventListener('input', function () {
        self._syncClearBtn(input.value);
        if (self._composing) return;
        self._scheduleSearch(input.value);
      });

      // キーボードナビゲーション（Enter / ↑↓ / ESC）
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (self._composing) return;
          e.preventDefault();
          // Enter: アクティブ候補の予定詳細モーダルを開く
          self._openActive();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          // ↓: フローティング一覧内の次候補に移動
          self.focusNext();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          // ↑: フローティング一覧内の前候補に移動
          self.focusPrev();
        } else if (e.key === 'Escape') {
          // ESC: フローティング一覧を閉じる（クエリはそのまま維持しない → クリア）
          input.value = '';
          self.setQuery('');
          self._hideDropdown();
          input.blur();
        }
      });

      // 検索欄フォーカス復帰時: クエリが存在していればプルダウンを再表示する
      input.addEventListener('focus', function () {
        self._showDropdown();
      });

      // クリアボタン
      clearBtn.addEventListener('click', function () {
        input.value = '';
        self.setQuery('');
        input.focus();
      });
    },

    /**
     * デバウンスタイマーをセットして検索を実行する
     * @param {string} val - 入力値
     */
    _scheduleSearch: function (val) {
      clearTimeout(this._timer);
      var self = this;
      this._timer = setTimeout(function () {
        self.query = val;
        self.activeIndex = -1;
        KC.Render.renderGrid();
      }, 300);
    },

    /* ------------------------------------------------------------------
     * 検索プルダウン（案 X）
     * ------------------------------------------------------------------ */

    /**
     * KC.State.events から id でイベントオブジェクトを逆引きする
     * @param {string} id - イベント ID
     * @returns {Object|null}
     */
    _evtFromId: function (id) {
      var events = KC.State.events || [];
      for (var i = 0; i < events.length; i++) {
        if (events[i].id === id) return events[i];
      }
      return null;
    },

    /**
     * evt.start から "M/D(曜) HH:MM" または "M/D(曜) 終日" を返す
     * @param {Object} evt - KcEvent
     * @returns {string}
     */
    _fmtEvtDate: function (evt) {
      var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
      var d = new Date(evt.start);
      var prefix = (d.getMonth() + 1) + '/' + d.getDate()
        + '(' + DAY_NAMES[d.getDay()] + ')';
      if (evt.allday) return prefix + ' 終日';
      var hh = ('0' + d.getHours()).slice(-2);
      var mm = ('0' + d.getMinutes()).slice(-2);
      return prefix + ' ' + hh + ':' + mm;
    },

    /**
     * プルダウンの内容を _matchList（KcEvent 配列）から再構築して表示/非表示を切り替える。
     * クエリが空、または matchList が空（0件）の場合の処理も含む。
     */
    _renderDropdown: function () {
      var dd = document.getElementById('kc-search-dropdown');
      if (!dd) return;

      // クエリが空のときはプルダウンを非表示にする
      if (!this.query) {
        dd.setAttribute('hidden', '');
        dd.innerHTML = '';
        return;
      }

      dd.removeAttribute('hidden');
      dd.innerHTML = '';

      if (this._matchList.length === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.className = 'kc-search-dropdown-empty';
        emptyEl.textContent = '該当する予定がありません';
        dd.appendChild(emptyEl);
        return;
      }

      var self = this;
      this._matchList.forEach(function (evt, idx) {
        var item = self._buildDropdownItem(evt, idx);
        dd.appendChild(item);
      });
    },

    /**
     * プルダウンの 1 行 DOM を生成する
     * @param {Object} evt - KcEvent オブジェクト
     * @param {number} idx - _matchList 内のインデックス
     * @returns {HTMLElement}
     */
    _buildDropdownItem: function (evt, idx) {
      // 予定の bgColor を決定（permissionRules → evt.color → デフォルト）
      var markerColor = '#818cf8';
      var perm = KC.LoginContext.getPermission(evt);
      markerColor = perm.bgColor || evt.color || '#818cf8';

      var item = document.createElement('div');
      item.className = 'kc-search-dropdown-item';
      item.setAttribute('role', 'option');
      item.dataset.index = String(idx);

      // 左端カラーマーカー
      var markerEl = document.createElement('span');
      markerEl.className = 'kc-search-dropdown-item-marker';
      markerEl.style.backgroundColor = markerColor;

      // コンテンツ領域（マーカーの右側）
      var bodyEl = document.createElement('div');
      bodyEl.className = 'kc-search-dropdown-item-body';

      // 日時行（日付+曜日部分を span で囲んで土日祝色を適用）
      var dateEl = document.createElement('div');
      dateEl.className = 'kc-search-dropdown-item-date';
      this._buildDateContent(dateEl, evt);

      var titleEl = document.createElement('div');
      titleEl.className = 'kc-search-dropdown-item-title';
      titleEl.textContent = evt.title || '(無題)';

      bodyEl.appendChild(dateEl);
      bodyEl.appendChild(titleEl);

      item.appendChild(markerEl);
      item.appendChild(bodyEl);

      var self = this;
      item.addEventListener('click', function () {
        self._activateAt(idx);
        self._hideDropdown();
        // フローティング一覧のアイテムクリック → 予定詳細モーダルを開く
        KC.Popup.openEdit(evt.id);
      });

      return item;
    },

    /**
     * 日時表示 div に土日祝色付き span を挿入する
     * 例: "5/22(日) 14:00" → テキスト "5/22" + span.kc-dd-day--sun "(日)" + テキスト " 14:00"
     * @param {HTMLElement} container - 追記先の div 要素
     * @param {Object} evt - KcEvent
     */
    _buildDateContent: function (container, evt) {
      var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
      var d = new Date(evt.start);
      var dow = d.getDay();

      // 土日祝判定（KC.Utils.getHolidayName は KC.Holidays に委譲し、未取得時はハードコードフォールバック）
      var isHoliday = !!KC.Utils.getHolidayName(d);
      var dayClass = '';
      if (isHoliday || dow === 0) {
        dayClass = 'kc-dd-day--sun';
      } else if (dow === 6) {
        dayClass = 'kc-dd-day--sat';
      }
      // 祝日は日曜と同じ赤系で表示（kc-dd-day--sun を流用）
      // 土曜祝日も赤系優先とするため isHoliday チェックを先に行っている

      var datePart = (d.getMonth() + 1) + '/' + d.getDate();
      var dayPart = '(' + DAY_NAMES[dow] + ')';
      var timePart = evt.allday
        ? ' 終日'
        : ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);

      // 日付テキストノード
      container.appendChild(document.createTextNode(datePart));

      // 曜日 span（色クラスあり）
      var daySpan = document.createElement('span');
      if (dayClass) daySpan.className = dayClass;
      daySpan.textContent = dayPart;
      container.appendChild(daySpan);

      // 時刻テキストノード
      container.appendChild(document.createTextNode(timePart));
    },

    /**
     * プルダウン内のアクティブ行（--active クラス）を activeIndex に同期する。
     * アクティブ行がリスト内で見えない場合は自動スクロールする
     */
    _updateDropdownActive: function () {
      var dd = document.getElementById('kc-search-dropdown');
      if (!dd) return;

      var items = dd.querySelectorAll('.kc-search-dropdown-item');
      items.forEach(function (item) {
        item.classList.remove('kc-search-dropdown-item--active');
      });

      if (this.activeIndex < 0 || this.activeIndex >= items.length) return;

      var activeItem = items[this.activeIndex];
      activeItem.classList.add('kc-search-dropdown-item--active');

      // アクティブ行がドロップダウンのスクロール領域外なら自動スクロール
      var ddTop = dd.scrollTop;
      var ddBottom = ddTop + dd.clientHeight;
      var itemTop = activeItem.offsetTop;
      var itemBottom = itemTop + activeItem.offsetHeight;
      if (itemTop < ddTop) {
        dd.scrollTop = itemTop;
      } else if (itemBottom > ddBottom) {
        dd.scrollTop = itemBottom - dd.clientHeight;
      }
    },

    /**
     * プルダウンを非表示にする（hidden 属性をセット）
     */
    _hideDropdown: function () {
      var dd = document.getElementById('kc-search-dropdown');
      if (!dd) return;
      dd.setAttribute('hidden', '');
    },

    /**
     * プルダウンを表示する（matchList が空でなくクエリが存在する場合のみ）
     */
    _showDropdown: function () {
      if (!this.query) return;
      if (!this._matchList || this._matchList.length === 0) return;
      var dd = document.getElementById('kc-search-dropdown');
      if (!dd) return;
      dd.removeAttribute('hidden');
    }
  };

  /* ====================================================================
   * KC.UrlState — URL ハッシュ状態同期（REQ_url-state-sync Phase 1）
   *
   * ハッシュフォーマット: #kc:<key>=<value>[&<key>=<value>...]
   * replaceState 系パラメータ: view / date / filter / q / fs / scroll
   * pushState 系パラメータ: record / new / more（Phase 2）
   * "#kc:" プレフィクスなしのハッシュはすべて無視する（FR-12）
   *
   * fs セマンティクス（ユーザー決定）:
   *   デフォルト（fs パラメータなし）= 全画面。URL に fs を書かない。
   *   ユーザーが全画面解除 → fs=0 を記録。再全画面化 → fs を除去。
   *   これにより init が無条件に _enterExpanded を呼んでも URL への書き込みが不要となり、
   *   リロード時の復元と競合しない。
   *
   * 順序バグ対策（[High] 指摘対応）:
   *   IIFE が評価された時点（= ページロード直後・KC.Boot.init より前）で
   *   location.hash をパースして _initialParams にキャッシュする。
   *   restore() はこのキャッシュから読むため、init 内の _enterExpanded 等が
   *   URL を書き換えても復元値が汚染されない。
   * ==================================================================== */
  KC.UrlState = (function () {
    /** カレンダー自身の replaceState/pushState 呼び出しによる hashchange を無視するフラグ */
    var _isUpdatingHash = false;

    /**
     * P-14: parse(window.location.hash) の同一ハッシュ値に対するメモ化キャッシュ。
     * { hash: string, params: Object } の形式で直前のパース結果を保持する。
     * replaceState/pushState による hash 変化 or 外部からの hashchange で自動的に無効化される。
     */
    var _parseCache = null;

    /** スクロールイベントのデバウンスタイマー */
    var _scrollTimer = null;

    /** スクロールイベントリスナー参照（週・日ビュー専用。月ビュー切替時に登録/解除） */
    var _scrollListener = null;

    /** #kc: プレフィクス */
    var PREFIX = '#kc:';

    /**
     * 起動時（IIFE 評価時点）のハッシュを即時キャッシュする。
     * restore() はこのキャッシュを参照するため、init 内の URL 書き込みに汚染されない。
     */
    var _initialParams = (function () {
      // parse をまだ定義していないため同等のロジックをインラインで実行する
      var hash = window.location.hash;
      if (!hash || hash.indexOf(PREFIX) !== 0) return {};
      var body = hash.slice(PREFIX.length);
      if (!body) return {};
      var result = {};
      body.split('&').forEach(function (pair) {
        var idx = pair.indexOf('=');
        if (idx === -1) return;
        var k = pair.slice(0, idx);
        var v = pair.slice(idx + 1);
        if (!k) return;
        try { result[k] = decodeURIComponent(v); } catch (e) { /* デコード失敗は無視 */ }
      });
      return result;
    }());

    /**
     * ハッシュ文字列をパースしてキー値マップを返す
     * "#kc:" プレフィクスを持たない場合は {} を返す（FR-12 AC-13）
     * @param {string} hash - window.location.hash
     * @returns {Object}
     */
    function parse(hash) {
      if (!hash || hash.indexOf(PREFIX) !== 0) return {};
      var body = hash.slice(PREFIX.length);
      if (!body) return {};
      var result = {};
      body.split('&').forEach(function (pair) {
        var idx = pair.indexOf('=');
        if (idx === -1) return;
        var k = pair.slice(0, idx);
        var v = pair.slice(idx + 1);
        if (!k) return;
        try {
          result[k] = decodeURIComponent(v);
        } catch (e) {
          // デコード失敗は無視
        }
      });
      return result;
    }

    /**
     * キー値マップをハッシュ文字列にシリアライズする
     * @param {Object} params
     * @returns {string}
     */
    function serialize(params) {
      var pairs = [];
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === null || v === undefined || v === '') return;
        pairs.push(k + '=' + encodeURIComponent(v));
      });
      if (pairs.length === 0) return '';
      return PREFIX + pairs.join('&');
    }

    /**
     * P-14: 現在の window.location.hash をパースして返す（キャッシュ付き）。
     * 同一ハッシュに対して連続して呼ばれる場合はキャッシュを返してパースコストを削減する。
     * replaceState/pushState 後はキャッシュが自動的に無効化される（_parseCache = null）。
     * @returns {Object}
     */
    function _parseCurrent() {
      var hash = window.location.hash;
      if (_parseCache && _parseCache.hash === hash) return _parseCache.params;
      var params = parse(hash);
      _parseCache = { hash: hash, params: params };
      return params;
    }

    /**
     * 現在のハッシュから指定キーの値を返す。存在しない場合は null
     * P-14: _parseCurrent() でキャッシュを活用してパースを最小化する
     * @param {string} key
     * @returns {string|null}
     */
    function get(key) {
      var params = _parseCurrent();
      return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : null;
    }

    /**
     * 現在のハッシュの指定キーを更新して replaceState する（FR-11 ガード付き）
     * @param {string} key
     * @param {string} value - 空文字の場合はキーを削除する
     */
    function update(key, value) {
      var params = parse(window.location.hash);
      if (value === null || value === undefined || value === '') {
        delete params[key];
      } else {
        params[key] = value;
      }
      var newHash = serialize(params);
      _isUpdatingHash = true;
      _parseCache = null; // P-14: replaceState 前にキャッシュ無効化
      try {
        history.replaceState(null, '', newHash || location.pathname + location.search);
      } finally {
        _isUpdatingHash = false;
      }
    }

    /**
     * 現在のハッシュに指定キーを追加して pushState する（Phase 2 用: record/new/more）
     * Phase 1 では使用しない
     * @param {string} key
     * @param {string} value
     */
    function push(key, value) {
      var params = parse(window.location.hash);
      params[key] = value;
      var newHash = serialize(params);
      _isUpdatingHash = true;
      _parseCache = null; // P-14: pushState 前にキャッシュ無効化
      try {
        history.pushState(null, '', newHash || location.pathname + location.search);
      } finally {
        _isUpdatingHash = false;
      }
    }

    /**
     * 現在のハッシュから指定キーを削除して replaceState する（冪等: キー不在なら何もしない）
     * @param {string} key
     */
    function remove(key) {
      // キーが存在しない場合は replaceState を発行しない（不要な二連 replaceState を防ぐ）
      var params = parse(window.location.hash);
      if (!Object.prototype.hasOwnProperty.call(params, key)) return;
      update(key, '');
    }

    /**
     * P-8: 複数の update/remove を 1 回の replaceState にまとめるトランザクション API。
     * fn(params) を呼び出し、その中での params オブジェクト編集を元に最終 replaceState を 1 回だけ発行する。
     * @param {function(Object): void} fn - params オブジェクトを受け取り変更する関数
     *   fn 内では update/remove の代わりに params[key] = value / delete params[key] を使う
     */
    function batch(fn) {
      var params = parse(window.location.hash);
      fn(params);
      var newHash = serialize(params);
      _isUpdatingHash = true;
      _parseCache = null; // P-14: replaceState 前にキャッシュ無効化
      try {
        history.replaceState(null, '', newHash || location.pathname + location.search);
      } finally {
        _isUpdatingHash = false;
      }
    }

    /**
     * Date オブジェクト → ビューに応じた date 文字列を返す
     * 月ビュー: YYYY-MM、週・日ビュー: YYYY-MM-DD
     * @param {Date} d
     * @param {string} view
     * @returns {string}
     */
    function _dateToParam(d, view) {
      if (!d) return '';
      var y = d.getFullYear();
      var m = KC.Utils.pad2(d.getMonth() + 1);
      if (view === 'month') return y + '-' + m;
      var day = KC.Utils.pad2(d.getDate());
      return y + '-' + m + '-' + day;
    }

    /**
     * date パラメータ文字列から Date を生成して返す（overflow 逆算チェック付き）
     * 不正値の場合は null を返す（FR-12）
     * popstate ハンドラと restore() の両方で共用する（DRY）
     * @param {string} dateStr - "YYYY-MM" または "YYYY-MM-DD"
     * @returns {Date|null}
     */
    function parseDate(dateStr) {
      if (!dateStr) return null;
      // YYYY-MM 形式（月ビュー）
      if (/^\d{4}-\d{2}$/.test(dateStr)) {
        var y = parseInt(dateStr.slice(0, 4), 10);
        var mo = parseInt(dateStr.slice(5, 7), 10) - 1;
        if (mo < 0 || mo > 11) return null;
        return new Date(y, mo, 1);
      }
      // YYYY-MM-DD 形式（週・日ビュー）overflow 逆算チェック付き
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        var parts = dateStr.split('-');
        var yy = parseInt(parts[0], 10);
        var mm = parseInt(parts[1], 10) - 1;
        var dd = parseInt(parts[2], 10);
        if (mm < 0 || mm > 11 || dd < 1 || dd > 31) return null;
        var dt = new Date(yy, mm, dd);
        // overflow 逆算チェック: new Date(2026, 1, 30) → 3/2 になる等の異常値を排除
        if (dt.getFullYear() !== yy || dt.getMonth() !== mm || dt.getDate() !== dd) return null;
        return dt;
      }
      return null;
    }

    /**
     * 現在の view + current を URL に書き込む（replaceState）
     * ナビゲーション操作・ビュー切替後に呼ぶ
     */
    function syncViewDate() {
      var view = KC.State.view;
      var dateStr = _dateToParam(KC.State.current, view);
      var params = parse(window.location.hash);
      params.view = view;
      params.date = dateStr;
      var newHash = serialize(params);
      _isUpdatingHash = true;
      try {
        history.replaceState(null, '', newHash || location.pathname + location.search);
      } finally {
        _isUpdatingHash = false;
      }
    }

    /**
     * scroll=HH:mm 形式から scrollTop 値（px）に変換する
     * hourHeight は kc-time 要素の高さから算出する（scrollToDefaultTime と同じロジック）
     * 不正値は null を返す（FR-12）
     * @param {string} scrollStr - "HH:mm"
     * @returns {number|null}
     */
    function _scrollStrToTop(scrollStr) {
      if (!scrollStr || !/^\d{2}:\d{2}$/.test(scrollStr)) return null;
      var parts = scrollStr.split(':');
      var h = parseInt(parts[0], 10);
      var min = parseInt(parts[1], 10);
      if (h < 0 || h > 23 || min < 0 || min > 59) return null;
      var timeCol = document.getElementById('kc-time-col');
      var hourHeight = 60;
      if (timeCol) {
        var firstTick = timeCol.querySelector('.kc-time');
        if (firstTick) {
          var rect = firstTick.getBoundingClientRect();
          if (rect.height) hourHeight = rect.height;
        }
      }
      return (h + min / 60) * hourHeight;
    }

    /**
     * #kc-body の現在の scrollTop を HH:mm 文字列に変換する
     * @param {HTMLElement} bodyEl
     * @returns {string}
     */
    function _scrollTopToStr(bodyEl) {
      var timeCol = document.getElementById('kc-time-col');
      var hourHeight = 60;
      if (timeCol) {
        var firstTick = timeCol.querySelector('.kc-time');
        if (firstTick) {
          var rect = firstTick.getBoundingClientRect();
          if (rect.height) hourHeight = rect.height;
        }
      }
      var totalMinutes = Math.round((bodyEl.scrollTop / hourHeight) * 60);
      var h = Math.floor(totalMinutes / 60);
      var m = totalMinutes % 60;
      if (h > 23) h = 23;
      return KC.Utils.pad2(h) + ':' + KC.Utils.pad2(m);
    }

    /**
     * 週・日ビューで #kc-body のスクロールイベントを登録する（デバウンス 500ms）
     * 月ビューでは誤発火しないよう view === 'month' をガードする（Q-3 対応）
     */
    function _attachScrollListener() {
      var bodyEl = document.getElementById('kc-body');
      if (!bodyEl) return;
      if (_scrollListener) {
        bodyEl.removeEventListener('scroll', _scrollListener);
      }
      _scrollListener = function () {
        // 月ビューの場合はスクロール更新をスキップ（Q-3: 月ビュー誤発火ガード）
        if (KC.State.view === 'month') return;
        clearTimeout(_scrollTimer);
        _scrollTimer = setTimeout(function () {
          var bEl = document.getElementById('kc-body');
          if (!bEl) return;
          update('scroll', _scrollTopToStr(bEl));
        }, 500);
      };
      bodyEl.addEventListener('scroll', _scrollListener);
    }

    /**
     * init 完了後に URL ハッシュを解析して状態を復元する（Phase 1 スコープ）
     * 復元順序: ビュー/日付 → フィルタ → 検索 → 全画面 → スクロール
     *
     * 注: _initialParams（IIFE 評価時にキャッシュ済み）から読む。
     *     init 内の _enterExpanded 等が URL を書き換えた後でも正しい初期値を参照できる。
     */
    function restore() {
      // キャッシュ済みの起動時パラメータを使用する（URL への書き込みによる汚染を回避）
      var params = _initialParams;

      // --- 1. ビュー・日付の復元 ---
      var urlView = params.view;
      var urlDate = params.date;
      var validViews = { month: true, week: true, day: true };
      var viewChanged = false;
      var dateChanged = false;

      if (urlView && validViews[urlView]) {
        if (urlView !== KC.State.view) {
          KC.State.view = urlView;
          viewChanged = true;
        }
      }
      if (urlDate) {
        var parsedDate = parseDate(urlDate);
        if (parsedDate) {
          KC.State.current = parsedDate;
          dateChanged = true;
        }
        // 不正値は無視（FR-12）
      }

      if (viewChanged || dateChanged) {
        // debounce を経由せず即時実行（復元のため）
        KC.Render._refreshImmediate();
      }

      // --- 2. フィルタの復元（URL 優先、なければ localStorage 既存値を維持） ---
      var urlFilter = params.filter;
      if (urlFilter === 'all' || urlFilter === 'mine' || urlFilter === 'others') {
        // URL 値が有効な場合は localStorage 値より優先して上書きする（FR-2, AC-3）
        KC.State.eventFilter = urlFilter;
        // フィルタドロップダウンのボタン表示ラベルも更新する
        var filterBtn = document.getElementById('kc-filter-select');
        if (filterBtn) {
          var filterLabel = KC.FilterDropdown._labelFor(urlFilter);
          if (filterBtn.childNodes.length > 0) {
            filterBtn.childNodes[0].nodeValue = filterLabel + ' ';
          }
        }
        // aria-selected の更新
        var filterMenu = document.querySelector('#kc-filter .kc-dropdown-menu');
        if (filterMenu) {
          Array.from(filterMenu.querySelectorAll('.kc-option')).forEach(function (li) {
            li.setAttribute('aria-selected', String(li.dataset.value === urlFilter));
          });
        }
        // URL のフィルタに合わせて renderGrid で再描画（viewChanged でないケースで差分反映）
        KC.Render.renderGrid();
      }
      // urlFilter が無効値（不正値）の場合は既存の eventFilter（localStorage 由来）を維持（FR-12 / AC-4）

      // --- 3. 検索クエリの復元（[Low] 二重 replaceState 対策） ---
      // setQuery() を経由すると URL を再書き込みするため、ここでは直接プロパティを設定する
      var urlQ = params.q;
      if (urlQ !== undefined && urlQ !== null && urlQ !== '') {
        // searchTargets が空（検索バー非表示）の場合は q を無視する（FR-3）
        if (KC.SearchFilter._searchTargets && KC.SearchFilter._searchTargets.length > 0) {
          KC.SearchFilter.query = urlQ;
          KC.SearchFilter.activeIndex = -1;
          var input = document.getElementById('kc-search-input');
          if (input) input.value = urlQ;
          KC.SearchFilter._syncClearBtn(urlQ);
          // マッチリストの再構築（setQuery が行う renderGrid は既に viewChanged で呼び済みの場合も多いが念のため実行）
          KC.Render.renderGrid();
        }
      }

      // --- 4. 全画面の復元（[High] fs セマンティクス反転対応） ---
      // デフォルト（fs なし）= 全画面。init が _enterExpanded を呼んでいるので何もしない。
      // fs=0 のとき → ユーザーが前回解除した状態なので _exitExpanded を呼ぶ。
      // fs=0 以外（不正値含む）は全画面のままとする（デフォルト一致）。
      if (params.fs === '0') {
        var root = document.getElementById('kc-root');
        if (root) KC.Boot._exitExpanded(root);
      }
      // fs なし・fs=0 以外のケースは全画面状態を維持（init の _enterExpanded が設定済み）

      // --- 5. スクロール位置の復元（週・日ビューのみ） ---
      if (KC.State.view !== 'month' && params.scroll) {
        requestAnimationFrame(function () {
          var bodyEl = document.getElementById('kc-body');
          if (!bodyEl) return;
          var top = _scrollStrToTop(params.scroll);
          if (top !== null) {
            bodyEl.scrollTop = top;
          }
          // 不正値は無視してデフォルト位置のまま（FR-12）
        });
      }

      // --- スクロールリスナーを登録（週・日ビューのみ有効、月ビューはガード内でスキップ） ---
      _attachScrollListener();

      // --- URL 書き戻し（restore 完了後の確定的な 1 回 replaceState） ---
      // init 中の _enterExpanded / patchRenderGrid 等が `parse(window.location.hash)` を基に
      // replaceState を発行する場合、その時点で URL に残っていないパラメータは消えてしまう。
      // ここで _initialParams を基に「実際に復元した状態」を 1 回だけ replaceState で書き戻す。
      // - 有効な view/date は KC.State に反映済みのため KC.State から取得する
      // - filter/q/fs/scroll/record/new/more は _initialParams からの有効値を使う
      //   （fs はステップ 4 の処理結果で URL に既に反映されているが、まとめて再設定して問題ない）
      // - record/new/more は非同期検証前の段階で URL に残す（後段の async IIFE が検証失敗時に remove する）
      (function () {
        // 元 URL に #kc: ハッシュがなかった場合は書き戻し不要（FR-12: 非 #kc: ハッシュ・ハッシュなしには不干渉）
        if (Object.keys(params).length === 0) return;

        var restoredParams = {};

        // view/date: 常に現在の KC.State から取得（restore ステップ 1 で更新済み）
        restoredParams.view = KC.State.view;
        // B-P3: インライン再実装 (_dateToParamLocal) を廃止し、同スコープの _dateToParam を使用する（DRY）
        restoredParams.date = _dateToParam(KC.State.current, KC.State.view);

        // filter: 有効値が URL に存在した場合のみ書き戻す
        var urlFilter = params.filter;
        if (urlFilter === 'all' || urlFilter === 'mine' || urlFilter === 'others') {
          restoredParams.filter = urlFilter;
        }

        // q: 空でない場合のみ書き戻す（searchTargets が空で復元スキップした場合も含めて書き戻す）
        // searchTargets が空の場合、フロントエンド側で q は機能しないが URL に残す（再描画後に有効になることを想定）
        var urlQ = params.q;
        if (urlQ !== undefined && urlQ !== null && urlQ !== '') {
          restoredParams.q = urlQ;
        }

        // fs: '0' の場合のみ書き戻す（デフォルト=全画面=なしが仕様のため '0' 以外は書かない）
        if (params.fs === '0') {
          restoredParams.fs = '0';
        }

        // scroll: 有効値が URL に存在した場合のみ書き戻す
        // （週・日ビュー以外では意味がないが、URL に残すことは問題ない）
        var urlScroll = params.scroll;
        if (urlScroll && /^\d{2}:\d{2}$/.test(urlScroll)) {
          restoredParams.scroll = urlScroll;
        }

        // record/new/more: 非同期検証前の段階でそのまま書き戻す（async IIFE が失敗時に remove する）
        if (params.record) { restoredParams.record = params.record; }
        if (params['new']) { restoredParams['new'] = params['new']; }
        if (params.more)   { restoredParams.more   = params.more; }

        var newHash = serialize(restoredParams);
        _isUpdatingHash = true;
        try {
          history.replaceState(null, '', newHash || location.pathname + location.search);
        } finally {
          _isUpdatingHash = false;
        }
      }());

      // --- 6. モーダル・ポップオーバーの復元（Phase 2） ---
      // record / new / more は非同期処理が絡むため即時 async IIFE で実行する。
      // push スキップは各関数内の URL 現在値比較（get() === value）で自然に行われる。
      (async function () {
        var urlRecord = params.record;
        var urlNew    = params['new'];
        var urlMore   = params.more;

        // 6-1. record: レコード編集モーダルの復元（存在確認 API 付き）
        if (urlRecord) {
          var recordId = String(urlRecord).trim();
          // 数値文字列のバリデーション（不正値は無視）
          if (/^\d+$/.test(recordId)) {
            try {
              await KC.Api.getRecord(recordId);
              // レコード存在確認成功 → モーダルを開く（URL に既に同値があるため openEdit 内の push はスキップされる）
              KC.Popup.openEdit(recordId);
            } catch (err) {
              // レコード不存在またはアクセス権限なし → エラーバナー表示、record パラメータ除去（FR-12 AC-8）
              console.warn('[KC.UrlState.restore] record=', recordId, 'の存在確認失敗:', err);
              KC.Banner.show('指定されたレコードが見つかりません', { hideReload: true });
              remove('record');
            }
          } else {
            // 不正値（数値以外）→ 無視して record パラメータ除去
            remove('record');
          }
          // record 復元が有効なため new/more の復元はスキップ（排他制御）
          return;
        }

        // 6-2. new: 新規作成モーダルの復元
        if (urlNew) {
          // YYYY-MM-DD または YYYY-MM-DDTHH:mm のバリデーション
          var newDateMatch = urlNew.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/);
          if (newDateMatch) {
            var options = { date: newDateMatch[1], allday: !newDateMatch[2] };
            if (newDateMatch[2]) {
              options.hour   = parseInt(newDateMatch[2], 10);
              options.minute = parseInt(newDateMatch[3], 10);
            }
            // URL に既に同値があるため openCreate 内の push はスキップされる
            KC.Popup.openCreate(options);
          } else {
            // 不正値は無視
            remove('new');
          }
          return;
        }

        // 6-3. more: +N more ポップオーバーの復元（月ビューのみ、描画完了後）
        // _refreshImmediate() の Promise を await して loadEvents + renderGrid + placeMonthEvents
        // の完了を待ち、確実に .kc-month-more が DOM に存在する状態で querySelector する。
        if (urlMore) {
          // YYYY-MM-DD バリデーション
          if (/^\d{4}-\d{2}-\d{2}$/.test(urlMore)) {
            if (KC.State.view !== 'month') {
              // 月ビュー以外では無視してパラメータ除去
              remove('more');
            } else {
              // 月ビューの全描画（loadEvents → renderGrid → placeMonthEvents）を待つ
              await KC.Render._refreshImmediate();
              // data-date="YYYY-MM-DD" セルに紐付く .kc-month-more 要素を探す
              var moreEl = document.querySelector('[data-date="' + urlMore + '"] .kc-month-more');
              if (!moreEl) {
                // セルが存在しない（対象日がグリッド外 or 予定数が閾値未満）→ 無視
                remove('more');
              } else {
                // .kc-month-more に紐付く非表示予定リストを取得（WeakMap から）
                var hiddenEvents = KC.MonthOverflowPopup.getHiddenEvents
                  ? KC.MonthOverflowPopup.getHiddenEvents(moreEl)
                  : [];
                // URL に既に同値があるため open 内の push はスキップされる
                KC.MonthOverflowPopup.open(moreEl, urlMore, hiddenEvents);
              }
            }
          } else {
            remove('more');
          }
        }
      }());
    }

    // 公開 API
    return {
      parse: parse,
      serialize: serialize,
      get: get,
      update: update,
      push: push,
      remove: remove,
      batch: batch,          // P-8: 複数変更を 1 回の replaceState にまとめるトランザクション API
      restore: restore,
      syncViewDate: syncViewDate,
      parseDate: parseDate,        // [Medium] popstate ハンドラと共用（DRY）
      // テスト・デバッグ用内部アクセサ
      _isUpdatingHash: function () { return _isUpdatingHash; }
    };
  }());

  /* ====================================================================
   * KC.FilterDropdown — イベントフィルタドロップダウン
   * ヘッダー右側に「すべて / 自分のみ / 他人のみ」を切り替える UI を提供する
   * ==================================================================== */
  KC.FilterDropdown = {
    /** localStorage のキー */
    STORAGE_KEY: 'kc-event-filter',

    /**
     * localStorage からフィルタ値を読み込み KC.State.eventFilter を初期化する
     * DOM 構築前に呼ぶこと
     */
    loadFilter: function () {
      try {
        var saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved === 'mine' || saved === 'others' || saved === 'all') {
          KC.State.eventFilter = saved;
        }
      } catch (e) {
        // localStorage が使えない環境ではデフォルト値を維持
        console.warn('[KC.FilterDropdown] localStorage 読み込み失敗:', e);
      }
    },

    /**
     * フィルタ値を保存して再描画する
     * @param {string} value - 'all' | 'mine' | 'others'
     */
    _saveAndRefresh: function (value) {
      KC.State.eventFilter = value;
      try {
        localStorage.setItem(this.STORAGE_KEY, value);
      } catch (e) {
        console.warn('[KC.FilterDropdown] localStorage 保存失敗:', e);
      }
      // FR-2: フィルタ変更を URL ハッシュに同期する（replaceState）
      if (KC.UrlState) KC.UrlState.update('filter', value);
      // フィルタはクライアント側処理のため API 再取得不要。renderGrid で再描画のみ実施する
      KC.Render.renderGrid();
    },

    /**
     * フィルタ値に対応する表示ラベルを返す
     * @param {string} value
     * @returns {string}
     */
    _labelFor: function (value) {
      if (value === 'mine')   return '自分のみ';
      if (value === 'others') return '他人のみ';
      return 'すべて';
    },

    /**
     * フィルタドロップダウン DOM を生成して headRight に追加する
     * @param {HTMLElement} headRight - .kc-head-right 要素
     */
    buildDOM: function (headRight) {
      var self = this;
      var wrap = document.createElement('div');
      wrap.className = 'kc-dropdown';
      wrap.id = 'kc-filter';

      var btn = document.createElement('button');
      btn.className = 'kc-dropdown-btn';
      btn.id = 'kc-filter-select';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = self._labelFor(KC.State.eventFilter) + ' ';
      var caret = document.createElement('span');
      caret.className = 'kc-caret';
      caret.textContent = '▾'; // ▾
      btn.appendChild(caret);

      var menuUl = document.createElement('ul');
      menuUl.className = 'kc-dropdown-menu';
      menuUl.setAttribute('role', 'listbox');
      menuUl.setAttribute('aria-label', 'フィルタ切替');

      var options = [
        { value: 'all',    label: 'すべて' },
        { value: 'mine',   label: '自分のみ' },
        { value: 'others', label: '他人のみ' }
      ];

      options.forEach(function (opt) {
        var li = document.createElement('li');
        li.className = 'kc-option';
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.setAttribute('aria-selected', String(opt.value === KC.State.eventFilter));
        li.textContent = opt.label;
        menuUl.appendChild(li);
      });

      wrap.appendChild(btn);
      wrap.appendChild(menuUl);

      // ドロップダウン開閉ロジック（KC.ViewDropdown と同パターン）
      function open() {
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
      function close() {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
      function toggle(e) {
        if (e) e.preventDefault();
        wrap.classList.contains('open') ? close() : open();
      }

      function choose(value, label) {
        // ボタンのテキストノードを更新（caret は保持）
        if (btn.childNodes.length > 0) {
          btn.childNodes[0].nodeValue = label + ' ';
        } else {
          btn.textContent = label + ' ';
        }
        // aria-selected 更新
        Array.from(menuUl.querySelectorAll('.kc-option')).forEach(function (li) {
          li.setAttribute('aria-selected', String(li.dataset.value === value));
        });
        close();
        self._saveAndRefresh(value);
      }

      btn.addEventListener('click', toggle);
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') toggle(e);
        if (e.key === 'Escape') close();
      });

      Array.from(menuUl.querySelectorAll('.kc-option')).forEach(function (li) {
        li.addEventListener('click', function () {
          choose(li.dataset.value, li.textContent.trim());
        });
        li.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            choose(li.dataset.value, li.textContent.trim());
          }
        });
      });

      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) close();
      });

      // ビュードロップダウンの前に挿入（headRight の先頭）
      headRight.insertBefore(wrap, headRight.firstChild);
    },

    /** DOM 構築後にドロップダウンを初期化する（KC.Boot.init から呼ぶ） */
    init: function () {
      var headRight = document.querySelector('.kc-head-right');
      if (!headRight) return;
      this.buildDOM(headRight);
    }
  };

  /* ====================================================================
   * KC.ViewDropdown — ビュー切り替え
   * ==================================================================== */
  KC.ViewDropdown = {
    init: function () {
      var wrap = KC.State.els.viewWrap;
      var btn  = KC.State.els.viewBtn;
      if (!wrap || !btn) return;

      var menu = wrap.querySelector('.kc-dropdown-menu');
      if (!menu) return;

      var items = Array.from(menu.querySelectorAll('.kc-option'));

      function open() {
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
      function close() {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
      function toggle(e) {
        if (e) e.preventDefault();
        wrap.classList.contains('open') ? close() : open();
      }

      function choose(value, label) {
        if (btn.childNodes.length > 0) {
          btn.childNodes[0].nodeValue = label + ' ';
        } else {
          btn.textContent = label + ' ';
        }

        items.forEach(function (li) {
          li.setAttribute('aria-selected', String(li.dataset.value === value));
        });

        close();

        KC.State.view = value;
        // ビュー切替時: activeIndex をリセット（FR-7）。クエリとマッチリストは維持する
        KC.SearchFilter.activeIndex = -1;
        // FR-1: ビュー切替を URL ハッシュに同期する（replaceState）
        if (KC.UrlState) KC.UrlState.syncViewDate();
        KC.Render.refresh();
      }

      btn.addEventListener('click', toggle);
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') toggle(e);
        if (e.key === 'Escape') close();
      });

      items.forEach(function (li) {
        li.addEventListener('click', function () {
          choose(li.dataset.value, li.textContent.trim());
        });
        li.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            choose(li.dataset.value, li.textContent.trim());
          }
        });
      });

      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) close();
      });
    }
  };

  /* ====================================================================
   * KC.Boot — 初期化 + kintone.events 登録
   * ==================================================================== */
  KC.Boot = {
    _initialized: false,

    /**
     * アプリ管理権限の有無を /k/v1/app/settings.json の呼出可否で簡易判定する。
     * 成功なら KC.State.isAppAdmin = true、失敗なら false（デフォルト維持）。
     * 403 / その他エラーはユーザーに見せない（console.warn のみ）。
     */
    _checkAppAdminPermission: async function () {
      try {
        await kintone.api(
          kintone.api.url('/k/v1/app/settings.json', true),
          'GET',
          { app: kintone.app.getId() }
        );
        KC.State.isAppAdmin = true;
      } catch (e) {
        KC.State.isAppAdmin = false;
        // 権限なし or エラーはユーザーに見せない
        console.warn('[KC.Boot] app/settings.json 呼出失敗（管理権限なし）');
      }
    },

    /**
     * カレンダーヘッダー右側（.kc-head-right）に ⚙ プラグイン設定ボタンを挿入する。
     * KC.State.isAppAdmin が true のときのみ表示状態にする。
     * ボタンは初回のみ挿入する（_buildDOM のガード相当のチェックを行う）。
     */
    _insertSettingsButton: function () {
      var headRight = document.querySelector('.kc-head-right');
      if (!headRight) return;

      // 多重挿入防止（init が複数回呼ばれた場合への安全策）
      if (headRight.querySelector('.kc-settings-btn')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kc-settings-btn';
      btn.title = 'プラグイン設定を開く';
      btn.setAttribute('aria-label', 'プラグイン設定を開く');

      var icon = document.createElement('span');
      icon.className = 'kc-settings-btn-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⚙'; // ⚙
      btn.appendChild(icon);

      btn.addEventListener('click', function () {
        window.location.href = '/k/admin/app/' + kintone.app.getId() + '/plugin/config?pluginId=' + PLUGIN_ID;
      });

      headRight.appendChild(btn);

      if (KC.State.isAppAdmin) {
        btn.style.display = 'inline-block';
      }
    },

    /** DOM構築（ヘッダー、グリッド、ドロップダウン） */
    _buildDOM: function () {
      var root = document.getElementById('kc-root');
      if (!root) return;

      // 既にDOM構築済みの場合はスキップ
      if (root.querySelector('.kc-header')) return;

      // ヘッダー
      var header = document.createElement('header');
      header.className = 'kc-header';

      var headLeft = document.createElement('div');
      headLeft.className = 'kc-head-left';

      var title = document.createElement('div');
      title.className = 'kc-title';
      title.textContent = KC.Config.APP_NAME || 'カレンダー';

      var todayBtn = document.createElement('button');
      todayBtn.className = 'kc-btn kc-today';
      todayBtn.setAttribute('data-action', 'today');
      todayBtn.textContent = '今日';

      var prevBtn = document.createElement('button');
      prevBtn.className = 'kc-btn kc-btn--icon';
      prevBtn.setAttribute('data-action', 'prev');
      prevBtn.setAttribute('aria-label', '前の月');  // デフォルト view が month のため（REQ_day-view §3.6）
      prevBtn.textContent = '\u2039'; // ‹

      var nextBtn = document.createElement('button');
      nextBtn.className = 'kc-btn kc-btn--icon';
      nextBtn.setAttribute('data-action', 'next');
      nextBtn.setAttribute('aria-label', '次の月');  // デフォルト view が month のため（REQ_day-view §3.6）
      nextBtn.textContent = '\u203A'; // ›

      var rangeLabel = document.createElement('div');
      rangeLabel.className = 'kc-range';
      rangeLabel.id = 'kc-range-label';
      rangeLabel.setAttribute('aria-live', 'polite');
      rangeLabel.textContent = 'yyyy年MM月';

      headLeft.appendChild(title);
      headLeft.appendChild(todayBtn);
      headLeft.appendChild(prevBtn);
      headLeft.appendChild(nextBtn);
      headLeft.appendChild(rangeLabel);

      // ヘッダー右（ビュードロップダウン）
      var headRight = document.createElement('div');
      headRight.className = 'kc-head-right';

      var dropdown = document.createElement('div');
      dropdown.className = 'kc-dropdown';
      dropdown.id = 'kc-view';

      var viewBtn = document.createElement('button');
      viewBtn.className = 'kc-dropdown-btn';
      viewBtn.id = 'kc-view-select';
      viewBtn.setAttribute('aria-haspopup', 'listbox');
      viewBtn.setAttribute('aria-expanded', 'false');
      viewBtn.textContent = '月 ';
      var caret = document.createElement('span');
      caret.className = 'kc-caret';
      caret.textContent = '\u25BE'; // ▾
      viewBtn.appendChild(caret);

      var menuUl = document.createElement('ul');
      menuUl.className = 'kc-dropdown-menu';
      menuUl.setAttribute('role', 'listbox');
      menuUl.setAttribute('aria-label', '表示切替');

      // 月ビューオプション（デフォルト選択: REQ_day-view §3.4）
      var optMonth = document.createElement('li');
      optMonth.className = 'kc-option';
      optMonth.setAttribute('role', 'option');
      optMonth.dataset.value = 'month';
      optMonth.setAttribute('aria-selected', 'true');
      optMonth.textContent = '月';
      menuUl.appendChild(optMonth);

      // 週ビューオプション（REQ_day-view §3.4）
      var optWeek = document.createElement('li');
      optWeek.className = 'kc-option';
      optWeek.setAttribute('role', 'option');
      optWeek.dataset.value = 'week';
      optWeek.setAttribute('aria-selected', 'false');
      optWeek.textContent = '週';
      menuUl.appendChild(optWeek);

      // 日ビューオプション（REQ_day-view §3.4）
      var optDay = document.createElement('li');
      optDay.className = 'kc-option';
      optDay.setAttribute('role', 'option');
      optDay.dataset.value = 'day';
      optDay.setAttribute('aria-selected', 'false');
      optDay.textContent = '日';
      menuUl.appendChild(optDay);

      dropdown.appendChild(viewBtn);
      dropdown.appendChild(menuUl);
      headRight.appendChild(dropdown);

      // 全画面表示ボタン（通常時に表示）
      var fullscreenBtn = document.createElement('button');
      fullscreenBtn.className = 'kc-btn kc-btn--icon kc-fullscreen-btn';
      fullscreenBtn.id = 'kc-fullscreen-btn';
      fullscreenBtn.setAttribute('aria-label', '全画面表示');
      fullscreenBtn.title = '全画面表示';
      fullscreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg> 全画面表示';
      headRight.appendChild(fullscreenBtn);

      // 全画面を閉じるボタン（全画面時のみ表示）
      var exitFullscreenBtn = document.createElement('button');
      exitFullscreenBtn.className = 'kc-btn kc-exit-fullscreen-btn';
      exitFullscreenBtn.id = 'kc-exit-fullscreen-btn';
      exitFullscreenBtn.innerHTML = '✕ 全画面を閉じる';
      headRight.appendChild(exitFullscreenBtn);

      header.appendChild(headLeft);
      header.appendChild(headRight);

      // グリッドラッパー
      var gridWrap = document.createElement('section');
      gridWrap.className = 'kc-grid-wrap';
      gridWrap.setAttribute('aria-label', 'カレンダー');

      // 曜日ヘッダー
      var daysDiv = document.createElement('div');
      daysDiv.className = 'kc-days';
      daysDiv.id = 'kc-days';

      var spacerLeft = document.createElement('div');
      spacerLeft.className = 'kc-day-spacer-left';
      spacerLeft.setAttribute('aria-hidden', 'true');

      var spacerRight = document.createElement('div');
      spacerRight.className = 'kc-day-spacer-right';
      spacerRight.setAttribute('aria-hidden', 'true');

      daysDiv.appendChild(spacerLeft);
      daysDiv.appendChild(spacerRight);

      // 終日スロット
      var alldayDiv = document.createElement('div');
      alldayDiv.className = 'kc-allday';
      alldayDiv.id = 'kc-allday';

      // スクロールボディ
      var bodyDiv = document.createElement('div');
      bodyDiv.className = 'kc-body';
      bodyDiv.id = 'kc-body';

      var timeCol = document.createElement('aside');
      timeCol.className = 'kc-time-col';
      timeCol.id = 'kc-time-col';

      var rowsDiv = document.createElement('div');
      rowsDiv.className = 'kc-rows';
      rowsDiv.id = 'kc-rows';

      bodyDiv.appendChild(timeCol);
      bodyDiv.appendChild(rowsDiv);

      gridWrap.appendChild(daysDiv);
      gridWrap.appendChild(alldayDiv);
      gridWrap.appendChild(bodyDiv);

      root.appendChild(header);
      root.appendChild(gridWrap);
    },

    /** スクロールバー幅をCSS変数にセット */
    _setScrollbarVar: function () {
      var body = document.getElementById('kc-body');
      if (!body) return;
      var sbw = body.offsetWidth - body.clientWidth;
      document.documentElement.style.setProperty(
        '--kc-scrollbar-w',
        sbw > 0 ? sbw + 'px' : '0px'
      );
    },

    /** 全画面表示（CSS fixed方式）を有効化 */
    _enterExpanded: function (root) {
      root.classList.add('kc-expanded');
      var exitBtn = document.getElementById('kc-exit-fullscreen-btn');
      var fsBtn = document.getElementById('kc-fullscreen-btn');
      if (exitBtn) exitBtn.style.display = 'inline-flex';
      if (fsBtn) fsBtn.style.display = 'none';
      // FR-7: 全画面 ON = デフォルト状態のため fs パラメータを除去する（fs なし = 全画面）
      if (KC.UrlState) KC.UrlState.remove('fs');
      // P-3: 全画面切替後にセル高が変わるため再描画する。
      // KC.Render.renderGrid() を経由することで placeMonthEvents も 1 回だけスケジュールされる
      // （renderGrid ファサード内の rAF + placeMonthEvents チェーンに委ねる）。
      // データ再取得は不要なため refresh() ではなく renderGrid() を使用する。
      KC.Render.renderGrid();
    },

    /** 全画面表示を解除 */
    _exitExpanded: function (root) {
      root.classList.remove('kc-expanded');
      var exitBtn = document.getElementById('kc-exit-fullscreen-btn');
      var fsBtn = document.getElementById('kc-fullscreen-btn');
      if (exitBtn) exitBtn.style.display = 'none';
      if (fsBtn) fsBtn.style.display = '';
      // FR-7: 全画面解除 = 非デフォルト状態のため fs=0 を記録する（fs=0 = 全画面解除）
      if (KC.UrlState) KC.UrlState.update('fs', '0');
      // P-3: 全画面解除後にセル高が変わるため再描画する（renderGrid 経由で placeMonthEvents も 1 回のみ実行）
      KC.Render.renderGrid();
    },

    /**
     * prev/next ボタンの aria-label を現在の view に合わせて更新する（REQ_day-view §3.6）
     * view 切替時に KC.Render.refresh 経由で呼ばれるよう外部公開する
     * P-10/B-P1: KC.State.els.prevBtn/nextBtn を優先参照し、DOM クエリを削減する
     */
    _updateNavAriaLabels: function () {
      var labels = {
        month: { prev: '前の月', next: '次の月' },
        week:  { prev: '前の週', next: '次の週' },
        day:   { prev: '前の日', next: '次の日' }
      };
      var v = labels[KC.State.view] || labels.week;
      // KC.State.els が refreshEls() 後に確定している場合はキャッシュを使用する（DOM クエリ不要）
      var els = KC.State.els || {};
      var prevBtn = els.prevBtn || document.querySelector('[data-action="prev"]');
      var nextBtn = els.nextBtn || document.querySelector('[data-action="next"]');
      if (prevBtn) prevBtn.setAttribute('aria-label', v.prev);
      if (nextBtn) nextBtn.setAttribute('aria-label', v.next);
    },

    /**
     * 初期化
     * @param {string|number|null} [viewId] - app.record.index.show の event.viewId
     */
    init: async function (viewId) {
      var root = document.getElementById('kc-root');
      if (!root) return;

      // フィルタ設定を localStorage から復元（DOM 構築前に行う）
      KC.FilterDropdown.loadFilter();

      // プラグイン設定を読み込み KC.Config を上書きする（detectFields より前に呼ぶ）
      // 設定なし / 必須フィールド未入力の場合はハードコード値を維持し、detectFields でフォールバック
      KC.Config.loadFromPluginConfig(viewId);

      // SearchFilter の検索対象フィールドをプラグイン設定から初期化する（Phase 2）
      // searchTargets が空の場合は何もマッチしない動作になる（v7 以降はタイトルが初期値として設定済み）
      KC.SearchFilter._searchTargets = KC.Config.SEARCH_TARGETS || [];
      // REFERENCE_TABLE フィールド定義は非同期で取得するため、フォールバック用にリセットしておく
      KC.SearchFilter._refTableDefsLoaded = false;
      KC.SearchFilter._refTableDefs = {};
      KC.SearchFilter._relatedRecordsCache = {};
      KC.SearchFilter._relatedRecordsFetchedAt = 0; // P-6: TTL キャッシュ用タイムスタンプ初期化

      // P-12: REFERENCE_TABLE フィールドが searchTargets に存在するかを事前フラグとして保持する
      // _refreshImmediate での loadRelatedRecords 呼び出し判定に使用する
      KC.SearchFilter._hasRefTableTarget = KC.SearchFilter._searchTargets.some(function (t) {
        return t.fieldType === 'REFERENCE_TABLE';
      });

      // P-1/P-2: detectFields と detectAppName を並列実行して初期化レイテンシを削減する
      // detectFields の戻り値（resp.properties）は P-2 で _loadRefTableDefs が再利用する
      // detectAppName は calendarTitle 設定済みならスキップ
      var detectAppNamePromise = KC.Config.CALENDAR_TITLE
        ? Promise.resolve()
        : KC.Config.detectAppName();

      var fieldsProps = await KC.Config.detectFields(); // P-2: properties を受け取る

      // P-1: detectAppName の完了を待つ（detectFields と並列実行した場合に未完了の可能性）
      await detectAppNamePromise;

      // P-2: REFERENCE_TABLE が searchTargets に含まれる場合は detectFields の結果を再利用して
      // フィールド定義を取得する（同一エンドポイントへの重複 API コールを回避）
      // await して完了後に初期描画へ進むことで、初回描画時に _refTableDefs が空のまま
      // matchField が呼ばれる問題を防ぐ。失敗してもカレンダー表示には影響しない
      if (KC.SearchFilter._hasRefTableTarget) {
        try {
          // fieldsProps が null（detectFields 失敗時）の場合は _loadRefTableDefs が自前で API を叩く
          await KC.SearchFilter._loadRefTableDefs(fieldsProps);
        } catch (err) {
          console.warn('[KC.Boot] _loadRefTableDefs 失敗（継続）:', err);
        }
      }

      // ログインユーザー情報をキャッシュ（権限判定に使用）
      // USER_SELECT のみ対応のため同期呼び出しで十分
      KC.LoginContext.init();

      // P-13: 祝日データを非同期取得（await しない: 初回はハードコードで即時描画し、取得完了後に再描画）
      // CSP で外部 API がブロックされた場合は console.warn のみ出力して継続する
      // 祝日データはグリッド描画関数内で KC.Holidays.getName() を参照するため
      // renderGrid() のみで正しく反映される（loadEvents 不要）
      KC.Holidays.fetchHolidays().then(function () {
        if (KC.State.view === 'month' || KC.State.view === 'week' || KC.State.view === 'day') {
          KC.Render.renderGrid(); // P-13: refresh() → renderGrid()（loadEvents を省略して余分な API コール削減）
        }
      });

      // DOM構築
      this._buildDOM();

      // アプリ名を DOM に反映（detectAppName 完了済みだが、念のため再設定）
      var titleEl = document.querySelector('.kc-title');
      if (titleEl) titleEl.textContent = KC.Config.APP_NAME;

      // DOM参照取得
      KC.State.refreshEls();

      // ナビゲーションボタン
      var S = KC.State;
      var R = KC.Render;

      /**
       * prev/next ボタンの aria-label を現在の view に合わせて更新する（REQ_day-view §3.6）
       * 外部公開済みの KC.Boot._updateNavAriaLabels に委譲する
       */
      function _updateNavAriaLabels() {
        KC.Boot._updateNavAriaLabels();
      }

      if (S.els.prevBtn) {
        S.els.prevBtn.addEventListener('click', function () {
          // ドラッグ中の場合はキャンセルしてから移動（§10.2）
          KC.DnD._cancel();
          S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          // view 別分岐: 月は月単位、日は1日単位、週は7日単位（REQ_day-view §3.6）
          if (S.view === 'month') {
            S.current.setMonth(S.current.getMonth() - 1);
          } else if (S.view === 'day') {
            S.current.setDate(S.current.getDate() - 1);
          } else {
            S.current.setDate(S.current.getDate() - 7);
          }
          // FR-1: ナビゲーション操作を URL ハッシュに同期する（replaceState）
          if (KC.UrlState) KC.UrlState.syncViewDate();
          _updateNavAriaLabels();
          R.refresh();
        });
      }

      if (S.els.todayBtn) {
        S.els.todayBtn.addEventListener('click', function () {
          // ドラッグ中の場合はキャンセルしてから今日へ（§10.2）
          KC.DnD._cancel();
          S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          S.current = new Date();     // view によらず今日へ（REQ_month-view §3.8）
          // FR-1: today ボタン操作を URL ハッシュに同期する（replaceState）
          if (KC.UrlState) KC.UrlState.syncViewDate();
          R.refresh();
        });
      }

      if (S.els.nextBtn) {
        S.els.nextBtn.addEventListener('click', function () {
          // ドラッグ中の場合はキャンセルしてから移動（§10.2）
          KC.DnD._cancel();
          S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          // view 別分岐: 月は月単位、日は1日単位、週は7日単位（REQ_day-view §3.6）
          if (S.view === 'month') {
            S.current.setMonth(S.current.getMonth() + 1);
          } else if (S.view === 'day') {
            S.current.setDate(S.current.getDate() + 1);
          } else {
            S.current.setDate(S.current.getDate() + 7);
          }
          // FR-1: ナビゲーション操作を URL ハッシュに同期する（replaceState）
          if (KC.UrlState) KC.UrlState.syncViewDate();
          _updateNavAriaLabels();
          R.refresh();
        });
      }

      // 列数デフォルト
      document.documentElement.style.setProperty('--kc-col-count', '7');

      // スクロールバー幅 → CSS変数
      this._setScrollbarVar();
      var self = this;
      // P-4: リサイズ時の _setScrollbarVar は ResizeObserver 側（kc-body 監視）に専任させる。
      // window.resize ハンドラでは月ビュー再描画のみ行い、_setScrollbarVar の二重呼び出しを排除する。
      var _resizeTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          if (KC.State.view === 'month' && KC.RenderMonth) {
            // ポップオーバーを先に閉じる（グリッドクリア前に確実に閉じるため）
            if (KC.MonthOverflowPopup) KC.MonthOverflowPopup.close();
            // 月ルートが非表示の場合に表示状態を回復してから再描画（_calcMaxItems の height=0 回避）
            KC.RenderMonth._showMonthDOM();
            // データ再取得なし・レイアウト再計算のみ
            KC.RenderMonth.renderGrid();
            // セル高が確定してから placeMonthEvents を呼ぶ（refresh と同様）
            requestAnimationFrame(function () {
              KC.RenderMonth.placeMonthEvents();
            });
          }
        }, 200);
      });
      var bodyEl = document.getElementById('kc-body');
      if (bodyEl && 'ResizeObserver' in window) {
        var obs = new ResizeObserver(function () { self._setScrollbarVar(); });
        obs.observe(bodyEl);
      }

      // TimeSlots パッチ適用
      KC.TimeSlots.patchRenderGrid();

      // ViewDropdown 初期化
      KC.ViewDropdown.init();

      // SearchFilter 初期化（検索欄 UI を FilterDropdown の左に追加）
      var sfHeadRight = document.querySelector('.kc-head-right');
      if (sfHeadRight) {
        KC.SearchFilter.buildDOM(sfHeadRight);
      }

      // FilterDropdown 初期化（フィルタドロップダウン UI を .kc-head-right に追加）
      KC.FilterDropdown.init();

      // 全画面ボタンのイベント登録
      var fullscreenBtn = document.getElementById('kc-fullscreen-btn');
      var exitFullscreenBtn = document.getElementById('kc-exit-fullscreen-btn');
      var bootSelf = this;

      if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', function () {
          var rootEl = document.getElementById('kc-root');
          if (rootEl) bootSelf._enterExpanded(rootEl);
        });
      }

      if (exitFullscreenBtn) {
        exitFullscreenBtn.addEventListener('click', function () {
          var rootEl = document.getElementById('kc-root');
          if (rootEl) bootSelf._exitExpanded(rootEl);
        });
      }

      // ESCキーで全画面解除
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var rootEl = document.getElementById('kc-root');
          if (rootEl && rootEl.classList.contains('kc-expanded')) {
            bootSelf._exitExpanded(rootEl);
          }
        }
      });

      // 初回描画
      R.refresh();

      // 初期表示で全画面
      this._enterExpanded(root);

      // FR-10（Phase 1 + Phase 2）: popstate リスナーを登録する
      // replaceState 系（view/date/filter）: 差分更新
      // pushState 系（record/new/more）: パラメータ消滅検知 → クローズ / 再オープン
      window.addEventListener('popstate', function () {
        if (KC.UrlState._isUpdatingHash()) return;  // 自己書き換え無視（FR-11）
        // P-14: 外部からの popstate（ブラウザ戻る/進む）は _parseCurrent キャッシュを汚染するため
        // KC.UrlState.parse を直接使って最新ハッシュを取得する（_parseCurrent は使わない）
        var params = KC.UrlState.parse(window.location.hash);
        // #kc: プレフィクスなし → 無視（AC-13）
        if (!window.location.hash || window.location.hash.indexOf('#kc:') !== 0) {
          // ハッシュが完全に消えた場合もモーダル/ポップオーバーを閉じる
          if (KC.Popup._iframe) KC.Popup._close();
          if (KC.MonthOverflowPopup && KC.MonthOverflowPopup.close) KC.MonthOverflowPopup.close();
          return;
        }

        // --- pushState 系パラメータの消滅検知（FR-4/FR-5/FR-6 popstate 連動） ---

        // record / new が消えた かつ モーダルが開いている → 閉じる（ブラウザ「戻る」AC-7 対応）
        // _close() 内で remove() を呼ぶと replaceState が発火するが、
        // popstate ハンドラ内の _isUpdatingHash() ガードが機能しているため再帰しない
        if (!params.record && !params['new'] && KC.Popup._iframe) {
          KC.Popup._close();
        }
        // record が戻った（「進む」） → モーダルを再オープン（T-3 step 5/6）
        // openEdit 内で get('record') === rId を比較するため push は自然にスキップされる
        if (params.record && !KC.Popup._iframe) {
          var rId = String(params.record).trim();
          if (/^\d+$/.test(rId)) {
            KC.Api.getRecord(rId).then(function () {
              KC.Popup.openEdit(rId);
            }).catch(function () {
              KC.Banner.show('指定されたレコードが見つかりません', { hideReload: true });
              KC.UrlState.remove('record');
            });
          }
        }
        // new が戻った（「進む」） → 新規作成モーダルを再オープン
        // openCreate 内で get('new') === newParam を比較するため push は自然にスキップされる
        if (params['new'] && !KC.Popup._iframe) {
          var newStr = params['new'];
          var m = newStr.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/);
          if (m) {
            var opts = { date: m[1], allday: !m[2] };
            if (m[2]) { opts.hour = parseInt(m[2], 10); opts.minute = parseInt(m[3], 10); }
            KC.Popup.openCreate(opts);
          }
        }

        // more が消えた かつ ポップオーバーが開いている → 閉じる（AC-12）
        // isOpen() で開閉状態を確認してから close() を呼ぶ（§7.4 擬似コードと一致）
        if (!params.more && KC.MonthOverflowPopup && KC.MonthOverflowPopup.isOpen && KC.MonthOverflowPopup.isOpen()) {
          KC.MonthOverflowPopup.close();
        }
        // more が戻った（「進む」） → ポップオーバーを再オープン
        // open 内で get('more') === ymd を比較するため push は自然にスキップされる
        if (params.more && KC.State.view === 'month') {
          var ymd = params.more;
          if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
            requestAnimationFrame(function () {
              var moreEl = document.querySelector('[data-date="' + ymd + '"] .kc-month-more');
              if (moreEl && KC.MonthOverflowPopup) {
                KC.MonthOverflowPopup.open(moreEl, ymd, KC.MonthOverflowPopup.getHiddenEvents(moreEl));
              }
            });
          }
        }

        // --- replaceState 系パラメータの差分更新 ---

        var curView = KC.State.view;
        var validViews = { month: true, week: true, day: true };
        var changed = false;

        // view の差分更新
        if (params.view && validViews[params.view] && params.view !== curView) {
          KC.State.view = params.view;
          changed = true;
        }
        // date の差分更新（KC.UrlState.parseDate を共用して DRY 化）
        if (params.date) {
          var parsedDt = KC.UrlState.parseDate(params.date);
          if (parsedDt) {
            KC.State.current = parsedDt;
            changed = true;
          }
        }
        if (changed) {
          KC.Render._refreshImmediate();
        }

        // filter の差分更新（replaceState で書き換わった場合）
        if (params.filter && (params.filter === 'all' || params.filter === 'mine' || params.filter === 'others')) {
          if (params.filter !== KC.State.eventFilter) {
            KC.State.eventFilter = params.filter;
            KC.Render.renderGrid();
          }
        }
      });

      // URL ハッシュからの状態復元（Phase 1: view/date/filter/q/fs/scroll）
      // _enterExpanded 後に呼ぶことで全画面の ON/OFF を正しく制御できる
      KC.UrlState.restore();

      // アプリ管理権限を確認し、権限あれば設定ボタンを表示する
      // 初回描画完了後に非同期で実行するため、権限判定の失敗はカレンダー動作に影響しない
      this._checkAppAdminPermission().then(function () {
        bootSelf._insertSettingsButton();
      });

      _log('[KC.Boot] init complete');
    }
  };

  /* ====================================================================
   * グローバルにリフレッシュ関数を公開（ポップアップから呼ばれる）
   * ==================================================================== */
  window.KC_REFRESH = function () {
    // ポップアップ保存後の即時更新: debounce を経由せず直ちに描画する
    if (KC && KC.Render && typeof KC.Render._refreshImmediate === 'function') {
      KC.Render._refreshImmediate();
    }
  };

  /* ====================================================================
   * kintone.events 登録
   * ==================================================================== */
  kintone.events.on('app.record.index.show', function (event) {
    if (event.viewType !== 'custom') return event;

    if (KC.Boot._initialized) {
      // ビュー再表示時: 検索クエリをリセットして入力欄を空にする（FR-9）
      KC.SearchFilter.query = '';
      KC.SearchFilter.activeIndex = -1;
      KC.SearchFilter._matchList = [];
      var srchInput = document.getElementById('kc-search-input');
      if (srchInput) srchInput.value = '';
      KC.SearchFilter._syncClearBtn('');
      KC.Render.refresh();
      return event;
    }

    KC.Boot._initialized = true;
    // event.viewId（kintone ビュー ID）をビュー個別設定の読み込みに使用する
    // kintone.app.getViewId() は存在しないため event オブジェクトから取得する
    KC.Boot.init(event.viewId); // async だが return event は即座に返す
    return event;
  });

  /* ====================================================================
   * 新規作成画面でのフィールド自動セット（ポップアップ内で発火）
   * ==================================================================== */
  kintone.events.on('app.record.create.show', function (event) {
    var ctx = sessionStorage.getItem('KC_CREATE_CONTEXT');
    if (!ctx) return event;
    sessionStorage.removeItem('KC_CREATE_CONTEXT');

    var data = JSON.parse(ctx);
    // 親ウィンドウで保存した FIELD 設定を優先して使用する
    // （ポップアップ側では detectFields が完了していない場合があるため）
    var savedFieldConfig = sessionStorage.getItem('KC_FIELD_CONFIG');
    var F;
    if (savedFieldConfig) {
      try {
        F = JSON.parse(savedFieldConfig);
      } catch (err) {
        console.warn('[KC] KC_FIELD_CONFIG のパース失敗。フォールバック使用:', err);
        F = KC.Config.FIELD;
      }
    } else {
      F = KC.Config.FIELD;
    }
    // START_FIELD_TYPE を sessionStorage から取得する
    // ポップアップ側では detectFields が完了していないため KC.Config.START_FIELD_TYPE が未設定の場合がある
    var savedFieldType = sessionStorage.getItem('KC_START_FIELD_TYPE');
    var fieldType = savedFieldType || KC.Config.START_FIELD_TYPE || 'DATETIME';
    // ALLDAY_LABEL を sessionStorage から取得する（DATETIME + 終日ケースで必須）
    // KC.Config.ALLDAY_LABEL のデフォルト値とアプリ設定値が不一致の環境で「終日」チェックが入らない問題に対処
    var savedAlldayLabel = sessionStorage.getItem('KC_ALLDAY_LABEL');
    var alldayLabel = savedAlldayLabel || KC.Config.ALLDAY_LABEL || '終日';

    // メールアドレス初期値設定フラグを sessionStorage から取得する
    var mailLoginUserDefault = sessionStorage.getItem('KC_MAIL_LOGIN_USER_DEFAULT') === '1';

    var record = event.record;

    if (data.allday) {
      // 終日イベント
      if (fieldType === 'DATE') {
        record[F.start].value = data.date;
        record[F.end].value = data.date;
      } else {
        record[F.start].value = data.date + 'T00:00:00+09:00';
        // 終了は翌日
        var endDate = new Date(data.date);
        endDate.setDate(endDate.getDate() + 1);
        record[F.end].value = KC.Utils.fmtYMD(endDate) + 'T00:00:00+09:00';
      }
      if (F.allday && record[F.allday]) {
        record[F.allday].value = [alldayLabel];
      }
    } else {
      var pad2 = KC.Utils.pad2;
      var startTime = pad2(data.hour) + ':' + pad2(data.minute) + ':00';
      var endMinute = data.minute + 30;
      var endHour = data.hour;
      if (endMinute >= 60) { endMinute -= 60; endHour += 1; }
      var endTime = pad2(endHour) + ':' + pad2(endMinute) + ':00';

      if (fieldType === 'DATE') {
        record[F.start].value = data.date;
        record[F.end].value = data.date;
      } else {
        record[F.start].value = data.date + 'T' + startTime + '+09:00';
        record[F.end].value = data.date + 'T' + endTime + '+09:00';
      }
    }

    // ログインユーザー情報をセット
    var user = kintone.getLoginUser();
    // アカウントフィールド: 設定によらず常にセット（仕様）
    if (F.account && record[F.account]) record[F.account].value = [{ code: user.code }];
    // メールアドレスフィールド: mailLoginUserDefault が true の場合のみ新規作成時にセット
    if (mailLoginUserDefault && F.userMail && record[F.userMail]) {
      record[F.userMail].value = user.email || '';
    }

    // ポップアップ内でキャンセルボタンを監視して自動クローズする
    // kintone の新規作成キャンセルはURLを変えず任意のkintoneイベントも発火しないため、
    // DOM のキャンセルボタンを直接 MutationObserver で検知して window.close() を呼ぶ。
    if (window.opener) {
      _kcWatchCancelButton();
    }

    return event;
  });

  /**
   * kintone 新規作成フォームのキャンセルボタンを MutationObserver で待ち受け、
   * クリック時にポップアップを閉じる。
   * kintone の DOM は遅延描画されるため MutationObserver で確実に捕捉する。
   * 複数の selector を候補として試し、最初に見つかったボタンに listener を付ける。
   */
  function _kcWatchCancelButton() {
    // kintone 標準のキャンセルボタン selector 候補（バージョン差異に対応）
    var CANCEL_SELECTORS = [
      'a.gaia-ui-actionmenu-cancel',
      'button.gaia-ui-actionmenu-cancel',
      '[data-action="cancel"]',
      '.gaia-argoui-record-toolbar-cancel',
      'a[href*="cancel"]'
    ];

    var _attached = false;

    function _attachListener(btn) {
      if (_attached) return;
      _attached = true;
      btn.addEventListener('click', function () {
        // kintone のフォームリセット完了後に閉じる（遅延なしでも動作するが念のため）
        setTimeout(function () {
          try { window.close(); } catch (e) { console.warn('[KC] cancel close failed:', e); }
        }, 100);
      });
      _log('[KC] cancel button listener attached:', btn.className || btn.tagName);
    }

    function _findAndAttach() {
      for (var si = 0; si < CANCEL_SELECTORS.length; si++) {
        var btn = document.querySelector(CANCEL_SELECTORS[si]);
        if (btn) {
          _attachListener(btn);
          return true;
        }
      }
      return false;
    }

    // 即時チェック（DOM がすでに描画済みの場合）
    if (_findAndAttach()) return;

    // MutationObserver で DOM の変化を監視しキャンセルボタン出現を待つ
    var observer = new MutationObserver(function () {
      if (_findAndAttach()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 10 秒後に自動切断（永続監視防止）
    setTimeout(function () { observer.disconnect(); }, 10000);
  }

  /* ====================================================================
   * 保存成功後にポップアップを閉じてカレンダーを更新
   * ==================================================================== */
  kintone.events.on([
    'app.record.create.submit.success',
    'app.record.edit.submit.success'
  ], function (event) {
    if (window.opener) {
      // 親ウィンドウのカレンダーをリフレッシュ
      try { window.opener.KC_REFRESH && window.opener.KC_REFRESH(); } catch (e) {}
      window.close();
      return event;
    }
    return event;
  });

  /* ====================================================================
   * 削除成功後も同様
   * ==================================================================== */
  kintone.events.on('app.record.detail.delete.submit', function (event) {
    if (window.opener) {
      try { window.opener.KC_REFRESH && window.opener.KC_REFRESH(); } catch (e) {}
      // 削除の場合はリダイレクトを防ぎ、ウィンドウを閉じる
      setTimeout(function () { window.close(); }, 500);
    }
    return event;
  });

  /* ====================================================================
   * ポップアップウィンドウ自動クローズ
   *
   * 仕様:
   *   - openCreate で開いた場合: 初回が create.show。ユーザーがキャンセルすると
   *     index.show / detail.show / edit.show のいずれかへ遷移する。いずれの
   *     遷移でも close する。
   *   - openEdit で開いた場合: 初回が detail.show。ユーザーが編集ボタンで
   *     edit.show に入った後にキャンセルすると detail.show に戻る。
   *     edit.show 経由かどうかをフラグで判定し、戻り後に close する。
   *
   * 単発の index.show / edit.show は kintone のバージョン・設定により
   *   - URL `/k/{appId}/edit` でキャンセル → 親ウィンドウ URL は `/k/{appId}/`
   *     になるが、ポップアップではポップアップ自身の遷移として index.show /
   *     edit.show / detail.show のいずれかが発火する（環境差あり）
   * という挙動のばらつきがあるため、初回イベントを起点にした状態遷移で
   * 確実に close する。
   *
   * window.opener が null（= 親ウィンドウからの通常導線でない）の場合は
   * 何もしない（親ウィンドウ側の index.show は KC.Boot.init を発火させる
   * ので、ここでは扱わない）
   * ==================================================================== */
  var _kcInitialEvent = null;     // ポップアップで最初に発火したイベント名
  var _kcWasInEditMode = false;   // openEdit 起動後 edit.show を経由したか

  /**
   * ポップアップを閉じる（window.opener がある場合のみ）
   * 一覧 KC.Boot のリフレッシュは親ウィンドウのウィンドウクローズ監視
   * （openCreate / openEdit 内 setInterval）に任せる
   */
  function _kcClosePopupIfNeeded() {
    if (window.opener) {
      try { window.close(); } catch (e) { console.warn('[KC] popup close failed:', e); }
    }
  }

  /**
   * ポップアップ内のすべてのナビゲーションイベントを統合ハンドリングする
   * 初回イベントを記録し、以降の遷移パターンに応じて close するか判断する
   */
  kintone.events.on([
    'app.record.create.show',
    'app.record.edit.show',
    'app.record.detail.show',
    'app.record.index.show'
  ], function (event) {
    // 親ウィンドウ（一覧画面）の場合は別の index.show ハンドラに委ねる
    if (!window.opener) return event;

    if (_kcInitialEvent === null) {
      // 初回イベント: 起動画面を記録するだけで close しない
      _kcInitialEvent = event.type;
      if (event.type === 'app.record.edit.show') {
        // openEdit ではないルートで直接 edit.show 起動 = 通常ない想定
        _kcWasInEditMode = true;
      }
      return event;
    }

    // 2回目以降: 起動画面に応じて close 判断
    if (_kcInitialEvent === 'app.record.create.show') {
      // 新規作成からの遷移はすべてキャンセル扱い → close
      _kcClosePopupIfNeeded();
      return event;
    }

    if (_kcInitialEvent === 'app.record.detail.show') {
      // openEdit 起動: detail.show → edit.show → ... の遷移を追跡
      if (event.type === 'app.record.edit.show') {
        _kcWasInEditMode = true;
        return event;
      }
      // edit.show 経由後に detail.show に戻った = 編集キャンセル → close
      if (event.type === 'app.record.detail.show' && _kcWasInEditMode) {
        _kcClosePopupIfNeeded();
        return event;
      }
      // edit.show を経由していないのに index.show 等に遷移した場合も close
      if (event.type === 'app.record.index.show') {
        _kcClosePopupIfNeeded();
        return event;
      }
    }

    return event;
  });

})(kintone.$PLUGIN_ID);
