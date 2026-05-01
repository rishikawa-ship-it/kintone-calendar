/**
 * kc-calendar.js
 * kintone カスタマイズビュー用カレンダー（単一ファイル IIFE）
 *
 * 前提: カスタマイズビューHTML に <div id="kc-root" class="kc-root"></div> が設定済み
 */
(function () {
  'use strict';

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
      device:   { required: false, type: null },
      place:    { required: false, type: null },
      userName: { required: false, type: null },
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
      device:   '機器名',
      place:    '場所',
      userName: '利用者氏名',
      userMail: '利用者メールアドレス',
      account:  'アカウント',
      memo:     '説明欄'
    },

    // KC_start フィールドの型（detectFields で上書きされる）
    START_FIELD_TYPE: 'DATETIME',

    ALLDAY_LABEL: '終日',
    EXCLUDED_STATUSES: ['返却済', '削除済'],
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
          console.log('[KC] フィールド自動検出完了:', detected);
        } else {
          console.log('[KC] KC_プレフィックスのフィールドなし。デフォルト値を使用');
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
        console.log('[KC] START_FIELD_TYPE:', this.START_FIELD_TYPE);
      } catch (e) {
        console.error('[KC] フィールド検出エラー:', e);
        // エラー時はデフォルト値で続行
      }
    }
  };

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
     * 日本の祝日判定
     * getHolidayName(date) → 祝日名 or null
     */
    getHolidayName: function (date) {
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
    }
  };

  /* ====================================================================
   * KC.State — アプリケーション状態管理
   * ==================================================================== */
  KC.State = {
    view: 'week',
    current: new Date(),
    events: [],
    editing: null,
    alldayExpanded: false,   /* レーン展開トグル状態。初期値 false（折りたたみ）*/
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
      var ev = {
        id:       rec.$id.value,
        rev:      rec.$revision.value,
        created:  rec.$created ? rec.$created.value : '',  /* 作成日時 (ISO 8601) — assignLanes のソートキー */
        title:    self._safeVal(rec, F.title),
        device:   self._safeVal(rec, F.device),
        status:   self._safeVal(rec, F.status),
        color:    self._safeVal(rec, F.color),
        place:    self._safeVal(rec, F.place),
        userName: self._safeVal(rec, F.userName),
        userMail: self._safeVal(rec, F.userMail),
        account:  F.account && rec[F.account] ? ((rec[F.account].value || [])[0]?.code || '') : '',
        memo:     self._safeVal(rec, F.memo)
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

    /** 一覧取得 */
    loadEvents: async function (isoStart, isoEnd) {
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
      conditions.push('(' + F.end + ' > "' + qStart + '")');

      if (F.status) {
        var excluded = KC.Config.EXCLUDED_STATUSES.map(function (s) { return '"' + s + '"'; }).join(',');
        conditions.push('(' + F.status + ' not in (' + excluded + '))');
      }

      var query = conditions.join(' and ') + ' order by ' + F.start + ' asc limit ' + KC.Config.QUERY_LIMIT;

      // fields パラメータ（存在するフィールドのみ）
      // $created はシステムフィールドのため FIELD オブジェクトに含まれず明示追加
      var fieldList = ['$id', '$revision', '$created'];
      for (var key in F) {
        if (F[key]) fieldList.push(F[key]);
      }

      var url = kintone.api.url('/k/v1/records.json', true);
      var params = {
        app: KC.Config.getAppId(),
        query: query,
        fields: fieldList
      };

      var resp = await kintone.api(url, 'GET', params);
      var self = this;
      return (resp.records || []).map(function (r) { return self._recordToEvent(r); });
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
      this._safeSet(record, F.device,   ev.device || '');
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
      this._safeSet(record, F.userName, ev.userName || '');
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
      if ('device'   in ev && F.device)   record[F.device]   = { value: ev.device || '' };
      if ('status'   in ev && F.status)   record[F.status]   = { value: ev.status || '' };
      if ('userMail' in ev && F.userMail) record[F.userMail] = { value: ev.userMail || '' };
      if ('userName' in ev && F.userName) record[F.userName]  = { value: ev.userName || '' };
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

    /** ログインユーザー情報 */
    getLoginUser: function () {
      return kintone.getLoginUser();
    }
  };

  /* ====================================================================
   * KC.Popup — kintone標準画面をポップアップで開く
   * ==================================================================== */
  KC.Popup = {
    /** 新規作成ポップアップを開く */
    openCreate: function (options) {
      // options: { date, hour, minute, allday }
      sessionStorage.setItem('KC_CREATE_CONTEXT', JSON.stringify(options));
      var appId = KC.Config.getAppId();
      var url = '/k/' + appId + '/edit';
      var popup = window.open(url, 'kc_edit', 'width=1200,height=700,scrollbars=yes,resizable=yes');
      if (popup) {
        var checkClosed = setInterval(function () {
          if (popup.closed) {
            clearInterval(checkClosed);
            KC.Render.refresh();
          }
        }, 500);
      }
    },

    /** 編集（レコード詳細）ポップアップを開く */
    openEdit: function (recordId) {
      if (recordId === undefined || recordId === null || recordId === '') {
        console.error('[KC.Popup.openEdit] recordId が取得できていません:', recordId);
        alert('レコードIDの取得に失敗しました。コンソールを確認してください。');
        return;
      }
      var appId = KC.Config.getAppId();
      var url = '/k/' + appId + '/show#record=' + recordId;
      console.log('[KC.Popup.openEdit] open:', url);
      var popup = window.open(url, 'kc_edit', 'width=1200,height=700,scrollbars=yes,resizable=yes');
      if (popup) {
        var checkClosed = setInterval(function () {
          if (popup.closed) {
            clearInterval(checkClosed);
            KC.Render.refresh();
          }
        }, 500);
      }
    }
  };

  /* ====================================================================
   * KC.DnD — ドラッグ&ドロップ（移動/リサイズ）
   *
   * Phase 1: 終日予定の DnD（移動・左右リサイズ）＋共通基盤
   * Phase 2: 時間予定の DnD は別途実装（startMove / startResize は温存）
   * ==================================================================== */
  KC.DnD = (function () {
    /** DnD 定数 */
    var DND_THRESHOLD = 5;   // ドラッグ発動閾値（px）

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
    function _positionAlldayGhost(ghost, colStart, span, lane) {
      var BAR_H   = 22;
      var BAR_GAP = 3;
      var BAR_TOP = 4;
      ghost.style.left   = ((colStart / 7) * 100) + '%';
      ghost.style.width  = ((span / 7) * 100) + '%';
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

      // リスナ除去
      document.removeEventListener('mousemove', _onMouseMoveAllday);
      document.removeEventListener('mouseup', _onMouseUpAllday);
      document.removeEventListener('keydown', _onKeyDown);
      window.removeEventListener('blur', _cancel);

      document.body.classList.remove('kc-dnd-active');
      document.body.style.userSelect = '';
    }

    /**
     * 楽観的 UI 更新: State をインプレース更新 → renderGrid → API 送信
     * @param {Object} origEv - 元のイベントオブジェクト
     * @param {string} newStart - 新しい開始 ISO 文字列
     * @param {string} newEnd - 新しい終了 ISO 文字列
     */
    function _commitOptimistic(origEv, newStart, newEnd) {
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

      // 即時 UI 反映
      KC.Render.renderGrid();

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

        // ゴーストを allday レイヤに追加
        var alldayWrap = document.getElementById('kc-allday');
        var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
        if (eventsLayer && _drag.ghost) {
          eventsLayer.appendChild(_drag.ghost);
        }

        // ESC / blur キャンセル登録
        document.addEventListener('keydown', _onKeyDown);
        window.addEventListener('blur', _cancel);
      }

      if (_drag.type === 'move-allday') {
        _onMoveAlldayMove(e);
      } else if (_drag.type === 'resize-left' || _drag.type === 'resize-right') {
        _onResizeAlldayMove(e);
      }
    }

    /** 終日移動の mousemove 処理 */
    function _onMoveAlldayMove(e) {
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
      var clampedSpan = Math.min(spanDays, 7 - info.colIdx);
      _positionAlldayGhost(_drag.ghost, info.colIdx, clampedSpan, _drag.lane);
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

      _commitOptimistic(drag.ev, drag.newStart, drag.newEnd);
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
      _positionAlldayGhost(ghost, ev.colStart || 0, ev.span || 1, ev.lane || 0);

      _drag = {
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
      if (colEnd < 0) colEnd = 6;
      var span = colEnd - colStart + 1;
      if (span < 1) span = 1;

      _positionAlldayGhost(_drag.ghost, colStart, span, _drag.lane);
      _updateAlldayGhostLabel(_drag.ghost, newStartDate, newEndDate);
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
      _positionAlldayGhost(ghost, ev.colStart || 0, ev.span || 1, ev.lane || 0);

      _drag = {
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
    // 時間予定 DnD — Phase 2 で再構成（既存実装を温存）
    // =========================================================================

    /**
     * 時間予定の移動 DnD（Phase 2 で実装予定）
     * 現在は既存の壊れた実装を温存しているが、Phase 2 では _onMouseMoveAllday と同様の
     * 5px 閾値 + ゴースト生成パターンに書き換える。
     * @param {Object} ev - KcEvent
     * @param {MouseEvent} mousedown
     */
    function startMove(ev, mousedown) {
      // Phase 2 で実装
      // TODO: 5px 閾値、単一ゴースト、楽観更新を適用する
    }

    /**
     * 時間予定のリサイズ DnD（Phase 2 で実装予定）
     * @param {Object} ev - KcEvent
     * @param {'top'|'bottom'} side
     * @param {MouseEvent} mousedown
     */
    function startResize(ev, side, mousedown) {
      // Phase 2 で実装
    }

    // =========================================================================
    // ユーティリティ
    // =========================================================================

    /**
     * 現在表示週の 7 日分の YYYY-MM-DD 文字列配列を返す
     * @returns {string[]}
     */
    function _getWeekYMDs() {
      var S = KC.State;
      var U = KC.Utils;
      var d = new Date(S.current);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      var res = [];
      for (var i = 0; i < 7; i++) {
        res.push(U.fmtYMD(U.addDays(d, i)));
      }
      return res;
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
      startMoveAllday:   startMoveAllday,
      startResizeAllday: startResizeAllday,
      startMove:         startMove,
      startResize:       startResize,
      beginSelection:    beginSelection,
      _cancel:           _cancel
    };
  }());

  /* ====================================================================
   * KC.RenderWeek — 週ビューレンダラー
   * ==================================================================== */
  KC.RenderWeek = (function () {
    var U = KC.Utils;
    var S = KC.State;

    /** 色が明るいかどうかを判定するヘルパー */
    function isLightColor(color) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      var data = ctx.getImageData(0, 0, 1, 1).data;
      var luminance = (0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2]) / 255;
      return luminance > 0.6;
    }

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

    /**
     * 当週におけるイベントの表示位置を計算する
     * @param {Object} evt - KcEvent オブジェクト
     * @param {string[]} weekYMD - 当週 7 日の YYYY-MM-DD 文字列配列（index 0 = 日曜）
     * @returns {{ colStart: number, span: number, adDateRange: string } | null}
     *   当週に表示範囲がない場合は null
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

      // 当週の開始・終了を YYYY-MM-DD で取得
      var weekStartYMD = weekYMD[0];
      var weekEndYMD   = weekYMD[6];

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
     * 当週の終日イベントにレーン番号を付与する（破壊的変更）
     * ソート規則: created 昇順 → id 昇順（AC 4.16・4.17 対応）
     * @param {Array} weekEvents - eventToBarPosition の結果配列（colStart, span, created, id を含む）
     * @returns {Array} lane プロパティが付与された配列
     */
    function assignLanes(weekEvents) {
      // 作成日時昇順 → ID 昇順でソート
      weekEvents.sort(function (a, b) {
        if (a.created < b.created) return -1;
        if (a.created > b.created) return 1;
        return Number(a.id) - Number(b.id);
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
     * 折りたたみ時の表示レーン数を算出する
     * @param {number} maxLane - 当週の最大レーン番号（0 始まり）
     * @returns {number} 表示レーン数（1〜3 の範囲）
     */
    function calcCollapsedLanes(maxLane) {
      return Math.max(1, Math.min(maxLane + 1, 3));
    }

    /**
     * .kc-ad-event DOM 要素を生成する（1イベント = 1バー）
     * @param {Object} ev - 位置情報付き KcEvent（colStart, span, lane, adDateRange を含む）
     * @returns {HTMLElement}
     */
    function buildAlldayBar(ev) {
      // 高さ計算定数（CSS 変数と同値を使用）
      var BAR_H   = 22;   /* --kc-ad-bar-h */
      var BAR_GAP = 3;    /* --kc-ad-bar-gap */
      var BAR_TOP = 4;    /* --kc-ad-bar-top */

      var el = document.createElement('div');
      el.className = 'kc-ad-event';

      // 絶対配置の位置計算（§3.3 の計算式）
      el.style.left   = ((ev.colStart / 7) * 100) + '%';
      el.style.width  = ((ev.span / 7) * 100) + '%';
      el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
      el.style.height = BAR_H + 'px';

      // 色適用
      if (ev.color) {
        el.style.background  = ev.color;
        el.style.borderColor = ev.color;
        el.style.color = isLightColor(ev.color) ? '#1f2937' : '#ffffff';
      }

      // ホバーツールチップ（件名 + 日付範囲）
      el.title = (ev.title || '(無題)') + (ev.adDateRange ? '\n' + ev.adDateRange : '');

      // ドット
      var dot = document.createElement('span');
      dot.className = 'dot';
      if (ev.color) {
        dot.style.background = isLightColor(ev.color) ? '#1f2937' : '#ffffff';
      }

      // 件名のみ（Google カレンダー方式: 単一行・件名のみ表示）
      var titleSpan = document.createElement('span');
      titleSpan.className = 'kc-ad-evt-title';
      titleSpan.textContent = ev.title || '(無題)';  /* XSS 対策: textContent */

      el.appendChild(dot);
      el.appendChild(titleSpan);

      // 左端リサイズハンドル
      var leftHandle = document.createElement('div');
      leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
      leftHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAllday(ev, 'left', mdEvt, el);
      });

      // 右端リサイズハンドル
      var rightHandle = document.createElement('div');
      rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
      rightHandle.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        mdEvt.stopPropagation();
        KC.DnD.startResizeAllday(ev, 'right', mdEvt, el);
      });

      el.appendChild(leftHandle);
      el.appendChild(rightHandle);

      // クリック → 編集ポップアップ（AC 4.7）
      // 注: 5px 未満の mousedown→mouseup は click として処理される
      el.addEventListener('click', function (clickEvt) {
        clickEvt.stopPropagation();
        KC.Popup.openEdit(ev.id);
      });

      // mousedown → 終日 DnD 開始（バグ B 修正）
      el.addEventListener('mousedown', function (mdEvt) {
        if (mdEvt.button !== 0) return;
        // リサイズハンドルからの mousedown は stopPropagation されるためここには届かない
        KC.DnD.startMoveAllday(ev, mdEvt, el);
      });

      return el;
    }

    /**
     * レーン展開トグル UI を更新する
     * @param {HTMLElement} toggleEl - .kc-allday-toggle 要素
     * @param {number} maxLane - 当週の最大レーン番号（0 始まり）
     * @param {boolean} expanded - 現在の展開状態
     * @param {number} hiddenCount - 折りたたみ時に非表示になるイベント数（"+N" 表示用）
     */
    function updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount) {
      if (!toggleEl) return;

      if (maxLane < 3) {
        // 必要レーン数 ≤ 3 のときはトグルを非表示（AC 4.11）
        toggleEl.style.display = 'none';
        return;
      }

      toggleEl.style.display = 'flex';

      // ラベルを更新（XSS 対策: textContent）
      toggleEl.textContent = '';
      if (expanded) {
        toggleEl.textContent = '▲ 折りたたむ';
      } else {
        toggleEl.textContent = '▼ もっと表示 (+' + hiddenCount + ')';
      }
    }

    /** 時間ガター描画 */
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

    /** セルグリッド描画 */
    function renderRows() {
      var rows = S.els.rows;
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
          row.appendChild(cell);
        }
        rows.appendChild(row);
      }
    }

    /** イベント配置 */
    function placeEvents() {
      var alldayWrap = S.els.allday;

      // イベントバーレイヤをクリア
      var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
      var toggleEl    = alldayWrap ? alldayWrap.querySelector('.kc-allday-toggle') : null;
      if (eventsLayer) eventsLayer.innerHTML = '';

      // 通常イベントのオーバーレイをクリア（セル自体は保持）
      var rows = S.els.rows;
      if (!rows) return;
      rows.querySelectorAll('.kc-overlay').forEach(function (o) { o.remove(); });

      var range = weekRange(S.current);
      var weekYMD = [];
      for (var wi = 0; wi < 7; wi++) {
        weekYMD.push(U.fmtYMD(U.addDays(range.start, wi)));
      }

      // ===== 終日イベント: Google カレンダー方式（単一絶対配置バー）=====
      var weekEvents = [];
      (S.events || []).forEach(function (evt) {
        if (!evt.allday) return;
        var pos = eventToBarPosition(evt, weekYMD);
        if (!pos) return;
        // イベントオブジェクトと位置情報をマージ（元オブジェクトは破壊しない）
        weekEvents.push(Object.assign({}, evt, pos));
      });

      // レーン割り当て（created 昇順 → id 昇順ソート後にレーン計算）
      assignLanes(weekEvents);

      // 最大レーン番号を算出（イベントが 0 件のときは -1）
      var maxLane = weekEvents.reduce(function (m, ev) {
        return Math.max(m, ev.lane || 0);
      }, -1);

      // 折りたたみ時の表示レーン数: min(必要レーン数, 3)
      var collapsedLaneCount = calcCollapsedLanes(maxLane);

      // 展開時に隠れるイベント数（トグルラベル "+N" 用）
      var hiddenCount = weekEvents.filter(function (ev) { return ev.lane >= 3; }).length;

      // トグル UI を更新（maxLane < 3 のときは非表示）
      if (toggleEl) updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount);

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
        var bar = buildAlldayBar(ev);
        eventsLayer.appendChild(bar);
      });

      // ===== 行高の動的制御（AC 4.10・4.11・4.12 対応）=====
      if (alldayWrap) {
        // 高さ計算定数（CSS 変数と同値）
        var BAR_H    = 22;   /* --kc-ad-bar-h */
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

      // ===== 通常イベント配置 =====
      (S.events || []).forEach(function (evt) {
        if (evt.allday) return;  // 終日は上記で処理済み

        var s = new Date(evt.start);
        var e = new Date(evt.end);

        // 通常イベント配置（開始日のみに配置、跨ぎは24:00で切る）
        var dayIdx = weekYMD.indexOf(U.fmtYMD(s));
        if (dayIdx < 0) return;

        var startMin = s.getHours() * 60 + s.getMinutes();
        var endMin   = e.getHours() * 60 + e.getMinutes();
        if (U.fmtYMD(s) !== U.fmtYMD(e) || endMin <= startMin) {
          endMin = 24 * 60;
        }
        var totalMin = 24 * 60;
        var topPct    = (startMin / totalMin) * 100;
        var heightPct = ((endMin - startMin) / totalMin) * 100;

        var firstHourRow = rows.children[0];
        if (!firstHourRow) return;
        var colCell = firstHourRow.children[dayIdx];
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

        var div = document.createElement('div');
        div.className = 'kc-event';
        div.style.top    = 'calc(' + topPct + '% + 0px)';
        div.style.height = 'calc(' + heightPct + '% - 2px)';
        div.style.pointerEvents = 'auto';

        if (evt.color) {
          div.style.background = evt.color;
          div.style.borderColor = evt.color;
          div.style.color = isLightColor(evt.color) ? '#1f2937' : '#ffffff';
        }

        // XSS安全: textContent 使用
        var titleDiv = document.createElement('div');
        titleDiv.className = 'kc-evt-title';
        titleDiv.textContent = evt.title || '(無題)';

        var metaDiv = document.createElement('div');
        metaDiv.className = 'kc-evt-meta';
        // 同日: "M/D HH:MM ~ HH:MM" / 跨ぎ: "M/D HH:MM ~ M/D HH:MM"
        var sTimeStr = U.pad2(s.getHours()) + ':' + U.pad2(s.getMinutes());
        var eTimeStr = U.pad2(e.getHours()) + ':' + U.pad2(e.getMinutes());
        var sDateStr = (s.getMonth() + 1) + '/' + s.getDate();
        var eDateStr = (e.getMonth() + 1) + '/' + e.getDate();
        var sameDayWhole = (s.getFullYear() === e.getFullYear()) &&
                           (s.getMonth() === e.getMonth()) &&
                           (s.getDate() === e.getDate());
        var fullTimeStr = sameDayWhole
          ? (sDateStr + ' ' + sTimeStr + ' ~ ' + eTimeStr)
          : (sDateStr + ' ' + sTimeStr + ' ~ ' + eDateStr + ' ' + eTimeStr);
        metaDiv.textContent = fullTimeStr + (evt.device ? ' / ' + evt.device : '');

        if (evt.color) {
          metaDiv.style.color = isLightColor(evt.color) ? '#6b7280' : 'rgba(255,255,255,0.8)';
        }

        div.appendChild(titleDiv);
        div.appendChild(metaDiv);
        div.title = (evt.title || '') + '\n' + fullTimeStr;

        div.addEventListener('click', function (clickEvt) {
          clickEvt.stopPropagation();
          KC.Popup.openEdit(evt.id);
        });

        div.addEventListener('mousedown', function (mdEvt) {
          if (mdEvt.button !== 0) return;
          KC.DnD.startMove(evt, mdEvt);
        });

        overlay.appendChild(div);
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
      renderTimeGutter();
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
        S.events = await KC.Api.loadEvents(isoStart, isoEnd);
        KC.Render.renderGrid();
        KC.Render.refreshTitle();
      } catch (err) {
        console.error('[KC] loadEvents error:', err);
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
   * KC.RenderMonth — 月ビュー（スタブ）
   * ==================================================================== */
  KC.RenderMonth = {
    refresh: function () { /* 将来実装 */ },
    renderGrid: function () { /* 将来実装 */ },
    gridRange: function () {
      var S = KC.State;
      var y = S.current.getFullYear();
      var m = S.current.getMonth();
      var first = new Date(y, m, 1);
      var start = new Date(first);
      start.setDate(first.getDate() - first.getDay());
      var last = new Date(y, m + 1, 0);
      var end = new Date(last);
      end.setDate(last.getDate() + (6 - last.getDay()));
      return { start: start, end: end };
    }
  };

  /* ====================================================================
   * KC.RenderDay — 日ビュー（スタブ）
   * ==================================================================== */
  KC.RenderDay = {
    refresh: function () { /* 将来実装 */ },
    renderGrid: function () { /* 将来実装 */ },
    gridRange: function () {
      var S = KC.State;
      var d = S.current;
      var start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var end = new Date(start);
      return { start: start, end: end };
    }
  };

  /* ====================================================================
   * KC.Render — レンダラーファサード
   * ==================================================================== */
  KC.Render = {
    /** ビューに対応するモジュールを取得 */
    _pickModule: function () {
      var v = KC.State.view || 'week';
      if (v === 'week')  return KC.RenderWeek;
      if (v === 'month') return KC.RenderMonth;
      if (v === 'day')   return KC.RenderDay;
      return KC.RenderWeek;
    },

    /** 共通 refresh 入口 */
    refresh: function () {
      var root = document.getElementById('kc-root');
      if (!root) return;
      var m = this._pickModule();
      if (m && typeof m.refresh === 'function') {
        m.refresh();
      } else if (m && typeof m.renderGrid === 'function') {
        m.renderGrid();
      }
      this.refreshTitle();
    },

    /** renderGrid ファサード */
    renderGrid: function () {
      var root = document.getElementById('kc-root');
      if (!root) return;
      var m = this._pickModule();
      if (m && typeof m.renderGrid === 'function') {
        m.renderGrid();
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

    /** ヘッダーラベル生成 */
    _formatWeekMonthRange: function (date) {
      var range = this._weekRange(date);
      var sy = range.start.getFullYear();
      var sm = range.start.getMonth() + 1;
      var ey = range.end.getFullYear();
      var em = range.end.getMonth() + 1;
      var p2 = KC.Utils.pad2;

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
      var rows = S.els.rows;
      if (!rows) return;

      var rowElems = Array.from(rows.children);
      if (!rowElems.length) return;
      var firstRow = rowElems[0];
      var colCount = firstRow.children.length || 0;
      if (!colCount) return;

      var columnDates = this._getColumnDates(colCount);
      var self = this;

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
            slot.addEventListener('click', function (e) { self._onTimeSlotClick(e); });
            cell.appendChild(slot);
          }
        });
      });
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

    /** 時間セルクリック → ダイアログ表示 */
    _onTimeSlotClick: function (e) {
      e.preventDefault();
      e.stopPropagation();
      var slot = e.currentTarget;
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
        try {
          self.buildTimeSlots();
          self.bindAllDayBoxes();
          self.scrollToDefaultTime();
        } catch (err) {
          console.error('[KC.TimeSlots] decorate error', err);
        }
        return result;
      };

      this._patched = true;
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
      title.textContent = '貸与Wi-Fi予約カレンダー';

      var todayBtn = document.createElement('button');
      todayBtn.className = 'kc-btn kc-today';
      todayBtn.setAttribute('data-action', 'today');
      todayBtn.textContent = '今日';

      var prevBtn = document.createElement('button');
      prevBtn.className = 'kc-btn kc-btn--icon';
      prevBtn.setAttribute('data-action', 'prev');
      prevBtn.setAttribute('aria-label', '前の週');
      prevBtn.textContent = '\u2039'; // ‹

      var nextBtn = document.createElement('button');
      nextBtn.className = 'kc-btn kc-btn--icon';
      nextBtn.setAttribute('data-action', 'next');
      nextBtn.setAttribute('aria-label', '次の週');
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
      viewBtn.textContent = '週 ';
      var caret = document.createElement('span');
      caret.className = 'kc-caret';
      caret.textContent = '\u25BE'; // ▾
      viewBtn.appendChild(caret);

      var menuUl = document.createElement('ul');
      menuUl.className = 'kc-dropdown-menu';
      menuUl.setAttribute('role', 'listbox');
      menuUl.setAttribute('aria-label', '表示切替');

      var optWeek = document.createElement('li');
      optWeek.className = 'kc-option';
      optWeek.setAttribute('role', 'option');
      optWeek.dataset.value = 'week';
      optWeek.setAttribute('aria-selected', 'true');
      optWeek.textContent = '週';

      menuUl.appendChild(optWeek);
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
    },

    /** 全画面表示を解除 */
    _exitExpanded: function (root) {
      root.classList.remove('kc-expanded');
      var exitBtn = document.getElementById('kc-exit-fullscreen-btn');
      var fsBtn = document.getElementById('kc-fullscreen-btn');
      if (exitBtn) exitBtn.style.display = 'none';
      if (fsBtn) fsBtn.style.display = '';
    },

    /** 初期化 */
    init: async function () {
      var root = document.getElementById('kc-root');
      if (!root) return;

      // フィールド自動検出（KC_プレフィックスのフィールドを探す）
      await KC.Config.detectFields();

      // DOM構築
      this._buildDOM();

      // DOM参照取得
      KC.State.refreshEls();

      // ナビゲーションボタン
      var S = KC.State;
      var R = KC.Render;

      if (S.els.prevBtn) {
        S.els.prevBtn.addEventListener('click', function () {
          S.alldayExpanded = false;   // 週切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          S.current.setDate(S.current.getDate() - 7);
          R.refresh();
        });
      }

      if (S.els.todayBtn) {
        S.els.todayBtn.addEventListener('click', function () {
          S.alldayExpanded = false;   // 週切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          S.current = new Date();
          R.refresh();
        });
      }

      if (S.els.nextBtn) {
        S.els.nextBtn.addEventListener('click', function () {
          S.alldayExpanded = false;   // 週切り替え時はトグル状態をリセット（AC 4.14 / §3.6）
          S.current.setDate(S.current.getDate() + 7);
          R.refresh();
        });
      }

      // 列数デフォルト
      document.documentElement.style.setProperty('--kc-col-count', '7');

      // スクロールバー幅 → CSS変数
      this._setScrollbarVar();
      var self = this;
      window.addEventListener('resize', function () { self._setScrollbarVar(); });
      var bodyEl = document.getElementById('kc-body');
      if (bodyEl && 'ResizeObserver' in window) {
        var obs = new ResizeObserver(function () { self._setScrollbarVar(); });
        obs.observe(bodyEl);
      }

      // TimeSlots パッチ適用
      KC.TimeSlots.patchRenderGrid();

      // ViewDropdown 初期化
      KC.ViewDropdown.init();

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

      console.log('[KC.Boot] init complete');
    }
  };

  /* ====================================================================
   * グローバルにリフレッシュ関数を公開（ポップアップから呼ばれる）
   * ==================================================================== */
  window.KC_REFRESH = function () {
    if (KC && KC.Render && KC.Render.refresh) {
      KC.Render.refresh();
    }
  };

  /* ====================================================================
   * kintone.events 登録
   * ==================================================================== */
  kintone.events.on('app.record.index.show', function (event) {
    if (event.viewType !== 'custom') return event;

    if (KC.Boot._initialized) {
      KC.Render.refresh();
      return event;
    }

    KC.Boot._initialized = true;
    KC.Boot.init(); // async だが return event は即座に返す
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
    var F = KC.Config.FIELD;
    var record = event.record;

    if (data.allday) {
      // 終日イベント
      if (KC.Config.START_FIELD_TYPE === 'DATE') {
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
        record[F.allday].value = [KC.Config.ALLDAY_LABEL];
      }
    } else {
      var pad2 = KC.Utils.pad2;
      var startTime = pad2(data.hour) + ':' + pad2(data.minute) + ':00';
      var endMinute = data.minute + 30;
      var endHour = data.hour;
      if (endMinute >= 60) { endMinute -= 60; endHour += 1; }
      var endTime = pad2(endHour) + ':' + pad2(endMinute) + ':00';

      if (KC.Config.START_FIELD_TYPE === 'DATE') {
        record[F.start].value = data.date;
        record[F.end].value = data.date;
      } else {
        record[F.start].value = data.date + 'T' + startTime + '+09:00';
        record[F.end].value = data.date + 'T' + endTime + '+09:00';
      }
    }

    // ログインユーザー情報をセット
    var user = kintone.getLoginUser();
    if (F.userName && record[F.userName]) record[F.userName].value = user.name || '';
    if (F.userMail && record[F.userMail]) record[F.userMail].value = user.email || '';
    if (F.account && record[F.account]) record[F.account].value = [{ code: user.code }];

    return event;
  });

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

})();
