(function () {
  'use strict';

  /**
   * 開発用 kintone JS API モック。
   * config.html を npm run dev:config で起動したローカルサーバーで開いたときに
   * 設定画面の動作を kintone なしで確認できるようにする。
   *
   * - フィールド一覧 / ビュー一覧はハードコード (setup-test-app/fields-config.datetime.json と同等)
   * - getConfig / setConfig は localStorage に保存
   * - REST API 呼出はコンソールにログ出力 + ダミー成功レスポンス
   */

  var STORAGE_KEY = 'kc-dev-plugin-config';
  var PLUGIN_ID = 'kc-dev-plugin-id';
  var APP_ID = 891;

  // モックフィールド一覧 (setup-test-app/fields-config.datetime.json と同等構成)
  var MOCK_FIELDS = {
    title:      { type: 'SINGLE_LINE_TEXT', code: 'title',      label: 'タイトル' },
    startDate:  { type: 'DATETIME',         code: 'startDate',  label: '開始日時' },
    endDate:    { type: 'DATETIME',         code: 'endDate',    label: '終了日時' },
    status:     { type: 'DROP_DOWN',        code: 'status',     label: 'ステータス' },
    userColor:  { type: 'DROP_DOWN',        code: 'userColor',  label: '色' },
    memo:       { type: 'MULTI_LINE_TEXT',  code: 'memo',       label: 'メモ' },
    allday:     { type: 'CHECK_BOX',        code: 'allday',     label: '終日' },
    place:      { type: 'SINGLE_LINE_TEXT', code: 'place',      label: '場所' },
    userName:   { type: 'SINGLE_LINE_TEXT', code: 'userName',   label: '利用者氏名' },
    userMail:   { type: 'SINGLE_LINE_TEXT', code: 'userMail',   label: 'メールアドレス' },
    account:    { type: 'USER_SELECT',      code: 'account',    label: 'アカウント' },
    // kintone 標準フィールドもいくつか追加 (filterFields の挙動確認用)
    レコード番号: { type: 'RECORD_NUMBER', code: 'レコード番号', label: 'レコード番号' },
    作成者:       { type: 'CREATOR',       code: '作成者',       label: '作成者' },
    更新者:       { type: 'MODIFIER',      code: '更新者',       label: '更新者' }
  };

  // モックビュー一覧 (handleViewApply / ビュー個別設定の動作確認用)
  // id プロパティを追加: kintone ビュー ID の模倣 (Phase 9 対応)
  var MOCK_VIEWS = {
    '一覧': { type: 'LIST', name: '一覧', index: '0', id: '8888', fields: ['title', 'startDate', 'endDate'] },
    'カレンダー (既存)': { type: 'CUSTOM', name: 'カレンダー (既存)', index: '1', id: '9999', html: '<div>old html</div>' }
  };

  window.kintone = {
    $PLUGIN_ID: PLUGIN_ID,
    app: {
      getId: function () { return APP_ID; },
      // Phase 9: kintone.app.getViewId() モック (仮 ID)
      // 実機では現在表示中のカスタマイズビューの ID が返る (未検証)
      getViewId: function () { return 9999; }
    },
    plugin: {
      app: {
        getConfig: function (pluginId) {
          var raw = localStorage.getItem(STORAGE_KEY);
          // Phase 9: { config: "<JSON文字列>" } 形式で保存されている前提
          // 旧形式 (フラットオブジェクト) との互換のため raw をそのまま返す
          var stored = raw ? JSON.parse(raw) : {};
          console.log('[kintone-mock] getConfig:', stored);
          return stored;
        },
        setConfig: function (config, callback) {
          // Phase 9: config は { config: JSON.stringify(currentConfig) } 形式を期待
          localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
          console.log('[kintone-mock] setConfig:', config);
          if (callback) setTimeout(callback, 100);
        }
      }
    },
    api: {
      url: function (path, isGuestSpace) {
        return path; // モックでは引数の path をそのまま返す
      }
    }
  };

  // kintone.api を関数として実装 (callable)
  var apiFn = function (url, method, params) {
    console.log('[kintone-mock] kintone.api:', method, url, params);
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        // GET /k/v1/app/form/fields
        if (/app\/form\/fields/.test(url) && method === 'GET') {
          resolve({ properties: MOCK_FIELDS });
        }
        // GET /k/v1/app/views.json
        else if (/app\/views/.test(url) && method === 'GET') {
          resolve({ views: MOCK_VIEWS, revision: '1' });
        }
        // PUT /k/v1/preview/app/views.json
        else if (/app\/views/.test(url) && method === 'PUT') {
          console.log('[kintone-mock] PUT views received:', params.views);
          // 受信した views を MOCK_VIEWS にマージ (次回 GET で確認可能)
          Object.keys(params.views).forEach(function (k) {
            MOCK_VIEWS[k] = params.views[k];
          });
          resolve({ revision: '2' });
        }
        // GET /k/v1/app/settings.json（アプリ管理権限チェック用）
        else if (/app\/settings/.test(url) && method === 'GET') {
          resolve({ name: 'モックアプリ', description: '' });
        }
        // POST /k/v1/preview/app/deploy.json
        else if (/app\/deploy/.test(url) && method === 'POST') {
          resolve({});
        }
        // GET /k/v1/preview/app/deploy.json (デプロイ状態ポーリング)
        // 1 回目の呼び出しで即 SUCCESS を返す (開発モック)
        else if (/app\/deploy/.test(url) && method === 'GET') {
          resolve({ apps: [{ app: APP_ID, status: 'SUCCESS' }] });
        }
        else {
          reject(new Error('[kintone-mock] Unknown API: ' + method + ' ' + url));
        }
      }, 200);
    });
  };
  // kintone.api を関数として再代入 (kintone.api.url は属性として保持)
  apiFn.url = window.kintone.api.url;
  window.kintone.api = apiFn;

  // localStorage 初期化用のリセット関数 (開発便利機能)
  window.__kcDevReset = function () {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[kintone-mock] config reset');
    location.reload();
  };

  console.log('[kintone-mock] initialized. window.__kcDevReset() で設定をクリアできます。');
})();
