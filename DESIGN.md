# kintone カレンダー カスタマイズJS 設計書

## 1. システム構成図

### 1.1 旧アーキテクチャ（GAS版）

```
┌─────────────────────────────────────────────────────┐
│  kintone カスタマイズビュー                          │
│  ┌───────────────────────────────────────────────┐  │
│  │ kintone-calendar-embed.js                     │  │
│  │  - iframe を生成し GAS Web App を埋め込む      │  │
│  └────────────────┬──────────────────────────────┘  │
│                   │ iframe src                       │
│  ┌────────────────▼──────────────────────────────┐  │
│  │ GAS Web App (index.html + <script>群)         │  │
│  │  - google.script.run で GAS サーバーを呼出     │  │
│  └────────────────┬──────────────────────────────┘  │
└───────────────────┼─────────────────────────────────┘
                    │ google.script.run
┌───────────────────▼─────────────────────────────────┐
│  GAS サーバーサイド (code.gs / config.gs)            │
│  - kintone REST API 中継（UrlFetchApp）              │
│  - Google スプレッドシート読み書き（キャッシュ）      │
└───────┬───────────────────────────┬─────────────────┘
        │ UrlFetchApp               │ SpreadsheetApp
        ▼                           ▼
   kintone REST API         Google スプレッドシート
   (正データ)               (読取キャッシュ)
```

### 1.2 新アーキテクチャ（kintone カスタマイズ JS）

```
┌─────────────────────────────────────────────────────┐
│  kintone カスタマイズビュー                          │
│  ┌───────────────────────────────────────────────┐  │
│  │ kc-calendar.js + kc-calendar.css              │  │
│  │  - kintone.events で発火                       │  │
│  │  - カスタマイズビューの DOM に直接描画          │  │
│  │  - kintone.api() で REST API を直接呼出        │  │
│  └────────────────┬──────────────────────────────┘  │
│                   │ kintone.api()                    │
│                   │ (同一オリジン / セッション認証)   │
│                   ▼                                  │
│            kintone REST API                          │
│            (単一データストア)                         │
└─────────────────────────────────────────────────────┘

排除: GAS / スプレッドシート / iframe / postMessage
```

---

## 2. ファイル構成

```
kintone-calendar/
├── DESIGN.md                ← 本設計書
└── src/
    ├── kc-calendar.js       ← 全ロジック（単一ファイル、kintoneにアップロード）
    └── kc-calendar.css      ← 全スタイル（kintoneにアップロード）
```

kintone カスタマイズビューに JS/CSS をそれぞれ1ファイルアップロードする。
IIFE で囲みグローバル汚染を防止。

---

## 3. モジュール設計（JS内部構造）

単一ファイル内に以下のモジュールを IIFE 内で順に定義する。

```
kc-calendar.js (IIFE)
  ├── KC.Config    -- フィールドコード定義
  ├── KC.Utils     -- 日付ユーティリティ
  ├── KC.State     -- アプリケーション状態管理
  ├── KC.Api       -- kintone REST API ラッパー
  ├── KC.Dialog    -- ダイアログ（作成/編集/削除）
  ├── KC.DnD       -- ドラッグ&ドロップ
  ├── KC.RenderWeek -- 週ビューレンダラー
  ├── KC.RenderMonth -- 月ビュー（スタブ）
  ├── KC.RenderDay   -- 日ビュー（スタブ）
  ├── KC.Render    -- レンダラーファサード
  ├── KC.TimeSlots -- 30分スロット・終日クリック
  ├── KC.ViewDropdown -- ビュー切替
  └── KC.Boot      -- 初期化 + kintone.events 登録
```

### 依存関係

```
Boot → Render → RenderWeek / RenderMonth / RenderDay
Boot → ViewDropdown
Render → Api → Config
TimeSlots → Dialog
RenderWeek → Dialog (イベントクリック)
Dialog → Api → Config
DnD → Api, Dialog
Utils ← 全モジュールから利用
State ← 全モジュールから参照
```

---

## 4. 各モジュール仕様

### 4.1 KC.Config

