# 要件定義書: 日ビュー（Day View）実装

**文書番号**: REQ_day-view
**作成日**: 2026-04-30
**最終更新日**: 2026-05-13（第 2 版: §3.1 DOM 共有方針・§9.1 を `KC.Render.setActiveView` ベースに更新）
**作成者**: designer (サブエージェント)
**対象ファイル**: `src/kc-calendar.js`, `src/kc-calendar.css`（および `docs/` ミラー）
**ステータス**: 確定版（確定済み仕様 10 件 / 未確定事項 4 件 — §10 参照）

### 更新履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-13 | 第 2 版 | §3.1 DOM 共有方針の記述を `KC.Render.setActiveView` ベースに更新（`_showWeekDOM` 言及を削除）。§9.1 引き継ぎコメントを `setActiveView` ベースに更新（Step 4-B 対応） |
| 2026-04-30 | 初版 | 2026-05-12 ユーザー確認済み仕様 10 件を反映して新規作成 |

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

### 1.1 日ビュー実装の意義

`kc-calendar.js` は現在、週ビュー（`KC.RenderWeek`）と月ビュー（`KC.RenderMonth`）が動作する状態にある。日ビュー（`KC.RenderDay`）は `src/kc-calendar.js:3412–3422` にスタブのみが存在し、実質未実装である（`refresh` と `renderGrid` は空の関数、`gridRange` は単日 0:00 を返すのみ）。

週ビュー・月ビューでは 1 日単位の詳細確認に限界がある。「特定日の予定を時系列で把握したい」「会議の隙間時間を分単位で確認したい」といったユースケースに応える日ビューは、Google カレンダーと同等の利用価値を提供するための必須機能である。

### 1.2 Google カレンダー Day View との対比

| 機能 | Google カレンダー Day View | 本実装（Phase 月-Day-1） |
|---|---|---|
| レイアウト | 1 列タイムライン | 1 列グリッド（週ビュー DOM 流用）|
| 時刻ガター | 00〜23 時 | 同一（`renderTimeGutter` 共通化）|
| 終日エリア | 上部固定エリア | 同一（開閉トグル付き）|
| 自動スクロール | 現在時刻付近 | 6:30 固定（`KC.TimeSlots.scrollToDefaultTime` 流用）|
| 重複予定表示 | 並列レーン | 初回は積み重ね（Phase 月-Day-2 で並列化）|
| 別日 DnD | 対応 | Phase 月-Day-3 以降（初回スコープ外）|
| 祝日表示 | ヘッダー表示 | 同一（`KC.Holidays.getName` 流用）|

### 1.3 既存週ビュー / 月ビューとの関係

日ビューは週ビューと同じ DOM 構造（`.kc-grid-wrap`）を利用し、CSS 変数 `--kc-col-count` を `1` に設定することで 1 列表示に切り替える。これにより、週ビューで動作する以下の共通機能がそのまま日ビューでも機能する。

- 時刻ガター（`renderTimeGutter`）
- 時間予定の絶対配置 (`placeEvents`)
- 終日エリアの開閉トグル（`buildAlldayBar` / `updateAlldayToggle`）
- 6:30 自動スクロール（`KC.TimeSlots.scrollToDefaultTime`）
- 時刻スロットクリックによる新規作成
- `KC.DnD` の縦移動・上下リサイズ

### 1.4 KC.RenderShared 切り出しの保守性向上目的

現在 `KC.RenderWeek` の IIFE クロージャ内に、週ビューと日ビューの両方で必要となる共通関数が閉じ込められている。日ビューを実装するためには同一ロジックを複製するか、`KC.RenderWeek` の内部関数を公開する必要があり、どちらも DRY 原則に反する。

`KC.RenderShared`（仮称）モジュールとして以下の関数を切り出すことで、両ビューが同じ実装を共有し、将来の仕様変更時の修正箇所を 1 か所に集約できる。

| 切り出し対象関数 | 現所在（`KC.RenderWeek` 内） |
|---|---|
| `buildAlldayBar(ev)` | `src/kc-calendar.js:2277–2360` |
| `renderTimeGutter()` | `src/kc-calendar.js:2390–2400` |
| `calcCollapsedLanes(maxLane)` | `src/kc-calendar.js:2268–2270` |
| `updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount)` | `src/kc-calendar.js:2369–2387` |

---

## 2. スコープ

### 2.1 Phase 月-Day-1（MVP、本要件書の対象）

| 項目 | 詳細 |
|---|---|
| A. KC.RenderDay 実装（基本表示） | スタブを完全実装に置き換え。1 列グリッド・時刻ガター・終日エリア・イベント配置 |
| B. KC.RenderShared 共通モジュール切り出し | `buildAlldayBar` / `renderTimeGutter` / `calcCollapsedLanes` / `updateAlldayToggle` を KC.RenderWeek から移動 |
| C. ViewDropdown 表示順変更と「日」追加 | 表示順を「月 / 週 / 日」に変更。ボタン初期テキストを「月」に変更 |
| D. デフォルト view を `'month'` に変更 | `KC.State.view = 'month'`（プラグイン化設定可化の前準備）|
| ナビゲーション（日単位） | prev/next で `setDate(±1)` |
| タイトルラベル | `2026年04月30日(木)` 形式 |
| 6:30 自動スクロール | `KC.TimeSlots.scrollToDefaultTime` 流用 |
| 祝日表示 | ヘッダーに祝日名・終日エリア背景色（`--holiday` クラス流用）|
| 終日エリアの開閉トグル | 週ビューと同一仕様 |
| 共通フィルタ | `KC.EventFilter` を継続利用 |
| 24:00 跨ぎ予定 | 当日分のみ表示（24:00 でクランプ）|
| src / docs 同期 | `src/` 編集後 `docs/` にも同期（CLAUDE.md ルール）|

### 2.2 Phase 月-Day-2（スコープ外）

| 項目 | 内容 |
|---|---|
| 重複時間予定の並列表示 | 同じ時間帯に複数の時間予定がある場合の並列レーン表示。初回は積み重ね（`kc-overlay` z-index で重なる）|

### 2.3 Phase 月-Day-3（スコープ外）

| 項目 | 内容 |
|---|---|
| 別日への DnD | 日ビューから別の日への予定移動。DnD で date を跨ぐ操作 |

