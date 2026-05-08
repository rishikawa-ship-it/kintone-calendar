# 要件定義書: 月ビュー（Google カレンダー風 Month View）実装

**文書番号**: REQ_month-view
**作成日**: 2026-05-08
**作成者**: designer (サブエージェント)
**対象ファイル**: `src/kc-calendar.js`, `src/kc-calendar.css`（および `docs/` ミラー）
**ステータス**: 確定版（仕様確定 10 件済み / 未確定事項 6 件 — §10 参照）

---

## 目次

1. [目的・背景](#1-目的背景)
2. [スコープ](#2-スコープ)
3. [設計方針](#3-設計方針)
4. [受け入れ条件（Done の定義）](#4-受け入れ条件done-の定義)
5. [データモデル / 状態](#5-データモデル--状態)
6. [既存コードからの差分](#6-既存コードからの差分)
7. [CSS 変数 / レイアウト](#7-css-変数--レイアウト)
8. [エッジケース / 検証ケース](#8-エッジケース--検証ケース)
9. [次タスクへの引き継ぎ](#9-次タスクへの引き継ぎ)
10. [未確定事項 / リスク・前提](#10-未確定事項--リスク前提)

---

## 1. 目的・背景

### 1.1 月ビュー実装の意義

`kc-calendar.js` は現在、週ビュー（`KC.RenderWeek`）のみ動作する状態にある。月ビュー（`KC.RenderMonth`）と日ビュー（`KC.RenderDay`）は `src/kc-calendar.js:2151–2181` にスタブのみが存在し、実質未実装である。

月単位の予定俯瞰は日常業務での利用頻度が高く、「その月に何が入っているか」を一覧確認したいユースケースを週ビューだけでは満たせない。月ビューの追加は、カレンダー製品としての完成度に直結する。

### 1.2 Google カレンダー方式採用の理由

Google カレンダーの月ビューは以下の点で実績ある UX 標準として機能している。

- **6 行 × 7 列固定**のグリッドで月全体を俯瞰できる
- 終日イベントは行またぎの連続バーで視覚的に期間を把握できる
- 時間予定はセル内にコンパクトな chip で表示し、クリックで詳細を開く
- 当月外の日付は薄表示で空白を自然に埋める

これらは `REQ_allday-bar-redesign.md` で採用した絶対配置レイヤ方式と同じ設計思想であり、週ビューとの設計一貫性が高い。

### 1.3 関連要件定義書

| 文書 | 関係 |
|---|---|
| `requirements/REQ_allday-bar-redesign.md` | 終日バー絶対配置方式。月ビューも同思想を採用 |
| `requirements/REQ_event-drag-resize.md` | DnD 共通基盤。月ビュー DnD は Phase 2 でこの基盤を拡張する |

---

## 2. スコープ

### 2.1 対象（Phase 1 スコープ内）

| 項目 | 詳細 |
|---|---|
| 6×7 グリッド表示 | CSS Grid `grid-template-rows: repeat(6, 1fr)` で月全体を固定 6 行に配置 |
| 終日イベントの週ごとバー | 各週行に `.kc-month-ad-events` レイヤを生成し、`KC.Lanes` 経由でレーン割り当て + 連続バー描画 |
| 時間予定のセル内 chip | ドット + 時刻 + 件名のインライン chip（`.kc-month-chip`）を縦並びで配置 |
| セル内表示件数上限 | 最大 5 件。超過分は「他◯件」ラベルで省略 |
| セルクリック → 新規作成 | `KC.Popup.openCreate({ date, allday: true })` を呼ぶ |
| 終日バークリック → 編集 | `KC.Popup.openEdit(ev.id)` を呼ぶ |
| 時間予定 chip クリック → 編集 | `KC.Popup.openEdit(ev.id)` を呼ぶ |
| ナビゲーション（月単位） | prev/today/next ボタンを月単位 ±1 で動作させる |
| ViewDropdown に「月」追加 | `_buildDOM` の dropdown に月オプションを追加 |
| cursor API 化 | `KC.Api.loadEvents` の内部実装を cursor API に変更（シグネチャ維持） |
| `KC.Lanes` ユーティリティ切り出し | `KC.RenderWeek` 内の 3 関数を `KC.Lanes` として独立モジュール化 |
| タイトルラベル | 月ビュー時は `2026年04月` 形式（ゼロ埋め月）で表示 |
| src / docs 同期 | `src/` 編集後、`docs/` にも同内容を同期（CLAUDE.md ルール） |

### 2.2 スコープ外（Phase 2 以降）

| 項目 | 理由 |
|---|---|
| 「他◯件」クリックの詳細展開（ポップオーバー） | Phase 2 対応。Phase 1 では何もしない |
| 月ビュー DnD（バーのドラッグ移動・リサイズ） | Phase 2 対応。`REQ_event-drag-resize.md` の月ビュー拡張として別タスク化 |
| 日ビュー（`KC.RenderDay`）の実装と統合 | Phase 2 以降 |
| 月ビューでの時刻スナップ（時間予定の DnD） | Phase 2 以降 |

---

## 3. 設計方針

### 3.1 全体アーキテクチャ

#### 月ビュー追加後のモジュール依存関係

```
KC.Boot
  ├─ KC.Render（ファサード）
  │     ├─ KC.RenderWeek   ← 既存実装（KC.Lanes を経由するよう改修）
  │     ├─ KC.RenderMonth  ← 今回新規実装（KC.Lanes を利用）
  │     └─ KC.RenderDay    ← スタブ維持
  ├─ KC.Lanes              ← 新規モジュール（KC.RenderWeek から切り出し）
  ├─ KC.Api                ← loadEvents を cursor API に改修
  └─ KC.TimeSlots          ← month 時にスキップ処理を追加
```

#### 月ビュー DOM 構造

```
.kc-root
  ├─ .kc-header               ← 既存（変更なし）
  └─ .kc-month-root           ← 月ビュー専用ルート（view='month' 時に _buildDOM で生成）
        ├─ .kc-month-days     ← 曜日ヘッダー（日〜土、7 列）
        │     └─ .kc-month-dayhead × 7
        └─ .kc-month-grid     ← CSS Grid 本体（6行 × 7列）
              └─ .kc-month-week × 6   ← 行ラッパー（position: relative）
                    ├─ .kc-month-cell × 7   ← 日付セル（背景・クリック受付）
                    │     ├─ .kc-month-datehead   ← 日付数字
                    │     ├─ .kc-month-chip × N   ← 時間予定 chip
                    │     └─ .kc-month-more        ← 「他◯件」（省略時のみ）
                    └─ .kc-month-ad-events         ← 終日バー専用絶対配置レイヤ
                          └─ .kc-ad-event × N      ← 終日バー（KC.RenderWeek と同クラス）
```

**設計ポイント**: `.kc-month-ad-events` は週ごとに 1 個生成し、`.kc-month-week` に `position: relative` を与えて絶対配置の基準とする。これは `REQ_allday-bar-redesign.md §3.2` の `.kc-ad-events` レイヤと同じ思想である。

#### view 切替時の DOM 生成フロー

```
KC.ViewDropdown → KC.State.view = 'month' → KC.Render.refresh()
  → KC.RenderMonth.refresh()
  → _ensureMonthDOM()    // .kc-month-root が未生成なら生成
  → データ取得 (cursor API)
  → KC.RenderMonth.renderGrid()
```

週ビューと月ビューの DOM は共存させず、view 切替時に不要な方を `display: none` で隠す方式を採用する（DOM 再生成より高速）。ただし、`.kc-grid-wrap`（週ビュー DOM）は週ビューが描画を依存するため、月ビュー表示中は `display: none` とし、`.kc-month-root` を `display: block` に切り替える。

### 3.2 KC.Lanes ユーティリティ（新規モジュール）

#### 背景

現在 `KC.RenderWeek` の IIFE 内クロージャに以下の 3 関数が存在する。

| 関数名 | 所在 | 役割 |
|---|---|---|
| `eventToBarPosition(evt, weekYMD)` | `src/kc-calendar.js:1595–1634` | 週内でのバー位置（colStart / span / adDateRange）を算出 |
| `assignLanes(weekEvents)` | `src/kc-calendar.js:1642–1675` | created 昇順 → id 昇順でソートし、衝突のないレーン番号を付与 |
| `isLightColor(color)` | `src/kc-calendar.js:1456–1465` | `canvas` を使った輝度判定（文字色を白 / 黒に切り替える） |

これら 3 関数は月ビューでも同一ロジックが必要であり、`KC.Lanes` として独立モジュールに切り出す。

#### 公開関数

```javascript
KC.Lanes = {
  /**
   * 週内でのイベントのバー位置を算出する
   * @param {Object} evt - KcEvent（start, end を含む）
   * @param {string[]} weekYMD - 7 要素の YYYY-MM-DD 配列（index 0 = 日曜）
   * @returns {{ colStart: number, span: number, adDateRange: string } | null}
   */
  eventToBarPosition: function (evt, weekYMD) { ... },

  /**
   * 週イベント配列にレーン番号を付与する（破壊的変更）
   * ソート規則: created 昇順 → id 昇順
   * @param {Array} weekEvents - { colStart, span, created, id } を含む配列
   * @returns {Array} lane プロパティが付与された配列
   */
  assignLanes: function (weekEvents) { ... },

  /**
   * 色が明るいかどうかを判定する（文字色選択に使用）
   * @param {string} color - CSS カラー文字列
   * @returns {boolean} true = 明るい色（文字を黒にする）
   */
  isLightColor: function (color) { ... }
};
```

#### 切り出し手順（依存順序）

1. `KC.Lanes` IIFE を `KC.RenderWeek` より前に定義する（依存順序: `KC.Lanes` → `KC.RenderWeek` → `KC.RenderMonth`）
2. `KC.RenderWeek` 内の `eventToBarPosition` / `assignLanes` / `isLightColor` の定義を削除する
3. `KC.RenderWeek` 内で呼び出している箇所を `KC.Lanes.eventToBarPosition` / `KC.Lanes.assignLanes` / `KC.Lanes.isLightColor` に変更する
4. 既存の `buildAlldayBar`、`calcCollapsedLanes`、`updateAlldayToggle` は描画寄りのため `KC.RenderWeek` 内に残す

**後方互換注意点**: 手順 3 の変更を正しく行わないと `KC.RenderWeek` が動作しなくなる。builder はリグレッションテスト（週ビューの動作確認）を必須とすること。

### 3.3 月レイアウト計算

#### `monthRange(date)` 関数

月ビューの表示範囲（42 日分 = 6 行 × 7 列）を算出する。

```
入力: Date（表示基準月の任意の日）
出力: { start: Date, end: Date }

計算手順:
  monthFirst = new Date(year, month, 1)
  rangeStart = monthFirst から曜日分遡って当週の日曜へ（setDate - getDay()）
  rangeEnd   = rangeStart から 41 日後（= 6週 × 7日 - 1）
```

**6 行固定の根拠**: `rangeStart` の計算によって「月初日が含まれる週の日曜」から始め、常に 42 マスを確保する。これにより 28 日の 2 月でも 31 日の長い月でも 6 行に収まる（前月末・翌月頭で埋める）。

#### 当月外日付の判定

```javascript
// セルの date.getMonth() !== S.current.getMonth() なら当月外
```

当月外の `.kc-month-cell` には `.kc-month-cell--other-month` クラスを付与し、文字色のみ薄表示（gray-400 相当: `#9ca3af`）とする。背景色・クリック挙動は当月と同一。

### 3.4 終日イベント描画

各週行ごとに `.kc-month-ad-events` 絶対配置レイヤを生成し、`KC.Lanes` 経由で終日イベントを描画する。

#### 処理フロー

```
renderGrid() 内の週行ループ（6 週分）:
  1. weekYMD（7 要素配列）を算出
  2. S.events から当週にかかる終日イベントを抽出
  3. KC.Lanes.eventToBarPosition(evt, weekYMD) で colStart / span を算出
  4. KC.Lanes.assignLanes(weekEvents) でレーン番号付与
  5. 各イベントに対して buildMonthAlldayBar(ev) で .kc-ad-event を生成
  6. .kc-month-ad-events レイヤに appendChild
```

#### バー位置計算

`REQ_allday-bar-redesign.md §3.3` と同一の計算式を採用する。

```
left  = (colStart / 7) * 100%
width = (span / 7) * 100%
top   = BAR_TOP + lane * (BAR_H + BAR_GAP)   [px]
height = BAR_H                                [px]
```

`.kc-month-ad-events` の `left/right` で time-col / scrollbar オフセットを吸収する必要はなく、セルグリッドに `left: 0; right: 0` で張るだけでよい（月ビューには時間ガターがない）。

#### バー外観

週ビュー（`buildAlldayBar`）と同じ `.kc-ad-event` クラスのバー要素を使う。これにより CSS の `.kc-ad-event` スタイルがそのまま適用される。クリックハンドラは `KC.Popup.openEdit(ev.id)`。

### 3.5 時間予定描画（セル内 chip）

#### chip 構造

```html
<div class="kc-month-chip" data-ev-id="123">
  <span class="kc-month-chip-dot"></span>
  <span class="kc-month-chip-time">10:00</span>
  <span class="kc-month-chip-title">件名テキスト</span>
</div>
```

- ドット（`kc-month-chip-dot`）は `evt.color` で塗る。`color` 未設定なら `#3b82f6`
- 時刻（`kc-month-chip-time`）は開始時刻 `HH:MM` 形式
- 件名（`kc-month-chip-title`）は `text-overflow: ellipsis` で省略

#### クリック

chip クリック → `KC.Popup.openEdit(ev.id)`。`stopPropagation()` でセルへの伝播を止める。

### 3.6 セル内表示件数の管理と「他◯件」表示

#### 表示順序

1. 終日イベント（レーン昇順 → 期間長昇順）
2. 時間予定（開始時刻昇順）

#### 件数カウントと省略

```
表示可能上限: MAX_CELL_ITEMS = 5
表示済みカウント = 終日バー本数（当セルにかかるレーン数）+ chip 数

表示済みカウント < 5 の間はイベントを追加
5 件を超えたら「他 N 件」を最下行に追加（N = 残り件数）
```

**注意**: 「当セルにかかるレーン数」は同一週行の `KC.Lanes.assignLanes` 結果から、当セルの列（colIdx）に重なるバーの数を求める。

#### 「他◯件」表示

```html
<div class="kc-month-more">他 2 件</div>
```

- セル内最下行に配置
- テキスト: `他 N 件`（全角スペースなし、数字は半角）
- Phase 1 のクリック挙動: 何もしない（Phase 2 でポップオーバー対応予定）
- CSS: `color: var(--kc-subtext)`、`font-size: 11px`、`cursor: default`

### 3.7 セル / イベントのクリック挙動

| 操作 | 挙動 |
|---|---|
| 空セルクリック（`.kc-month-cell`） | `KC.Popup.openCreate({ date, allday: true })` |
| 終日バー（`.kc-ad-event`）クリック | `KC.Popup.openEdit(ev.id)` |
| 時間予定 chip（`.kc-month-chip`）クリック | `KC.Popup.openEdit(ev.id)` |
| 「他◯件」（`.kc-month-more`）クリック | 何もしない（Phase 1） |

chip / バーはクリック時に `stopPropagation()` でセルへの伝播を止める。これにより chip をクリックしても新規作成ダイアログは開かない。

### 3.8 ナビゲーション（月単位 prev/today/next）

`KC.Boot.init()` 内の prev/today/next ボタンハンドラを view 別分岐に変更する。

```javascript
// 変更前（週固定）
S.current.setDate(S.current.getDate() - 7);

// 変更後（view 別分岐）
if (S.view === 'month') {
  S.current.setMonth(S.current.getMonth() - 1);
} else {
  S.current.setDate(S.current.getDate() - 7);
}
```

today ボタンは view によらず `S.current = new Date()` で統一。

**aria-label の更新**: `aria-label` も「前の月」「次の月」に切り替えると望ましいが、Phase 1 では省略可（未確定事項 §10 参照）。

### 3.9 ViewDropdown への「月」オプション追加

`KC.Boot._buildDOM` の `menuUl.appendChild(optWeek)` 直後に月オプションを追加する（`src/kc-calendar.js:2568` 付近）。

```javascript
var optMonth = document.createElement('li');
optMonth.className = 'kc-option';
optMonth.setAttribute('role', 'option');
optMonth.dataset.value = 'month';
optMonth.setAttribute('aria-selected', 'false');
optMonth.textContent = '月';
menuUl.appendChild(optMonth);
```

### 3.10 cursor API 化（KC.Api.loadEvents 改修）

#### 概要

**本改修は週ビュー / 月ビュー共通基盤改修**となる。実装変更は `KC.Api.loadEvents` のみだが、週ビューの動作にも影響するためリグレッション確認が必須。

#### 旧実装（変更前）

`src/kc-calendar.js:362–403` の `loadEvents` は `kintone.api(url, 'GET', params)` で最大 500 件取得。500 件を超えるレコードが存在する場合はデータが欠落する。

#### 新実装（cursor API、kintone-rules.md §3 準拠）

シグネチャ `async loadEvents(isoStart, isoEnd) → KcEvent[]` は変更しない。内部実装のみ変更する。

```
1. POST /k/v1/records/cursor.json
     body: { app, query, fields, size: 500 }
   → レスポンス: { id: cursorId, totalCount }

2. ループ（next === true の間）:
     GET /k/v1/records/cursor.json
       params: { id: cursorId }
     → レスポンス: { records, next }
     → records を累積配列に push

3. 全件取得完了後、各レコードを _recordToEvent で変換して返す

4. エラー時:
     DELETE /k/v1/records/cursor.json
       body: { id: cursorId }
   でカーソルを破棄し、エラーを再スローする
```

**cursor 取得ループの注意点**: `next === true` の間は GET を繰り返す。1 回の GET で返るレコード数は `size` パラメータ（最大 500）で制御される。

#### cursor API のエラーハンドリング

```javascript
var cursorId = null;
try {
  var createResp = await kintone.api(cursorUrl, 'POST', createParams);
  cursorId = createResp.id;
  var allRecords = [];
  var hasNext = true;
  while (hasNext) {
    var getResp = await kintone.api(cursorUrl, 'GET', { id: cursorId });
    allRecords = allRecords.concat(getResp.records || []);
    hasNext = getResp.next;
  }
  return allRecords.map(function (r) { return self._recordToEvent(r); });
} catch (err) {
  if (cursorId) {
    try { await kintone.api(cursorUrl, 'DELETE', { id: cursorId }); } catch (e2) { /* ignore */ }
  }
  console.error('[KC.Api.loadEvents] cursor API エラー:', err);
  throw err;
}
```

### 3.11 タイトルラベル（view 別分岐）

`KC.Render._formatWeekMonthRange` を view 別に分岐する。

```javascript
_formatWeekMonthRange: function (date) {
  var S = KC.State;
  var p2 = KC.Utils.pad2;

  if (S.view === 'month') {
    // 月ビュー: "2026年04月"（ゼロ埋め月）
    return date.getFullYear() + '年' + p2(date.getMonth() + 1) + '月';
  }

  // 週ビュー: 既存ロジック（変更なし）
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
```

### 3.12 KC.TimeSlots との整合（月ビュー時スキップ）

`KC.TimeSlots.patchRenderGrid`（`src/kc-calendar.js:2393–2413`）内の後処理は週ビュー専用の操作（30 分スロット生成・終日セルクリック付与・時刻スクロール）であり、月ビューでは不要かつ DOM 不整合を引き起こす。

```javascript
KC.Render.renderGrid = function () {
  var result = original.apply(KC.Render, arguments);
  if (KC.State.view === 'month') return result;  // 月ビュー時はスキップ
  try {
    self.buildTimeSlots();
    self.bindAllDayBoxes();
    self.scrollToDefaultTime();
  } catch (err) {
    console.error('[KC.TimeSlots] decorate error', err);
  }
  return result;
};
```

---

## 4. 受け入れ条件（Done の定義）

各条件は Given / When / Then 形式で記述する。

### AC4.1 月ビュー切替時の 6×7 グリッド表示

- **Given**: 週ビューが表示されている
- **When**: ViewDropdown で「月」を選択する
- **Then**: 6 行 × 7 列（42 マス）の月グリッドが表示される
- **And**: 週ビューの DOM（`.kc-grid-wrap`）が非表示になる

### AC4.2 当月外日付の薄表示

- **Given**: 月ビューで 2026 年 4 月が表示されている（4 月 1 日は水曜）
- **When**: グリッド左上（3 月 29 日〜3 月 31 日）を目視確認する
- **Then**: 当月外日付（3 月・5 月分）の文字色が薄く（gray-400: `#9ca3af`）表示される
- **And**: 当月日付（4 月 1 日〜30 日）は通常の文字色で表示される

### AC4.3 当日の視覚的強調

- **Given**: 月ビューが表示されている
- **When**: 本日の日付セルを確認する
- **Then**: 当日の日付数字に `.kc-month-cell--today` クラスが付与され、青丸（背景: `#3b82f6`、文字: 白）で強調表示される

### AC4.4 終日イベントの週ごと連続バー

- **Given**: 2026 年 4 月 6 日（月）〜4 月 10 日（金）の終日イベントが登録済み
- **When**: 月ビューで 4 月を表示する
- **Then**: 第 2 週行（4/5〜4/11）に月曜〜金曜にまたがる 1 本の連続バーが描画される
- **And**: バーの境界線（列の `border-left`）がバーに重ならない（縦線が見えない）

### AC4.5 週またぎ終日イベントの行分割

- **Given**: 2026 年 4 月 10 日（金）〜4 月 14 日（火）の終日イベントが登録済み
- **When**: 月ビューで 4 月を表示する
- **Then**: 第 2 週行（〜4/11）に金〜土の 2 列バーが表示される
- **And**: 第 3 週行（4/12〜）に日〜火の 3 列バーが表示される（行ごとにバーが分割される）

### AC4.6 時間予定の chip 表示

- **Given**: 2026 年 4 月 15 日（水）の 14:00 〜 15:00 の時間予定が登録済み
- **When**: 月ビューで 4 月を表示する
- **Then**: 4 月 15 日のセルに「● 14:00 件名」形式の chip が表示される（● はイベントの color ドット）

### AC4.7 セル内 5 件上限と「他◯件」

- **Given**: 同一日に終日 3 件・時間予定 4 件（合計 7 件）が登録されている
- **When**: 月ビューでその日を表示する
- **Then**: 5 件までが表示され、6 件目以降は「他 2 件」のラベルで省略される

### AC4.8 「他◯件」の Phase 1 クリック挙動

- **Given**: 「他 2 件」ラベルが表示されている
- **When**: 「他 2 件」をクリックする
- **Then**: 何も起きない（ポップオーバー等は表示されない）

### AC4.9 空セルクリック → 新規作成

- **Given**: 月ビューでイベントのないセルが表示されている
- **When**: そのセルをクリックする
- **Then**: `KC.Popup.openCreate({ date: 'YYYY-MM-DD', allday: true })` が呼ばれ、新規作成ポップアップが開く

### AC4.10 終日バークリック → 編集

- **Given**: 月ビューで終日イベントバーが表示されている
- **When**: バーをクリックする
- **Then**: `KC.Popup.openEdit(ev.id)` が呼ばれ、編集ポップアップが開く
- **And**: セルへの `click` イベントが伝播せず、新規作成ポップアップは開かない

### AC4.11 時間予定 chip クリック → 編集

- **Given**: 月ビューで時間予定 chip が表示されている
- **When**: chip をクリックする
- **Then**: `KC.Popup.openEdit(ev.id)` が呼ばれ、編集ポップアップが開く
- **And**: セルへの `click` イベントが伝播せず、新規作成ポップアップは開かない

### AC4.12 prev/next で月単位移動

- **Given**: 2026 年 4 月の月ビューが表示されている
- **When**: 「‹」（前月）ボタンをクリックする
- **Then**: 2026 年 3 月の月ビューが表示される（タイトルが `2026年03月` になる）
- **When**: 「›」（次月）ボタンをクリックする
- **Then**: 2026 年 4 月に戻る

### AC4.13 today ボタン

- **Given**: 2025 年 12 月の月ビューが表示されている
- **When**: 「今日」ボタンをクリックする
- **Then**: 本日の属する月が表示される（`S.current = new Date()`）

### AC4.14 タイトルラベルのフォーマット

- **Given**: 月ビューで 2026 年 4 月が表示されている
- **When**: ヘッダーのタイトルラベルを確認する
- **Then**: `2026年04月` と表示される（月は 2 桁ゼロ埋め）

### AC4.15 cursor API で 500 件超の全件取得

- **Given**: 表示期間内に 600 件のレコードが存在する
- **When**: 月ビューにナビゲートする（または週ビューで該当期間を表示する）
- **Then**: 500 件を超えるレコードが全て取得され、カレンダーに反映される（cursor GET ループが正常動作する）

### AC4.16 cursor API エラー時のハンドリング

- **Given**: cursor API の GET リクエストが通信エラーで失敗する状況
- **When**: カレンダーの表示を更新する
- **Then**: `console.error` にエラーが出力される
- **And**: カーソルが DELETE で破棄される（cursor リソースリークがない）
- **And**: 既存の `try-catch` を通じてエラーが再スローされ、UI はエラーを通知する（既存の `refresh()` のエラー処理に委ねる）

### AC4.17 KC.Lanes を週ビュー / 月ビューの両方が使用する

- **Given**: 週ビューで終日イベントが 3 件表示されている
- **When**: 月ビューに切り替えて同じ期間を確認する
- **Then**: 週ビュー・月ビュー両方で `KC.Lanes.assignLanes` が呼ばれ、同じソート・レーン割り当てロジックが適用される
- **And**: 週ビューの動作（`REQ_allday-bar-redesign.md` の AC が全て合格）が維持される

### AC4.18 月ビュー時に時刻スロットが描画されない

- **Given**: 月ビューが表示されている
- **When**: DevTools で DOM を確認する
- **Then**: `.kc-time-slot` 要素が存在しない
- **And**: `.kc-time-col` が表示されていない（月ビューに時刻ガターは存在しない）

### AC4.19 ViewDropdown に「月」オプションが表示される

- **Given**: カレンダーが初期化されている
- **When**: ViewDropdown ボタンをクリックする
- **Then**: 「週」と「月」の 2 つのオプションが表示される
- **And**: 「月」を選択すると `KC.State.view === 'month'` になり月ビューが表示される

### AC4.20 src / docs 同期

- **Given**: `src/kc-calendar.js` および `src/kc-calendar.css` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` および `docs/kc-calendar.css` が同一内容に同期されている（CLAUDE.md ルール準拠）

---

## 5. データモデル / 状態

### 5.1 KC.State の追加なし

月ビュー固有の新規状態フィールドは不要。既存の `KC.State.view = 'month'` が識別子として機能する。`KC.State.alldayExpanded` は月ビューでは参照しない（週ビュー専用）。

```javascript
// 月ビュー実装で参照する既存フィールド
KC.State = {
  view:    'week' | 'month' | 'day',  // 'month' 追加済み（スタブ定義に含まれる）
  current: Date,                       // 表示基準日（月の任意の日）
  events:  KcEvent[],                  // cursor API で取得した全レコード
  els:     { ... }                     // DOM キャッシュ（月ビュー用要素を追加）
};
```

### 5.2 KcEvent モデル（変更なし）

`DESIGN.md §6` および `REQ_allday-bar-redesign.md §5.2` のモデルを維持する。月ビューで追加するフィールドはない。

```javascript
// 参照するフィールド（月ビューで使うもの）
{
  id:      string,    // Popup.openEdit に渡す
  title:   string,    // バー / chip に表示
  start:   string,    // ISO 8601：chip の時刻表示・セル割り当て
  end:     string,    // ISO 8601：バーの span 計算
  allday:  boolean,   // 終日バー / chip 分岐
  color:   string,    // バー背景色・ドット色
  created: string,    // KC.Lanes.assignLanes のソートキー
}
```

### 5.3 KC.Lanes モジュール構成

```javascript
KC.Lanes = (function () {
  // isLightColor: KC.RenderWeek から移動
  function isLightColor(color) { ... }

  // eventToBarPosition: KC.RenderWeek から移動
  function eventToBarPosition(evt, weekYMD) { ... }

  // assignLanes: KC.RenderWeek から移動
  function assignLanes(weekEvents) { ... }

  return {
    isLightColor:      isLightColor,
    eventToBarPosition: eventToBarPosition,
    assignLanes:       assignLanes
  };
}());
```

---

## 6. 既存コードからの差分

### 6.1 移動（KC.RenderWeek → KC.Lanes）

以下の 3 関数は `KC.RenderWeek` から削除し、`KC.Lanes` に移動する。移動後、`KC.RenderWeek` 内の呼び出し箇所を `KC.Lanes.XXX` 経由に変更する。

| 関数名 | 現所在 | 移動先 | 現呼び出し箇所（`KC.RenderWeek` 内） |
|---|---|---|---|
| `isLightColor(color)` | `kc-calendar.js:1456–1465` | `KC.Lanes.isLightColor` | `buildAlldayBar`（2 箇所）、`placeEvents` の通常イベントブロック（1 箇所） |
| `eventToBarPosition(evt, weekYMD)` | `kc-calendar.js:1595–1634` | `KC.Lanes.eventToBarPosition` | `placeEvents` 内の終日ブロック（1 箇所） |
| `assignLanes(weekEvents)` | `kc-calendar.js:1642–1675` | `KC.Lanes.assignLanes` | `placeEvents` 内の終日ブロック（1 箇所） |

**依存順序**: `KC.Lanes` の IIFE 定義は `KC.RenderWeek` の IIFE より前に記述すること。

### 6.2 変更する JS（既存ファイル）

| 対象 | 変更内容 | 所在 |
|---|---|---|
| `KC.Api.loadEvents` | 内部実装を cursor API ループに変更（シグネチャ維持） | `kc-calendar.js:362–403` |
| `KC.Render._formatWeekMonthRange` | view === 'month' 時の分岐追加 | `kc-calendar.js:2251–2266` |
| `KC.Boot._buildDOM` の dropdown | 「月」オプション `<li>` を追加 | `kc-calendar.js:2561–2568` 付近 |
| `KC.Boot.init` の prev/today/next ハンドラ | view === 'month' 時は月単位で移動 | `kc-calendar.js:2689–2711` |
| `KC.TimeSlots.patchRenderGrid` | view === 'month' 時に後処理をスキップ | `kc-calendar.js:2393–2413` |
| `KC.RenderMonth` スタブ | 完全実装に置き換え | `kc-calendar.js:2151–2166` |

### 6.3 追加する JS（新規モジュール・関数）

#### `KC.Lanes` モジュール（新規 IIFE）

```javascript
KC.Lanes = (function () {
  // KC.RenderWeek から移動した 3 関数
  function isLightColor(color) { ... }
  function eventToBarPosition(evt, weekYMD) { ... }
  function assignLanes(weekEvents) { ... }
  return { isLightColor, eventToBarPosition, assignLanes };
}());
```

#### `KC.RenderMonth` 実装（IIFE に書き換え）

公開関数:

| 関数名 | 役割 |
|---|---|
| `refresh()` | データ取得 + `renderGrid()` を呼ぶ完全リフレッシュ |
| `renderGrid()` | DOM をクリアして月グリッド全体を再描画 |
| `gridRange()` | `monthRange(S.current)` の結果を返す |
| `monthRange(date)` | 6 行 42 日分の { start, end } を算出（内部関数） |
| `buildMonthDOM()` | `.kc-month-root` および曜日ヘッダーを生成（内部関数） |
| `renderMonthGrid()` | 42 セルを生成してグリッドに配置（内部関数） |
| `placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents)` | 週行ごとに終日バーを配置（内部関数） |
| `placeMonthTimedEvents(cellEl, timedEvents, usedSlots)` | セルに時間予定 chip を配置（内部関数） |
| `applyOverflow(cellEl, remaining)` | 「他◯件」要素を追加（内部関数） |
| `buildMonthAlldayBar(ev)` | 月ビュー用の `.kc-ad-event` 要素を生成（内部関数） |
| `buildMonthChip(evt)` | `.kc-month-chip` 要素を生成（内部関数） |

### 6.4 追加する CSS（新規クラス）

| クラス | 役割 | 主なスタイル |
|---|---|---|
| `.kc-month-root` | 月ビュールート | `display: flex; flex-direction: column; height: 100%` |
| `.kc-month-days` | 曜日ヘッダー行 | `display: grid; grid-template-columns: repeat(7, 1fr)` |
| `.kc-month-dayhead` | 曜日ラベル（日〜土） | `text-align: center; font-size: 12px; color: var(--kc-subtext)` |
| `.kc-month-grid` | 月グリッド本体 | `display: grid; grid-template-rows: repeat(6, 1fr); flex: 1` |
| `.kc-month-week` | 週行ラッパー | `display: grid; grid-template-columns: repeat(7, 1fr); position: relative` |
| `.kc-month-cell` | 日付セル | `border: 1px solid var(--kc-border); min-height: var(--kc-month-cell-min-h); overflow: hidden; cursor: pointer` |
| `.kc-month-cell--other-month` | 当月外セル | `color: #9ca3af` |
| `.kc-month-cell--today .kc-month-datehead` | 当日日付 | `background: #3b82f6; color: #fff; border-radius: 999px` |
| `.kc-month-datehead` | セル内日付数字 | `font-size: 13px; font-weight: 500; text-align: center; padding: 2px` |
| `.kc-month-ad-events` | 終日バー専用絶対配置レイヤ | `position: absolute; left: 0; right: 0; top: 0; pointer-events: none; z-index: 1` |
| `.kc-month-chip` | 時間予定 chip | `display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 4px; cursor: pointer; border-radius: 3px; overflow: hidden; white-space: nowrap` |
| `.kc-month-chip-dot` | chip のカラードット | `width: 6px; height: 6px; border-radius: 999px; flex: 0 0 auto` |
| `.kc-month-chip-time` | chip の時刻 | `font-size: 11px; flex: 0 0 auto; color: var(--kc-subtext)` |
| `.kc-month-chip-title` | chip の件名 | `flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| `.kc-month-more` | 「他◯件」 | `font-size: 11px; color: var(--kc-subtext); padding: 1px 4px; cursor: default` |

---

## 7. CSS 変数 / レイアウト

### 7.1 新規 CSS 変数（推奨）

| 変数名 | 推奨値 | 説明 |
|---|---|---|
| `--kc-month-cell-min-h` | `90px` | セルの最小高。`grid-template-rows: repeat(6, 1fr)` で動的だが下限を保証する |

> **未確定**: 推奨値は 90px か 100px かを builder が判断する（§10 参照）。

### 7.2 月ビューのレイアウト計算

- `.kc-month-grid` の高さ: `flex: 1` で `.kc-month-root` の残余領域全体を使う
- `grid-template-rows: repeat(6, 1fr)`: 6 行を均等分割（行高は動的）
- `.kc-month-week` の高さが確定した後、`.kc-month-ad-events` は `top` / `left` / `right` を 0 に固定し、`bottom` はセル内のコンテンツ（chip / more）が始まる高さに合わせる

### 7.3 `.kc-month-ad-events` の高さ計算

週ビューの `.kc-ad-events` と異なり、月ビューの終日バーレイヤはセル内に重なって配置される。バーが多い場合は chip のスペースを圧迫するため、レーン数に応じて高さを調整するか、chip をバーの下に配置する設計とする。

**推奨設計**: セルを `display: flex; flex-direction: column` とし、`.kc-month-ad-events` を上部に配置。その高さは `(maxLane + 1) * (BAR_H + BAR_GAP) + BAR_TOP` で JS から動的設定する。

---

## 8. エッジケース / 検証ケース

| ケース | 期待動作 | 備考 |
|---|---|---|
| 5 月（31 日）の月ビュー | 月初（5/1 = 金曜）が第 1 週の金曜から始まり、6 行で収まる（前月 4 日分 + 31 日 + 翌月 7 日分 = 42 マス） | 6 行固定の検証 |
| 2 月（28 日）の月ビュー | 6 行 42 マスに前後の月の日付で埋める | 最短月の検証 |
| 2026 年 11 月（月初が日曜）の月ビュー | 月初が日曜のため第 1 行は 11/1 から始まり、前月分が 0 になる | colStart = 0 の検証 |
| 月末が土曜の月 | 最終行の土曜が月末になり、翌月分が 0 マスになる | 末尾処理の検証 |
| 週またぎ終日イベント（行分割）| 各週行に分割してバーを描画する | §3.4・AC4.5 参照 |
| 前月から継続する終日イベント | 1 行目の先頭セルから始まるバーとして表示される | `clampedStartYMD` が当週の日曜以降になる |
| 翌月へ継続する終日イベント | 最終行の末尾セルで終わるバーとして表示される | `clampedEndYMD` が当週の土曜以前になる |
| 同セルに終日 3 件 + 時間予定 4 件（計 7 件） | 5 件表示 + 「他 2 件」 | AC4.7 |
| cursor API で 600 件取得 | 第 1 GET で 500 件、第 2 GET で 100 件。合計 600 件が正しく取得される | AC4.15 |
| cursor API 通信失敗 | cursor DELETE を試行しエラーを再スロー。`refresh()` のエラーハンドラで catch される | AC4.16 |
| view 切替の往復（week ↔ month） | 週ビューに戻った際に終日バー・時刻スロットが正常に再描画される | リグレッション確認 |
| 全画面モードでの月ビュー | `.kc-expanded` クラスが付与された状態で月グリッドが正しく高さ計算される | 未確定事項 §10 参照 |
| 月ビュー表示中の今日クリック | `S.current = new Date()` により本日の月が表示される | AC4.13 |
| イベントが 0 件の月 | グリッドが正常に描画され、全セルが空白で表示される | エラーなし |
| `color` フィールドが空のイベント | デフォルト色（`#3b82f6`）でドットが表示される | フォールバック確認 |

---

## 9. 次タスクへの引き継ぎ

### 9.1 builder への指示

- **ブランチ**: `feature/month-view` で作業すること（`isolation: "worktree"` 推奨）
- **編集対象**: `src/kc-calendar.js` と `src/kc-calendar.css` を同時に変更する。`docs/` への同期も忘れずに（CLAUDE.md ルール: AC4.20）
- **実装順序（依存順）**:
  1. `KC.Lanes` 新規 IIFE を `KC.RenderWeek` より前に定義する
  2. `KC.RenderWeek` 内の 3 関数の定義を削除し、呼び出し箇所を `KC.Lanes.XXX` に変更する（**リグレッション注意**）
  3. 週ビューの動作を確認してからステップ 4 以降へ進む
  4. `KC.Api.loadEvents` を cursor API 化する（週ビューも影響受けるためリグレッション確認必須）
  5. `KC.Boot._buildDOM` に月オプション追加
  6. `KC.Boot.init` の nav ハンドラを view 別分岐に変更
  7. `KC.TimeSlots.patchRenderGrid` に月ビュー時スキップを追加
  8. `KC.Render._formatWeekMonthRange` を view 別分岐に変更
  9. `KC.RenderMonth` を完全実装する（スタブを IIFE に置き換え）
  10. CSS の月ビュー用クラスを `kc-calendar.css` に追加
- **段階的置換**: `KC.Lanes` 切り出しは既存の `KC.RenderWeek` 動作に影響する。置換後に週ビューの AC（`REQ_allday-bar-redesign.md §4` の全 AC）が合格することを確認してから次ステップへ進む
- **cursor API リグレッション**: `KC.Api.loadEvents` 改修後、週ビューで 500 件未満のレコードが従来通り取得・表示されることを確認する
- **XSS 対策**: `textContent` を使用し `innerHTML` にユーザー入力を直接代入しない（`DESIGN.md §9.3`）
- **1 関数 1 責務**: `KC.RenderMonth` 内の各処理は責務ごとに関数を分割する（`coding-rules.md` 準拠）
- **「他◯件」の Phase 1 実装**: クリックハンドラを配線しない（`cursor: default` のみ設定。将来 `cursor: pointer` に変更してポップオーバーを接続する）

### 9.2 reviewer への指示

§4「受け入れ条件」の各項目（AC4.1〜AC4.20）を 1 つずつ順に確認すること。

特に以下に重点を置く:

1. **AC4.4（連続バー）**: 列境界線がバーに重なっていないことを目視確認する
2. **AC4.5（週またぎ分割）**: バーが週行ごとに正しく分割されることを確認する
3. **AC4.7（件数上限）**: 5 件ちょうどと 6 件以上の両方でテストする
4. **AC4.17（KC.Lanes リグレッション）**: 週ビューで `REQ_allday-bar-redesign.md` の AC4.1〜4.21 が全て合格することを確認する
5. **AC4.15（cursor API 500 件超）**: テスト環境でレコードを 501 件以上作成して全件取得されることを確認する（または curl で cursor POST → GET ループを模擬する）
6. **AC4.20（sync）**: `diff src/kc-calendar.js docs/kc-calendar.js` が空出力であることを確認する
7. **AC4.18（時刻スロット非表示）**: 月ビュー表示中に `.kc-time-slot` が DOM に存在しないことを DevTools で確認する
8. **リグレッション（cursor API 通常ケース）**: 週ビューで 500 件未満の通常ケースで挙動が変わっていないことを確認する

---

## 10. 未確定事項 / リスク・前提

### 10.1 セル高の最小値

- **内容**: `--kc-month-cell-min-h` の推奨値として 90px と 100px の 2 案がある
- **影響箇所**: `kc-calendar.css`（`--kc-month-cell-min-h` の定義値）
- **方針**: builder が UI 確認後に決定してよい。推奨は 90px（6 行 × 90px = 540px + ヘッダー分で一般的な画面に収まる）

### 10.2 chip の色設計

- **内容**: 時間予定 chip の背景色を「背景なし（透明）」にするか「ごく薄い背景（`#f0f9ff` 等）」にするかが未確定
- **影響箇所**: `.kc-month-chip` CSS
- **方針**: builder が Google カレンダーを参考に実装してよい。デフォルトは背景なしを推奨

### 10.3 「他◯件」のテキスト形式

- **内容**: `他 2 件` / `他2件` / `+2 more` のいずれにするかが未確定（確定済み仕様 #4 では「他◯件」と記載）
- **影響箇所**: `applyOverflow` 関数のテキスト生成
- **方針**: `他 N 件`（「他」+ 半角スペース + 半角数字 + 半角スペース + 「件」）で実装する（日本語 UI との整合のため）

### 10.4 月ビューでの全画面モード時の高さ計算

- **内容**: `kc-expanded` クラス適用時（`position: fixed; inset: 0`）に月グリッドが正しい高さで表示されるか検証が必要
- **影響箇所**: `.kc-month-root` / `.kc-month-grid` の CSS（`height: 100%` と `flex: 1` が適切に機能するか）
- **方針**: builder がブラウザ実機確認後に必要なら `calc(100vh - kintone ヘッダー高)` 等を追加する

### 10.5 cursor API の連続呼び出し安定性

- **内容**: cursor GET ループを連続で呼ぶ際にレート制限（同時接続 10 まで: `kintone-rules.md §3`）に抵触するケースがあるか未検証
- **影響箇所**: `KC.Api.loadEvents` の cursor ループ
- **方針**: 通常の月ビューで 500 件超のレコードが発生することは稀。問題が発生した場合はループ間に `await new Promise(r => setTimeout(r, 100))` の遅延を入れることを検討する

### 10.6 月またぎ終日イベントの月ビュー表示

- **内容**: 前月末から開始する終日イベントが当月の第 1 行にバーとして流入する仕様を確認済み（`eventToBarPosition` の clamp 処理で対応）。ただし Google カレンダーの月ビューでは「当月外セルにも終日バーが表示される」動作の詳細確認が必要
- **影響箇所**: `placeMonthAlldayEvents` の週行ループ
- **方針**: 当月外の日付（`.kc-month-cell--other-month`）のセルにかかる終日バーも同様に描画する（`KC.Lanes.eventToBarPosition` がクランプした範囲のみ表示）

---

*本要件定義書は確定済み仕様 10 件・受け入れ条件 20 件・未確定事項 6 件の構成で作成した。未確定事項（§10）のうち §10.3 は本文書内で方針を示した。残り 5 件（§10.1 / 10.2 / 10.4 / 10.5 / 10.6）は builder が実装判断または実機確認後に確定させること。*