```javascript
KC.Config = {
  getAppId: () => kintone.app.getId(),
  FIELD: {
    title:    '予定タイトル',
    status:   '貸出ステータス',
    start:    '開始日時',
    end:      '終了日時',
    allday:   '終日',
    place:    '場所',
    userName: '利用者氏名',
    userMail: '利用者メールアドレス',
    account:  'アカウント',
    memo:     '説明欄',
  },
  EXCLUDED_STATUSES: ['返却済', '削除済'],
  QUERY_LIMIT: 500,
};
```

### 4.2 KC.Utils

```javascript
KC.Utils = {
  pad2(n),                         // 2桁ゼロ埋め
  fmtYMD(date),                    // Date → "YYYY-MM-DD"
  addDays(date, n),                // 日付加算 → 新Date
  addMs(isoStr, ms),               // ISO文字列にミリ秒加算
  toLocalInput(isoStr),            // ISO → datetime-local用文字列
  fromLocalInput(val),             // datetime-local値 → ISO文字列
  escapeHtml(str),                 // XSS対策用エスケープ
};
```

### 4.3 KC.State

```javascript
KC.State = {
  view: 'week',         // 'week' | 'month' | 'day'
  current: new Date(),  // 表示基準日
  events: [],           // KcEvent[]
  editing: null,        // 編集中イベント or null
  els: {},              // DOM要素キャッシュ
  refreshEls(),         // DOM参照の再取得
};
```

**els に格納する要素:**

| キー | セレクタ | 説明 |
|------|---------|------|
| root | #kc-root | ルート |
| days | #kc-days | 曜日ヘッダー |
| allday | #kc-allday | 終日スロット行 |
| rows | #kc-rows | 時間グリッド |
| timeCol | #kc-time-col | 時間ガター |
| body | #kc-body | スクロール領域 |
| range | #kc-range-label | 年月ラベル |
| prevBtn | [data-action="prev"] | 前週ボタン |
| todayBtn | [data-action="today"] | 今日ボタン |
| nextBtn | [data-action="next"] | 次週ボタン |
| viewWrap | #kc-view | ドロップダウンラッパー |
| viewBtn | #kc-view-select | ドロップダウンボタン |
| dlg | #kc-dialog | ダイアログ |

### 4.4 KC.Api

```javascript
KC.Api = {
  async loadEvents(isoStart, isoEnd),  // 一覧取得
  async createEvent(event),            // 作成
  async updateEvent(event),            // 更新（差分フィールドのみ）
  async deleteEvent(id),               // 削除
  getLoginUser(),                      // ログインユーザー情報
};
```

### 4.5 KC.Dialog

```javascript
KC.Dialog = {
  ensureDOM(),     // <dialog> + フォームのDOM生成（初回のみ）
  openCreate(options),  // {date, hour, minute, allday}
  openEdit(event),      // KcEvent
  close(),
};
```

### 4.6 KC.DnD

```javascript
KC.DnD = {
  startMove(event, mousedownEvent),
  startResize(event, side, mousedownEvent),
  beginSelection(cell),
};
```

### 4.7 KC.RenderWeek

```javascript
KC.RenderWeek = {
  refresh(),        // 週ビュー全体再描画 + データ取得
  renderGrid(),     // グリッド描画 + イベント配置
  gridRange(),      // {start: Date, end: Date}
  placeEvents(),    // イベントDOM配置
};
```

内部関数: weekStart, weekRange, renderDayHeaders, renderAlldayRow, renderTimeGutter, renderRows, spanDates

### 4.8 KC.Render（ファサード）

```javascript
KC.Render = {
  refresh(),        // 現ビューのrefreshを委譲
  renderGrid(),     // 現ビューのrenderGridを委譲
  refreshTitle(),   // 年月ラベル更新
  gridRange(),      // 現ビューの期間を返す
};
```

### 4.9 KC.TimeSlots

```javascript
KC.TimeSlots = {
  patchRenderGrid(),    // renderGrid後フック登録
  buildTimeSlots(),     // 30分スロットDOM生成
  bindAllDayBoxes(),    // 終日セルクリック付与
  scrollToDefaultTime(), // 6:30自動スクロール
};
```

**GAS版からの変更**: alert() → KC.Dialog.openCreate() に置換

### 4.10 KC.Boot

```javascript
KC.Boot = {
  init(),  // DOM構築、イベント登録、初回描画
};
```

---

## 5. kintone API 連携仕様

### 5.1 一覧取得