### 2.4 スコープ外（別フェーズ）

| 項目 |
|---|
| ARIA / キーボード完全対応 |
| タッチ / モバイル対応 |
| `+N more` 展開ポップオーバー（月ビュー Phase 2 と同期）|

---

## 3. 設計方針

### 3.1 全体アーキテクチャ

#### Phase 月-Day-1 後のモジュール依存関係

```
KC.Boot
  ├─ KC.Render（ファサード）
  │     ├─ KC.RenderWeek    ← KC.RenderShared 経由に変更
  │     ├─ KC.RenderMonth   ← 既存実装（変更なし）
  │     └─ KC.RenderDay     ← 完全実装（スタブ置き換え）
  ├─ KC.RenderShared        ← 新規モジュール（KC.RenderWeek から切り出し）
  ├─ KC.Lanes               ← 既存モジュール（変更なし）
  ├─ KC.Api                 ← 変更なし
  └─ KC.TimeSlots           ← day ビュー時に機能するよう確認
```

#### view 切替時のフロー（日ビュー）

```
KC.ViewDropdown → KC.State.view = 'day' → KC.Render.refresh()
  → KC.Render._pickModule() が KC.RenderDay を返す
  → KC.RenderDay.refresh()
     → --kc-col-count を 1 にセット
     → renderTimeGutter()  (KC.RenderShared 経由)
     → KC.Render.renderGrid()
        → KC.TimeSlots.patchRenderGrid により buildTimeSlots + bindAllDayBoxes + scrollToDefaultTime が実行
     → データ取得 (KC.Api.loadEvents)
     → KC.Render.renderGrid()（イベント配置込み）
```

#### DOM 共有方針

日ビューは週ビューと同じ `.kc-grid-wrap` を使用する。切替時は `--kc-col-count` を `1` にセットするだけでレイアウトが 1 列に変わる。月ビューから日ビューへの切替時は、`KC.Render.refresh()` 冒頭で `KC.Render.setActiveView('day')` が呼ばれることで `#kc-month-root` が `display:none` に設定され、`.kc-grid-wrap` が表示状態に復帰する（`KC.Render.refresh` の処理で自動対応）。

ビュー切替時の DOM 表示制御は `KC.Render.setActiveView(viewName)` に一元化されている。内部では VIEW_ROOTS レジストリ（week / month / day）を参照し、active view の DOM ルートのみ表示・他は `display:none` にする 3 段階方式で動作する（詳細は `DESIGN.md §4.8`・`REQ_view-switch-refactor.md §3.1` 参照）。

### 3.2 KC.RenderShared 共通モジュール

#### 概要

`KC.RenderShared`（確定名称は §10.1 参照）を `KC.RenderWeek` より前に定義する。`KC.RenderWeek` と `KC.RenderDay` の両方から `KC.RenderShared.*` として呼び出す。

#### 移動する関数の一覧

| 関数名 | 現所在 | 移動後の公開名 | パラメータ変更 |
|---|---|---|---|
| `buildAlldayBar(ev)` | `src/kc-calendar.js:2277–2360` | `KC.RenderShared.buildAlldayBar(ev, locator)` | `locator` 追加（後述）|
| `renderTimeGutter()` | `src/kc-calendar.js:2390–2400` | `KC.RenderShared.renderTimeGutter()` | なし |
| `calcCollapsedLanes(maxLane)` | `src/kc-calendar.js:2268–2270` | `KC.RenderShared.calcCollapsedLanes(maxLane)` | なし |
| `updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount)` | `src/kc-calendar.js:2369–2387` | `KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount)` | なし |

#### `buildAlldayBar` の `locator` パラメータ

週ビュー（7 列）と日ビュー（1 列）では、終日バーの `left` / `width` 計算式の分母が異なる。

| ビュー | colCount | left 計算 | width 計算 |
|---|---|---|---|
| 週ビュー | 7 | `(ev.colStart / 7) * 100%` | `(ev.span / 7) * 100%` |
| 日ビュー | 1 | `0%` | `100%` |

`locator` オブジェクトでこの違いを吸収する。

```javascript
// locator インターフェース
{
  colCount: number,   // 7（週）or 1（日）
}

// buildAlldayBar 内での使用
el.style.left  = ((ev.colStart / locator.colCount) * 100) + '%';
el.style.width = ((ev.span    / locator.colCount) * 100) + '%';
```

`KC.RenderWeek` からの呼び出し: `KC.RenderShared.buildAlldayBar(ev, { colCount: 7 })`
`KC.RenderDay` からの呼び出し: `KC.RenderShared.buildAlldayBar(ev, { colCount: 1 })`

#### 依存順序

```
KC.Lanes → KC.RenderShared → KC.RenderWeek → KC.RenderMonth → KC.RenderDay → KC.Render
```

### 3.3 KC.RenderDay 実装

#### `dayRange(date)` 関数（内部関数）

```
入力: Date（表示基準日）
出力: { start: Date, end: Date }

計算手順:
  start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  end   = 同一日（または翌日 0:00 = addDays(start, 1) とし open-end 形式とする）
```

> **設計注意**: API の `isoEnd` 引数は「翌日 0:00」で渡す（週ビュー・月ビューと同様の open-end 形式）。`gridRange()` が返す `end` は表示上の終端（当日 23:59 相当）とするか翌日 0:00 とするかを builder が確認すること（§10.2 参照）。

#### `renderGrid()` 関数（公開）

週ビューの `renderGrid()` と同じ構成。

```
1. renderDayHeaders()   ← 日ビュー用（1 列分の曜日ヘッダー）
2. renderAlldayRow()    ← 週ビューの renderAlldayRow を colCount=1 で流用
3. renderRows()         ← 週ビューの renderRows を colCount=1 で流用
4. placeEvents()        ← 週ビューの placeEvents を colCount=1 で流用
```

週ビューが `--kc-col-count: 7` を前提として動作しているため、日ビューでは `renderGrid()` の先頭で `--kc-col-count` を `1` にセットする。

#### `refresh()` 関数（公開）

