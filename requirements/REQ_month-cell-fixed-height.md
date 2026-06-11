# REQ_month-cell-fixed-height: 月ビュー セル高さ固定・表示件数動的算出

**文書番号**: REQ_month-cell-fixed-height
**作成日**: 2026-06-10
**最終更新日**: 2026-06-11（第 5 版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `src/kc-calendar.js`, `src/kc-calendar.css`
**対象ファイル（従／同期対象）**: `docs/kc-calendar.js`, `docs/kc-calendar.css`, `plugin/src/js/desktop.js`, `plugin/src/css/desktop.css`
**ステータス**: 確定版 第 5 版（2026-06-11 FR-7 月ビュー週行数動的化を追加）

---

## 改訂履歴

| 版 | 日付 | 変更概要 |
|---|---|---|
| 第 1 版 | 2026-06-10 | 新規作成。FR-1〜FR-5 確定。未確定事項 0 件。 |
| 第 2 版 | 2026-06-10 | 実機検証（k/891、セル高 156px、イベント 9 件）で判明した日跨ぎ時間予定バー（span）の件数制限漏れ問題を反映。FR-4 改訂（span バーを件数制限対象に追加）、FR-6 新設（バー表示優先度ルール）。§2.5 追加（実機検証で判明した問題の詳細）。受入基準 AC5.8 改訂・AC5.12〜AC5.14 追加。検証項目 §6.3 / §6.6 更新。修正対象 §4.2 更新（`placeMonthTimedSpanEvents` を要修正に変更）。シーケンス §8.1 更新。 |
| 第 3 版 | 2026-06-10 | 実機検証（k/891、2026-05-26）で判明した「span バーのみの列で `+N more` がバーより上（日付直下）に表示される」問題を反映。FR-6 に「`+N more` はセル最下部に固定（margin-top: auto）」を追記。§2.6 追加。§4.1 CSS 修正表に `margin-top: auto` 行を追記。受入基準 AC5.15 追加。検証項目 §6.3 更新。解決済み事項 §7.10 追記。§8.2 / §8.4 更新。 |
| 第 4 版 | 2026-06-10 | 第 3 版の `margin-top: auto` 方式を廃止し、「more 描画位置 = 最終スロット+1」方式に置き換え。理由: margin-top: auto では floor 端数の余白（cellH=156 で約 26px）が最終バーと more の間に集約されて視覚的に目立つ。新方式では余白がセル最下端側に逃げる。FR-6 改訂（最終スロット+1 方式の仕様を明記）。§2.6 の実装方針を更新。§4.1 CSS 修正表から `margin-top: auto` 行を削除。§4.2 JS 修正表の `placeMonthTimedEvents()` / `applyOverflow()` を更新（chip 0 本の列でも spacer を必ず挿入する変更が入る）。AC5.15 を最終スロット+1 方式の受入基準に書き換え。§6.3 / §6.6 更新。解決済み事項 §7.10 を廃止記録として更新・§7.11 追記。§8.2〜§8.4 シナリオ数値を更新。 |
| 第 5 版 | 2026-06-11 | FR-7 新設（月ビュー週行数動的化）。全日が翌月の末尾週を描画しない Google カレンダー同等の動作を要件化。グリッド `grid-template-rows` を `repeat(N,…)` で動的設定・`min-height` も N に追従。FR-5 の再計算経路との連携を明記。NFR-3 新設（42 セル前提ロジックへの影響管理）。§1.7、§4.1 CSS／§4.2 JS 修正表更新、AC5.16〜AC5.19 追加、§6.7 追加、§7.12（リスク）追加、§8.5 追加、§9.1 更新、§10 更新。 |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（調査結果）](#2-現状分析調査結果)
3. [要件](#3-要件)
4. [修正対象箇所一覧](#4-修正対象箇所一覧)
5. [受入基準](#5-受入基準)
6. [検証項目・テストシナリオ](#6-検証項目テストシナリオ)
7. [未確定事項・リスク・前提](#7-未確定事項リスク前提)
8. [想定 UX / シーケンス](#8-想定-ux--シーケンス)
9. [影響範囲](#9-影響範囲)
10. [関連資料](#10-関連資料)

---

## 1. 背景・目的

### 1.1 問題

月ビューで予定（chip + 終日バー）が多い日のセルが縦に広がり、週行全体が他の週行よりも背が高くなってしまう。これにより月グリッドが均一な 6 行に見えなくなり、レイアウトが崩れる。

### 1.2 原因の要約（詳細は §2）

`.kc-month-cell` に `min-height: 90px` は設定されているが、**最大高・固定高の制約がない**。セルは `display: flex; flex-direction: column` の flex コンテナであり、子要素（chip・spacer・+N more）が増えると内容に応じて縦に伸びる。

一方で `+N more` オーバーフロー機能（`KC.MonthOverflowPopup`）は実機検証済みで正常動作しているため、オーバーフロー機能を破壊せず「セルを伸ばさない」形での修正が求められる。

### 1.3 追加判明した問題（2026-06-10 実機検証・第 2 版）

第 1 版の設計では終日バー（`placeMonthAlldayEvents`）に `alldayLimit = maxItems - 1` の件数制限を設けた。しかし**日跨ぎ時間予定バー（`placeMonthTimedSpanEvents`）には件数制限がなく**、span バーが全件描画されることが実機検証で判明した。

この結果、終日バー + span バーの合計が `maxItems` を超えるケースで `+N more` 要素がセル高の外側に押し出されてクリップされる問題が再現した（詳細は §2.5）。

また、この問題を踏まえて「隠れ予定があるセルでは `+N more` 行を必ずセル内に収める」という優先度ルールを要件として明文化した（FR-6）。

### 1.4 さらに判明した問題（2026-06-10 実機検証・第 3 版）

第 2 版の FR-6 で `+N more` のセル内可視性を保証したが、**span バーのみが存在する列（単日時間予定が 0 件の日）で `+N more` がバーより上（日付直下）に表示される**問題が新たに確認された（詳細は §2.6）。

span バーは `position: absolute` の `.kc-month-ad-events` レイヤに描画されるため通常の flex フローの外側にある。spacer・chip が 0 本の列では `+N more` が dateline 直下（y≈32px）に配置されてしまい、絶対配置された span バー（y≈86px）よりも上に重なって表示される。

第 3 版ではこの問題を `margin-top: auto` で解消することとしたが、**第 4 版で廃止し「最終スロット+1 方式」に置き換えた**（後述 §1.5）。

### 1.5 第 3 版方式の問題と第 4 版での置き換え（2026-06-10 確定）

第 3 版で採用した `margin-top: auto` 方式には以下の問題があることが判明した:

- `_calcMaxItems()` が `floor` で計算するため、セル高に端数が生じる（cellH=156px の場合 `available=100px` に対し `floor(100/27)=3` で `100 mod 27 = 19px` の余白が発生）
- `margin-top: auto` ではこの余白（≈19px）が「最終バーと `+N more` の間」に集約されて詰まって見える
- ユーザーから「最終バーと more の間が開きすぎる」という指摘があった

**代替案（第 4 版確定）: more 描画位置 = 最終スロット+1 方式**

- `+N more` の位置をそのセルで**実際に使われた最終スロット+1**のスロット位置に固定する
- 占有スロット判定は 3 種すべてで統一: 終日バー（列の描画レーン数）、日跨ぎ span バー（その列を跨ぐ描画済み span のレーン占有数）、単日 chip（spacer + 積み上げ）
- chip 0 本の列でも、占有最終スロット分の spacer を `+N more` の前に必ず挿入する（§2.6 の 5/26 問題の根本対処）
- 余白はセル最下端側（`+N more` の下）に逃げるため、バーと `+N more` が詰まって見える問題は発生しない
- 実装: `placeMonthTimedEvents()` の spacer 挿入ロジックを「chip 0 本でも usedSlots > 0 なら spacer を必ず挿入」に変更する（CSS 変更不要、JS のみ）

### 1.7 月ビュー週行数の固定化問題（2026-06-11 確定・第 5 版）

2026 年 6 月のように月初が月曜始まりで最終週（7/5〜7/11 相当）が丸ごと翌月日になる月では、当月の予定が 1 件もない空行がグリッドの末尾に表示される。これはスペースの無駄であり、1 行分のセル高が小さくなるため `_calcMaxItems()` の返り値も不必要に小さくなる。Google カレンダーは週行数を月の実必要数（4〜6 週）に応じて動的化しており、全日が翌月の末尾週は描画しない。本要件（FR-7）でその動作を実装する。

### 1.8 目的

1. セルの高さを「予定 0 件時の自然高」に固定し、予定の増加によって伸びないようにする
2. セル高から表示可能件数を動的算出し、収まらない予定は既存の `+N more` 機能に委ねる
3. 終日バー・日跨ぎ span バー・単日 chip の**合計**が `maxItems` を超えないよう制限する
4. 隠れ予定があるセルでは `+N more` 行を必ずセル内に可視表示する
5. span バーのみの列を含むすべての状況で `+N more` が最終スロット+1 の位置（バー群直下）に表示され、余白はセル最下端側に逃げること
6. 既存の `+N more` ポップオーバー（`KC.MonthOverflowPopup`、実機検証済み）を壊さない
7. 月の実際の週数（4〜6 週）に応じてグリッド行数を動的化し、全日が翌月の末尾週を描画しないこと（FR-7）

---

## 2. 現状分析（調査結果）

### 2.1 セルが広がるメカニズム

#### CSS の問題（`src/kc-calendar.css:825-836`）

```css
/* 現状 */
.kc-month-cell {
  min-height: var(--kc-month-cell-min-h, 90px);  /* 最小高のみ。最大高制約なし */
  overflow: hidden;                               /* ←後述の通りこれだけでは不十分 */
  display: flex;
  flex-direction: column;                         /* 子要素が縦積みで増えると高さが伸びる */
  ...
}
```

`overflow: hidden` が設定されているにもかかわらずセルが広がる理由:

- `.kc-month-week`（`src/kc-calendar.css:818-822`）には `height` も `overflow` も設定されていない
- `.kc-month-grid`（`src/kc-calendar.css:810-815`）は `grid-template-rows: repeat(6, 1fr)` を使用している
- CSS Grid の `1fr` は「空きスペース」を均等分割するが、**最小コンテンツサイズ（min-content size）** を下回ることはできない
- `.kc-month-week` の最小コンテンツサイズは子要素（`.kc-month-cell`）のコンテンツ高に依存する
- 結果として、コンテンツが増えた `.kc-month-cell` が `.kc-month-week` を押し広げ、その行の `1fr` が他の行より大きくなる

`overflow: hidden` はセルの**外側へのはみ出し**を隠すだけであり、セル自体の高さが内容に合わせて伸びることは防がない。

#### JS の問題（`src/kc-calendar.js:3789-3801`）

`_calcMaxItems()` は**現在のセル実高**（`getBoundingClientRect().height`）からレンダリング時の表示件数上限を計算する:

```javascript
// src/kc-calendar.js:3789-3801（plugin/src/js/desktop.js:4143-4159 も同内容）
function _calcMaxItems() {
  var firstCell = document.querySelector('.kc-month-cell');
  if (!firstCell) return MAX_CELL_ITEMS;
  var cellH = firstCell.getBoundingClientRect().height;   // ← 実高を取得
  if (!cellH || cellH <= 0) return MAX_CELL_ITEMS;
  var dateHeadH = 32;
  var padding   = 4;
  var moreH     = 20;
  var itemH     = BAR_H + BAR_GAP;  // BAR_H=24, BAR_GAP=3 → 27px
  var available = cellH - dateHeadH - padding - moreH;
  var max = Math.floor(available / itemH);
  return Math.min(max, 10);
}
```

この計算は**正しい設計**だが、CSS 側でセル高が固定されていないため「セルが既に伸びた状態」で計算すると、伸びた分だけ maxItems が大きくなり、より多くの chip が配置されてさらにセルが広がるという循環が生じうる。

また `_calcMaxItems()` は `placeMonthEvents()` の冒頭（`src/kc-calendar.js:4142`）で**1回だけ**呼ばれ、全セル共通の値として使用される。終日バーの `usedSlots` 数は考慮されているが（`src/kc-calendar.js:4172`）、セル自体の高さ固定が担保されていないため根本解決にならない。

### 2.2 終日バー超過のカウント漏れ（第 1 版で対応済み）

第 1 版要件（FR-4）で `placeMonthAlldayEvents()` に `alldayLimit = maxItems - 1` の件数制限を設け、超過分を `hiddenByCol` として返す設計を定義した。`plugin/src/js/desktop.js:4410-4490` で実装済み。

### 2.3 plugin/src 側の同一問題

`plugin/src/js/desktop.js:4143-4159` の `_calcMaxItems()` は `src/kc-calendar.js` と同一実装である。CSS も同様の構造を持つ（`plugin/src/css/desktop.css` の `.kc-month-cell` に同一の `min-height` のみ設定）。同一の問題を抱えている。

### 2.4 `_calcMaxItems()` の本来の設計意図

`_calcMaxItems()` の設計は**正しい方向**であり、セル実高から表示可能件数を算出するアプローチは維持する。問題は CSS 側でセル高が固定されていないことだけである。CSS でセル高を固定すれば `_calcMaxItems()` が正しく機能するようになる。

### 2.5 実機検証で判明した問題（2026-06-10、k/891）

**検証条件**: セル高 156px、`maxItems = 3`（_calcMaxItems の計算値）、2026-05-25 のセルでイベント 9 件

**判明した不具合の連鎖:**

1. 終日バーは `alldayLimit = maxItems - 1 = 2` により正しく 2 本に制限される（`plugin/src/js/desktop.js:4445`）
2. しかし `placeMonthTimedSpanEvents`（`plugin/src/js/desktop.js:4502-4535`）には件数制限がなく、日跨ぎ時間予定バーが 2 本そのまま描画される
3. `spanResult.colLaneCounts[colIdx] = alldayLaneCount(2) + spanLanes(2) = 4` → `usedSlots = 4`
4. `spacer` 高さ = `usedSlots * BAR_H + (usedSlots-1) * BAR_GAP = 4×24 + 3×3 = 105px`
5. `remaining = maxItems - usedSlots = 3 - 4 = -1 → 0` のため chip は 0 本
6. `hiddenCount > 0` なので `applyOverflow()` で `.kc-month-more` が生成されるが、DOM 上の位置は `dateline(32px) + spacer(105px) = 137px` より下
7. セル高 156px のため `more` 要素の上端が `137px`、要素高 `≈20px` で下端が `157px` → セル高を超えてクリップされ、ほぼ見えない状態になる

**根本原因:** `placeMonthTimedSpanEvents` が `maxItems` を受け取らず、span バーを全件描画している。終日バーと span バーの合計スロット数が `maxItems` を超えても制限がかからない。

**数値で再現（セル高 156px の例）:**

```
_calcMaxItems() = floor((156 - 32 - 4 - 20) / 27) = floor(100 / 27) = 3  → maxItems = 3
alldayLimit     = maxItems - 1 = 2  → 終日バー 2 本表示（超過 0 本）
span バー       = 制限なし → 2 本表示
usedSlots       = 2 (allday) + 2 (span) = 4  ← maxItems=3 を超過
spacer 高さ     = 4×24 + 3×3 = 105px
more の top     = 32 (dateline) + 105 (spacer) = 137px
more の bottom  = 137 + 20 = 157px  > セル高 156px  → クリップされて不可視
```

### 2.6 実機検証で判明した `+N more` の位置問題（2026-06-10、k/891・第 3 版）

**検証条件**: k/891、2026-05-26（月曜日）。週をまたぐ日跨ぎ時間予定のみが存在し、単日時間予定は 0 件の列。

**問題の再現:**

1. `.kc-month-ad-events` レイヤに span バーが絶対配置で描画される（例: lane=2 なら `top = 28+4 + 2*27 = 86px`）
2. 単日時間予定が 0 件のため `placeMonthTimedEvents()` は spacer・chip を挿入しない（または spacer のみ）
3. `applyOverflow()` で `.kc-month-more` が `cellEl.appendChild()` されるが、flex コンテナ内の子要素は `dateline` + `more` のみとなる
4. `more` の表示位置は flex フローにより dateline 直下（top ≈ 32px）となる
5. span バーは絶対配置で top ≈ 86px に描画されているため、**`more`（y=32）がバー（y=86）より視覚的に上に表示される**

**セル DOM 構造の対比:**

```
【問題ケース: span バーのみの列（現状）】
.kc-month-cell (flex column)
  ├── .kc-month-dateline  (y=0, h=32)
  └── .kc-month-more      (y=32) ← バーより上に来てしまう
  [.kc-month-ad-events (absolute)]
    └── span バー          (y=86) ← more より下に絶対配置

【正しい状態: more がセル最下部】
.kc-month-cell (flex column)
  ├── .kc-month-dateline  (y=0, h=32)
  └── .kc-month-more      (y=136, セル底部) ← margin-top: auto で最下部へ
  [.kc-month-ad-events (absolute)]
    └── span バー          (y=86) ← more より上
```

**根本原因:** `placeMonthTimedEvents()` が `usedSlots > 0 かつ timedEvents.length > 0` のときのみ spacer を挿入する設計になっており、単日予定が 0 件の列では spacer が挿入されない。`+N more` は spacer がなければ dateline 直下に配置されてしまう。

**第 3 版の暫定対処（廃止）**: CSS で `.kc-month-more { margin-top: auto; }` を追加する方式を採用したが、floor 端数の余白がバーと `+N more` の間に集約されて目立つ問題が発覚したため第 4 版で廃止した。

**第 4 版の実装方針（最終スロット+1 方式）**: `placeMonthTimedEvents()` の spacer 挿入ロジックを変更し、**`timedEvents` が 0 件でも `usedSlots > 0` なら spacer を必ず挿入する**。これにより `+N more` は常に `dateline + spacer(usedSlots 分)` の直後（最終スロット+1 の位置）に配置され、余白はセル最下端に逃げる。CSS 変更は不要（第 3 版で追加した `margin-top: auto` は不要のため追加しない）。

**修正後の DOM 構造（最終スロット+1 方式）:**

```
【修正後: span バーのみの列（usedSlots=2）】
.kc-month-cell (flex column)
  ├── .kc-month-dateline       (y=0,  h=32)
  ├── .kc-month-chip-spacer    (y=32, h=51)  ← usedSlots=2: 2×24+1×3=51px（chip 0 本でも挿入）
  └── .kc-month-more           (y=83)        ← spacer の直後 = スロット 3 の先頭位置
  [.kc-month-ad-events (absolute)]
    └── span バー               (y=32+4+2×27=90px 付近) ← more より上
  余白: 156 - 83 - 20 = 53px がセル最下端側に集まる

【比較: margin-top: auto 方式（第 3 版・廃止）】
  ├── .kc-month-dateline       (y=0,  h=32)
  └── .kc-month-more           (y=136, セル底部)  ← バーとの間に 26px の余白が詰まる
```

---

## 3. 要件

### 3.1 機能要件

#### FR-1: セルの高さを固定する

- 月ビューの `.kc-month-cell` は予定の数にかかわらず高さが変動しないこと
- セルの高さは「予定 0 件時に `.kc-month-grid` が自然に均等分割する高さ」を基準とする
- 予定が多くてセルの高さを超えるコンテンツは `overflow: hidden` でクリップされること

#### FR-2: 表示可能件数を高さから動的算出する

- `_calcMaxItems()` は引き続き動作し、セル実高に基づいて表示件数上限を計算する
- セル高が固定されることで `_calcMaxItems()` の計算結果が毎回安定する
- 計算結果に基づいて chip + 終日 spacer が `overflow: hidden` の境界内に収まること

#### FR-3: 収まらない予定は `+N more` に委ねる

- 表示件数上限を超えた予定は既存の `applyOverflow()` / `KC.MonthOverflowPopup` 経由でポップオーバーに表示されること
- `+N more` の `N` は「終日バー超過分 + 日跨ぎ span バー超過分 + 時間予定 chip 非表示分」の合計とする

#### FR-4: 終日バー・日跨ぎ span バーの合計に件数上限を設ける（第 2 版改訂）

第 1 版では終日バーのみを制限対象としていたが、実機検証で日跨ぎ時間予定バー（span バー）も制限対象に含める必要があることが判明した。

- **終日バーの制限（第 1 版から継続）**: `placeMonthAlldayEvents()` が `alldayLimit = maxItems - 1` で件数制限し、超過分を `hiddenByCol` に記録する（実装済み）
- **span バーの制限（第 2 版新規）**: `placeMonthTimedSpanEvents()` は終日バー描画後に呼ばれ、「終日バーが使ったスロット数」を踏まえて残り枠（`spanLimit = maxItems - effectiveLaneCount - 1`、最低 0）を超える span バーは描画しないこと
  - `spanLimit` の `- 1` は `+N more` 行のための最低 1 枠確保のため
  - span バー超過分は `hiddenByCol`（または新設する `hiddenSpanByCol`）に記録し、`hiddenCount` / ポップオーバーに合算すること
- **合計制約**: 終日バースロット数 + span バースロット数 + `+N more` 行の合計がセル高に収まること（overflow: hidden によるクリップが発生しない状態が理想、少なくとも `+N more` 行は必ずセル内に収めること）

#### FR-5: ウィンドウリサイズ・全画面切替時の再計算（第 1 版から変更なし）

- ウィンドウリサイズ後に月ビューが表示されている場合、`placeMonthEvents()` を debounce 付きで再実行してセル高・表示件数を再計算すること
- debounce 待機時間: **200ms**（`window` の `resize` イベントに対して）
- kintone 全画面表示モード（`.kc-root.kc-expanded`）の切替（ON / OFF 両方向）後にも同様に `placeMonthEvents()` を再実行すること
- 再実行は `requestAnimationFrame` でラップしてセル高確定後に計算すること（既存の `src/kc-calendar.js:4224` のパターンに倣う）
- 月ビュー以外のビュー（週・日）が表示されている間はリサイズ・全画面切替のトリガーで `placeMonthEvents()` を実行しないこと

#### FR-6: バー表示の優先度ルール・`+N more` の描画位置（第 2 版新規・第 4 版改訂）

件数制限によりすべての予定が表示できない場合、以下の優先度でセル内のスペースを割り当てること。

1. **最優先**: セル内に最低 1 本のバー（終日バーまたは span バーのうち最初の 1 本）を表示する
2. **第 2 優先**: `+N more` 行を必ずセル内に完全表示する（`hiddenCount > 0` のセルで `+N more` がクリップされてはならない）
3. **第 3 優先**: 2 本目以降のバー・chip を可能な限り表示する

極小セル（セル高が `dateline + moreH` 以下で 1 本のバーすら入らない場合）では、バーを 0 本にして `+N more` のみ表示してもよい（`_calcMaxItems()` が 0 を返すケースに該当: `plugin/src/js/desktop.js:4156`）。

**`+N more` の描画位置 = 最終スロット+1 の位置（第 4 版確定）**

- `+N more` 要素（`.kc-month-more`）の表示位置は、そのセルで**実際に使われた最終スロット+1**のスロット位置とする
- 「実際に使われた最終スロット」の判定は 3 種のバーで統一する:
  - **終日バー**: その列の描画レーン数（`alldayResult.colLaneCounts[colIdx]`）
  - **日跨ぎ span バー**: その列を跨ぐ描画済み span バーのレーン占有数（`spanResult.colLaneCounts[colIdx]` に含まれる）
  - **単日 chip**: spacer + 積み上げ（`usedSlots + chipsAdded`）
- **chip が 0 本の列でも `usedSlots > 0` なら spacer を必ず挿入する**。これにより `more` が `dateline + spacer` の直後（最終スロット+1 の位置）に配置され、span バーより上に来る視覚的逆転（§2.6）が解消される
- 余白（`_calcMaxItems()` の floor 端数分）はセル最下端側（`more` の下）に集まる。第 3 版の `margin-top: auto` 方式では余白がバーと `more` の間に集積して目立ったが、本方式では解消される
- 実装: `placeMonthTimedEvents()` の spacer 挿入条件を `if (usedSlots > 0)` から変更不要だが、**`timedEvents.length === 0` でも `usedSlots > 0` なら関数に入って spacer だけ挿入するよう呼び出し元（`placeMonthEvents()`）を調整する**（CSS 変更不要）

**期待位置の例（cellH=156px、BAR_H=24、BAR_GAP=3、dateline=32px）:**

| シナリオ | usedSlots | chipsAdded | spacerH | more の top |
|---|---|---|---|---|
| 5/25: バー 2 本 + chip 1 本 | 2 | 1 | 2×24+1×3=51px | 32+51+27=110px |
| 5/26: span のみ（スロット 2） | 2 | 0 | 2×24+1×3=51px | 32+51=83px |
| 単日 chip 2 本のみ | 0 | 2 | 0px | 32+2×27=86px |

**実装上の制約導出:**

```
spanLimit の上限 = maxItems - effectiveLaneCount(終日バー実描画数) - 1
                                                                    ↑ +N more 行のための最低 1 枠
```

この計算により、バー合計（allday + span）は `maxItems - 1` を超えず、残り 1 枠が `+N more` 行に確保される。

#### FR-7: 月ビューの週行数を月の実必要数に応じて動的化する（第 5 版新規）

**背景**: 現状のグリッドは `grid-template-rows: repeat(6, minmax(0,1fr))` で常に 6 行固定。全日が翌月の末尾週が存在する月（例: 2026 年 6 月）では不要な空行が表示される。

**週数の算出方法**:

```
weekCount = ceil((dayOfWeekOffset(月初) + daysInMonth) / 7)
```

- `dayOfWeekOffset`: 月初曜日のオフセット（日曜始まりなら日=0、月=1、…、土=6）
- 算出結果は 4〜6 の整数
- 全日が翌月（当月の予定が 0 件であるかに関わらず、**日付ベース**で全セルが翌月）の末尾週は描画しない

**CSS 変更**:

- `.kc-month-grid` の `grid-template-rows` を `repeat(6, minmax(0,1fr))` 固定から外し、JS で `--kc-month-week-count: N` カスタムプロパティ（または `style.gridTemplateRows` インラインスタイル）を動的設定する
- CSS 側は `grid-template-rows: repeat(var(--kc-month-week-count, 6), minmax(0,1fr))` に変更する（デフォルト 6 行でフォールバック）
- `.kc-month-grid` の `min-height: calc(6 * 90px)` を `calc(var(--kc-month-week-count, 6) * 90px)` に変更する
- 全画面モード時（`.kc-root.kc-expanded .kc-month-grid`）の高さ定義も同様に `var(--kc-month-week-count, 6)` に追従させる

**JS 変更**:

- 月描画開始時（`placeMonthEvents()` またはグリッドセル生成関数）で `weekCount` を計算し、`.kc-month-grid` 要素に `style.setProperty('--kc-month-week-count', weekCount)` を設定する
- 末尾週のセル生成（`createElement` / `innerHTML` 等）を `weekCount` に応じてスキップするか、生成後に DOM から除去する
- `weekCount` 変更後は `requestAnimationFrame` でセル高確定を待ってから `_calcMaxItems()` を呼ぶ（FR-5 の再計算経路をそのまま利用）

**既存ロジックとの連携**:

- 行数が減ると各セルが高くなり `_calcMaxItems()` の返り値が増加する → 表示可能件数が自動的に増える（FR-5 の再計算経路がそのまま有効であること）
- ウィンドウリサイズ・全画面切替後の `placeMonthEvents()` 再実行（FR-5）は FR-7 の変更後も動作すること（`weekCount` 変数はグリッド再描画のたびに再計算される）

### 3.2 非機能要件

#### NFR-1: 既存機能を壊さない

- `KC.MonthOverflowPopup`（`+N more` ポップオーバー）の動作を変更しない
- 週ビュー・日ビューの表示に影響を与えない
- 月ビュー DnD（`REQ_month-dnd.md`）の動作に影響を与えない

#### NFR-2: src / docs / plugin の三者同期

- `src/kc-calendar.css`, `src/kc-calendar.js` の変更を `docs/` および `plugin/src/` に同期すること

#### NFR-3: 42 セル前提ロジックへの影響管理（第 5 版新規）

現状実装の以下のロジックは「月グリッド = 常に 42 セル（6 週 × 7 日）」を暗黙的に前提としている可能性がある。FR-7 実施後、実際の週数が 4〜5 週になる場合でもこれらが正常動作することを確認し、必要に応じて対応すること。

| 対象ロジック | リスク内容 | 対応方針 |
|---|---|---|
| セル生成ループ（`placeMonthEvents()` / グリッド初期化） | `for (let i = 0; i < 42; i++)` のような固定長ループが存在する場合、末尾週スキップ時に配列外アクセスや未初期化セルへの参照が発生する | `weekCount * 7` を使用するよう変更するか、末尾週の DOM が存在しない場合のガード処理を追加する |
| 月 DnD（`REQ_month-dnd.md`）| ドラッグ中のセル index 計算が 42 固定を前提としている場合、5 週月でインデックスずれが生じる | 実機確認を必須とし、インデックス計算を `weekCount * 7` ベースに修正する |
| `+N more` ポップオーバー（`KC.MonthOverflowPopup`）| 非表示予定の登録がセル index で管理されている場合、35 セル月で index 36〜41 の予定データへのアクセスが発生しないことを確認する | セルが存在しない週の index に予定が登録されないよう、イベントフィルタリング側で保証する |
| 検索フローティング一覧（`REQ_search-bar.md`）| 検索結果をセル座標で表示する処理が週数前提を持つ場合 | 実機確認。問題があれば別 REQ で対応 |
| 前後月の日付埋め（前月末・翌月初のグレー日付）| 末尾週が翌月日で埋まる場合に末尾週を描画しないため、前後月日付の生成範囲も `weekCount` に追従させる必要がある | セル生成ロジックを `weekCount * 7` ベースに変更し、末尾 7 セル（全翌月）を生成しないよう修正する |

---

## 4. 修正対象箇所一覧

### 4.1 CSS 修正

| ファイル | 行番号 | 変更内容 |
|---|---|---|
| `src/kc-calendar.css` | 818-822 | `.kc-month-week` に `overflow: hidden` を追加してセルのはみ出しを抑止 |
| `src/kc-calendar.css` | 825-836 | `.kc-month-cell` の高さ制御を変更。`min-height` 維持 + `height: 100%` または `align-self: stretch` によるグリッド行高への追従（§7.2 参照）|
| `src/kc-calendar.css` | 810-815 | **変更あり（第 5 版 FR-7）**: `.kc-month-grid` の `grid-template-rows: repeat(6, minmax(0,1fr))` を `repeat(var(--kc-month-week-count, 6), minmax(0,1fr))` に変更。`min-height: calc(6 * 90px)` を `calc(var(--kc-month-week-count, 6) * 90px)` に変更 |
| `src/kc-calendar.css` | 全画面モード定義箇所 | **変更あり（第 5 版 FR-7）**: `.kc-root.kc-expanded .kc-month-grid` の高さ定義も `var(--kc-month-week-count, 6)` に追従させる |
| `docs/kc-calendar.css` | 同上 | `src/` と同期 |
| `plugin/src/css/desktop.css` | 対応箇所 | 同上（plugin 固有スタイルがある場合はそちらも）|

> **第 3 版で追加予定だった `margin-top: auto`（`.kc-month-more`）は第 4 版で廃止。CSS への変更は不要。** 代わりに JS 側（`placeMonthTimedEvents()` の spacer 挿入ロジック）で対処する（§4.2 参照）。

### 4.2 JS 修正

| ファイル | 行番号 | 対象関数 | 変更内容 |
|---|---|---|---|
| `src/kc-calendar.js` | 3789-3801 | `_calcMaxItems()` | 変更不要（CSS 側の修正後に正しく機能する）|
| `src/kc-calendar.js` | 3989-4036 | `placeMonthAlldayEvents()` | 変更不要（第 1 版 FR-4 で実装済み: `maxItems` による件数制限・`hiddenByCol` 返却）|
| `src/kc-calendar.js` | 4046-4089 相当 | `placeMonthTimedSpanEvents()` | **変更あり（第 2 版 FR-4）**: `spanLimit` パラメータを受け取り、超過 span バーを描画せず `hiddenSpanByCol`（または既存の返却構造に追加）として返す |
| `src/kc-calendar.js` | 4046-4089 相当 | `placeMonthTimedEvents()` | **変更あり（第 4 版 FR-6）**: 先頭の `if (!timedEvents \|\| timedEvents.length === 0) return 0;` 早期 return を除去し、`usedSlots > 0` の場合は単日予定が 0 件でも spacer を挿入してから return するよう変更する。これにより `+N more` が最終スロット+1 の位置に配置される |
| `src/kc-calendar.js` | 4097-4106 相当 | `applyOverflow()` | 変更不要（呼び出し元で `hiddenCount` 算出済み）|
| `src/kc-calendar.js` | 4112-4195 相当 | `placeMonthEvents()` | **変更あり**: ① `placeMonthTimedSpanEvents()` に `spanLimit` を渡す / ② span バー超過分を `hiddenCount` に加算（FR-4 第 2 版）/ ③ debounce リサイズハンドラを登録（FR-5）/ ④ **単日予定 0 件の列でも `placeMonthTimedEvents()` を呼んで spacer だけ挿入させる（第 4 版 FR-6）** |
| `src/kc-calendar.js` | 4221-4226 付近 | `refresh()` 内 `requestAnimationFrame` | **変更あり**: kintone 全画面切替（`.kc-root.kc-expanded` の付け外し）検知を追加して `placeMonthEvents()` を再実行（FR-5）|
| `src/kc-calendar.js` | グリッド生成箇所 | `_buildMonthGrid()` 相当 | **変更あり（第 5 版 FR-7）**: ① `weekCount = ceil((startDayOffset + daysInMonth) / 7)` を算出し `.kc-month-grid` に `style.setProperty('--kc-month-week-count', weekCount)` を設定する / ② セル生成ループを `weekCount * 7` セルに変更（末尾週が全翌月の場合はスキップ）/ ③ `requestAnimationFrame` でセル高確定後に `placeMonthEvents()` を呼ぶ（FR-5 の経路を利用）|
| `plugin/src/js/desktop.js` | 4143-4159 | `_calcMaxItems()` | `src/` と同期 |
| `plugin/src/js/desktop.js` | 4502-4535 | `placeMonthTimedSpanEvents()` | **変更あり（第 2 版 FR-4）**: 上記 `src/` と同内容で同期 |
| `plugin/src/js/desktop.js` | 4565-4608 | `placeMonthTimedEvents()` | **変更あり（第 4 版 FR-6）**: 上記 `src/` と同内容で同期 |
| `plugin/src/js/desktop.js` | 4627-4732 | `placeMonthEvents()` 等 | `src/` と同期 |

---

## 5. 受入基準

Given / When / Then 形式で記述する。

### AC5.1 予定が多くてもセルの高さが変わらない

- **Given**: 月ビューで特定の日（例: A 日）に時間予定が 10 件以上登録されている
- **When**: 月ビューを表示する
- **Then**: A 日のセルの高さが他の予定 0 件の日と同じ高さである（週行の高さが均一）
- **And**: A 日のセルに `+N more` ラベルが表示されている

### AC5.2 表示件数がセル高から算出される

- **Given**: 月ビューのセルの高さが計算できる状態（DOM 構築後）
- **When**: `_calcMaxItems()` が実行される
- **Then**: 返り値がセルの実高・dateline 高・itemH に基づいて計算された値である（最低 1、最大 10）

### AC5.3 収まらない予定が `+N more` に表示される

- **Given**: 月ビューで A 日に時間予定が `_calcMaxItems()` の返り値を超える件数登録されている
- **When**: 月ビューを表示する
- **Then**: `_calcMaxItems()` の件数だけ chip が表示され、残りは `+N more` ラベルに集約される
- **And**: `+N more` をクリックするとポップオーバーに非表示予定が表示される（既存動作維持）

### AC5.4 ウィンドウリサイズ後に件数が再計算される

- **Given**: 月ビューが表示されている
- **When**: ブラウザウィンドウのサイズを変更する
- **Then**: リサイズ後のセル高に基づいて `_calcMaxItems()` が再計算され、chip の表示件数が更新される
- **And**: セルの高さは変わらず、件数のみが調整される

### AC5.5 全画面モード切替後に件数が再計算される

- **Given**: 月ビューが通常表示モードで表示されている
- **When**: 全画面ボタンをクリックして `.kc-root.kc-expanded` 状態にする
- **Then**: 全画面後のセル高に基づいて `_calcMaxItems()` が再計算される
- **And**: 全画面時のセルが 6 行均等分割のまま維持される

### AC5.6 週ビュー・日ビューに影響がない

- **Given**: 月ビューの CSS 修正が適用されている
- **When**: 週ビューまたは日ビューに切り替える
- **Then**: 週ビュー・日ビューのレイアウトが修正前と変わらない（`REQ_month-view.md §4` の関連 AC が合格）

### AC5.7 `+N more` ポップオーバーが引き続き動作する

- **Given**: 月ビューでセル高固定修正が適用されている
- **When**: `+N more` ラベルをクリックする
- **Then**: `KC.MonthOverflowPopup` のポップオーバーが表示され、非表示予定の一覧が確認できる（`REQ_month-overflow-popup.md §7` の全 AC が合格）

### AC5.8 終日バー・span バーが多い日でも `+N more` がセル内に収まる（第 2 版改訂）

- **Given**: 月ビューで 2026-05-25 のセル（k/891 検証アプリ）に終日バー 2 本・日跨ぎ span バー 2 本・単日時間予定 5 件（合計 9 件）が登録されており、セル高 156px・maxItems=3 である
- **When**: 月ビューを表示する
- **Then**: 表示されるバーの合計本数が `maxItems - 1 = 2` 本以下に制限される（例: 終日バー 2 本 + span バー 0 本、または終日バー 1 本 + span バー 1 本 等）
- **And**: `+N more` 行（例: `+7 more`）がセル高 156px 内に完全に収まって可視表示される
- **And**: `+N more` をクリックするとポップオーバーに隠れた 7 件（終日超過 + span 超過 + 時間予定超過の合計）がすべて表示される

### AC5.9 kintone 全画面切替後に件数が再計算される

- **Given**: 月ビューが表示されており、通常表示と全画面表示でセル高が異なる
- **When**: 全画面ボタンをクリック（通常 → 全画面）またはその逆（全画面 → 通常）の切替を行う
- **Then**: 切替後に `placeMonthEvents()` が再実行され、新しいセル高に基づいて chip 数が更新される
- **And**: 切替前後でセルの高さは均一なままである

### AC5.10 月ビュー非表示中はリサイズトリガーが発火しない

- **Given**: 週ビューまたは日ビューが表示されている
- **When**: ブラウザウィンドウのサイズを変更する
- **Then**: `placeMonthEvents()` が実行されない（月ビューの不要な再描画が起きない）

### AC5.11 src / docs / plugin が同期されている

- **Given**: `src/kc-calendar.css` および `src/kc-calendar.js` の変更が完了している
- **When**: 3 ファイルセット（src / docs / plugin）の対応箇所を確認する
- **Then**: 同等の修正が各ファイルに存在する

### AC5.12 span バー超過分がポップオーバーに含まれる（第 2 版新規）

- **Given**: 月ビューで日跨ぎ時間予定が span バーの表示上限を超えて登録されている
- **When**: `+N more` をクリックする
- **Then**: ポップオーバーに span バーの超過分の予定（終日バー超過分・時間予定超過分と合わせて）が表示される
- **And**: `+N more` の `N` が「終日超過 + span 超過 + chip 非表示」の合計件数に一致する

### AC5.13 `+N more` の可視性保証（第 2 版新規: FR-6 の受入基準）

- **Given**: 月ビューでいずれかのセルに非表示予定（hiddenCount > 0）が存在する
- **When**: 月ビューを表示する
- **Then**: そのセルの `+N more` 要素の下端が `cellEl.getBoundingClientRect().bottom` を超えていない（セル内に完全に収まっている）
- **And**: `+N more` 要素が `overflow: hidden` によって一部でもクリップされていない

### AC5.14 最低 1 本のバー表示（第 2 版新規: FR-6 の受入基準）

- **Given**: 月ビューでセル高が最小（`min-height: 90px`）の場合に予定が多数登録されている
- **When**: 月ビューを表示する
- **Then**: セル内に少なくとも 1 本のバー（終日バーまたは span バーの先頭）が表示されるか、バーが 1 本も入らない極小セルでは `+N more` のみが表示される（`_calcMaxItems() = 0` の場合）

### AC5.15 `+N more` が最終スロット+1 の位置に表示される（第 4 版改訂: FR-6 の受入基準）

- **Given**: 月ビューで span バーのみが存在する列（例: k/891 の 2026-05-26、usedSlots=2）が表示されている。単日時間予定は 0 件。
- **When**: 月ビューを表示する
- **Then**: `+N more` 要素が `dateline + spacer(usedSlots 分)` の直後（最終スロット+1 の位置）に表示される。期待 top ≈ `32 + (2×24 + 1×3) = 83px`。絶対配置された span バーより下に視覚的に位置している
- **And**: `+N more` よりも下（セル最下端側）に余白が集中している（`more` の下に空白がある）
- **And**: 単日時間予定が存在するセル（k/891 の 2026-05-25、usedSlots=2・chip 1 本）でも `+N more` が chip 群の直後に表示される。期待 top ≈ `32 + 51 + 27 = 110px`
- **And**: 単日 chip のみのセル（usedSlots=0、chip 2 本）では spacer なしで chip 群の直後に `+N more` が表示される。期待 top ≈ `32 + 2×27 = 86px`

### AC5.16 5 週月で末尾週が描画されない（第 5 版新規: FR-7 の受入基準）

- **Given**: 月ビューで 2026 年 6 月（月初=月曜日、weekCount=5）を表示している
- **When**: DOM を確認する
- **Then**: `.kc-month-grid` の `grid-template-rows` が `repeat(5, …)` に設定されており（または `--kc-month-week-count: 5` が設定されており）、`.kc-month-week` 要素が 5 つ存在する
- **And**: 7/5〜7/11 の日付を持つセル行が DOM に存在しない

### AC5.17 6 週必要な月では 6 行表示される（第 5 版新規: FR-7 の受入基準）

- **Given**: 月ビューで 6 週必要な月（例: 2026 年 8 月。月初=土曜日、weekCount=6）を表示している
- **When**: DOM を確認する
- **Then**: `.kc-month-week` 要素が 6 つ存在し、末尾週のセルが正常に表示されている
- **And**: `--kc-month-week-count: 6`（またはデフォルト値）が設定されている

### AC5.18 5 週月では各セルが 6 週月より高く表示可能件数が増える（第 5 版新規: FR-7 の受入基準）

- **Given**: 同一ウィンドウサイズで 5 週月（例: 2026 年 6 月）と 6 週月（例: 2026 年 8 月）をそれぞれ月ビューで表示する
- **When**: `_calcMaxItems()` の返り値を DevTools で確認する
- **Then**: 5 週月の `_calcMaxItems()` 返り値が 6 週月より大きい（セルが高くなった分だけ表示件数が増える）
- **And**: 5 週月で予定が少なかった日のセルが 6 週月表示時より背が高い

### AC5.19 FR-7 変更後も月 DnD・`+N more`・検索が正常動作する（第 5 版新規: NFR-3 の受入基準）

- **Given**: 5 週月（2026 年 6 月）を月ビューで表示している
- **When**: ① 月 DnD で予定をドラッグ&ドロップする / ② `+N more` をクリックしてポップオーバーを開く / ③ 検索フローティング一覧で予定を検索する
- **Then**: ① DnD が正常に完了し予定の日付が正しく更新される
- **And**: ② ポップオーバーが開き非表示予定が正しく表示される（件数が正しい）
- **And**: ③ 検索結果が正しいセルに対応して表示される

---

## 6. 検証項目・テストシナリオ

### 6.1 セル高固定の確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 予定 0 件の日と 10 件の日を同月に並べる | 月ビューを表示して DevTools で高さを確認 | 両セルの `getBoundingClientRect().height` が同値 |
| 予定が多い行と少ない行の比較 | DevTools で `.kc-month-week` の高さを比較 | 全 6 行が同じ高さを持つ |
| セルに chip が収まりきらない状態 | DevTools で `.kc-month-cell` の overflow を確認 | `overflow: hidden` により chip がクリップされ、セルは伸びない |

### 6.2 `_calcMaxItems()` の動的算出確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 通常ウィンドウサイズ | コンソールで `KC.RenderMonth._calcMaxItems()` を呼ぶ（※公開されている場合） | セル高に基づいた整数値が返る |
| ウィンドウを縦方向に縮める | リサイズ後に月ビューを再描画 | セル高が縮んだ分だけ maxItems が減少する |
| ウィンドウを縦方向に広げる | リサイズ後に月ビューを再描画 | セル高が増えた分だけ maxItems が増加する |

### 6.3 `+N more` との連携確認（第 4 版更新）

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| セル高固定後の `+N more` 表示（時間予定のみ超過） | 時間予定が多い日の月ビューを確認 | `+N more` が表示され、ポップオーバーが開く |
| `N` の値の整合性（時間予定のみ） | `+N more` の数字を確認 | N = 時間予定の全件数 − 表示 chip 数 |
| 終日バーが多い日の `+N more` | 終日バーが `maxItems - 1` を超える日の月ビューを確認 | `+N more` の `N` に終日超過分が加算されている |
| span バーが多い日の `+N more`（第 2 版新規） | 日跨ぎ時間予定が span バー上限を超える日の月ビューを確認 | `+N more` の `N` に span バー超過分が加算されている |
| `+N more` のセル内可視性確認（第 2 版新規） | セル高 156px・イベント 9 件（終日 2 + span 2 + 単日 5）の日（k/891: 2026-05-25）を月ビューで表示 | `+N more` がセル高内に完全に収まっている（bottom ≦ cell bottom）。DevTools で確認 |
| `+N more` クリックで隠れ予定を確認（第 2 版新規） | 上記セルの `+N more` をクリック | ポップオーバーに終日超過 + span 超過 + 時間予定超過の合計件数がすべて表示される（表示件数 = `+N` の N と一致） |
| ポップオーバー内の終日超過分表示 | 終日バー超過のある日の `+N more` クリック | ポップオーバーの一覧に終日超過予定が含まれ、終日バー形式で表示される |
| span バーのみの列で `+N more` が最終スロット+1 に表示される（第 4 版改訂） | k/891 の 2026-05-26（span バーのみ・usedSlots=2・単日予定 0 件）を月ビューで表示 | DevTools で `.kc-month-more` の top ≈ 83px（32+51）。span バーより下に位置している。`+N more` の下側（83〜156px）に余白が出る |
| 単日予定ありの列で `+N more` が chip 群直後に表示される（第 4 版改訂） | chip が表示されているセルの `+N more` の位置を確認 | chip 群の直後に `+N more` が表示されている（chip より上に表示されない）。余白は `+N more` より下に集まる |
| バー・chip がなく `+N more` のみのセル | `_calcMaxItems()=0` 相当の極小セルで隠れ予定あり | `+N more` が dateline 直下（spacer なし）に表示される |

### 6.4 リサイズ・全画面切替の再計算確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| ウィンドウリサイズ後の再計算 | 月ビュー表示中にウィンドウを縦方向に縮め、200ms 待つ | chip 数が更新される（セル高が縮んだ分だけ `+N more` に集約される） |
| ウィンドウリサイズ後の再計算（拡大） | 月ビュー表示中にウィンドウを縦方向に広げ、200ms 待つ | chip 数が増加する（セル高が増えた分だけ表示可能件数が増える） |
| 全画面 ON → 月ビュー確認 | 全画面ボタンをクリックして確認 | 全画面セル高に合わせて chip 数が変わる |
| 全画面 OFF → 月ビュー確認 | 全画面を解除して確認 | 通常セル高に合わせて chip 数が戻る |
| 週ビュー中のリサイズ | 週ビュー表示中にウィンドウをリサイズ | `placeMonthEvents()` が実行されない（コンソールログ等で確認） |
| debounce の確認 | 200ms 以内に連続リサイズしてから停止 | 停止後 200ms 経過後に 1 回だけ再描画される（連続リサイズ中は再描画しない） |

### 6.5 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| 週ビュー | `REQ_month-view.md §4` 関連 AC および `REQ_allday-bar-redesign.md §4` の全 AC が合格 |
| 月ビュー基本機能 | `REQ_month-view.md §4` の AC4.1〜AC4.25 が合格 |
| `+N more` ポップオーバー | `REQ_month-overflow-popup.md §7` の AC7.1〜AC7.15 が合格 |
| 月ビュー DnD | `REQ_month-dnd.md` の全 AC が合格 |

### 6.7 週行数動的化の確認（第 5 版新規: FR-7）

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 5 週月（2026/6）の行数確認 | 2026 年 6 月を月ビューで表示し DevTools で確認 | `.kc-month-week` が 5 つ。`--kc-month-week-count: 5` が設定されている。7/5〜7/11 セル行が存在しない |
| 6 週月（2026/8）の行数確認 | 2026 年 8 月を月ビューで表示し DevTools で確認 | `.kc-month-week` が 6 つ。`--kc-month-week-count: 6` が設定されている |
| 4 週月の行数確認（存在確認）| 4 週で収まる月（例: 2026 年 2 月: 2/1=日曜日。weekCount=4）を表示 | `.kc-month-week` が 4 つ |
| 5 週月での `_calcMaxItems()` 増加確認 | 6 週月と 5 週月で同一ウィンドウサイズでの返り値を比較 | 5 週月の maxItems が 6 週月より大きい値になっている |
| 月送り時の行数更新確認 | 前月 / 翌月ナビゲーションで 6 週月 → 5 週月 → 6 週月と切り替える | 切り替えのたびに行数が正しく変化し、余分な行が残存しない |
| 週行数変化後のリサイズ連携 | 5 週月で表示中にウィンドウをリサイズする（200ms 以上待機） | `placeMonthEvents()` が再実行され chip 数が更新される（FR-5 経路が有効）|
| 5 週月で DnD が正常動作する | 2026 年 6 月で予定をドラッグ&ドロップ | 正しいセルに移動し、日付が正しく更新される（§7.12 リスク確認）|
| 5 週月で `+N more` ポップオーバーが正常動作する | 2026 年 6 月で `+N more` をクリック | ポップオーバーが開き、件数・予定内容が正しい（§7.12 リスク確認）|

### 6.6 実機確認（SAML 認証環境）（第 4 版更新）

1. `plugin/dist/plugin.zip` を kintone（bushiroad-group.cybozu.com）に手動アップロードする
2. 検証アプリ（k/891/）の月ビューで予定が多い日（3 件以上）の行高を確認する
3. 予定が少ない行（0〜1 件）と多い行（5 件以上）の高さが均一であることを目視確認する
4. セル高固定修正後も `+N more` クリックでポップオーバーが表示されることを確認する
5. **2026-05-25 のセル**（終日バー 2 本 + span バー 2 本 + 単日時間予定 5 件）で以下を確認する（第 2 版新規）:
   a. バー合計が `maxItems - 1` 本以下に制限されていること
   b. `+N more` がセル内に完全に収まって可視表示されること（セル底辺でクリップされていないこと）
   c. `+N more` の N が隠れた件数（終日超過 + span 超過 + 単日超過）の合計と一致すること
   d. `+N more` クリックで隠れた全件がポップオーバーに表示されること
   e. `+N more` の top が概ね 110px 付近であること（DevTools で確認）。`+N more` の下側にセル余白が集まっていること（第 4 版新規）
6. **2026-05-26 のセル**（span バーのみ・usedSlots=2・単日予定 0 件）で以下を確認する（第 4 版改訂）:
   a. `+N more` が span バーより下に位置していること（目視確認）
   b. DevTools で `.kc-month-more` の top が概ね 83px 付近であること
   c. `+N more` の下側（83〜156px 相当）に余白が出ていること（`+N more` とバーの間には余白がないこと）
7. span バーのない通常セル（chip 2 本のみ）で `+N more` が chip 群の直後（top ≈ 86px）に表示されることを確認する（第 4 版改訂）
8. ウィンドウリサイズ後（200ms 以上経過後）に chip 数が更新されることを確認する
9. 全画面切替（ON / OFF 両方向）後に chip 数が更新されることを確認する
10. 全画面切替後も `+N more` クリックでポップオーバーが表示されることを確認する（`REQ_month-overflow-popup.md §8.7` の確認事項を再確認）

---

## 7. 未確定事項・リスク・前提

> **本版（第 5 版 / 2026-06-11 更新）時点での未確定事項: 0 件**
>
> 第 1〜4 版の未確定事項はすべて解決済み。第 5 版追加（FR-7: 週行数動的化）はユーザー確認済み（2026-06-11）。リスク §7.12 は FR-7 実施時に builder が確認・対処するべき技術リスク（仕様は確定）。

### 解決済み事項（第 1 版: 2026-06-10 確定）

| 旧番号 | 項目 | 確定内容 | 反映箇所 |
|---|---|---|---|
| §7.1 | 終日バーの件数制限 | **選択肢 A（今回同時対応）**: `placeMonthAlldayEvents()` に件数上限を設け、超過分を `+N more` にカウントしポップオーバーにも含める | FR-4、§4.2 `placeMonthAlldayEvents()` / `placeMonthEvents()` 行、AC5.8 |
| §7.2 | CSS 実装方式 | **builder の技術判断に委ねる**: 3 案を併記し、副作用（`.kc-month-ad-events` 絶対配置への影響・DnD ghost クリップ）が最も少ない案を選択する。判断基準は §7.2 参照 | §4.1 CSS 修正表 |
| §7.3 | リサイズ時の再実行 | **選択肢 A（対応する）**: `window` の `resize` イベントに debounce 200ms で `placeMonthEvents()` を再実行。kintone 全画面切替時も再実行。月ビュー非表示時は発火しない | FR-5、§4.2 `placeMonthEvents()` / `refresh()` 行、AC5.4 / AC5.9 / AC5.10 |

### 解決済み事項（第 2 版: 2026-06-10 確定）

| 番号 | 項目 | 確定内容 | 反映箇所 |
|---|---|---|---|
| §7.7 | span バーの件数制限方針 | **span バーにも `spanLimit` 制限を設ける**: `spanLimit = maxItems - effectiveLaneCount - 1`（最低 0）。超過 span バーはポップオーバーに合算する | FR-4 改訂、§4.2 `placeMonthTimedSpanEvents()` 行、AC5.8 改訂・AC5.12 |
| §7.8 | `+N more` 可視性の優先度 | **バー表示優先度を明文化**: 1 本目バー > `+N more` 行 > 2 本目以降バー。hiddenCount > 0 のセルでは `+N more` を必ず可視表示する | FR-6、AC5.13・AC5.14 |

### 解決済み事項（第 3 版: 2026-06-10 確定 → 第 4 版で一部廃止）

| 番号 | 項目 | 確定内容 | 反映箇所 | 備考 |
|---|---|---|---|---|
| §7.10 | `+N more` の表示位置固定方針 | ~~**CSS で `margin-top: auto` を追加**~~（**第 4 版で廃止**）: floor 端数余白がバーと `+N more` の間に集積して目立つ問題が発覚。第 4 版の §7.11 に置き換えた | 廃止 | FR-6 改訂で上書き |

### 7.12 [リスク] FR-7 実施後の 42 セル前提ロジックへの影響（第 5 版新規）

FR-7 によりグリッドのセル数が 28〜42（4〜6 週 × 7 日）に変動する。以下のロジックが 42 固定を前提としている場合、5 週月（35 セル）や 4 週月（28 セル）で誤動作する可能性がある。builder は実装前に各関数のセル数前提を確認し、問題があれば `weekCount * 7` ベースに修正すること。

- **セル生成ループ**: `i < 42` のような固定値ループが存在する場合は `i < weekCount * 7` に変更する
- **月 DnD のセル index 計算**: ドラッグ元・ドラッグ先のセル index が正しく対応する日付に解決されることを確認する。index ずれが発生する場合は `weekCount` ベースで再計算する
- **`+N more` ポップオーバーの予定登録**: 非表示予定をセル index で管理している場合、35 セル月で index 35〜41 の参照が発生しないことを確認する
- **検索フローティング一覧**: セル座標を使う処理が `weekCount * 7` の範囲内で動作することを確認する
- **前後月の日付埋め**: 末尾週スキップ時に翌月の日付が 0 個のグレー日付セルが生成されないことを確認する（全翌月の週はセル自体を生成しない）

これらは実機確認（§6.7 および §6.6 の実機確認手順に追加）が必須である。

### 解決済み事項（第 4 版: 2026-06-10 確定）

| 番号 | 項目 | 確定内容 | 反映箇所 |
|---|---|---|---|
| §7.11 | `+N more` の描画位置方針（第 3 版 §7.10 の置き換え） | **最終スロット+1 方式**: `placeMonthTimedEvents()` を `usedSlots > 0 かつ timedEvents.length === 0` でも spacer を挿入するよう変更。`+N more` は `dateline + spacer` 直後に配置され、余白はセル最下端に逃げる。CSS 変更不要 | FR-6 改訂、§4.2 `placeMonthTimedEvents()` / `placeMonthEvents()` 行、AC5.15 改訂、§8.2〜§8.4 |

### 7.2 [前提・builder への判断基準] CSS 実装方式

builder は以下の 3 案から実機・DevTools で副作用を確認し、最適な案を選択すること。選択した案と理由をコミットメッセージまたはレビュー担当への報告に記載すること。

**案 A: `.kc-month-week` に `overflow: hidden` のみ追加**

```css
.kc-month-week {
  overflow: hidden;  /* 追加 */
}
/* .kc-month-cell の変更なし（grid アイテムはデフォルト stretch） */
```

最小変更。ただし `.kc-month-ad-events` が `position: absolute` で `.kc-month-week` 基準のため、バーが週行の `overflow: hidden` でクリップされないか確認が必要。

**案 B: `.kc-month-cell` に `height: 0` を追加**

```css
.kc-month-cell {
  min-height: var(--kc-month-cell-min-h, 90px);  /* 既存のまま */
  height: 0;                                      /* 追加 */
  /* overflow: hidden は既存のまま */
}
```

grid 行の `1fr` 割り当て高さが `height: 0` より優先され、`min-height` が下限を保証する。セル単位で `overflow: hidden` が効く。

**案 C: `.kc-month-week` に `min-height: 0` + `overflow: hidden`、`.kc-month-cell` に `height: 100%` を追加**

```css
.kc-month-week {
  min-height: 0;     /* 追加 */
  overflow: hidden;  /* 追加 */
}
.kc-month-cell {
  height: 100%;      /* 追加 */
}
```

grid アイテムの最小サイズ制約を週行レベルで解除し、セルを週行高さに追従させる。

**判断基準（優先順）**:

1. 全 6 行の高さが均一になること（AC5.1）
2. `.kc-month-ad-events`（`position: absolute`）の終日バーが正しく表示されること
3. DnD ghost chip（`.kc-event--ghost`）がドラッグ中にクリップされないこと（§7.5 参照）
4. CSS の変更量が少ないこと

### 7.4 [前提] `overflow: hidden` はセル外クリックに影響しない

`.kc-month-cell` の `overflow: hidden` は表示クリップであり、クリックイベントのヒットテストには影響しない。クリップ領域外の要素はクリックできなくなるが、ポップオーバー（`document.body` に append される `position: fixed` 要素）は影響を受けない。

### 7.5 [リスク] DnD ゴーストのクリップ問題

月ビュー DnD では `.kc-event--ghost` クラスの chip がドラッグ中に表示される（`placeMonthEvents()` のクリア処理で `not(.kc-event--ghost)` が除外されている: `src/kc-calendar.js:4128`）。セル高固定により ghost chip が `overflow: hidden` でクリップされる可能性がある。

DnD 実機確認を修正後に必須とすること。クリップが問題になる場合、ghost は `position: absolute` に変更するか、ghost 要素を `.kc-month-ad-events` レイヤに配置する等の対応が必要になる可能性がある。

### 7.6 [リスク] `_calcMaxItems()` がリサイズ間に古い値を保持する

`_calcMaxItems()` は `placeMonthEvents()` 呼び出し時にその場でセル高を取得する設計（キャッシュなし）のため、`placeMonthEvents()` が再実行されるタイミング次第では古いセル高で計算される可能性がある。`requestAnimationFrame` ラップ（`src/kc-calendar.js:4224`）が既に1フレーム待機しているため、通常は問題が生じない見込み。

### 7.9 [前提] `placeMonthTimedSpanEvents` の `spanLimit` 計算（第 2 版新規）

`spanLimit` は `placeMonthEvents()` 内で以下のように算出すること:

```
spanLimit = Math.max(0, maxItems - alldayResult.effectiveLaneCount - 1)
            ↑ -1 は +N more 行の最低 1 枠確保
```

この値を `placeMonthTimedSpanEvents()` に渡し、`span バーの lane 番号 >= spanLimit` のバーは描画しない。超過バーは `hiddenSpanByCol`（7 要素配列）として返却し、`placeMonthEvents()` 内で `hiddenAllday` とともに `hiddenCount` に加算する。

---

## 8. 想定 UX / シーケンス

### 8.1 修正後のセル描画フロー（第 2 版更新）

```
[placeMonthEvents() 実行]
    ↓
[_calcMaxItems() でセル実高から maxItems を算出]
    ← CSS によりセル高はグリッド均等分割の値に固定されている
    ← よって maxItems の計算結果が毎回安定する
    ↓
[placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, maxItems)]
    ← alldayLimit = maxItems - 1 まで終日バーを描画
    ← 超過分を hiddenByCol として返す
    ← alldayResult.effectiveLaneCount に描画した終日バーのレーン数を格納
    ↓
[spanLimit = max(0, maxItems - alldayResult.effectiveLaneCount - 1)]  ← 第 2 版新規
    ↓
[placeMonthTimedSpanEvents(weekEl, weekYMD, spanEvents, alldayResult.effectiveLaneCount, spanLimit)]
    ← spanLimit まで span バーを描画（超過分は hiddenSpanByCol に記録）  ← 第 2 版新規
    ← colLaneCounts に終日 + span の合計スロット数を格納
    ↓
[placeMonthTimedEvents(cellEl, timedEvents, usedSlots, maxItems)]
    ← usedSlots（終日 + span 占有分）を引いた残り件数だけ chip を追加
    ← chip が maxItems に達したら追加を打ち切る
    ↓
[hiddenCount = (dayTimedEvents.length - chipsAdded)
             + hiddenAllday.length
             + hiddenSpan.length]                                       ← 第 2 版: span 超過も加算
[hiddenCount > 0 なら applyOverflow(cellEl, hiddenCount, [...hiddenAllday, ...hiddenSpan, ...hiddenTimed])]
    ← +N more ラベルを追加
    ← KC.MonthOverflowPopup に非表示予定（終日 + span 超過 + 時間予定）を登録
    ← +N more は必ず spacer(≦ (maxItems-1)本分) + chip(0本以上) の直後に置かれ、
       バー合計 (allday + span) ≦ maxItems-1 の制約によりセル内に収まる  ← FR-6 保証
    ↓
[セル内表示が overflow: hidden でクリップされる]
    ← セル高は変動しない

[window 'resize' イベント（debounce 200ms）または全画面切替検知]  ← FR-5
    ↓
[KC.State.view === 'month' を確認]
    ← 月ビュー以外ならスキップ
    ↓
[requestAnimationFrame → placeMonthEvents() 再実行]
    ← 新しいセル高に基づいて maxItems が再計算される
```

### 8.2 修正後の見た目イメージ（第 4 版更新）

```
月グリッド（6行均等）
+----------+----------+----------+
| 月 1     | 月 2     | 月 25    |
| ■■■会議  | ■■■開発  | ■■■終日A |
| 10:00 朝 | 09:00 週 | ■■■終日B |
| +3 more  | +2 more  | +7 more  | ← more はバー群の直後（最終スロット+1）
|  [余白]  |  [余白]  |  [余白]  | ← floor 端数の余白はセル最下端に逃げる
+----------+----------+----------+  ← 全行同じ高さ
| 月 26    | 月 27    | 月 28    |
| [spacer] |          |          |  ← chip なしでも usedSlots 分の spacer を挿入
| ======span バー====|          |  ← 絶対配置（y=32+4+n*27）
| +2 more  |          |          | ← spacer 直後（最終スロット+1）に表示
|  [余白]  |          |          | ← 余白はセル最下端側
+----------+----------+----------+   バーより上に来ない（FR-6 §2.6 解消）
```

### 8.3 実機検証再現シナリオ（修正後の期待動作・2026-05-25）

**条件**: k/891、2026-05-25、セル高 156px、maxItems=3

```
alldayLimit = 3 - 1 = 2  → 終日バー 2 本表示
spanLimit   = max(0, 3 - 2 - 1) = 0  → span バー 0 本表示（全件 hiddenSpan に記録）
usedSlots   = 2 (allday) + 0 (span) = 2
remaining   = 3 - 2 = 1  → chip 1 本表示（時間予定先頭 1 件）
hiddenCount = 0 (allday) + 0 (span) + 2 (span超過) + chip 非表示分 ※実際の件数は検証時に確認
spacerH     = 2×24 + 1×3 = 51px
more の top = 32 (dateline) + 51 (spacer) + 27 (chip 1 本) = 110px  ← 最終スロット+1
more の bottom ≈ 110 + 20 = 130px  < セル高 156px  → セル内に収まる ✓
余白        = 156 - 130 = 26px がセル最下端側に出る（バーと more の間には余白なし）
```

### 8.4 実機検証再現シナリオ（修正後の期待動作・2026-05-26、第 4 版更新）

**条件**: k/891、2026-05-26（span バーのみの列・usedSlots=2・単日時間予定 0 件）、セル高 156px

```
【修正前（問題あり）】
timedEvents.length === 0 → placeMonthTimedEvents 内で spacer 挿入なし
more は dateline 直下（top ≈ 32px）に配置
span バーは絶対配置（top ≈ 32+4+2×27 = 90px 付近）
結果: more（y=32）< span バー（y≈90）→ バーより上に more が表示される（視覚的逆転）

【修正後（FR-6 最終スロット+1 方式）】
timedEvents.length === 0 でも usedSlots=2 > 0 なら spacer を挿入
spacerH = 2×24 + 1×3 = 51px
more の top = 32 (dateline) + 51 (spacer) = 83px  ← 最終スロット+1
span バーの bottom ≈ 90 + 24 = 114px
more（top=83）の下端 ≈ 83 + 20 = 103px  < span バー bottom(114px) → 視覚的に more がバーの上端より上だが、
  span バーは絶対配置レイヤ（z-index:1）で more（z-index:2）より後ろに描画されるため、
  クリック・視認性は確保される。more の top が span バー top（≈90px）より上に来ても
  z-index 優先で more テキストが読める。
余白        = 156 - 103 = 53px がセル最下端側に出る（more の下に余白が集まる）✓

【第 3 版（廃止）との比較: margin-top: auto 方式】
more の top ≈ 156 - 20 = 136px → バーとの間に 136 - (90+24) = 22px の余白が視覚的に目立った
第 4 版では more が 83px に上がり余白は more の下に移動 → バーと more が詰まって見える問題解消
```

### 8.5 週行数動的化後の見た目イメージ（第 5 版新規・FR-7）

```
【5 週月（2026 年 6 月）】
月グリッド（5 行均等）← 6 週月より各行が高い
+----------+----------+----------+----------+----------+----------+----------+
| 5/31(日) | 6/1(月)  | 6/2(火)  | 6/3(水)  | 6/4(木)  | 6/5(金)  | 6/6(土)  | ← 第 1 週
+----------+----------+...
| 6/7      | 6/8      | ...      | 6/12     | 6/13     |           ← 第 2 週
+----------+----------+...
| ...      |                                                        ← 第 3・4 週
+----------+----------+...
| 6/28     | 6/29     | 6/30     | 7/1      | 7/2      | 7/3      | 7/4      | ← 第 5 週
+----------+----------+----------+----------+----------+----------+----------+
（第 6 行 = 7/5〜7/11 → 描画しない ✓）

【6 週月（2026 年 8 月）との比較】
5 週月: セル高 ≈ grid高÷5 → maxItems が大きくなる（例: 5 → 6 件表示可能）
6 週月: セル高 ≈ grid高÷6 → maxItems が小さくなる（例: 4 件表示可能）
```

**月送り時のフロー（FR-7 追加分）**:

```
[月ナビゲーション: 前月 / 翌月 クリック]
    ↓
[グリッド再描画関数が呼ばれる]
    ↓
[weekCount = ceil((startDayOffset + daysInMonth) / 7) を算出]
    ↓
[.kc-month-grid に --kc-month-week-count: weekCount を設定]
    ← CSS が即時 grid-template-rows を更新
    ↓
[weekCount * 7 セル分の DOM を生成（末尾週が全翌月の場合はその 7 セルを生成しない）]
    ↓
[requestAnimationFrame → placeMonthEvents() を実行]
    ← 新しいセル高（grid高 ÷ weekCount）から maxItems を算出
    ← FR-5 の再計算経路がそのまま機能する
```

---

## 9. 影響範囲

### 9.1 影響あり

| 対象 | 影響内容 | 対応 |
|---|---|---|
| 月ビュー全般 | セル高固定により chip 数が変わりうる | `REQ_month-view.md §4` リグレッション確認 |
| `+N more` ポップオーバー | `N` の算出が終日超過分・span 超過分も加算されるよう拡張される | `REQ_month-overflow-popup.md §7` 全 AC の実機確認 |
| `placeMonthAlldayEvents()` の呼び出しシグネチャ | `maxItems` 引数を追加する（実装済み） | 呼び出し元（`placeMonthEvents()`）も合わせて修正済み |
| `placeMonthTimedSpanEvents()` の呼び出しシグネチャ（第 2 版新規） | `spanLimit` 引数を追加する | 呼び出し元（`placeMonthEvents()`）も合わせて修正が必要 |
| 月ビュー DnD | ghost chip がクリップされる可能性 | `REQ_month-dnd.md` 実機確認（§7.5 参照）|
| `window` resize イベント | debounce ハンドラの追加で他のリスナーと競合しないか | 登録・解除のライフサイクルを `KC.RenderMonth` の init / destroy と合わせて管理 |
| グリッドセル数（第 5 版 FR-7） | 週行数が 4〜6 週に変動し、セル数が 28〜42 に変化する | NFR-3 に記載の 42 セル前提ロジックを `weekCount * 7` ベースに移行。§7.12 のリスクリストを参照 |
| `_calcMaxItems()` の返り値（第 5 版 FR-7） | 行数減少によりセル高が増加し maxItems が増加する | 既存の FR-5 再計算経路で自動吸収（追加対応不要）|
| 月 DnD のセル index 計算（第 5 版 FR-7） | 35 セル月で index 35〜41 への参照が発生する可能性 | builder が実機確認のうえ修正。§7.12 参照 |
| `+N more` ポップオーバーの予定登録（第 5 版 FR-7） | セル index が 35 未満の範囲に収まるかを確認する必要がある | イベントデータのフィルタリングが `weekCount * 7` セル範囲内で完結することを確認する |

### 9.2 影響なし

| 対象 | 理由 |
|---|---|
| 週ビュー | `.kc-month-*` クラスのみ修正するため影響なし |
| 日ビュー | 同上 |
| `KC.MonthOverflowPopup` の内部ロジック | 呼び出し元（`applyOverflow()`）の変更なし |
| kintone REST API / cursor API | データ取得ロジックの変更なし |

---

## 10. 関連資料

| 資料 | 関連箇所 |
|---|---|
| `src/kc-calendar.css:818-836` | `.kc-month-week` / `.kc-month-cell` — 修正対象 CSS |
| `src/kc-calendar.css:810-815` | `.kc-month-grid` — `grid-template-rows: repeat(6, 1fr)` の定義（**第 5 版 FR-7 で動的化対象**）|
| `src/kc-calendar.js:3789-3801` | `_calcMaxItems()` — 表示件数動的算出 |
| `src/kc-calendar.js:3989-4036` | `placeMonthAlldayEvents()` — 終日バー配置・件数制限（FR-4 実装済み）|
| `src/kc-calendar.js:4046-4089` 相当 | `placeMonthTimedSpanEvents()` — 日跨ぎ span バー配置（第 2 版 FR-4 で件数制限追加）|
| `src/kc-calendar.js:4046-4089` 相当 | `placeMonthTimedEvents()` — chip 配置と maxItems 上限 |
| `src/kc-calendar.js:4097-4106` 相当 | `applyOverflow()` — `+N more` 生成 |
| `src/kc-calendar.js:4112-4195` 相当 | `placeMonthEvents()` — 配置オーケストレーター |
| `src/kc-calendar.js:4221-4226` | `requestAnimationFrame` ラップ — セル高確定待ち |
| `plugin/src/js/desktop.js:4143-4159` | `_calcMaxItems()` — src と同内容 |
| `plugin/src/js/desktop.js:4410-4490` | `placeMonthAlldayEvents()` — FR-4 実装済み（maxItems 制限・hiddenByCol 返却）|
| `plugin/src/js/desktop.js:4502-4535` | `placeMonthTimedSpanEvents()` — 第 2 版 FR-4 修正対象（件数制限なし → spanLimit 追加）|
| `plugin/src/js/desktop.js:4627-4732` | `placeMonthEvents()` 等 — src と同内容 |
| `requirements/REQ_month-overflow-popup.md §3.5` | `+N more` N の算出方法・終日バー超過の後送り方針（本要件で解消）|
| `requirements/REQ_month-view.md §7.1` | `--kc-month-cell-min-h: 90px` の確定値と根拠 |
| `requirements/REQ_month-view.md §7.2` | 全画面モード時の月グリッド高 CSS |
| `requirements/REQ_month-dnd.md` | DnD リグレッション確認対象 |

---

*本要件定義書: 確定版 第 5 版（2026-06-11 確定）。未確定事項 0 件。builder は §3 の全要件（FR-1〜FR-7、NFR-1〜NFR-3）および §4 の修正対象箇所を入力として実装を開始すること。第 5 版の追加実装は FR-7（週行数動的化）: ① `.kc-month-grid` に `--kc-month-week-count` カスタムプロパティを動的設定 / ② CSS で `grid-template-rows` と `min-height` を `var(--kc-month-week-count, 6)` に変更 / ③ セル生成ループを `weekCount * 7` ベースに変更。CSS 実装方式（§7.2 の 3 案）は builder が実機確認のうえ最適案を選択し、コミットメッセージに選択理由を記載すること。実装前に §7.5（DnD ghost クリップ）および §7.12（42 セル前提ロジック影響）のリスクを把握し、§6.7 の検証シナリオを DnD・ポップオーバー・検索すべてで実機確認すること。*