```javascript
const url = kintone.api.url('/k/v1/records.json', true);
const F = KC.Config.FIELD;
const params = {
  app: KC.Config.getAppId(),
  query: `(${F.start} < "${isoEnd}") and (${F.end} > "${isoStart}") ` +
         `and (${F.status} not in ("返却済","削除済")) ` +
         `order by ${F.start} asc limit 500`,
  fields: ['$id','$revision', ...Object.values(F)]
};
const resp = await kintone.api(url, 'GET', params);
```

### 5.2 作成

```javascript
const url = kintone.api.url('/k/v1/record.json', true);
const record = {
  [F.title]:  { value: ev.title },
  [F.status]: { value: ev.status },
  [F.start]:  { value: ev.start },
  [F.end]:    { value: ev.end },
  [F.allday]: { value: ev.allday ? ['終日'] : [] },
  [F.place]:  { value: ev.place },
  [F.userName]: { value: ev.userName },
  [F.userMail]: { value: ev.userMail },
  [F.account]:  ev.account ? { value: [{code:ev.account}] } : { value: [] },
  [F.memo]:   { value: ev.memo },
};
const resp = await kintone.api(url, 'POST', {
  app: KC.Config.getAppId(), record
});
```

### 5.3 更新

```javascript
const url = kintone.api.url('/k/v1/record.json', true);
// 変更フィールドのみ record に含める
await kintone.api(url, 'PUT', {
  app: KC.Config.getAppId(), id: ev.id, record
});
```

### 5.4 削除

```javascript
const url = kintone.api.url('/k/v1/records.json', true);
await kintone.api(url, 'DELETE', {
  app: KC.Config.getAppId(), ids: [id]
});
```

### 5.5 レコード → KcEvent 変換

> **注意**: 下記は設計上の概略。実際の実装（`src/kc-calendar.js` の `KC.Api._recordToEvent`）では `KC.Config.START_FIELD_TYPE` に基づいて DATE 型 / DATETIME 型を分岐処理する。詳細は §9「終日判定ルール」を参照。

```javascript
function recordToEvent(rec) {
  const F = KC.Config.FIELD;
  // START_FIELD_TYPE === 'DATE' の場合:
  //   - allday を true に強制セット（DATE 型 = 常に終日）
  //   - start/end を "YYYY-MM-DD" → ISO 8601 に変換
  //   - end を翌日 0:00 に変換（placeEvents の描画ロジック統一のため）
  // START_FIELD_TYPE === 'DATETIME' の場合:
  //   - allday は CHECK_BOX フィールドの値を参照
  //   - start/end はそのまま ISO 8601
  return {
    id:       rec.$id.value,
    rev:      rec.$revision.value,
    created:  rec.$created ? rec.$created.value : '',  // レーン割り当てのソートキー
    title:    rec[F.title].value,
    status:   rec[F.status].value,
    start:    rec[F.start].value,   // ISO 8601（DATE 型時は変換済み）
    end:      rec[F.end].value,     // ISO 8601（DATE 型時は翌日 0:00 に変換済み）
    allday:   /* DATE 型なら true 固定、DATETIME 型なら CHECK_BOX 参照 */ false,
    place:    rec[F.place].value,
    userName: rec[F.userName].value,
    userMail: rec[F.userMail].value,
    account:  (rec[F.account].value || [])[0]?.code || '',
    memo:     rec[F.memo].value,
  };
}
```

---

## 6. データモデル

### KcEvent

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | kintoneレコードID |
| rev | string | リビジョン |
| created | string | 作成日時 ISO 8601（`$created` システムフィールド。レーン割り当てのソートキー）|
| title | string | 予定タイトル（必須） |
| status | string | 貸出ステータス |
| start | string | 開始日時 ISO 8601（DATE 型フィールドの場合は "YYYY-MM-DDT00:00:00.000Z" に変換済み）|
| end | string | 終了日時 ISO 8601（DATE 型フィールドの場合は翌日 0:00 に変換済み）|
| allday | boolean | 終日フラグ（DATE 型フィールドの場合は常に `true`。詳細は §9 参照）|
| place | string | 場所 |
| userName | string | 利用者氏名 |
| userMail | string | メールアドレス |
| account | string | kintoneユーザーコード |
| memo | string | 説明欄 |

---

## 7. UI仕様

### 7.1 画面レイアウト