```javascript
async function refresh() {
  // 列数を 1 に設定
  document.documentElement.style.setProperty('--kc-col-count', '1');
  KC.RenderShared.renderTimeGutter();
  KC.Render.renderGrid();  // KC.TimeSlots パッチを通過させる

  var range = gridRange();
  var toISO = ...;
  var isoStart = toISO(range.start);
  var isoEnd   = toISO(U.addDays(range.start, 1));  // 翌日 0:00

  try {
    KC.State.events = await KC.Api.loadEvents(isoStart, isoEnd);
    KC.Render.renderGrid();
    KC.Render.refreshTitle();
  } catch (err) {
    console.error('[KC.RenderDay] loadEvents error:', err);
  }
}
```

#### `renderDayHeaders()` 関数（内部関数）

1 列分（1 日分）のヘッダーを生成する。週ビューの `renderDayHeaders()` を参考に、1 列のみ描画するよう実装する。

```
- .kc-day 要素を 1 個生成（曜日クラス・祝日クラス付与）
- .kc-day-head 内に曜日ラベル・日付数字・祝日名（`KC.Utils.getHolidayName(d)` で取得）
- 当日の場合は `is-today` クラスを付与
```

### 3.4 ViewDropdown 表示順変更

#### 確定仕様

- 表示順: **月 / 週 / 日**（既存「週 / 月」を月-週に入れ替え + 末尾に「日」追加）
- 初期選択: `month`（`aria-selected="true"` を月オプションに設定）

#### `_buildDOM` の変更点

現在の `menuUl` 子要素順:

```
1. optWeek（週, aria-selected="true"）
2. optMonth（月, aria-selected="false"）
```

変更後:

```
1. optMonth（月, aria-selected="true"）
2. optWeek（週, aria-selected="false"）
3. optDay（日, aria-selected="false"）
```

`viewBtn.textContent` の初期値を `'週 '` から `'月 '` に変更する（`src/kc-calendar.js:3999`）。

#### `optDay` 要素の追加

```javascript
var optDay = document.createElement('li');
optDay.className = 'kc-option';
optDay.setAttribute('role', 'option');
optDay.dataset.value = 'day';
optDay.setAttribute('aria-selected', 'false');
optDay.textContent = '日';
menuUl.appendChild(optDay);
```

### 3.5 デフォルト view の変更

#### 確定仕様

```javascript
// 変更前（src/kc-calendar.js:369）
KC.State = {
  view: 'week',
  ...
};

// 変更後
KC.State = {
  view: 'month',
  ...
};
```

#### 変更の意図

リロード時に月ビューが初期表示になる。将来のプラグイン化に際して「起動時ビュー」を設定パラメータ化する予定があるため、その前準備として `'month'` をデフォルトとする。

### 3.6 ナビゲーション分岐

#### `KC.Boot.init` の prev/next ハンドラ拡張

現在の分岐（`src/kc-calendar.js:4176–4207`）は `month` か否かの 2 分岐。これを 3 分岐に変更する。

```javascript
// prev ボタン
if (S.view === 'month') {
  S.current.setMonth(S.current.getMonth() - 1);
} else if (S.view === 'day') {
  S.current.setDate(S.current.getDate() - 1);
} else {
  S.current.setDate(S.current.getDate() - 7);
}

// next ボタン
if (S.view === 'month') {
  S.current.setMonth(S.current.getMonth() + 1);
} else if (S.view === 'day') {
  S.current.setDate(S.current.getDate() + 1);
} else {
  S.current.setDate(S.current.getDate() + 7);
}
```

#### aria-label の更新

prev/next ボタンの `aria-label` を view 別に切り替える。

```javascript
function _updateNavAriaLabels() {
  var S = KC.State;
  var prevBtn = S.els.prevBtn;
  var nextBtn = S.els.nextBtn;
  if (!prevBtn || !nextBtn) return;
  var labels = {
    month: { prev: '前の月', next: '次の月' },
    week:  { prev: '前の週', next: '次の週' },
    day:   { prev: '前の日', next: '次の日' }
  };
  var v = labels[S.view] || labels.week;
  prevBtn.setAttribute('aria-label', v.prev);
  nextBtn.setAttribute('aria-label', v.next);
}
```

この関数を `KC.Render.refresh()` の末尾（または `refreshTitle()` と同じタイミング）で呼ぶ。

### 3.7 タイトルラベル

#### `KC.Render._formatWeekMonthRange` への `day` 分岐追加

現在は `month` と `week` の 2 分岐（`src/kc-calendar.js:3508–3531`）。`day` 分岐を追加する。

```javascript
_formatWeekMonthRange: function (date) {
  var S = KC.State;
  var p2 = KC.Utils.pad2;

  if (S.view === 'month') {
    return date.getFullYear() + '年' + p2(date.getMonth() + 1) + '月';
  }

  if (S.view === 'day') {
    // "2026年04月30日(木)" 形式
    var DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
    return date.getFullYear() + '年'
      + p2(date.getMonth() + 1) + '月'
      + p2(date.getDate()) + '日'
      + '(' + DAY_LABELS[date.getDay()] + ')';
  }

  // 週ビュー: 既存ロジック維持
  var range = this._weekRange(date);
  // ... 既存コード
},
```

### 3.8 24:00 跨ぎ予定の表示

#### 確定仕様

日ビューでは、24:00 を跨ぐ予定（例: `22:00〜翌 2:00`）について、**当日分のみ表示**（24:00 でクランプ）する。翌日に移動した場合、翌日の Day View でその予定が再表示される。

これは `placeEvents` の既存クランプロジックと整合する。週ビューでは日跨ぎ表示（Google カレンダー準拠）が実装済みであるが（`REQ_event-drag-resize.md §1.3`）、日ビューでは 1 列しかないため翌日列に表示する余地がない。翌日の日ビューナビゲート時に同予定を再表示する。

### 3.9 KC.DnD の day 対応

#### `_getWeekYMDs` の day 分岐（`src/kc-calendar.js:1633`）

現在の実装は週ビュー専用（7 要素配列）。日ビュー時に 1 要素配列を返すよう分岐を追加する。

