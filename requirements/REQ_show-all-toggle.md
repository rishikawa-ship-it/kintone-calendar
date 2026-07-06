# 要件定義書: 全表示（隠れ予定も含め全て描画）トグル

**文書番号**: REQ_show-all-toggle
**作成日**: 2026-07-03
**最終更新日**: 2026-07-03（初版）
**作成者**: designer（サブエージェント）
**ステータス**: 初版（未解決事項あり。§9 参照）
**対象ファイル（正本）**:
- `plugin/src/js/desktop.js`
- `plugin/src/css/desktop.css`
**関連文書**:
- `requirements/REQ_month-cell-fixed-height.md` — 月ビュー セル高固定・`_calcMaxItems`・`+N more` の現行設計（本要件が「共存させたまま迂回する」対象）
- `requirements/REQ_url-state-sync.md` — `KC.UrlState` 設計・`#kc:` パラメータ・localStorage 併用パターン
- `requirements/REQ_weekday-more-state.md` — 週/日ビュー終日レーン `alldayExpanded` の現行仕様
- `requirements/REQ_checkbox-filter.md` — ヘッダー `.kc-head-right` への UI 追加パターン・`KC.CheckFilter` 実装例
- `MEMORY.md` — plugin 版のみが実運用（src 版は未使用）、月ビューデザイン刷新の実機検証未完了の申し送り

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（ファイル:行番号付き）](#2-現状分析ファイル行番号付き)
3. [要件](#3-要件)
4. [UI仕様](#4-ui仕様)
5. [月ビュー: 行を伸ばす実装方針](#5-月ビュー-行を伸ばす実装方針)
6. [週/日ビュー: alldayExpanded との統合方針](#6-週日ビュー-alldayexpanded-との統合方針)
7. [状態保持（URL＋localStorage）](#7-状態保持url localstorage)
8. [変更対象の関数・行・想定変更点](#8-変更対象の関数行想定変更点)
9. [受入基準](#9-受入基準)
10. [検証項目・テストシナリオ](#10-検証項目テストシナリオ)
11. [想定 UX / シーケンス](#11-想定-ux--シーケンス)
12. [未解決事項・リスク・前提](#12-未解決事項リスク前提)

---

## 1. 背景・目的

### 1.1 背景

月ビューは `REQ_month-cell-fixed-height.md` によりセル高を固定し、収まりきらない予定は `+N more` ポップオーバーに集約する設計になっている（`_calcMaxItems()` によるセル高からの動的件数算出、`plugin/src/js/desktop.js:5024`）。週/日ビューの終日/日跨ぎレーンも同様に、4 レーン以上になると `▼ もっと表示 (+N)` トグルで折りたたむ設計（`KC.State.alldayExpanded`、`desktop.js:754`）になっている。

この「切り詰めて見せる」設計は通常運用では有用だが、**全予定を一望したい場面**（棚卸し・重複確認・繁忙期の全体把握など）では、都度 `+N more` をクリックして確認する必要があり非効率という声がある。

### 1.2 目的

既存の「+more で切り詰める」表示（以下「通常モード」）と、**隠れている予定も含めて全件を描画する表示**（以下「全表示モード」）を、**ユーザーがヘッダーのトグルボタンでいつでも切り替えて比較できる**ようにする。全表示モードは通常モードを**置き換えるものではなく共存する別モード**として実装し、OFF 時は現行実装を一切変更しない。

### 1.3 スコープ

- 実装対象は `plugin/` 配下のみ（`src/kc-calendar.js` は対象外。MEMORY.md 記載のとおり src 版は未使用）
- 対象ビュー: 月・週・日のすべて
- 本書は designer による要件定義書であり、コード実装は行わない（builder へ委譲）

---

## 2. 現状分析（ファイル:行番号付き）

### 2.1 月ビュー: セル高固定の仕組み

#### CSS（`plugin/src/css/desktop.css`）

| 行 | 内容 |
|---|---|
| 39 | `--kc-month-cell-min-h: 90px`（セル最小高の CSS 変数） |
| 870-881 | `.kc-month-grid`: `grid-template-rows: repeat(6, minmax(0, 1fr))`（デフォルト。JS が週数に応じて `repeat(N, minmax(0,1fr))` に上書き）、`min-height: calc(6 * var(--kc-month-cell-min-h, 90px))` |
| 884-891 | `.kc-month-week`: `display: grid; grid-template-columns: repeat(7, ...); position: relative; min-height: 0`（`overflow:hidden` は付けない設計。`.kc-month-ad-events` の絶対配置がクリップされるため） |
| 894-908 | `.kc-month-cell`: `min-height: var(--kc-month-cell-min-h, 90px)`, **`height: 100%`**（週行高に完全追従）, **`overflow: hidden`**（コンテンツが増えてもクリップされセルは伸びない）, `display: flex; flex-direction: column` |
| 1006- | `.kc-month-ad-events`: 週行全幅オーバーレイ層。`position: absolute` で `.kc-month-week` を包含ブロックとして終日バー・日跨ぎ span バーを絶対配置 |
| 981- | `.kc-month-seg-layer`: dateline 直後の in-flow レイヤ。JS (`placeMonthTimedEvents`) が `usedSlots * BAR_H + (usedSlots-1) * BAR_GAP` で高さを設定し、chip の開始位置を確保する |
| 1114-1116 | `.kc-root.kc-expanded .kc-month-grid`: 全画面モード時の高さ定義（`height: calc(100vh - var(--kc-fullscreen-header-h, 0px))`） |

**全表示 ON にする際の障害**: `.kc-month-cell { height: 100%; overflow: hidden; }` と `.kc-month-grid { grid-template-rows: repeat(N, minmax(0,1fr)); }` の組み合わせが「行の高さをコンテンツ量に関わらず均一固定する」ための根幹。全表示 ON では、この 2 点（`overflow: hidden` と `minmax(0,1fr)` によるセル高の天井）を **月ビュー全体に対して迂回するモード** が必要。「セル単位で overflow を外す」だけでは `.kc-month-week`（`display:grid`, `min-height:0`）が依然として行の実効高を `1fr` 均等割りに制約するため、**行（`.kc-month-week`）と `.kc-month-grid` 双方の高さ制約を切り替える**必要がある（詳細は §5）。

#### JS: `baseCapacity` 算出（`_calcMaxItems`, `desktop.js:5024-5075` 付近）

- `.kc-month-cell` の `getBoundingClientRect().height` を実測し、dateline 高・padding・PITCH（chip/バー共通ピッチ、ダミー要素実測）から `available / PITCH` で表示可能件数を算出する
- 冒頭（`desktop.js:5027-5029`）で `firstCell` が取れない、または `cellH <= 0` の場合は `MAX_CELL_ITEMS = 5`（`desktop.js:5001`）をフォールバックとして返す
- この関数は「セル高が固定である」ことを前提にした設計であり、**全表示 ON 時にセルを可変高にする場合、この関数自体を呼ばない（バイパスする）分岐が必要**

#### あふれ判定と `+N more`（`placeMonthEvents`, `desktop.js:6100-6312`）

主要な流れ（OFF 時＝現行、§2.1 で行番号を明記）:

1. `baseCapacity = _calcMaxItems();`（`desktop.js:6153`）
2. 週ループ内で `totalItemsByCol`（終日+span+chip の列別合計）を算出し、`baseCapacity` を超える列は `effectiveCapByCol[col] = baseCapacity - 1`（more 用に1枠確保）、超えない列は `baseCapacity` のまま（`desktop.js:6204-6226`）
3. `placeMonthAlldayEvents(weekEl, weekYMD, weekAllday, baseCapacity, cellEls, effectiveCapByCol)`（`desktop.js:6229`, 関数本体 `desktop.js:5574-` ）: `lane >= cellCap` のイベントは描画せず `hiddenByCol` に積む（`desktop.js:5619-5632`）
4. `placeMonthTimedSpanEvents(...)`（`desktop.js:6234-6241`, 関数本体 `desktop.js:5799-`）: 終日バーが使ったレーン数を踏まえた残り枠で同様に制限
5. `placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, usedSlots + chipCap)`（`desktop.js:6285`, 関数本体 `desktop.js:6050-6077`）: `remaining = maxItems - usedSlots` を超える chip は描画しない
6. `hiddenCount > 0` のセルに対して `applyOverflow(cellEl, hiddenCount, hiddenEvents)`（`desktop.js:6085-6094`, 呼び出し `desktop.js:6306-6309`）で `.kc-month-more` を生成し `KC.MonthOverflowPopup.registerHiddenEvents` に登録

**全表示 ON にする際の分岐点**:
- `baseCapacity` を `Infinity`（または十分大きい定数）とみなす分岐を `placeMonthEvents()` 冒頭に追加すれば、`effectiveCapByCol` は常に「超過なし」の分岐（`baseCapacity` そのまま）になり、`placeMonthAlldayEvents` / `placeMonthTimedSpanEvents` / `placeMonthTimedEvents` の各関数は**変更せずに**全件描画するようになる（`lane >= cellCap` が常に false になるため）
- `applyOverflow` は `hiddenCount === 0` のときは何もしないため（`desktop.js:6086`）、全件描画されれば自動的に `+N more` は生成されなくなる。**`applyOverflow` 自体の呼び出し停止は不要**（`hiddenCount` が 0 になることで自然に抑止される）
- `+N more` を意図的に「出さない」という要件（ユーザー確定仕様）は、`baseCapacity = Infinity` 分岐で自然に満たせる

### 2.2 週/日ビュー: 終日/日跨ぎレーンの more 開閉

#### 状態管理

- `KC.State.alldayExpanded`（`desktop.js:754`）: モジュールスコープの boolean。初期値 `false`（折りたたみ）。週ビュー・日ビューで共有
- `REQ_weekday-more-state.md` により、prev/next/today ボタンクリック時のリセットは**廃止済み**（`desktop.js:10164, 10184, 10196` にコメントのみ残存: 「S.alldayExpanded はリセットしない」）
- ビュー切替（月↔週↔日）時のリセットの有無は `REQ_weekday-more-state.md §7 Q-2` で未確定のまま残置されている（本要件のスコープ外だが §12 で言及）

#### 展開/折りたたみのロジック（週ビュー `KC.RenderWeek.placeEvents`, `desktop.js:4340-4399`。日ビューは同一パターンで `desktop.js:6554-6589`）

```
desktop.js:4352  collapsedLaneCount = KC.RenderShared.calcCollapsedLanes(maxLane)   // 最大3レーン
desktop.js:4355  hiddenCount = weekEvents.filter(lane >= 3).length
desktop.js:4358  KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount)
desktop.js:4361-4366  toggleEl.onclick → S.alldayExpanded = !S.alldayExpanded; KC.Render.renderGrid();
desktop.js:4384  displayLanes = S.alldayExpanded ? (maxLane + 1) : collapsedLaneCount
desktop.js:4388  totalH = BAR_TOP + (BAR_H+BAR_GAP)*displayLanes - BAR_GAP + BAR_BTM + TOGGLE_H
desktop.js:4389  alldayWrap.style.height = totalH + 'px'
desktop.js:4397  eventsLayer.style.overflow = S.alldayExpanded ? 'visible' : 'hidden'
```

`updateAlldayToggle`（`KC.RenderShared`, `desktop.js:4100-`）は `maxLane < 3` のとき、そもそもトグル要素を `display:none` にする（レーンが少ない日はトグル自体が不要なため）。

**全表示 ON にする際の統合点**: `S.alldayExpanded` を真として扱う（`displayLanes = maxLane + 1` 固定、`eventsLayer.style.overflow = 'visible'` 固定）分岐を、全表示 ON のときに強制適用すればよい。詳細な統合方式（変数を共有するか、別フラグにするか）は §6 で方針を示す。

#### 時間グリッドのスクロール構造

- `.kc-body`（`desktop.css:85-95`）: `display: grid; grid-template-columns: var(--kc-time-col-w) 1fr; height: calc(100% - var(--kc-header-h)); overflow-y: auto;`。時間軸グリッド（0-24時、`.kc-rows`）は常にこの `.kc-body` 内でスクロールする構造であり、終日レーン（`.kc-allday`）はこの外側（`.kc-grid-wrap` 内、`.kc-body` の兄弟要素）にあるため、終日レーンの展開はスクロール量ではなく `.kc-allday` 自体の高さ（`alldayWrap.style.height`）で制御されている
- 全表示 ON でも週/日ビューは「終日レーンを全展開する」だけで済み、月ビューのような「行全体の高さ可変・ページスクロール」という大掛かりな構造変更は不要（終日レーンの展開自体が既存の `alldayWrap.style.height` 動的計算の枠内に収まる）

### 2.3 ヘッダー構成

#### DOM 構築（`KC.Boot._buildDOM` 相当, `desktop.js:9860-10003`）

- `headLeft`: タイトル・今日ボタン・prev/next・年月ラベル（`desktop.js:9875-9879`）
- `headRight`: ビュードロップダウン（`desktop.js:9882-9934`）→ 全画面ボタン（`desktop.js:9937-9943`）→ 全画面解除ボタン（`desktop.js:9946-9950`）の順で `appendChild`

#### 実行時の追加挿入順序（`KC.Boot.init`, `desktop.js:10244-10268` 付近）

```
desktop.js:10251-10254  KC.SearchFilter.buildDOM(sfHeadRight)   // 検索欄
desktop.js:10257        KC.CheckFilter.init()                   // フィルタパネル（内部で buildDOM 呼び出し）
```

`KC.CheckFilter.buildDOM`（`desktop.js:9594-9691`）内で `headRight.insertBefore(wrap, headRight.firstChild)`（`desktop.js:9688`）により、**フィルタボタンは常に `headRight` の先頭**に挿入される。`KC.SearchFilter.buildDOM` も同様に `insertBefore` パターンを使う（検索欄はフィルタの左）。

**「全表示」ボタンをフィルタの左に置くための実装位置**: `KC.CheckFilter.init()`（`desktop.js:10257`）の**前**に全表示ボタンの DOM 生成・`headRight` への挿入を実行すればよい。ただし `KC.CheckFilter.buildDOM` は `insertBefore(wrap, headRight.firstChild)` で常に先頭に割り込むため、全表示ボタンを `KC.CheckFilter.init()` より先に追加しても、その後 `CheckFilter` のボタンが先頭に割り込んで **全表示ボタンより前に来てしまう**。したがって挿入順序の制御には以下のいずれかが必要（§4.4 で確定要否を明記）:
  - (a) 全表示ボタンの挿入を `KC.CheckFilter.init()` の**後**に行い、`headRight.insertBefore(showAllWrap, checkFilterWrap)` のように **CheckFilter の DOM 要素を明示的に指定**して直前に挿入する
  - (b) `KC.CheckFilter.buildDOM` 側に「自分の右側に挿入してほしい要素」を渡すオプションを増やす（改修範囲が広がるため非推奨）
  - **推奨は (a)**: `document.getElementById('kc-filter')` で `CheckFilter` のルート要素を取得し、`headRight.insertBefore(showAllBtn, kcFilterEl)` する

#### 全画面/通常表示両対応

- ヘッダー DOM 構造自体は全画面/通常表示で同一（`.kc-root.kc-expanded` は CSS の `position: fixed` 等でルート要素の表示位置を変えるのみ、`desktop.css:1114-1116` 参照）。全表示ボタンも他のヘッダーボタン同様、全画面・通常表示の両方で同一 DOM がそのまま表示される（追加の分岐は不要）

### 2.4 状態同期: `KC.UrlState` と localStorage の既存パターン

#### `KC.UrlState`（`REQ_url-state-sync.md` で新設、`desktop.js` に実装済み）

- `#kc:<key>=<value>[&...]` 形式（`desktop.js:8807-` 付近に `_isUpdatingHash` フラグ等の実装、API は `KC.UrlState.update/get/remove/push` 等）
- 主要パラメータ: `view`, `date`, `filter`→`f<groupId>`（`REQ_checkbox-filter` で置換済み）, `q`, `record`, `new`, `more`, `fs`, `scroll`
- `replaceState` 系（ビュー/日付/フィルタ/検索/全画面/スクロール）と `pushState` 系（モーダル/ポップオーバー開閉）に分かれる。全表示トグルは「画面全体の表示モード」であり、モーダル開閉のような一過性の状態ではないため **`replaceState` 系として扱う**（全画面 `fs` パラメータと同様の性質）

#### localStorage の既存パターン

- `REQ_checkbox-filter.md §9.1`: `localStorage.setItem('kc-filter-checks', JSON.stringify(...))` のように、機能ごとに専用キーを用意し、JS 起動時に読み込んで `KC.State` に反映する
- `KC.UrlState` 優先・存在しなければ `localStorage` を使うという優先順位ルール（`REQ_url-state-sync.md FR-2`）が確立している。**全表示トグルも同一パターンを踏襲する**

#### 全表示フラグの追加方法（提案）

- URL パラメータ名: `all`（例: `#kc:view=month&date=2026-07&all=1`）
  - **候補名の検討**: `showAll` は長くなり他パラメータ（`view`, `date`, `q`, `fs` 等）と比べて浮く。既存パラメータは短い英単語（`fs`, `q`）が多いため `all=1` を第一候補とする。ただし `REQ_checkbox-filter.md` で `filter=all/mine/others`（廃止済みだが概念としては存在した）と紛らわしい可能性があるため、**最終的なキー名はユーザー確認が必要**（§12 Q-1）
- localStorage キー: `kc-show-all`（値は `'1'` / なし、または `'true'`/`'false'` 文字列）
- 状態格納先: `KC.State.showAll`（boolean、デフォルト `false`）

---

## 3. 要件

### 3.1 機能要件

| ID | 要件 |
|---|---|
| FR-1 | ヘッダーの `.kc-head-right` に「全表示」トグルボタンを新設し、位置は既存フィルタボタン（`#kc-filter`）の**直左**とする |
| FR-2 | ボタンは ON/OFF の 2 状態を持つトグルであり、クリックのたびに反転する。ON 状態は視覚的に判別可能な形（アクティブ表示、既存 `.kc-filter-active` 相当のスタイル等）にする |
| FR-3 | 全表示 ON のとき、月ビューは `+N more` を一切出さず、表示範囲内の全予定（終日バー・日跨ぎ span バー・単日 chip）を描画する |
| FR-4 | 全表示 ON のとき、月ビューの週行（`.kc-month-week`）はコンテンツ量に応じて高さが可変になり、予定が多い週ほど背が高くなる。セル個別スクロールにはしない |
| FR-5 | 全表示 ON のとき、月ビューを含むカレンダー全体の縦方向スクロールが可能になる（スクロール領域の具体位置は §5.4 で確定） |
| FR-6 | 全表示 ON のとき、週/日ビューは終日/日跨ぎレーンの `more` トグルを出さず、全レーンを展開表示する |
| FR-7 | 全表示 OFF のとき、月・週・日のすべてのビューで現行実装（`+more` 切り詰め・終日レーン折りたたみ）が完全に維持される（一切の変更なし） |
| FR-8 | 対象ビューは月・週・日のすべて |
| FR-9 | 全表示 ON/OFF の状態は URL（`#kc:`）と localStorage の両方に保持し、月送り・ビュー切替・リロード・ブラウザ「戻る」操作をまたいで維持される（詳細は §7） |
| FR-10 | 全表示 ON/OFF の切替は即時反映とする（既存フィルタ・検索と同様、API 再取得は発生させない） |

### 3.2 非機能要件

| ID | 要件 |
|---|---|
| NFR-1 | 全表示 OFF 時の描画結果（DOM 構造・CSS 適用結果）は本改修の前後で完全に同一であること（回帰なし） |
| NFR-2 | ヘッダー幅の増加は 1 ボタン分にとどめる（`REQ_checkbox-filter.md NF-1` の「ヘッダー幅を増やさない」方針とは異なり、本機能は新規ボタンを追加する。ユーザー確定仕様のとおり許容する） |
| NFR-3 | 全表示 ON 時に予定が極端に多い週がある場合でも、ブラウザが応答不能になるほどの描画コストにならないこと（上限方針は §8.6 のエッジケース参照、未確定） |
| NFR-4 | `src / docs` は同期対象外（plugin 版のみが正本。MEMORY.md の運用ルールに従う） |

---

## 4. UI仕様

### 4.1 ボタンの外観・配置

```
[検索欄] [全表示 ▢/▣] [フィルタ ▾] [ビュー切替 ▾] [全画面表示]
                ↑ 新設。フィルタボタンの直左
```

- ラベル案: `全表示`（固定文言）。トグル状態はラベル横のアイコンまたはボタン自体の背景色反転で表現する（例: OFF 時は通常ボタン、ON 時は `.kc-filter-active` 相当のスタイル、または独自クラス `.kc-show-all-active`）
- DOM 構造案:
  ```html
  <button class="kc-btn kc-show-all-btn" id="kc-show-all-btn" aria-pressed="false">
    全表示
  </button>
  ```
  - `aria-pressed` 属性でトグル状態を明示する（アクセシビリティ対応。既存 `KC.CheckFilter` の `aria-expanded` パターンに倣う）
  - 単純な `<button>` 要素とし、`KC.CheckFilter` のようなドロップダウンパネルは持たない（ON/OFF の単純トグルのため）

### 4.2 挿入位置の実装方針

`KC.Boot.init` 内、`KC.CheckFilter.init()`（`desktop.js:10257`）呼び出しの**直前**に以下の処理を追加する:

```javascript
// 全表示トグルボタンの挿入（REQ_show-all-toggle）
KC.ShowAllToggle.init();   // 内部で headRight を取得し、#kc-filter の直前に insertBefore する
```

`KC.ShowAllToggle.init()` の内部実装方針:

```javascript
init: function () {
  var headRight = document.querySelector('.kc-head-right');
  if (!headRight) return;
  var kcFilterEl = document.getElementById('kc-filter'); // CheckFilter 構築後を前提とする場合は順序入れ替えが必要（下記注記）
  this.buildDOM(headRight, kcFilterEl);
}
```

**重要な順序注意**: `#kc-filter`（`KC.CheckFilter` のルート要素）は `KC.CheckFilter.init()` 実行後でなければ DOM に存在しない。したがって `KC.ShowAllToggle.init()` は **`KC.CheckFilter.init()` の後**に呼び、`headRight.insertBefore(showAllBtn, kcFilterEl)` で `#kc-filter` の直前に割り込ませる方式を採る（§2.3 で述べた案 (a)）。実行順序は以下のとおり確定する:

```
KC.SearchFilter.buildDOM(sfHeadRight);   // 既存
KC.CheckFilter.init();                    // 既存
KC.ShowAllToggle.init();                  // 新規（CheckFilter の直後 = #kc-filter の直前に割り込む）
```

### 4.3 CSS（追加案）

```css
.kc-show-all-btn {
  /* 既存 .kc-btn の外観を継承 */
}
.kc-show-all-btn[aria-pressed="true"],
.kc-show-all-btn.kc-show-all-active {
  border-color: #1976d2;
  color: #1976d2;
  font-weight: 600;
  background: #e8f0fe;
}
```

既存 `.kc-filter-active`（`desktop.css:274-278`、色部分のみ）と統一感のある配色にする。

### 4.4 全画面/通常表示両対応

- ヘッダー DOM 構造は全画面・通常表示で共通のため、追加の分岐は不要（§2.3 参照）
- 全画面時も「全表示」ボタンは同一位置（フィルタの左）に表示される

---

## 5. 月ビュー: 行を伸ばす実装方針

### 5.1 CSS 側の分岐方針

全表示 ON/OFF を `.kc-root` （または `.kc-month-root`）に付与する CSS クラス（例: `.kc-show-all`）で分岐する。JS 側で `KC.State.showAll` が変化するたびにこのクラスを付け外しする。

```css
/* 通常モード（OFF、既存。変更なし） */
.kc-month-grid {
  grid-template-rows: repeat(6, minmax(0, 1fr));  /* JS がインラインで repeat(N,...) に上書き */
  min-height: calc(6 * var(--kc-month-cell-min-h, 90px));
}
.kc-month-cell {
  height: 100%;
  overflow: hidden;
}

/* 全表示モード（ON、新設） */
.kc-show-all .kc-month-grid {
  /* auto にすることで各行がコンテンツ高に応じて伸びる。JS のインライン repeat(N, minmax(0,1fr)) を
     上書きする必要があるため、行高定義自体を JS 側で分岐させる（下記 §5.2 参照）か、
     !important を避けるために JS がこのモードでは repeat(N, auto) をインライン設定する */
  min-height: 0;  /* 6行固定の下限を外す */
}
.kc-show-all .kc-month-week {
  /* 行自体は grid item として auto-minimum を許可する（コンテンツ高に応じて伸びる） */
  min-height: auto;
}
.kc-show-all .kc-month-cell {
  height: auto;        /* 週行高への追従をやめ、コンテンツ分だけ伸びる */
  overflow: visible;   /* +more によるクリップをやめ、全コンテンツを可視化する */
  min-height: var(--kc-month-cell-min-h, 90px);  /* 予定が少ない日でも最低限の高さは維持 */
}
```

**JS 側で `grid-template-rows` のインラインスタイルを分岐させる必要がある理由**: `renderMonthGrid()`（`desktop.js:4853-4877`）が `gridEl.style.gridTemplateRows = 'repeat(' + weekCount + ', minmax(0, 1fr))'`（`desktop.js:4873-4874`）を**常に**インライン設定しているため、CSS クラス側で `grid-template-rows` を上書きしようとしてもインラインスタイルの詳細度に負ける。したがって `renderMonthGrid()` 内で `KC.State.showAll` を参照し、ON のときは `repeat(N, auto)`（または `repeat(N, minmax(min-content, auto))`）を設定する分岐を追加する。

```javascript
// renderMonthGrid() 内、既存の rowsDef 設定行を分岐化
var rowsDef = KC.State.showAll
  ? 'repeat(' + weekCount + ', minmax(min-content, auto))'   // 全表示: コンテンツ高に応じて可変
  : 'repeat(' + weekCount + ', minmax(0, 1fr))';               // 通常: 均等固定高（既存）
gridEl.style.gridTemplateRows = rowsDef;
gridEl.style.minHeight = KC.State.showAll
  ? ''  // 全表示: 固定下限を外す（コンテンツ量なりの高さ）
  : 'calc(' + weekCount + ' * var(--kc-month-cell-min-h, 90px))';
```

### 5.2 `.kc-month-ad-events`（終日バー・span バーの絶対配置オーバーレイ）の高さ

現行、`.kc-month-ad-events` は `.kc-month-week`（`position: relative`）を包含ブロックとして `position: absolute; left:0; right:0;` で週行全幅を覆う（`desktop.css:1006-` 付近）。**高さは指定されていない**（`top` はバーごとに JS が `lane * (BAR_H+BAR_GAP)` で個別指定するのみ）。

- 全表示 ON でセルが可変高になると、`.kc-month-ad-events` 自体の高さが `0`（未指定 = 内容の絶対配置要素で自動計算されない）のままだと、レイヤの `overflow` 挙動によっては最下段のバーが `.kc-month-week` の外にはみ出して**クリップされる**リスクがある
- **対応方針**: 全表示 ON 時は `.kc-month-ad-events` に `position: absolute` ではなく `position: static`（または `height: auto` を明示し `.kc-month-week` 側の `overflow: visible` を保証）とするか、JS 側で `.kc-month-ad-events` の高さをそのセグメント配置後の実際の最大 `top+height` から動的算出して `style.height` に設定する。**後者（JS 動的算出）を推奨**する。理由: `position: absolute` のレイヤ構造自体（バーがセルの罫線より前面に出るための z-index 設計）を変えると、DnD・タイトル省略ロジック（`REQ_month-event-design-google.md` 等）に影響が及ぶリスクが高く、レイヤ構造は維持したまま高さだけ後追いで確保する方が安全
- **算出方法（案）**: `placeMonthAlldayEvents` / `placeMonthTimedSpanEvents` の呼び出し後、`weekEl` ごとに `colLaneCounts` の最大値（週内で最も多くレーンを使った列のレーン数）から `.kc-month-ad-events` の必要高を計算し、`adEventsEl.style.minHeight` に設定する。これにより `.kc-month-week` が `.kc-month-ad-events` の実コンテンツ高を内包する形で伸びる

### 5.3 `.kc-month-seg-layer`（chip 開始位置確保レイヤ）

`placeMonthTimedEvents()`（`desktop.js:6050-6077`）は `usedSlots > 0` のとき `segLayer.style.height` を設定する（`desktop.js:6055-6060`）。**全表示 ON でもこのロジック自体は変更不要**（`usedSlots` は実際に描画されたバー数であり、全表示 ON では常に「全件描画後の実際のバー数」が入るため、seg-layer の高さも自動的にコンテンツ量に追従する）。

### 5.4 `baseCapacity`/あふれ判定のバイパス

`placeMonthEvents()`（`desktop.js:6100-6312`）冒頭に分岐を追加する:

```javascript
var baseCapacity = KC.State.showAll ? Infinity : _calcMaxItems();
```

これにより:
- `effectiveCapByCol`（`desktop.js:6224-6226`）の `total > baseCapacity` 判定が常に false になり、全列 `effectiveCap = baseCapacity`（= `Infinity`）になる
- `placeMonthAlldayEvents` / `placeMonthTimedSpanEvents` の `lane >= cellCap` 判定（`desktop.js:5626` 等）が常に false になり、全バーが描画される
- `placeMonthTimedEvents` の `remaining = maxItems - usedSlots`（`desktop.js:6065`）が常に十分大きくなり、全 chip が描画される
- `hiddenCount` が常に 0 になり、`applyOverflow` が呼ばれなくなる（`+N more` が自動的に非表示化。§2.1 で述べたとおり `applyOverflow` 自体の変更は不要）

**`Infinity` を使う際の注意**: `effectiveCapByCol.map(function (total) { return total > baseCapacity ? Math.max(0, baseCapacity - 1) : baseCapacity; })`（`desktop.js:6224-6226`）で `baseCapacity - 1` が計算される分岐に入らないことを確認する必要がある（`total > Infinity` は常に false なので通らないが、`Infinity - 1 = Infinity` のため仮に通っても実害はない）。念のため builder は実装後にこの分岐が意図どおり働くことを確認する。

### 5.5 スクロール領域

**ユーザー確定仕様**: 「カレンダー領域はスクロール可能」「セル個別スクロールではなく、行がコンテンツ量に応じて伸びる」。

現行のレイアウト階層（`desktop.css:54-95`）:

```
.kc-root (height: calc(100vh - 230px), overflow: hidden, flex column)
  └─ .kc-grid-wrap (flex:1, overflow: hidden)          … 週/日ビュー用ラッパー
  └─ .kc-month-root (flex:1, overflow: hidden)          … 月ビュー用ラッパー（同階層、表示切替で共存）
       └─ .kc-month-days
       └─ .kc-month-grid
```

**方針**: 全表示 ON かつ月ビュー表示中は、`.kc-month-root` の `overflow: hidden` を `overflow-y: auto; overflow-x: hidden;` に変更する（`.kc-show-all .kc-month-root` セレクタで分岐）。これにより **カレンダー本体（`.kc-month-root`）がスクロール領域**になり、ヘッダー（`.kc-header`）は常に画面上部に固定されたまま、月グリッドだけがページ内スクロールする。`.kc-root` 自体（`height: calc(100vh - 230px)` で高さが決まっている）はスクロールさせない。

```css
.kc-show-all .kc-month-root {
  overflow-y: auto;
  overflow-x: hidden;
}
```

**週/日ビューのスクロール領域**: 週/日ビューは元々 `.kc-body` が `overflow-y: auto` でスクロール可能（`desktop.css:85-95`）。全表示 ON でも終日レーンが伸びるだけで、時間グリッド自体のスクロール構造は変更不要（§6 参照）。

---

## 6. 週/日ビュー: alldayExpanded との統合方針

### 6.1 統合方針（確定案）

`KC.State.alldayExpanded` とは**別に** `KC.State.showAll` を新設し、週/日ビューの描画時に以下の優先順位で終日レーンの展開状態を決定する:

```javascript
// KC.RenderWeek.placeEvents / KC.RenderDay.placeEvents 内（desktop.js:4384, 6579 相当）
var effectiveExpanded = KC.State.showAll ? true : S.alldayExpanded;
var displayLanes = effectiveExpanded ? (maxLane + 1) : collapsedLaneCount;
```

および:

```javascript
// desktop.js:4397, 6589 相当
eventsLayer.style.overflow = effectiveExpanded ? 'visible' : 'hidden';
```

**トグル UI（`▼ もっと表示` / `▲ 折りたたむ`）自体の扱い**: 全表示 ON のときは `更 more トグル自体を非表示にする`（ユーザー確定仕様「+more は出さない」を週/日にも適用する解釈）。`updateAlldayToggle` の呼び出し箇所（`desktop.js:4358, 6557`）に分岐を追加する:

```javascript
if (toggleEl) {
  if (KC.State.showAll) {
    toggleEl.style.display = 'none';  // 全表示 ON 時はトグル非表示
  } else {
    KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount);
  }
}
```

### 6.2 `S.alldayExpanded` を書き換えない理由

全表示 ON 中に `S.alldayExpanded = true` を直接書き換えてしまうと、全表示を OFF に戻したときに「ユーザーが手動で折りたたんでいた状態」が失われ、常に展開状態に固定されてしまう。**`S.alldayExpanded` はユーザーが手動トグルで操作する状態として温存し、`showAll` は表示計算時に一時的に上書きする（`effectiveExpanded` のような算出値として扱う）方式**を採用する。これにより:

- 全表示 ON → OFF に戻したとき、OFF にする直前まで `alldayExpanded` トグルを手動操作していなければ元の折りたたみ状態（`false`）に戻る
- 全表示 ON 中に週/日の `more` トグル自体を非表示にする（§6.1）ため、ON 中にユーザーが `alldayExpanded` を手動操作する経路自体が塞がれる（トグル DOM がないため誤操作の心配もない）

### 6.3 月ビューとの一貫性

月ビューは「セルごとの `+N more`」という単位で切り詰めているのに対し、週/日ビューは「終日レーン全体」という単位で切り詰めている。両者は実装単位が異なるが、**全表示 ON の効果としてはどちらも「隠れていたものをすべて見せ、まとめ表示 UI（+more / more トグル）を消す」という一貫した挙動**になる。ユーザーへの説明上も「全表示 = 隠れている予定を全部見せる」という単一の説明で両ビューの挙動を統一できる。

---

## 7. 状態保持（URL＋localStorage）

### 7.1 URL パラメータ

`REQ_url-state-sync.md §4.2` のパラメータ表に以下を追加する（`replaceState` 系）。

| キー | 値の形式 | 例 | 更新方式 |
|---|---|---|---|
| `all`（仮称。§12 Q-1 で確定要） | `1`（ON）/ パラメータ省略（OFF＝デフォルト） | `#kc:view=month&date=2026-07&all=1` | `replaceState` |

- **デフォルト（OFF）はパラメータを URL に書き込まない**（`fs` パラメータの「全画面がデフォルトで `fs` なし」と同じ設計思想を踏襲。全表示 OFF がデフォルトなので `all` パラメータなし＝ OFF とする）
- ON にしたときのみ `all=1` を `replaceState` で追加する
- OFF に戻したときは `all` パラメータを URL から除去する

### 7.2 localStorage

- キー: `kc-show-all`
- 値: `'1'`（ON）。OFF の場合はキー自体を削除する（`REQ_checkbox-filter.md` の `kc-filter-checks` パターンとは異なり、値のシンプルさを優先し ON のときのみキーを持たせる方式とする。builder 判断で `'0'`/`'1'` の明示保存に変更してもよい）

### 7.3 優先順位・復元処理

`REQ_url-state-sync.md FR-2` の「URL 優先、なければ localStorage」パターンを踏襲する。

```javascript
// KC.UrlState.restore() 内、他パラメータ復元と同じタイミングで実行
var urlAll = KC.UrlState.get('all');
if (urlAll !== null) {
  KC.State.showAll = (urlAll === '1');
} else {
  KC.State.showAll = (localStorage.getItem('kc-show-all') === '1');
}
KC.ShowAllToggle._applyState();  // ボタンの aria-pressed 更新・.kc-show-all クラス付け外し・再描画
```

### 7.4 月送り・リロード・戻る対応

- **月送り（prev/next/today）**: `KC.State.showAll` はナビゲーション操作で変更されないため、月を送っても ON/OFF はそのまま維持される（`KC.State.alldayExpanded` が prev/next でリセットされない現行仕様、`REQ_weekday-more-state.md` と同様の考え方）
- **リロード**: URL 優先で復元。URL に `all` パラメータがなければ localStorage の値を使う
- **ブラウザ「戻る」**: `all` パラメータは `replaceState` で更新するため、ブラウザ履歴には積まれない（全画面 `fs` パラメータと同じ扱い）。したがって「戻る」操作で全表示 ON/OFF が切り替わることは想定しない（`popstate` ハンドラでの差分検知は本要件では必須としない。ただし他の `replaceState` 系パラメータ同様、`popstate` 発火時に `all` の値が変わっていたら再描画する処理を入れることが望ましい。§12 で確認）
- **ビュー切替（月↔週↔日）**: `KC.State.showAll` はビュー非依存の1フラグとして扱い、ビューを切り替えても ON/OFF は維持される（全表示という概念自体がビュー横断の設定であるため）

---

## 8. 変更対象の関数・行・想定変更点

### 8.1 `plugin/src/js/desktop.js`

| 種別 | 対象 | 内容 |
|---|---|---|
| 新設 | `KC.State.showAll`（`desktop.js:754` 付近、`alldayExpanded` の隣） | 初期値 `false` |
| 新設 | `KC.ShowAllToggle` モジュール | `init()` / `buildDOM(headRight, beforeEl)` / `_toggle()` / `_persist()` / `_applyState()` / `loadState()` を持つ。`KC.CheckFilter` の構造踏襲 |
| 変更 | `renderMonthGrid()`（`desktop.js:4853-4877`） | `rowsDef` / `gridEl.style.minHeight` を `KC.State.showAll` で分岐（§5.1） |
| 変更 | `placeMonthEvents()`（`desktop.js:6100-6312`、特に `desktop.js:6153`） | `baseCapacity = KC.State.showAll ? Infinity : _calcMaxItems();` に変更（§5.4） |
| 変更 | `placeMonthEvents()` 内、週ループ末尾（`desktop.js:6229-6241` 相当の後） | `.kc-month-ad-events` の高さを動的算出して設定する処理を追加（§5.2） |
| 変更 | `KC.RenderWeek.placeEvents`（`desktop.js:4340-4399`、特に `4358, 4361-4366, 4384, 4397`） | `effectiveExpanded` 算出・トグル非表示分岐を追加（§6.1） |
| 変更 | `KC.RenderDay.placeEvents`（`desktop.js:6554-6589`、同上パターン） | 同上（週ビューと同一変更） |
| 変更 | `KC.UrlState` のパラメータ処理（`REQ_url-state-sync.md` 実装箇所、`restore()` 相当） | `all` パラメータの読み書き追加（§7.3） |
| 変更 | `KC.Boot.init`（`desktop.js:10244-10268` 付近） | `KC.CheckFilter.init()` の後に `KC.ShowAllToggle.init()` を追加（§4.2） |

### 8.2 `plugin/src/css/desktop.css`

| 種別 | 対象 | 内容 |
|---|---|---|
| 追加 | `.kc-show-all-btn` とその ON 状態スタイル（§4.3） | 新規 |
| 追加 | `.kc-show-all .kc-month-grid` / `.kc-show-all .kc-month-week` / `.kc-show-all .kc-month-cell` の可変高定義（§5.1） | 新規 |
| 追加 | `.kc-show-all .kc-month-root` の `overflow-y: auto`（§5.5） | 新規 |
| 確認 | 既存 `.kc-month-cell`, `.kc-month-grid`, `.kc-month-week`（§2.1 記載箇所） | **変更不要**（全表示 OFF 時の既存挙動を保つため、既存ルールはそのまま。`.kc-show-all` プレフィックス付きルールで上書きするだけ） |

---

## 9. 受入基準

Given/When/Then 形式で記述する。

### AC-1: 全表示ボタンの位置・トグル動作

- **Given**: カレンダーのヘッダーが表示されている状態で
- **When**: ヘッダーを確認したとき
- **Then**: 「全表示」ボタンがフィルタボタン（`#kc-filter`）の直左に表示されている
- **And**: クリックするたびに ON/OFF が切り替わり、`aria-pressed` 属性が反転する

### AC-2: 月ビュー全表示 ON で `+N more` が出ない

- **Given**: 月ビューで、通常モードなら `+N more` が表示されるほど予定が多い日がある状態で
- **When**: 全表示ボタンを ON にしたとき
- **Then**: その日の `+N more` ラベルが消え、該当日のすべての予定（終日バー・span バー・chip）が描画される

### AC-3: 月ビュー全表示 ON で行の高さが可変になる

- **Given**: 月ビュー全表示 ON の状態で、ある週に予定が多い日と少ない日が混在している
- **When**: 月ビューを表示する
- **Then**: 予定が多い日を含む週行が、予定が少ない週行より背が高く表示される（週行ごとに高さが異なる）

### AC-4: 月ビュー全表示 ON でスクロール可能

- **Given**: 全表示 ON でカレンダー領域が画面高を超えるほど週行が伸びている状態で
- **When**: カレンダー領域内でスクロール操作をする
- **Then**: ヘッダーは固定されたまま、月グリッド部分がスクロールしてすべての週を閲覧できる

### AC-5: 月ビュー全表示 OFF で現行動作を維持

- **Given**: 全表示ボタンが OFF（デフォルト）の状態で
- **When**: 予定が多い日を含む月ビューを表示する
- **Then**: セル高は固定のまま、収まらない予定は `+N more` に集約される（本改修前と完全に同一の見た目・DOM 構造になる）

### AC-6: 週ビュー全表示 ON で終日レーンが全展開される

- **Given**: 週ビューで終日イベントが4件以上ある週を表示している状態で
- **When**: 全表示ボタンを ON にしたとき
- **Then**: `▼ もっと表示` トグルが非表示になり、すべての終日イベントがレーンに展開表示される

### AC-7: 日ビュー全表示 ON で終日レーンが全展開される

- **Given**: 日ビューで終日イベントが4件以上ある日を表示している状態で
- **When**: 全表示ボタンを ON にしたとき
- **Then**: 週ビューと同様にすべての終日イベントが展開表示され、`more` トグルが非表示になる

### AC-8: 週/日ビュー全表示 OFF で現行動作を維持

- **Given**: 全表示ボタンが OFF の状態で
- **When**: 週ビュー・日ビューを表示する
- **Then**: 従来どおり `S.alldayExpanded` の値に応じて折りたたみ/展開が切り替わる（本改修前と同一動作）

### AC-9: 全表示 ON/OFF が URL に反映される

- **Given**: 全表示ボタンを ON にした状態で
- **When**: URL を確認したとき
- **Then**: `#kc:...&all=1` が含まれている
- **And**: OFF に戻すと `all` パラメータが URL から除去される

### AC-10: リロード後も全表示状態が復元される

- **Given**: 全表示 ON の状態でページをリロードしたとき
- **When**: カレンダーが再表示される
- **Then**: 全表示 ON の状態（ボタンの見た目・カレンダーの描画）が復元される

### AC-11: 月送り後も全表示状態が維持される

- **Given**: 全表示 ON の状態で
- **When**: 「次の月」ボタンをクリックして月を送ったとき
- **Then**: 全表示 ON の状態が維持されたまま新しい月が全件描画される

### AC-12: ビュー切替後も全表示状態が維持される

- **Given**: 月ビューで全表示 ON にした状態で
- **When**: 週ビューに切り替えたとき
- **Then**: 週ビューでも全表示 ON の状態（終日レーン全展開）が維持される

### AC-13: 全表示 ON→OFF 復帰でセル高固定表示に戻る

- **Given**: 全表示 ON からOFF に戻した状態で
- **When**: 月ビューを表示する
- **Then**: セル高固定・`+N more` 表示の通常モードに完全に戻る（可変高の残留スタイルが残らない）

### AC-14: alldayExpanded の手動状態が全表示 OFF 復帰後に保持される

- **Given**: 週ビューで `更 more` トグルを手動で折りたたんだ状態（`S.alldayExpanded === false`）のまま全表示 ON にし、その後 OFF に戻した状態で
- **When**: 週ビューを表示する
- **Then**: 折りたたみ状態（`S.alldayExpanded === false`）に戻っている（全表示 ON 中の強制展開によって手動状態が書き換わっていない）

---

## 10. 検証項目・テストシナリオ

### 10.1 基本トグル動作

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| ボタン位置確認 | ヘッダーを目視確認 | 「全表示」ボタンがフィルタボタンの直左にある（AC-1） |
| ON/OFF 切替 | ボタンを連続クリック | クリックのたびに見た目・`aria-pressed` が切り替わる |
| 全画面モードでの表示確認 | 全画面表示 ON の状態でヘッダーを確認 | 通常表示と同じ位置に全表示ボタンが表示される |

### 10.2 月ビュー

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| `+more` セルで全表示 ON | 予定過多の日がある月で全表示 ON | `+N more` が消え全予定が描画される（AC-2） |
| 週行の高さ可変確認 | 予定数が異なる週が並ぶ月で全表示 ON | 週ごとに行高が異なる（DevTools で `.kc-month-week` の高さを比較）（AC-3） |
| スクロール確認 | 全表示 ON でウィンドウ高を超えるまで予定を増やす | カレンダー領域がスクロール可能、ヘッダーは固定（AC-4） |
| OFF 復帰確認 | 全表示 ON → OFF に戻す | セル高固定・`+N more` 表示に戻る（AC-5, AC-13） |
| 5週/6週月での確認 | `REQ_month-cell-fixed-height.md` の週数動的化（FR-7）と併用し、5週月・6週月それぞれで全表示 ON | 週数に関わらず全件描画・行高可変が機能する |
| DnD との併用 | 全表示 ON の状態で月ビューの予定をドラッグ&ドロップ | 予定の日付が正しく更新される（行高可変時でも DnD 座標判定が破綻しないこと） |
| タイトル省略表示との併用 | 全表示 ON で長いタイトルの日跨ぎバーを表示 | `REQ_month-duplicate-fix.md` 等で対応済みのタイトル表示が崩れない |
| デフォルト権限色との併用 | 全表示 ON で `REQ_default-permission.md` の色分けが適用された予定を表示 | 色分けが正しく表示される（表示件数のみが変わり、色ロジックには影響しない） |
| チェックボックスフィルタとの併用 | 全表示 ON の状態でフィルタを操作し一部予定を絞り込む | フィルタ後の予定に対して全表示が機能する（フィルタで除外された予定は全表示でも出ない） |

### 10.3 週/日ビュー

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 終日レーン全展開確認 | 終日イベント4件以上の週で全表示 ON | `more` トグル非表示・全レーン展開（AC-6） |
| 日ビューでの確認 | 同上を日ビューで実施 | 同様に全展開される（AC-7） |
| OFF 復帰確認 | 全表示 ON → OFF | 元の `alldayExpanded` 状態（折りたたみ or 展開）に戻る（AC-8, AC-14） |
| 手動トグルとの相互作用 | 全表示 OFF で手動展開 → 全表示 ON → OFF | 手動展開状態が維持される（AC-14 の逆パターン） |

### 10.4 状態保持

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| URL 反映確認 | 全表示 ON にして URL を確認 | `#kc:...&all=1` が含まれる（AC-9） |
| リロード復元確認 | 全表示 ON でリロード | ON 状態が復元される（AC-10） |
| 月送り確認 | 全表示 ON で prev/next 操作 | ON 状態が維持される（AC-11） |
| ビュー切替確認 | 全表示 ON で月→週→日と切り替え | 各ビューで ON 状態が維持される（AC-12） |
| localStorage フォールバック確認 | URL に `all` パラメータがない状態で localStorage に `kc-show-all=1` がある場合にリロード | localStorage の値で ON 復元される |

### 10.5 実機検証手順

> MEMORY.md のとおり、plugin 版の検証は plugin.zip の実機手動アップロードが必須。

1. `plugin/dist/plugin.zip` を再ビルドし kintone 管理画面でプラグインを更新する
2. 検証アプリ（k/891 等）で以下を確認する:
   a. ヘッダーに「全表示」ボタンが正しい位置に表示される
   b. 予定が多い月・週・日を用意し、全表示 ON/OFF を切り替えて `+more`/`more トグル` の有無、行高の可変・固定を目視確認する
   c. 全表示 ON で月ビューをスクロールし、全週が閲覧できることを確認する
   d. 全表示 ON のまま月送り・週送り・ビュー切替・リロードを行い、状態が維持されることを確認する
   e. 全表示 ON の状態で DnD・タイトル省略・チェックボックスフィルタ・デフォルト権限色分けが正常動作することを確認する
   f. 全表示 OFF に戻し、既存の `+more`/`more トグル` 動作が本改修前と完全に同一であることを確認する（リグレッション確認）

---

## 11. 想定 UX / シーケンス

### 11.1 基本フロー

```
ユーザー: 月ビューで「予約が埋まっているか棚卸ししたい」
→ ヘッダーの「全表示」ボタンをクリック → ON になる
→ 月グリッドが再描画され、+N more だったセルも含めて全予定が chip/バーとして表示される
→ 予定が多い週の行が伸びて全予定が見える。カレンダー領域をスクロールして他の週も確認する
→ 確認が終わったら「全表示」ボタンを再度クリック → OFF に戻り、通常のコンパクト表示に戻る
```

### 11.2 週ビューでの利用フロー

```
ユーザー: 週ビューで終日予定が多い週を確認したい
→ 「全表示」ボタンを ON にする
→ 終日レーンの `▼ もっと表示` トグルが消え、全レーンが展開表示される
→ 終日予定をすべて確認できる
```

### 11.3 比較フロー（本要件の核心的なユースケース）

```
ユーザー: 通常モードでの見え方と全表示モードでの見え方を比較したい
→ 通常モード（OFF）で月ビューを閲覧し、+N more の集約状態を確認
→ 「全表示」ボタンを ON にして、同じ月がどう全展開されるかを確認
→ ON/OFF を切り替えながら、どちらが用途に適しているか判断する
```

### 11.4 状態復元フロー

```
ユーザー A: 全表示 ON のまま URL をコピーしてユーザー B に共有
→ URL に #kc:view=month&date=2026-07&all=1 が含まれる
↓
ユーザー B: リンクをクリック
→ カレンダーが起動し、all=1 を検知して全表示 ON の状態で描画される
→ ユーザー A と同じ「全件表示」の見え方を確認できる
```

---

## 12. 未解決事項・リスク・前提

### 12.1 未解決事項

| ID | 内容 | 優先度 | 担当 |
|---|---|---|---|
| Q-1 | **URL パラメータ名の確定**: 本書では `all` を仮称としたが、`REQ_checkbox-filter.md` で廃止された旧 `filter=all` との混同リスクがある。`showAll` / `expand` 等の代替案も含め、ユーザーに最終確認が必要 | 高 | 管理者→ユーザー確認 |
| Q-2 | **エッジケース: 予定が極端に多い週の上限有無**: ユーザー確定仕様には「上限なし」の明記がない。1週に数十件〜100件規模の予定がある場合、DOM 要素数が増えブラウザのレンダリング負荷が問題になる可能性がある。上限を設けない場合は NFR-3 のとおり許容するか、上限（例: 1日あたり50件でそれ以上は从来通り+more）を設けるか、ユーザー判断が必要 | 中 | 管理者→ユーザー確認 |
| Q-3 | **`.kc-month-ad-events` 高さ動的算出の詳細実装**: §5.2 で「JS 側で動的算出」と方針を示したが、具体的な算出式（`colLaneCounts` の最大値からの変換式）は builder が実装時に `BAR_H`/`BAR_GAP` 定数を用いて確定する必要がある。設計レベルでは方針のみ確定 | 中 | builder（実装時確定） |
| Q-4 | **`popstate` での `all` パラメータ差分検知**: §7.4 で「望ましいが必須ではない」とした。`REQ_url-state-sync.md FR-10` の既存 `popstate` ハンドラに `all` の差分検知を追加するかどうかはユーザー・builder 判断に委ねる | 低 | builder |
| Q-5 | **ビュー切替時の `alldayExpanded` リセット問題（`REQ_weekday-more-state.md §7 Q-2`）との関係**: 既存要件書で未確定のまま残っている「ビュー切替時に `alldayExpanded` をリセットするか」の論点と、本要件の `showAll`（ビュー横断で維持）が独立した状態であることは本書で明確化した（§7.4）が、`Q-2` 自体の解決は本要件のスコープ外 | 低 | 別要件（将来） |
| Q-6 | **全表示ボタンのバッジ・ラベル文言**: 「全表示」という固定文言でよいか、ON 時に文言を変える（例: 「全表示中」）か等の細部はユーザー確認が望ましい（UI 差分は軽微なため builder 判断でも可） | 低 | builder（任意） |

### 12.2 リスク

| リスク | 対策 |
|---|---|
| `.kc-month-grid` の `grid-template-rows` インラインスタイル分岐漏れ（`renderMonthGrid()` の他、`placeMonthEvents()` 実行タイミングでも参照される可能性） | builder は `grid-template-rows` を設定している全箇所（`desktop.js:4873-4876` 以外にも存在しないか grep で確認）を洗い出してから実装する |
| `.kc-month-cell` の `overflow: visible` 化により、DnD ゴースト表示・ホバーハイライト等が意図せず可視化される | 実機で DnD 操作・ホバー時の見た目を確認する（§10.2 テストシナリオに含む） |
| `_calcMaxItems()` のダミー要素挿入ロジック（`desktop.js:5047-5063`）は全表示 ON では呼ばれなくなるため、ON→OFF 切替時に一時的な計算ずれが起きないか | `baseCapacity = KC.State.showAll ? Infinity : _calcMaxItems();` の分岐が `placeMonthEvents()` 呼び出しのたびに再評価されるため、OFF に戻せば通常どおり `_calcMaxItems()` が呼ばれる。切替直後の再描画（`renderGrid()`）が確実に走ることを確認する |
| 週/日ビューの `more` トグル非表示化が、`REQ_weekday-more-state.md` の AC（トグル状態維持）と矛盾しないか | 本要件の「全表示 ON 中はトグル自体を隠す」は `REQ_weekday-more-state.md` の対象外（トグルが存在する場合の維持動作の話であり、トグルを消す本要件とは独立） |
| ヘッダー幅増加によるレイアウト崩れ（`REQ_checkbox-filter.md` はヘッダー幅を増やさない方針だったが、本要件は増やす方針） | 狭幅ウィンドウでの表示崩れを実機確認する（§10.5 実機検証手順に準ずる） |

### 12.3 前提

- 実装対象は `plugin/src/js/desktop.js` / `plugin/src/css/desktop.css` のみ（`src/kc-calendar.js` は対象外）
- 検証は plugin.zip の実機手動アップロードが必須
- 全表示 OFF はデフォルト状態であり、既存ユーザーの見え方は本改修により一切変化しない
- 本書は初版であり、§12.1 の未解決事項（特に Q-1, Q-2）はユーザー確認後に改訂版で確定させる

---

*初版（2026-07-03）: designer が既存実装（月ビューセル高固定・週/日終日レーン・ヘッダー構成・URL状態同期の各既存要件書と実装コード）を調査し初版を作成。未解決事項 Q-1〜Q-6 を §12.1 に整理。*