```
┌────────────────────────────────────────────────┐
│ kc-header                                      │
│ [タイトル] [今日] [◀][▶] 2025年11月   [週 ▾]  │
├────────────────────────────────────────────────┤
│ kc-grid-wrap                                   │
│ ┌──┬───┬───┬───┬───┬───┬───┬───┐              │
│ │  │日 │月 │火 │水 │木 │金 │土 │ kc-days     │
│ ├──┼───┼───┼───┼───┼───┼───┼───┤              │
│ │  │   │   │   │   │   │   │   │ kc-allday   │
│ ├──┼───┼───┼───┼───┼───┼───┼───┤              │
│ │0 │   │   │   │   │   │   │   │             │
│ │: │   │[ev]│  │   │   │   │   │ kc-body     │
│ │23│   │   │   │   │   │   │   │ (scroll)    │
│ └──┴───┴───┴───┴───┴───┴───┴───┘              │
└────────────────────────────────────────────────┘
```

### 7.2 ダイアログ

`<dialog>` 要素として JS で動的生成。フォーム項目:

- 予定タイトル（必須, text）
- 貸出ステータス（select: 予約済/貸出中/返却済）
- 開始日時（datetime-local）
- 終了日時（datetime-local）
- 終日（checkbox）
- 場所（text）
- 利用者氏名（text）
- 利用者メールアドレス（email）
- 説明欄（textarea）
- ボタン: [削除] [キャンセル] [保存]

### 7.3 カスタマイズビュー HTML設定

```html
<div id="kc-root" class="kc-root"></div>
```

JSがこの中にヘッダー・グリッド・ダイアログを構築する。

---

## 8. イベント処理仕様

| 操作 | ハンドラ | 処理 |
|------|---------|------|
| 前週クリック | Boot | current -= 7日 → refresh() |
| 今日クリック | Boot | current = new Date() → refresh() |
| 次週クリック | Boot | current += 7日 → refresh() |
| ビュー切替 | ViewDropdown | state.view = val → refresh() |
| 30分スロットクリック | TimeSlots | Dialog.openCreate({date, hour, minute}) |
| 終日セルクリック | TimeSlots | Dialog.openCreate({date, allday: true}) |
| イベントクリック | RenderWeek | Dialog.openEdit(event) |
| 保存ボタン | Dialog | validate → Api.create/update → refresh() |
| 削除ボタン | Dialog | confirm → Api.delete → refresh() |
| D&D移動 | DnD | ゴースト → Api.update → refresh() |
| D&Dリサイズ | DnD | ゴースト → Api.update → refresh() |

### データフロー

```
操作 → ハンドラ → KC.Api (kintone.api()) → kintone REST API
                                            ↓ (成功)
                                   State.events 更新
                                            ↓
                                   Render.renderGrid() → DOM更新
```

---

## 9. 終日判定ルール

### 9.1 設計思想

本カレンダーカスタマイズは `start` / `end` フィールドに **DATETIME 型と DATE 型の両方**を採用できる。DATE 型には時間情報が存在しないため、時間レーンへの描画は物理的に不可能であり、DATE 型のイベントは **常に終日扱い** となる。これにより、日にち単位でレコードを扱うアプリ（例: 機器貸出日管理）でも本カスタマイズをそのまま利用できる。

### 9.2 終日判定の 3 パターン

| `start` / `end` フィールド型 | `allday` チェックボックス | 描画レーン | 備考 |
|---|---|---|---|
| **DATE 型** | 無視（参照しない） | **常に終日** | DATE 型に時間情報が存在しないため |
| **DATETIME 型** | ON（チェック済み） | 終日 | ユーザーが明示的に終日指定 |
| **DATETIME 型** | OFF（未チェック） | 時間あり | 通常の時間予定 |

### 9.3 フィールド型の自動検出

`KC.Config.detectFields()` が起動時に kintone REST API でフィールド定義を取得し、`KC_start` フィールドの型を `KC.Config.START_FIELD_TYPE` に格納する（値は `'DATETIME'` または `'DATE'`）。以降のロジックはこの値を参照して分岐する。

```javascript
// KC.Config.START_FIELD_TYPE が設定されるタイミング（src/kc-calendar.js:109）
this.START_FIELD_TYPE = props[this.FIELD.start]
  ? props[this.FIELD.start].type
  : 'DATETIME';  // 検出失敗時のフォールバック
```