```javascript
function _getWeekYMDs() {
  var S = KC.State;
  var U = KC.Utils;

  // 日ビュー: 当日 1 要素のみ
  if (S.view === 'day') {
    return [U.fmtYMD(S.current)];
  }

  // 週ビュー: 既存ロジック（7 要素）
  var d = new Date(S.current);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  var res = [];
  for (var i = 0; i < 7; i++) {
    res.push(U.fmtYMD(U.addDays(d, i)));
  }
  return res;
}
```

#### `_xToColIdx` / `_adcellFromX` の対応

これらは `.kc-adcell[data-date]` の DOM を走査して列インデックスを求めるため、日ビューでも 1 個の `.kc-adcell` を正しく認識できる。追加実装は不要。

#### `_drag.view = 'week'` の流用

日ビューの DnD は終日バーの縦移動（同日内）と時間予定の縦移動・上下リサイズが対象。`_drag.view` には `'week'` を設定して既存コードパスを流用する（日ビューは 1 列であり、横方向の日跨ぎ DnD は Phase 月-Day-3 で対応）。

```javascript
// startMoveAllday, startMoveTime, startResize 内で
// S.view === 'day' の場合も view: 'week' を設定して流用
_drag = {
  view: 'week',   // day ビューでも week として扱う（1 列 = 横移動なし）
  ...
};
```

### 3.10 祝日表示

`KC.Utils.getHolidayName(d)`（週ビューで `U.getHolidayName(d)` として利用中）を日ビューのヘッダー描画で使用する。

```
- 祝日の場合: .kc-day に .kc-day--holiday クラスを付与
- 祝日名を .kc-holiday-name 要素として .kc-day-head 内に追加
- 終日エリアの `.kc-adcell` に .kc-adcell--holiday クラスを付与（背景色を既存 CSS で適用）
```

### 3.11 KC.TimeSlots との整合

`KC.TimeSlots.patchRenderGrid`（`src/kc-calendar.js:3537–3596` 付近）は月ビュー時のみスキップ（`if (KC.State.view === 'month') return result`）。週ビューと同様に日ビューでも動作する必要がある。

月ビュースキップ条件を変更する必要はない（`day` は `month` でないためパッチが適用される）。ただし `buildTimeSlots` 内の `_getColumnDates` は `view === 'week'` 以外を「日ビュー等」として処理済み（`src/kc-calendar.js:3557–3559`）であるため、日ビューでも正しく動作する。

---

## 4. 受け入れ条件（Done の定義）

各条件は Given / When / Then 形式で記述する。

### AC4.1 日ビュー切替で 1 列グリッド表示

- **Given**: 月ビューが表示されている
- **When**: ViewDropdown で「日」を選択する
- **Then**: 1 列のタイムライングリッドが表示される
- **And**: `.kc-grid-wrap` が表示状態になる
- **And**: `--kc-col-count` が `1` にセットされている（DevTools で確認）

### AC4.2 タイトルが `YYYY年MM月DD日(曜)` 形式

- **Given**: 日ビューで 2026 年 4 月 30 日（木）が表示されている
- **When**: ヘッダーのタイトルラベルを確認する
- **Then**: `2026年04月30日(木)` と表示される（月・日は 2 桁ゼロ埋め、曜日は全角丸括弧）

### AC4.3 prev/next で前後 1 日移動

- **Given**: 日ビューで 2026 年 4 月 30 日が表示されている
- **When**: 「‹」（前日）ボタンをクリックする
- **Then**: 2026 年 4 月 29 日の日ビューが表示される（タイトルが `2026年04月29日(水)` になる）
- **When**: 続けて「›」（翌日）ボタンをクリックする
- **Then**: 2026 年 4 月 30 日に戻る

### AC4.4 Today で当日に戻る

- **Given**: 日ビューで過去の任意の日が表示されている
- **When**: 「今日」ボタンをクリックする
- **Then**: 本日の日ビューが表示される（`KC.State.current = new Date()`）
- **And**: タイトルが本日の日付 `YYYY年MM月DD日(曜)` 形式になる

### AC4.5 時刻スロットクリックで新規作成

- **Given**: 日ビューで任意の時刻スロットが表示されている
- **When**: 時刻スロット（`.kc-time-slot`）をクリックする
- **Then**: `KC.Popup.openCreate({ date: 'YYYY-MM-DD', hour: H, half: M })` が呼ばれ、新規作成ポップアップが開く

### AC4.6 終日エリアクリックで終日新規作成

- **Given**: 日ビューで終日エリアが表示されている
- **When**: 終日セル（`.kc-adcell`）をクリックする
- **Then**: `KC.Popup.openCreate({ date: 'YYYY-MM-DD', allday: true })` が呼ばれる

### AC4.7 イベントクリックで編集ポップアップ

- **Given**: 日ビューで時間予定バーが表示されている
- **When**: バーをクリックする
- **Then**: `KC.Popup.openEdit(ev.id)` が呼ばれ、編集ポップアップが開く
- **And**: タイムスロットへの `click` 伝播が止まる（`stopPropagation` 済み）

### AC4.8 終日 DnD（1 列内・移動）

- **Given**: 日ビューで終日イベントバーが表示されている
- **When**: バーを左右（同セル内）にドラッグして放す
- **Then**: 移動量が 5px 未満の場合: クリックとして `KC.Popup.openEdit` が呼ばれる
- **And**: 移動量が 5px 以上の場合: 同一日（1 列しかないため日付変更なし）として API 更新呼び出しは行われない（delta = 0）

### AC4.9 時間予定 DnD（縦移動・上下リサイズ）

- **Given**: 日ビューで「14:00〜15:00」の時間予定バーが表示されている
- **When**: バーを縦方向に 1 時間分ドラッグして放す
- **Then**: API が `start: 15:00, end: 16:00` で更新呼び出しされる
- **When**: バー下端ハンドルを 1 時間分ドラッグして放す
- **Then**: API が `start: 14:00, end: 16:00` で更新呼び出しされる

### AC4.10 6:30 自動スクロール

- **Given**: 日ビューに切り替えた直後
- **When**: 画面を確認する
- **Then**: 時刻ガターが 6:30 付近を中心に表示されるようスクロールされている（`KC.TimeSlots.scrollToDefaultTime` が動作している）

### AC4.11 祝日表示

