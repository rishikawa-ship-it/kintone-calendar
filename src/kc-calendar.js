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
      els.dlg      = $('kc-dialog');
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
      var fieldList = ['$id', '$revision'];
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
      await kintone.api(url, 'PUT', {
        app: KC.Config.getAppId(),
        id: ev.id,
        record: record
      });
      return { ok: true };
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
   * KC.Dialog — ダイアログ（作成/編集/削除）
   * ==================================================================== */
  KC.Dialog = {
    _built: false,

    /** <dialog> + フォームの DOM 生成（初回のみ） */
    ensureDOM: function () {
      if (this._built) return;
      this._built = true;

      var root = KC.State.els.root || document.getElementById('kc-root');
      if (!root) return;

      var dlg = document.createElement('dialog');
      dlg.id = 'kc-dialog';
      dlg.className = 'kc-dialog';

      // フォーム HTML（textContent で値セットするため placeholder のみ）
      // 存在しないフィールドの入力欄は非表示にする
      var F = KC.Config.FIELD;
      var html = '';
      html += '<div class="kc-dlg-inner">';
      html += '<h2 class="kc-dlg-title" id="kc-dlg-title">予定の作成</h2>';
      html += '<form method="dialog" class="kc-dlg-form" id="kc-dlg-form">';

      // 予定タイトル（必須）
      html += '<label class="kc-dlg-label">予定タイトル <span class="kc-required">*</span>';
      html += '<input type="text" id="kc-f-title" class="kc-dlg-input" required></label>';

      // 機器名
      html += '<label class="kc-dlg-label" id="kc-row-device"' + (F.device ? '' : ' style="display:none"') + '>機器名';
      html += '<input type="text" id="kc-f-device" class="kc-dlg-input"></label>';

      // 貸出ステータス
      html += '<label class="kc-dlg-label" id="kc-row-status"' + (F.status ? '' : ' style="display:none"') + '>貸出ステータス';
      html += '<select id="kc-f-status" class="kc-dlg-select">';
      html += '<option value="">（未設定）</option>';
      html += '<option value="予約済">予約済</option>';
      html += '<option value="貸出中">貸出中</option>';
      html += '<option value="返却済">返却済</option>';
      html += '</select></label>';

      // カレンダー色
      html += '<label class="kc-dlg-label" id="kc-row-color"' + (F.color ? '' : ' style="display:none"') + '>カレンダー色';
      html += '<input type="color" id="kc-f-color" class="kc-dlg-input kc-dlg-color" value="#eef2ff"></label>';

      // 開始日時（DATE型の場合は type="date"）
      var isDateType = (KC.Config.START_FIELD_TYPE === 'DATE');
      var dateInputType = isDateType ? 'date' : 'datetime-local';
      html += '<label class="kc-dlg-label">開始日時';
      html += '<input type="' + dateInputType + '" id="kc-f-start" class="kc-dlg-input"></label>';

      // 終了日時
      html += '<label class="kc-dlg-label">終了日時';
      html += '<input type="' + dateInputType + '" id="kc-f-end" class="kc-dlg-input"></label>';

      // 終日（DATE型の場合は非表示 — 常に終日扱い）
      var showAllday = F.allday && !isDateType;
      html += '<label class="kc-dlg-label kc-dlg-label--check" id="kc-row-allday"' + (showAllday ? '' : ' style="display:none"') + '>';
      html += '<input type="checkbox" id="kc-f-allday"> 終日</label>';

      // 場所
      html += '<label class="kc-dlg-label" id="kc-row-place"' + (F.place ? '' : ' style="display:none"') + '>場所';
      html += '<input type="text" id="kc-f-place" class="kc-dlg-input"></label>';

      // 利用者氏名
      html += '<label class="kc-dlg-label" id="kc-row-userName"' + (F.userName ? '' : ' style="display:none"') + '>利用者氏名';
      html += '<input type="text" id="kc-f-userName" class="kc-dlg-input"></label>';

      // 利用者メールアドレス
      html += '<label class="kc-dlg-label" id="kc-row-userMail"' + (F.userMail ? '' : ' style="display:none"') + '>利用者メールアドレス';
      html += '<input type="email" id="kc-f-userMail" class="kc-dlg-input"></label>';

      // 説明欄
      html += '<label class="kc-dlg-label" id="kc-row-memo"' + (F.memo ? '' : ' style="display:none"') + '>説明欄';
      html += '<textarea id="kc-f-memo" class="kc-dlg-textarea" rows="3"></textarea></label>';

      // ボタン
      html += '<div class="kc-dlg-actions">';
      html += '<button type="button" id="kc-btn-delete" class="kc-dlg-btn kc-dlg-btn--danger" style="display:none">削除</button>';
      html += '<div class="kc-dlg-actions-right">';
      html += '<button type="button" id="kc-btn-cancel" class="kc-dlg-btn">キャンセル</button>';
      html += '<button type="button" id="kc-btn-save" class="kc-dlg-btn kc-dlg-btn--primary">保存</button>';
      html += '</div>';
      html += '</div>';

      html += '</form>';
      html += '</div>';

      dlg.innerHTML = html;
      root.appendChild(dlg);

      // DOM参照を更新
      KC.State.els.dlg = dlg;

      // イベントバインド
      this._bindEvents(dlg);
    },

    /** ダイアログ内のイベントを登録 */
    _bindEvents: function (dlg) {
      var self = this;

      // 保存
      var saveBtn = dlg.querySelector('#kc-btn-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function (e) {
          e.preventDefault();
          self._onSave();
        });
      }

      // キャンセル
      var cancelBtn = dlg.querySelector('#kc-btn-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function (e) {
          e.preventDefault();
          self.close();
        });
      }

      // 削除
      var deleteBtn = dlg.querySelector('#kc-btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function (e) {
          e.preventDefault();
          self._onDelete();
        });
      }

      // ESCキーで閉じる（dialog 標準挙動だが念のため）
      dlg.addEventListener('cancel', function () {
        self.close();
      });
    },

    /** 保存処理 */
    _onSave: async function () {
      var U = KC.Utils;
      var S = KC.State;

      var fTitle    = document.getElementById('kc-f-title');
      var fDevice   = document.getElementById('kc-f-device');
      var fStatus   = document.getElementById('kc-f-status');
      var fColor    = document.getElementById('kc-f-color');
      var fStart    = document.getElementById('kc-f-start');
      var fEnd      = document.getElementById('kc-f-end');
      var fAllday   = document.getElementById('kc-f-allday');
      var fPlace    = document.getElementById('kc-f-place');
      var fUserName = document.getElementById('kc-f-userName');
      var fUserMail = document.getElementById('kc-f-userMail');
      var fMemo     = document.getElementById('kc-f-memo');

      var isDateType = (KC.Config.START_FIELD_TYPE === 'DATE');

      var payload = {
        title:    fTitle.value.trim(),
        device:   fDevice ? fDevice.value.trim() : '',
        status:   fStatus ? fStatus.value.trim() : '',
        color:    fColor ? fColor.value : '',
        place:    fPlace ? fPlace.value.trim() : '',
        userName: fUserName ? fUserName.value.trim() : '',
        userMail: fUserMail ? fUserMail.value.trim() : '',
        memo:     fMemo ? fMemo.value : '',
        allday:   isDateType ? true : (fAllday ? fAllday.checked : false)
      };

      if (!payload.title) { alert('予定タイトルは必須です'); return; }

      if (isDateType) {
        // DATE型: input type="date" → "YYYY-MM-DD" 値
        var startDate = fStart.value; // "2025-11-03"
        var endDate = fEnd.value;     // "2025-11-05"
        if (!startDate || !endDate) { alert('開始/終了を入力してください'); return; }
        if (startDate > endDate) { alert('終了は開始より後にしてください'); return; }
        // 終日イベント: start=開始日0時, end=終了日の翌日0時
        payload.start = new Date(startDate + 'T00:00:00').toISOString();
        var endD = new Date(endDate + 'T00:00:00');
        endD.setDate(endD.getDate() + 1);
        payload.end = endD.toISOString();
      } else {
        var s  = U.fromLocalInput(fStart.value);
        var en = U.fromLocalInput(fEnd.value);
        if (!s || !en)      { alert('開始/終了を入力してください'); return; }
        if (new Date(s) >= new Date(en)) { alert('終了は開始より後にしてください'); return; }

        // 終日の場合、終了日を翌日0時に調整
        if (payload.allday) {
          var eDate = new Date(en);
          var next0 = new Date(
            Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), eDate.getUTCDate(), 0, 0, 0)
          );
          payload.start = new Date(s).toISOString();
          payload.end   = U.addMs(next0.toISOString(), 24 * 60 * 60 * 1000);
        } else {
          payload.start = s;
          payload.end   = en;
        }
      }

      // ログインユーザーの account をセット
      try {
        var user = KC.Api.getLoginUser();
        if (user && user.code) {
          payload.account = user.code;
        }
      } catch (_e) { /* 取得失敗時は空 */ }

      try {
        if (S.editing) {
          payload.id = S.editing.id;
          await KC.Api.updateEvent(payload);
        } else {
          await KC.Api.createEvent(payload);
        }
        this.close();
        KC.Render.refresh();
      } catch (err) {
        alert(err.message || String(err));
      }
    },

    /** 削除処理 */
    _onDelete: async function () {
      var S = KC.State;
      if (!S.editing) return;
      if (!confirm('この予定を削除しますか？')) return;

      try {
        await KC.Api.deleteEvent(S.editing.id);
        this.close();
        KC.Render.refresh();
      } catch (err) {
        alert(err.message || String(err));
      }
    },

    /** 新規作成ダイアログを開く */
    openCreate: function (options) {
      this.ensureDOM();
      options = options || {};
      var U = KC.Utils;
      var S = KC.State;
      S.editing = null;

      var dlgTitle = document.getElementById('kc-dlg-title');
      if (dlgTitle) dlgTitle.textContent = '予定の作成';

      var fTitle    = document.getElementById('kc-f-title');
      var fDevice   = document.getElementById('kc-f-device');
      var fStatus   = document.getElementById('kc-f-status');
      var fColor    = document.getElementById('kc-f-color');
      var fStart    = document.getElementById('kc-f-start');
      var fEnd      = document.getElementById('kc-f-end');
      var fAllday   = document.getElementById('kc-f-allday');
      var fPlace    = document.getElementById('kc-f-place');
      var fUserName = document.getElementById('kc-f-userName');
      var fUserMail = document.getElementById('kc-f-userMail');
      var fMemo     = document.getElementById('kc-f-memo');
      var btnDelete = document.getElementById('kc-btn-delete');

      // フォームクリア
      fTitle.value    = '';
      if (fDevice)  fDevice.value   = '';
      if (fStatus)  fStatus.value   = '';
      if (fColor)   fColor.value    = '#eef2ff';
      if (fPlace)   fPlace.value    = '';
      if (fMemo)    fMemo.value     = '';

      // ログインユーザーをデフォルトセット
      try {
        var user = KC.Api.getLoginUser();
        if (user) {
          if (fUserName) fUserName.value = user.name || '';
          if (fUserMail) fUserMail.value = user.email || '';
        }
      } catch (_e) {
        if (fUserName) fUserName.value = '';
        if (fUserMail) fUserMail.value = '';
      }

      // 日時セット
      var isDateType = (KC.Config.START_FIELD_TYPE === 'DATE');

      if (isDateType) {
        // DATE型: input type="date" に "YYYY-MM-DD" をセット
        if (fAllday) fAllday.checked = true;
        var dateStr = options.date || U.fmtYMD(new Date());
        fStart.value = dateStr;
        fEnd.value   = dateStr;
      } else if (options.allday) {
        if (fAllday) fAllday.checked = true;
        var dateStr2 = options.date || U.fmtYMD(new Date());
        fStart.value = dateStr2 + 'T00:00';
        fEnd.value   = dateStr2 + 'T23:59';
      } else if (options.date) {
        if (fAllday) fAllday.checked = false;
        var hour   = options.hour   != null ? options.hour   : 9;
        var minute = options.minute != null ? options.minute : 0;
        var startDt = new Date(options.date + 'T' + U.pad2(hour) + ':' + U.pad2(minute) + ':00');
        var endDt   = new Date(startDt.getTime() + 30 * 60000);
        fStart.value = U.toLocalInput(startDt.toISOString());
        fEnd.value   = U.toLocalInput(endDt.toISOString());
      } else {
        if (fAllday) fAllday.checked = false;
        var now = new Date();
        fStart.value = U.toLocalInput(now.toISOString());
        fEnd.value   = U.toLocalInput(new Date(now.getTime() + 30 * 60000).toISOString());
      }

      if (btnDelete) btnDelete.style.display = 'none';
      S.els.dlg.showModal();
    },

    /** 編集ダイアログを開く */
    openEdit: function (ev) {
      this.ensureDOM();
      var U = KC.Utils;
      var S = KC.State;
      S.editing = ev;

      var dlgTitle = document.getElementById('kc-dlg-title');
      if (dlgTitle) dlgTitle.textContent = '予定の編集';

      document.getElementById('kc-f-title').value    = ev.title || '';
      var fDevice   = document.getElementById('kc-f-device');
      var fStatus   = document.getElementById('kc-f-status');
      var fColor    = document.getElementById('kc-f-color');
      var fAllday   = document.getElementById('kc-f-allday');
      var fPlace    = document.getElementById('kc-f-place');
      var fUserName = document.getElementById('kc-f-userName');
      var fUserMail = document.getElementById('kc-f-userMail');
      var fMemo     = document.getElementById('kc-f-memo');
      if (fDevice)   fDevice.value   = ev.device || '';
      if (fStatus)   fStatus.value   = ev.status || '';
      if (fColor)    fColor.value    = ev.color || '#eef2ff';

      var isDateType = (KC.Config.START_FIELD_TYPE === 'DATE');
      if (isDateType) {
        // DATE型: ISO文字列 → "YYYY-MM-DD"
        document.getElementById('kc-f-start').value = ev.start ? ev.start.substring(0, 10) : '';
        // end は翌日0時のISO → 1日戻して表示
        if (ev.end) {
          var endD = new Date(ev.end);
          endD.setDate(endD.getDate() - 1);
          document.getElementById('kc-f-end').value = U.fmtYMD(endD);
        } else {
          document.getElementById('kc-f-end').value = '';
        }
        if (fAllday) fAllday.checked = true;
      } else {
        document.getElementById('kc-f-start').value = U.toLocalInput(ev.start);
        document.getElementById('kc-f-end').value   = U.toLocalInput(ev.end);
        if (fAllday) fAllday.checked = !!ev.allday;
      }
      if (fPlace)    fPlace.value    = ev.place || '';
      if (fUserName) fUserName.value = ev.userName || '';
      if (fUserMail) fUserMail.value = ev.userMail || '';
      if (fMemo)     fMemo.value     = ev.memo || '';

      var btnDelete = document.getElementById('kc-btn-delete');
      if (btnDelete) btnDelete.style.display = 'inline-block';

      S.els.dlg.showModal();
    },

    /** ダイアログを閉じる */
    close: function () {
      var dlg = KC.State.els.dlg || document.getElementById('kc-dialog');
      if (dlg && dlg.open) dlg.close();
    }
  };

  /* ====================================================================
   * KC.DnD — ドラッグ&ドロップ（移動/リサイズ）
   * ==================================================================== */
  KC.DnD = {
    _drag: null,

    /** セルから日付を取得 */
    _dayFromEvent: function (e) {
      var t = e.target.closest('.kc-cell');
      if (!t) return null;
      return new Date(t.dataset.date);
    },

    /** イベント移動開始 */
    startMove: function (ev, mousedown) {
      mousedown.preventDefault();
      var self = this;
      var U = KC.Utils;
      var S = KC.State;

      var ghost = document.createElement('div');
      ghost.className = 'kc-event kc-ghost';
      ghost.textContent = ev.title || '(無題)';

      // 期間を日付配列に展開
      var dates = this._spanDates(ev.start, ev.end, ev.allday);

      this._drag = {
        type: 'move',
        ev: ev,
        ghost: ghost,
        baseDates: dates,
        startCellDay: this._dayFromEvent(mousedown),
        delta: 0
      };

      document.body.style.userSelect = 'none';

      var onOver = function (e) {
        if (!self._drag) return;
        var day = self._dayFromEvent(e);
        if (!day) return;
        var delta = Math.round((day - self._drag.startCellDay) / 86400000);
        if (delta === self._drag.delta) return;
        self._drag.delta = delta;

        // ゴーストクリア
        S.els.rows.querySelectorAll('.kc-ghost').forEach(function (el) { el.remove(); });

        // 新しいゴースト配置
        self._drag.baseDates.forEach(function (ymd) {
          var d = U.fmtYMD(U.addDays(new Date(ymd), delta));
          var cell = S.els.rows.querySelector('.kc-cell[data-date="' + d + '"]');
          if (!cell) return;
          var g = ghost.cloneNode(true);
          cell.appendChild(g);
        });
      };

      var onUp = function () {
        document.removeEventListener('mouseover', onOver);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        S.els.rows.querySelectorAll('.kc-ghost').forEach(function (el) { el.remove(); });

        if (!self._drag) return;
        var drag = self._drag;
        self._drag = null;
        if (drag.delta === 0) return;

        var newStart = new Date(new Date(drag.ev.start).getTime() + drag.delta * 86400000).toISOString();
        var newEnd   = new Date(new Date(drag.ev.end).getTime() + drag.delta * 86400000).toISOString();

        KC.Api.updateEvent({ id: drag.ev.id, start: newStart, end: newEnd })
          .then(function () { KC.Render.refresh(); })
          .catch(function (err) { alert(err.message || err); });
      };

      document.addEventListener('mouseover', onOver);
      document.addEventListener('mouseup', onUp);
    },

    /** イベントリサイズ開始 */
    startResize: function (ev, side, mousedown) {
      mousedown.preventDefault();
      var self = this;
      var U = KC.Utils;
      var S = KC.State;

      this._drag = {
        type: 'resize',
        ev: ev,
        side: side,
        delta: 0,
        startCellDay: this._dayFromEvent(mousedown)
      };

      document.body.style.userSelect = 'none';

      var onOver = function (evt) {
        if (!self._drag) return;
        var day = self._dayFromEvent(evt);
        if (!day) return;
        var delta = Math.round((day - self._drag.startCellDay) / 86400000);
        if (delta === self._drag.delta) return;
        self._drag.delta = delta;

        S.els.rows.querySelectorAll('.kc-ghost').forEach(function (el) { el.remove(); });

        var evOrig = self._drag.ev;
        var s = new Date(evOrig.start);
        var e = new Date(evOrig.end);

        if (self._drag.side === 'left') {
          s = U.addDays(s, delta);
          if (s >= e) s = U.addDays(e, -1);
        } else {
          e = U.addDays(e, delta);
          if (e <= s) e = U.addDays(s, 1);
        }

        var arr = self._spanDates(s.toISOString(), e.toISOString(), evOrig.allday);
        arr.forEach(function (ymd) {
          var cell = S.els.rows.querySelector('.kc-cell[data-date="' + ymd + '"]');
          if (!cell) return;
          var g = document.createElement('div');
          g.className = 'kc-event kc-ghost';
          g.textContent = evOrig.title || '(無題)';
          cell.appendChild(g);
        });
      };

      var onUp = function () {
        document.removeEventListener('mouseover', onOver);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        S.els.rows.querySelectorAll('.kc-ghost').forEach(function (el) { el.remove(); });

        if (!self._drag) return;
        var drag = self._drag;
        self._drag = null;
        if (drag.delta === 0) return;

        var newStart = drag.ev.start;
        var newEnd   = drag.ev.end;

        if (drag.side === 'left') {
          newStart = new Date(new Date(drag.ev.start).getTime() + drag.delta * 86400000).toISOString();
          if (new Date(newStart) >= new Date(newEnd)) {
            newStart = new Date(new Date(newEnd).getTime() - 86400000).toISOString();
          }
        } else {
          newEnd = new Date(new Date(drag.ev.end).getTime() + drag.delta * 86400000).toISOString();
          if (new Date(newEnd) <= new Date(newStart)) {
            newEnd = new Date(new Date(newStart).getTime() + 86400000).toISOString();
          }
        }

        KC.Api.updateEvent({ id: drag.ev.id, start: newStart, end: newEnd })
          .then(function () { KC.Render.refresh(); })
          .catch(function (err) { alert(err.message || err); });
      };

      document.addEventListener('mouseover', onOver);
      document.addEventListener('mouseup', onUp);
    },

    /** 期間を日ごとの配列へ展開 */
    _spanDates: function (isoStart, isoEnd, allday) {
      var U = KC.Utils;
      var s = new Date(isoStart);
      var e = new Date(isoEnd);
      var last = allday ? U.addDays(e, -1) : e;
      var arr = [];
      for (var d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= last; d = U.addDays(d, 1)) {
        arr.push(U.fmtYMD(d));
      }
      return arr;
    }
  };

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

        var div = document.createElement('div');
        div.className = 'kc-day';

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

      // 7日分のセル
      for (var i = 0; i < 7; i++) {
        var d = U.addDays(range.start, i);
        var cell = document.createElement('div');
        cell.className = 'kc-adcell';
        cell.dataset.date = U.fmtYMD(d);

        var box = document.createElement('div');
        box.className = 'kc-adbox';
        cell.appendChild(box);
        wrap.appendChild(cell);
      }

      // 右端のスクロールバー幅ダミー列
      var spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      wrap.appendChild(spacer);

      S.els.allday = wrap;
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

      for (var h = 0; h < 24; h++) {
        var row = document.createElement('div');
        row.className = 'kc-row';
        row.dataset.hour = String(h);

        for (var c = 0; c < 7; c++) {
          var cell = document.createElement('div');
          cell.className = 'kc-cell';
          row.appendChild(cell);
        }
        rows.appendChild(row);
      }
    }

    /** 期間を日付配列に展開 */
    function spanDates(isoStart, isoEnd) {
      var s = new Date(isoStart);
      var e = new Date(isoEnd);
      var days = [];
      for (var d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= e; d = U.addDays(d, 1)) {
        days.push(U.fmtYMD(d));
      }
      return days;
    }

    /** イベント配置 */
    function placeEvents() {
      // 終日クリア
      var alldayWrap = S.els.allday;
      if (alldayWrap) {
        alldayWrap.querySelectorAll('.kc-adbox').forEach(function (b) { b.innerHTML = ''; });
      }

      // 通常クリア
      var rows = S.els.rows;
      if (!rows) return;

      // overlay をクリア（セル自体は保持）
      rows.querySelectorAll('.kc-overlay').forEach(function (o) { o.remove(); });

      var range = weekRange(S.current);
      var weekYMD = [];
      for (var wi = 0; wi < 7; wi++) {
        weekYMD.push(U.fmtYMD(U.addDays(range.start, wi)));
      }

      (S.events || []).forEach(function (evt) {
        var allday = !!evt.allday;
        var s = new Date(evt.start);
        var e = new Date(evt.end);

        if (allday) {
          // 終日イベント配置
          var dates = spanDates(evt.start, new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1).toISOString());
          var overlap = dates.filter(function (d) { return weekYMD.indexOf(d) >= 0; });

          overlap.forEach(function (ymd, idx) {
            var adCell = alldayWrap ? alldayWrap.querySelector('.kc-adcell[data-date="' + ymd + '"] .kc-adbox') : null;
            if (!adCell) return;

            var el = document.createElement('div');
            el.className = 'kc-ad-event';
            if (overlap.length > 1) {
              el.classList.add(idx === 0 ? 'seg-start' : (idx === overlap.length - 1 ? 'seg-end' : 'seg-middle'));
            }

            // XSS安全: textContent 使用
            var dot = document.createElement('span');
            dot.className = 'dot';
            var titleSpan = document.createElement('span');
            titleSpan.textContent = evt.title || '(無題)';

            // カレンダー色の反映
            if (evt.color) {
              el.style.background = evt.color;
              el.style.borderColor = evt.color;
              el.style.color = isLightColor(evt.color) ? '#1f2937' : '#ffffff';
              dot.style.background = isLightColor(evt.color) ? '#1f2937' : '#ffffff';
            }

            el.appendChild(dot);
            el.appendChild(titleSpan);

            // イベントクリック → 編集ダイアログ
            el.style.cursor = 'pointer';
            el.addEventListener('click', function (clickEvt) {
              clickEvt.stopPropagation();
              KC.Dialog.openEdit(evt);
            });

            adCell.appendChild(el);
          });
          return;
        }

        // 通常イベント配置
        var dayIdx = weekYMD.indexOf(U.fmtYMD(s));
        if (dayIdx < 0) return;

        var startMin = s.getHours() * 60 + s.getMinutes();
        var endMin   = e.getHours() * 60 + e.getMinutes();
        // 日を跨ぐ場合は終了を24:00とする
        if (U.fmtYMD(s) !== U.fmtYMD(e) || endMin <= startMin) {
          endMin = 24 * 60;
        }
        var totalMin = 24 * 60;
        var topPct    = (startMin / totalMin) * 100;
        var heightPct = ((endMin - startMin) / totalMin) * 100;

        // 最初の行の対象列にオーバーレイを作成
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

        // カレンダー色の反映
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
        var timeStr = U.pad2(s.getHours()) + ':' + U.pad2(s.getMinutes()) + ' - ' +
                      U.pad2(e.getHours()) + ':' + U.pad2(e.getMinutes());
        metaDiv.textContent = timeStr + (evt.device ? ' / ' + evt.device : '');

        // 色指定時はメタの文字色も調整
        if (evt.color) {
          metaDiv.style.color = isLightColor(evt.color) ? '#6b7280' : 'rgba(255,255,255,0.8)';
        }

        div.appendChild(titleDiv);
        div.appendChild(metaDiv);

        // ツールチップ
        div.title = (evt.title || '') + '\n' + timeStr;

        // イベントクリック → 編集ダイアログ
        div.addEventListener('click', function (clickEvt) {
          clickEvt.stopPropagation();
          KC.Dialog.openEdit(evt);
        });

        // D&D 移動（mousedown）
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
        S.events = await KC.Api.loadEvents(isoStart, isoEnd);
        renderGrid();
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

    /** 終日セルにクリックイベント付与 */
    bindAllDayBoxes: function () {
      var self = this;
      var boxes = document.querySelectorAll('.kc-adbox');
      boxes.forEach(function (box) {
        if (box.dataset.kcClickBound === '1') return;
        box.dataset.kcClickBound = '1';
        box.addEventListener('click', function (e) { self._onAllDayClick(e); });
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

      KC.Dialog.openCreate({
        date: date,
        hour: hour,
        minute: minute
      });
    },

    /** 終日セルクリック → ダイアログ表示 */
    _onAllDayClick: function (e) {
      e.preventDefault();
      e.stopPropagation();
      var box  = e.currentTarget;
      var cell = box.closest('.kc-adcell');
      var date = (cell && cell.dataset.date) || box.dataset.date || KC.Utils.fmtYMD(new Date());

      KC.Dialog.openCreate({
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
      fullscreenBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
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

    /** 全画面自動試行 + フォールバックバナー表示 */
    _tryAutoFullscreen: function (root) {
      var requestFs = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
      if (!requestFs) return; // Fullscreen API 非対応

      // まず requestFullscreen() を試みる
      var promise;
      try {
        promise = requestFs.call(root);
      } catch (_e) {
        // 同期的に例外が出た場合はバナー表示へ
        this._showFullscreenBanner(root);
        return;
      }

      // Promise を返す場合（モダンブラウザ）
      if (promise && typeof promise.catch === 'function') {
        var self = this;
        promise.catch(function () {
          self._showFullscreenBanner(root);
        });
      }
    },

    /** 「クリックして全画面で表示」バナーを表示 */
    _showFullscreenBanner: function (root) {
      // 既にバナーがあれば何もしない
      if (root.querySelector('.kc-fullscreen-banner')) return;

      var banner = document.createElement('div');
      banner.className = 'kc-fullscreen-banner';
      banner.textContent = 'クリックして全画面で表示';
      banner.setAttribute('role', 'button');
      banner.setAttribute('tabindex', '0');

      // クリックで全画面化 + バナー消去
      var onActivate = function () {
        var rootEl = document.getElementById('kc-root');
        if (rootEl) {
          var rfs = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen || rootEl.msRequestFullscreen;
          if (rfs) {
            try { rfs.call(rootEl); } catch (_e) { /* ignore */ }
          }
        }
        banner.classList.add('kc-fullscreen-banner--hidden');
        setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 400);
      };

      banner.addEventListener('click', onActivate);
      banner.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      });

      // root の先頭に挿入
      root.insertBefore(banner, root.firstChild);

      // 8秒後に自動フェードアウト（まだ残っていれば）
      setTimeout(function () {
        if (!banner.parentNode) return;
        banner.classList.add('kc-fullscreen-banner--hidden');
        setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 400);
      }, 8000);
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
          S.current.setDate(S.current.getDate() - 7);
          R.refresh();
        });
      }

      if (S.els.todayBtn) {
        S.els.todayBtn.addEventListener('click', function () {
          S.current = new Date();
          R.refresh();
        });
      }

      if (S.els.nextBtn) {
        S.els.nextBtn.addEventListener('click', function () {
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

      if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', function () {
          var rootEl = document.getElementById('kc-root');
          if (!rootEl) return;
          if (rootEl.requestFullscreen) {
            rootEl.requestFullscreen();
          } else if (rootEl.webkitRequestFullscreen) {
            rootEl.webkitRequestFullscreen();
          } else if (rootEl.msRequestFullscreen) {
            rootEl.msRequestFullscreen();
          }
        });
      }

      if (exitFullscreenBtn) {
        exitFullscreenBtn.addEventListener('click', function () {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
          }
        });
      }

      // fullscreenchange イベントでボタンの表示/非表示を切り替え
      var onFullscreenChange = function () {
        var isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        var fsBtn = document.getElementById('kc-fullscreen-btn');
        var exitBtn = document.getElementById('kc-exit-fullscreen-btn');
        if (fsBtn) fsBtn.style.display = isFullscreen ? 'none' : '';
        if (exitBtn) exitBtn.style.display = isFullscreen ? 'inline-flex' : 'none';
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      document.addEventListener('MSFullscreenChange', onFullscreenChange);

      // 初回描画
      R.refresh();

      // 全画面自動試行 + フォールバックバナー
      this._tryAutoFullscreen(root);

      console.log('[KC.Boot] init complete');
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

})();