### 9.4 内部処理の詳細

#### `_recordToEvent` での処理（src/kc-calendar.js:429–447）

```
START_FIELD_TYPE === 'DATE' の場合:
  1. ev.allday = true  （強制的に終日フラグをセット）
  2. startVal ("YYYY-MM-DD") を "YYYY-MM-DDT00:00:00.000Z" に変換
  3. endVal ("YYYY-MM-DD") の翌日 0:00 に変換（描画ロジック統一のため）
     例: "2025-11-03" → endDate = new Date("2025-11-03T00:00:00") → setDate(+1) → toISOString()

START_FIELD_TYPE === 'DATETIME' の場合:
  1. ev.start / ev.end はそのまま（ISO 8601 形式）
  2. allday フィールドが設定されていれば CHECK_BOX の値を参照してフラグをセット
     ev.allday = (rec[F.allday].value || []).includes(KC.Config.ALLDAY_LABEL)
```

終日イベントの `end` を「翌日 0:00」に統一することで、`placeEvents` 内の終日バー描画ロジックが DATE 型・DATETIME 型を区別せず同一処理で扱える。

#### `loadEvents` のクエリ条件（src/kc-calendar.js:460–468）

DATE 型の場合、kintone クエリに渡す日付形式が `"YYYY-MM-DD"` になる（DATETIME 型の ISO 8601 形式と区別が必要）。

```javascript
if (KC.Config.START_FIELD_TYPE === 'DATE') {
  qStart = isoStart.substring(0, 10);  // "YYYY-MM-DD" に変換
  qEnd   = isoEnd.substring(0, 10);
}
// クエリ条件: end >= qStart（当日終日イベントの取得漏れ防止）
conditions.push('(' + F.start + ' < "' + qEnd + '")');
conditions.push('(' + F.end + '  > "' + qStart + '")');
```

`end > qStart`（`>=` ではなく `>`）の条件で、当日が `end` と一致する単日終日イベント（DATE 型で `start = end = "YYYY-MM-DD"`）が取得漏れしないよう、クエリ範囲の境界設計に注意が必要。

#### データ保存時のフォーマット変換（src/kc-calendar.js:537–579）

DATE 型のとき、API への送信値は `"YYYY-MM-DD"` 形式に変換する（ISO 8601 形式のまま送ると kintone が型エラーを返す）。

```javascript
if (KC.Config.START_FIELD_TYPE === 'DATE') {
  record[F.start] = { value: ev.start.substring(0, 10) };  // "YYYY-MM-DD"
  record[F.end]   = { value: ev.end.substring(0, 10) };    // "YYYY-MM-DD"
}
```

---

## 10. 実装上の注意事項

### 10.1 kintone 固有の制約

1. **二重初期化防止**: `app.record.index.show` はビュー切替のたびに発火。フラグで制御。
2. **CSS スコープ**: `.kc-` プレフィックスで kintone 標準CSSとの衝突を防止。`html, body` へのスタイル適用禁止。
3. **高さ計算**: `100vh` ではなく kintone ヘッダーを考慮した `calc()` を使用。

### 10.2 GAS版からの変更点

1. `google.script.run` → `kintone.api()` (async/await)
2. スプレッドシートキャッシュ → 廃止（kintone直接読取）
3. iframe / postMessage → 廃止（直接DOM描画）
4. ダイアログHTML → JSで動的生成（ensureDOM）
5. タイムスロットclick → alert() を Dialog.openCreate() に変更
6. D&D セレクタ → `.cell` を `.kc-cell` に修正
7. イベント要素クリック → Dialog.openEdit() を追加
8. XSS対策 → innerHTML にユーザー入力を直接代入しない

### 10.3 セキュリティ

- `textContent` 使用 or `escapeHtml()` 経由で XSS 対策
- `kintone.api()` は CSRF トークン自動付与

### 10.4 実装順序

| Phase | 内容 |
|-------|------|
| 1 | Config + Utils + State |
| 2 | Api（kintone.api連携） |
| 3 | RenderWeek + Render（ファサード）|
| 4 | TimeSlots + Boot + kintone.events登録 |
| 5 | Dialog（DOM生成 + CRUD連携）|
| 6 | DnD（セレクタ修正）|
| 7 | ViewDropdown |
| 8 | CSS統合 + kintone固有調整 |