- **Given**: 2026 年 9 月 21 日（月・敬老の日）を日ビューで表示する
- **When**: ヘッダーの曜日エリアを確認する
- **Then**: 祝日名「敬老の日」が `.kc-holiday-name` 要素で表示される
- **And**: `.kc-day--holiday` クラスが付与されている
- **And**: 終日エリアの `.kc-adcell` に `.kc-adcell--holiday` クラスが付与されている

### AC4.12 本日マーク（青丸）

- **Given**: 本日の日ビューが表示されている
- **When**: 曜日ヘッダーを確認する
- **Then**: `.kc-day-head.is-today` クラスが付与されており、日付数字が青丸でハイライトされている

### AC4.13 24:00 跨ぎ予定は当日分のみ表示

- **Given**: 2026 年 4 月 30 日 22:00〜翌 1:00 の時間予定が存在する
- **When**: 4 月 30 日の日ビューを表示する
- **Then**: 22:00〜24:00 のバーが表示される（24:00 でクランプ）
- **When**: 5 月 1 日の日ビューに移動する
- **Then**: 同予定は表示されない（当日分のみ表示）

> **注記**: `REQ_event-drag-resize.md §1.3` で週ビューは Google 準拠（日跨ぎ表示）であるが、日ビューは 1 列のため翌日列が存在せず当日クランプを採用する。

### AC4.14 共通フィルタ動作

- **Given**: `KC.EventFilter` で「自分の予定のみ」フィルタが設定されている
- **When**: 日ビューを表示する
- **Then**: 自分の予定のみが表示される（他人の予定は非表示）
- **And**: ViewDropdown でフィルタ切替後に正しく再描画される

### AC4.15 ViewDropdown が「月 / 週 / 日」順で表示

- **Given**: カレンダーが初期化されている
- **When**: ViewDropdown ボタンをクリックする
- **Then**: 「月」「週」「日」の 3 つのオプションが上からこの順で表示される
- **And**: 「日」を選択すると `KC.State.view === 'day'` になり日ビューが表示される

### AC4.16 デフォルト view が month に変更されている

- **Given**: ブラウザでページをリロードする
- **When**: カレンダーが初期化完了する
- **Then**: 月ビューが初期表示される（`KC.State.view === 'month'`）
- **And**: ViewDropdown ボタンのラベルが「月」と表示されている

### AC4.17 KC.RenderShared が公開され week / day 両方が共通関数を使う

- **Given**: Phase 月-Day-1 の実装が完了している
- **When**: `KC.RenderShared` オブジェクトを DevTools コンソールで確認する
- **Then**: `KC.RenderShared.buildAlldayBar` / `renderTimeGutter` / `calcCollapsedLanes` / `updateAlldayToggle` が存在する
- **And**: 週ビューで終日バーが正しく描画される（`KC.RenderShared.buildAlldayBar` が使われている）
- **And**: 日ビューで終日バーが正しく描画される（同じ `KC.RenderShared.buildAlldayBar` が使われている）

### AC4.18 src / docs 同期

- **Given**: `src/kc-calendar.js` および `src/kc-calendar.css` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` および `docs/kc-calendar.css` が同一内容に同期されている（CLAUDE.md ルール準拠）

### AC4.19 既存週ビュー / 月ビューのリグレッションなし

- **Given**: Phase 月-Day-1 の実装が完了している
- **When**: ViewDropdown で「週」を選択する
- **Then**: `REQ_event-drag-resize.md §4` の全 AC（AC4.1〜AC4.26）が引き続き合格する
- **When**: ViewDropdown で「月」を選択する
- **Then**: `REQ_month-view.md §4` の全 AC（AC4.1〜AC4.25）が引き続き合格する

---

## 5. データモデル / 状態

### 5.1 KC.State の変更点

`KC.State` への新規フィールド追加はない。変更は初期値のみ。

```javascript
// 変更前（src/kc-calendar.js:369）
KC.State = {
  view: 'week',
  ...
};

// 変更後
KC.State = {
  view: 'month',   // デフォルト view を month に変更
  ...
};
```

### 5.2 KcEvent モデル（変更なし）

既存の `KcEvent` オブジェクトをそのまま利用する。日ビューで参照するフィールドは週ビューと同一。

```javascript
{
  id:      string,    // Popup.openEdit に渡す
  title:   string,    // バー / chip に表示
  start:   string,    // ISO 8601：時刻表示・配置計算（DATE 型フィールド使用時は変換済み）
  end:     string,    // ISO 8601：バー高さ計算（DATE 型フィールド使用時は翌日 0:00 に変換済み）
  allday:  boolean,   // 終日バー / 時間予定の分岐（DATE 型フィールド使用時は常に true）
  color:   string,    // バー背景色
  rev:     string,    // 楽観ロック用 revision
  created: string,    // KC.Lanes.assignLanes のソートキー
}
```

> **DATE 型サポートについて**: `start` / `end` が DATE 型フィールドの場合、`KC.Api._recordToEvent` が `allday: true` を強制セットし、`end` を翌日 0:00 に変換する。日ビューの描画ロジックはこれを前提として動作するため、DATE 型フィールド使用アプリでもすべての予定が終日バーとして正しく表示される。詳細は `DESIGN.md §9` 参照。

### 5.3 CSS 変数の状態管理

| 変数 | 週ビュー時 | 日ビュー時 | 月ビュー時 |
|---|---|---|---|
| `--kc-col-count` | `7` | `1` | （月ビューでは使用しない）|

`--kc-col-count` はビュー切替時に `document.documentElement.style.setProperty` で JS から変更する。

---

## 6. 既存コードからの差分

### 6.1 KC.RenderShared 新規モジュール（Phase B）

`KC.RenderWeek` IIFE の前に新規 IIFE を定義する。

| 関数名 | 元の所在 | 移動先 | 変更内容 |
|---|---|---|---|
| `buildAlldayBar(ev)` | `src/kc-calendar.js:2277–2360` | `KC.RenderShared.buildAlldayBar(ev, locator)` | `locator.colCount` パラメータを追加し、列数を外部注入に変更 |
| `renderTimeGutter()` | `src/kc-calendar.js:2390–2400` | `KC.RenderShared.renderTimeGutter()` | 変更なし（そのまま移動）|
| `calcCollapsedLanes(maxLane)` | `src/kc-calendar.js:2268–2270` | `KC.RenderShared.calcCollapsedLanes(maxLane)` | 変更なし（そのまま移動）|
| `updateAlldayToggle(...)` | `src/kc-calendar.js:2369–2387` | `KC.RenderShared.updateAlldayToggle(...)` | 変更なし（そのまま移動）|

### 6.2 KC.RenderWeek の改修（Phase B）

上記 4 関数の定義を削除し、呼び出し箇所を `KC.RenderShared.*` 経由に変更する。

| 変更箇所 | 変更内容 |
|---|---|
| `buildAlldayBar(ev)` 呼び出し箇所（`placeEvents` 内の終日ブロック） | `KC.RenderShared.buildAlldayBar(ev, { colCount: 7 })` に変更 |
| `renderTimeGutter()` 呼び出し箇所（`refresh` 内） | `KC.RenderShared.renderTimeGutter()` に変更 |
| `calcCollapsedLanes(maxLane)` 呼び出し箇所（`placeEvents` 終日ブロック） | `KC.RenderShared.calcCollapsedLanes(maxLane)` に変更 |
| `updateAlldayToggle(...)` 呼び出し箇所（`placeEvents` 終日ブロック） | `KC.RenderShared.updateAlldayToggle(...)` に変更 |

**後方互換注意点**: 4 関数の削除後、`KC.RenderWeek` が正常動作することをリグレッションテストで確認してから次のステップへ進む。

### 6.3 KC.RenderDay 完全実装（Phase A）

スタブ（`src/kc-calendar.js:3412–3422`）を IIFE に置き換える。

公開関数:

| 関数名 | 役割 |
|---|---|
| `refresh()` | データ取得 + `KC.Render.renderGrid()` + タイトル更新 |
| `renderGrid()` | `--kc-col-count: 1` セット + `renderDayHeaders()` + `renderAlldayRow()` + `renderRows()` + `placeEvents()` |
| `gridRange()` | `dayRange(S.current)` の結果を返す |

内部関数:

| 関数名 | 役割 |
|---|---|
| `dayRange(date)` | 単日 0:00〜当日終端の `{ start, end }` を算出 |
| `renderDayHeaders()` | 1 列分の曜日ヘッダー DOM 生成 |
| `renderAlldayRow()` | 終日エリア（1 列）DOM 生成。`KC.RenderShared.buildAlldayBar(ev, { colCount: 1 })` を利用 |
| `renderRows()` | 24 時間 × 1 列のグリッド DOM 生成 |
| `placeEvents()` | 当日の時間予定を絶対配置。週ビューの `placeEvents` ロジックを 1 列に適用 |

### 6.4 KC.Render._formatWeekMonthRange への day 分岐追加

`src/kc-calendar.js:3508–3531` の `_formatWeekMonthRange` に `day` 分岐を追加する。

変更前: `month` / `week` の 2 分岐
変更後: `month` / `day` / `week` の 3 分岐

```
day 時: "YYYY年MM月DD日(曜)" 形式（§3.7 参照）
```

### 6.5 KC.ViewDropdown の表示順・デフォルト変更

`src/kc-calendar.js:4010–4026` の `_buildDOM` 内 `menuUl` 構成を変更する。

| 変更内容 | 対象箇所 |
|---|---|
| `optWeek` の `aria-selected` を `'false'` に変更 | `src/kc-calendar.js:4014` |
| `optMonth` を `menuUl` の先頭に移動し `aria-selected` を `'true'` に変更 | `src/kc-calendar.js:4019–4026` |
| `optDay` を新規追加（`aria-selected: 'false'`、`data-value: 'day'`、`textContent: '日'`）| `src/kc-calendar.js:4026` 直後 |
| `viewBtn.textContent` の初期値を `'週 '` から `'月 '` に変更 | `src/kc-calendar.js:3999` |

### 6.6 KC.Boot.init のナビゲーション分岐拡張

`src/kc-calendar.js:4171–4207` の prev/next ハンドラを 3 分岐に変更する（§3.6 参照）。

`_updateNavAriaLabels()` 関数を新規追加し、`KC.Render.refreshTitle()` の呼び出しに合わせて実行する。

### 6.7 KC.DnD._getWeekYMDs の day 分岐

`src/kc-calendar.js:1633–1644` の `_getWeekYMDs` に `view === 'day'` の分岐を追加する（§3.9 参照）。

### 6.8 KC.State.view 初期値変更

`src/kc-calendar.js:369` の `view: 'week'` を `view: 'month'` に変更する。

---

## 7. CSS 変数 / レイアウト

### 7.1 `--kc-col-count` の切替

`--kc-col-count` は週ビュー・日ビューで共通で使用する CSS 変数。日ビュー切替時に `1` にセットすることで、既存の `.kc-cell`（`grid-column: span 1`）・`.kc-day`（幅計算）がそのまま 1 列に対応する。

| タイミング | 値 | 実装箇所 |
|---|---|---|
| 初期化時 | `7`（週デフォルト）| `src/kc-calendar.js:4211` |
| 日ビューに切替 | `1` | `KC.RenderDay.refresh()` または `KC.RenderDay.renderGrid()` の先頭 |
| 週ビューに戻る | `7` | `KC.RenderWeek.renderGrid()` または `refresh()` の先頭 |

### 7.2 新規 CSS の追加

日ビュー専用の新規 CSS は最小限とする。既存の週ビュー CSS（`.kc-day`, `.kc-cell`, `.kc-ad-event` 等）が `--kc-col-count: 1` 環境でも機能することを実機確認後、必要に応じて微調整を追加する。

想定される微調整箇所:

| 項目 | 内容 |
|---|---|
| `.kc-day` の最小幅 | 1 列表示時に幅が極端に広くなる場合、`max-width` 制限が必要になる可能性がある |
| `.kc-day-head` のタイトル幅 | 日ビューのヘッダーでは月・日・曜日を全て表示するため、週ビューより幅が必要な場合がある |

**方針**: builder が実機確認後に必要な CSS のみ `kc-calendar.css` に追加する。設計者が事前に仕様化する内容はない。

---

## 8. エッジケース / 検証ケース

| ケース | 期待動作 | 対応 AC |
|---|---|---|
| 日ビューに切替直後の 6:30 スクロール | `KC.TimeSlots.scrollToDefaultTime` が動作して 6:30 付近が中心に表示される | AC4.10 |
| 24:00 跨ぎ予定の表示（22:00〜翌 1:00）| 当日分（22:00〜24:00）のみ描画。翌日の Day View では非表示 | AC4.13 |
| 祝日の日ビュー表示 | `kc-day--holiday` / `kc-adcell--holiday` クラス付与・祝日名表示 | AC4.11 |
| 1 日に同じ時間帯の予定が 3 件以上 | 重複バーが積み重ねて表示される（Phase 月-Day-2 以前の仕様）| — |
| 終日バーの DnD（同一日内） | 1 列しかないため日付変更は発生しない。delta = 0 で API 更新なし | AC4.8 |
| 時間予定の縦 DnD（日ビュー）| 正常に `KC.DnD.startMoveTime` が動作し API 更新される | AC4.9 |
| view 切替の連続往復（月 → 日 → 週 → 日 → 月）| 毎回正しいビューが描画され、列数・スクロール・祝日表示が正常 | AC4.19 |
| 連続日付ナビ（prev を連打）| 毎回前日に移動し、月跨ぎ・年跨ぎも正しく動作する | AC4.3 |
| 月初から prev（例: 5/1 → 4/30）| 正しく `setDate(-1)` で前月末日に移動する | AC4.3 |
| リロードで month が初期表示 | `KC.State.view = 'month'` であるため月ビューが初期表示される | AC4.16 |
| 0 件の日の日ビュー | グリッドが正常描画される。終日エリア・時間グリッドが空で表示 | — |
| `color` フィールドが空のイベント | デフォルト色（`#3b82f6`）でバーが表示される | — |
| 終日トグルの展開状態が日ビュー切替後も保持 | `KC.State.alldayExpanded` は view 切替時にリセット（既存 prev/next ハンドラのリセット処理が機能する）| — |
| `KC.TimeSlots.patchRenderGrid` が day ビューで動作するか | `view !== 'month'` のため月ビュースキップにかからず、`buildTimeSlots` / `bindAllDayBoxes` / `scrollToDefaultTime` が実行される | AC4.10 |

---

## 9. 次タスクへの引き継ぎ

### 9.1 builder への指示

- **ブランチ**: `feature/day-view` で作業すること（`isolation: "worktree"` 推奨）
- **編集対象**: `src/kc-calendar.js` と `src/kc-calendar.css` を同時に変更する。`docs/` への同期も忘れずに（CLAUDE.md ルール: AC4.18）
- **実装順序（依存順）**:
  1. `KC.State.view` の初期値を `'month'` に変更する（§6.8）
  2. `KC.RenderShared` 新規 IIFE を `KC.RenderWeek` の直前に定義する。`buildAlldayBar` / `renderTimeGutter` / `calcCollapsedLanes` / `updateAlldayToggle` を移動する（§6.1）
  3. `KC.RenderWeek` 内の 4 関数の定義を削除し、呼び出し箇所を `KC.RenderShared.*` に変更する（§6.2）
  4. **リグレッションチェック**: 週ビューが正常動作することを確認してから次ステップへ
  5. `KC.DnD._getWeekYMDs` に `view === 'day'` の分岐を追加する（§6.7）
  6. `KC.Boot._buildDOM` の `menuUl` を「月 / 週 / 日」順に変更し `optDay` を追加する（§6.5）
  7. `KC.Boot.init` のナビゲーションハンドラに `day` 分岐を追加する（§6.6）
  8. `KC.Render._formatWeekMonthRange` に `day` 分岐を追加する（§6.4）
  9. `KC.RenderDay` のスタブを完全実装に置き換える（§6.3）
  10. 日ビューの動作確認（スクロール・ナビゲーション・イベント配置・DnD）
  11. CSS 微調整が必要なら `kc-calendar.css` に最小限追加する（§7.2）
- **段階的実装**: `KC.RenderShared` 切り出しは `KC.RenderWeek` の動作に影響する。切り出し後に週ビューの AC（`REQ_allday-bar-redesign.md §4` の全 AC）が合格することを確認してから次ステップへ進む
- **`buildAlldayBar` の `locator` パラメータ**: 週ビューからの呼び出し箇所すべてに `{ colCount: 7 }` を追加すること。漏れがあると終日バーの位置が崩れる
- **`--kc-col-count` のセット**: `KC.RenderDay.renderGrid()` の先頭で `document.documentElement.style.setProperty('--kc-col-count', '1')` を呼ぶ。週ビューに戻る際は `KC.RenderWeek.renderGrid()` 先頭で `'7'` に戻す（またはビュー切替ファサードで管理する）
- **ビュー切替の DOM 表示制御**: `KC.Render.setActiveView(viewName)` に一元化されている。`KC.Render.refresh()` 冒頭で `this.setActiveView(KC.State.view)` が呼ばれ、active view の DOM ルートのみ表示・他は `display:none` に設定される。新規ビューを追加する場合は `setActiveView` 内の `VIEW_ROOTS` レジストリに 1 エントリ追加するだけで対応可能（詳細は `REQ_view-switch-refactor.md §3.1`・`DESIGN.md §4.8` 参照）
- **XSS 対策**: `textContent` を使用し `innerHTML` にユーザー入力を直接代入しない（`DESIGN.md §10.3`）
- **1 関数 1 責務**: `KC.RenderDay` 内の各処理は責務ごとに関数を分割する（`coding-rules.md` 準拠）
- **未確定事項 §10.1 のモジュール名**: `KC.RenderShared` で実装して問題ない。管理者が別名を指定した場合はそちらを優先する

### 9.2 reviewer への指示

§4「受け入れ条件」の各項目（AC4.1〜AC4.19）を 1 件ずつ順に確認すること。

特に以下に重点を置く:

1. **AC4.2（タイトルフォーマット）**: `2026年04月30日(木)` の形式（月・日ゼロ埋め・全角丸括弧）を厳格に確認する
2. **AC4.10（6:30 スクロール）**: 日ビュー切替直後にスクロール位置が 6:30 付近になることを目視確認する
3. **AC4.13（24:00 跨ぎ）**: 日跨ぎ予定が当日分のみ表示され、翌日日ビューでは表示されないことを確認する
4. **AC4.17（KC.RenderShared）**: `KC.RenderShared.buildAlldayBar` が週・日両ビューで使われ、かつ終日バーが正しく描画されることを確認する
5. **AC4.19（週 / 月ビューリグレッション）**: 週ビューで `REQ_event-drag-resize.md §4` 全 AC、月ビューで `REQ_month-view.md §4` 全 AC が合格することを確認する
6. **AC4.16（デフォルト view）**: リロード後に月ビューが表示され、ViewDropdown のラベルが「月」であることを確認する
7. **AC4.15（ViewDropdown 表示順）**: 「月 / 週 / 日」の順で 3 オプションが表示されることを確認する
8. **AC4.18（sync）**: `diff src/kc-calendar.js docs/kc-calendar.js` が空出力であることを確認する

---

## 10. 未確定事項 / リスク・前提

### 10.1 KC.RenderShared のモジュール名（未確定）

`KC.RenderShared`、`KC.RenderHelpers`、`KC.Renderers` のいずれを採用するか未確定。

**推奨**: `KC.RenderShared`（共有する描画ヘルパー、という意味が明確）。
**管理者承認待ち。確定後、本要件書の §3.2 / §6.1 / §6.2 / §6.3 を更新すること。**

### 10.2 `gridRange()` の `end` の定義（要確認）

`KC.RenderDay.gridRange()` が返す `end` を「当日 23:59 相当」とするか「翌日 0:00（open-end）」とするかが未定義。

既存の `KC.RenderWeek.gridRange()` は `{ start: 週頭 0:00, end: 週末 23:59 }` を返す。`KC.Api.loadEvents` には `isoEnd = toISO(addDays(range.end, 1))` で翌日 0:00 を渡している（`src/kc-calendar.js:2731`）。日ビューで同じ方式を採用する場合、`gridRange()` が当日終端を返し `refresh()` が `addDays(range.start, 1)` で翌日 0:00 を計算すれば一貫性が保てる。

**推奨**: `gridRange()` の `end` は「当日終端（= `range.start` と同値、または `addDays(start, 0)` の 23:59 相当）」とし、`refresh()` 内で `isoEnd = toISO(addDays(range.start, 1))` を計算する（週ビューのパターン踏襲）。
**builder が実装前に確認して対応すること。**

### 10.3 KC.RenderShared の切り出し対象範囲（要確認）

§3.2 では 4 関数を切り出し対象としているが、週・日ビューで共通利用できる関数が他にも存在する可能性がある。

候補:
- `renderRows()` — 時間グリッド行生成（列数を `--kc-col-count` で制御するため共通化可能か要確認）
- `renderAlldayRow()` — 終日エリア生成（1 列 vs 7 列の差異をどう吸収するか要確認）
- `placeEvents()` — イベント配置（週・日で同一ロジックが使えるか要確認）

**方針**: Phase 月-Day-1 では §3.2 の 4 関数のみ切り出す。残りの共通化は builder が実装中に `KC.RenderDay.renderGrid()` の実装で判断し、大きな重複が生じる場合は管理者に報告してから追加共通化を行う。

### 10.4 KC.RenderDay.renderGrid() のスコープ

`KC.RenderDay.renderGrid()` で週ビューの `renderAlldayRow()` / `renderRows()` / `placeEvents()` をそのまま呼ぶ場合、これらが `S.els.allday` / `S.els.rows`（`kc-allday` / `kc-rows` の DOM 参照）を前提としている点に注意が必要。日ビューが同じ `#kc-allday` / `#kc-rows` の DOM を使う設計であれば問題ないが、DOM キャッシュが週ビューから引き継がれているかを確認すること。

**推奨**: 日ビューは週ビューと同じ `.kc-grid-wrap` DOM を共有する設計のため、`KC.State.els` の DOM 参照を更新せずにそのまま利用できるはず。builder が実装時に `KC.State.refreshEls()` のタイミングを確認すること。

---

## 参照した既存実装行番号（サマリ）

| 内容 | ファイル:行番号 |
|---|---|
| `KC.State.view` 初期値 | `src/kc-calendar.js:369` |
| `KC.RenderDay` スタブ | `src/kc-calendar.js:3412–3422` |
| `KC.Render._pickModule` | `src/kc-calendar.js:3429–3435` |
| `KC.Render.refresh` | `src/kc-calendar.js:3438–3454` |
| `KC.Render.renderGrid`（月ビュー placeMonthEvents 連鎖）| `src/kc-calendar.js:3457–3471` |
| `KC.Render._formatWeekMonthRange`（week / month 2 分岐）| `src/kc-calendar.js:3508–3531` |
| `KC.RenderWeek` IIFE 全体 | `src/kc-calendar.js:2138–2748` |
| `KC.RenderWeek.calcCollapsedLanes` | `src/kc-calendar.js:2268–2270` |
| `KC.RenderWeek.buildAlldayBar` | `src/kc-calendar.js:2277–2360` |
| `KC.RenderWeek.updateAlldayToggle` | `src/kc-calendar.js:2369–2387` |
| `KC.RenderWeek.renderTimeGutter` | `src/kc-calendar.js:2390–2400` |
| `KC.RenderWeek.renderDayHeaders`（祝日表示含む）| `src/kc-calendar.js:2158–2215` |
| `KC.DnD._getWeekYMDs` | `src/kc-calendar.js:1633–1644` |
| `KC.TimeSlots._getColumnDates`（day ビュー対応済み）| `src/kc-calendar.js:3541–3559` |
| `KC.TimeSlots.scrollToDefaultTime` | `src/kc-calendar.js:3611 付近` |
| `KC.ViewDropdown.init` | `src/kc-calendar.js:3868–3930` |
| `KC.Boot._buildDOM`（ViewDropdown HTML 構築）| `src/kc-calendar.js:3939–4099` |
| `KC.Boot.init`（ナビゲーションハンドラ）| `src/kc-calendar.js:4131–4283` |
| `KC.Boot.init`（`--kc-col-count` 初期値）| `src/kc-calendar.js:4211` |

---

*本要件定義書: 章数 10、受け入れ条件 19 件、未確定事項 4 件（§10.1〜§10.4）。2026-04-30 初版。*
