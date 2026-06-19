# REQ_month-maxitems-too-few: 月ビュー 日毎の最大表示件数が少なすぎる問題の修正

**文書番号**: REQ_month-maxitems-too-few
**作成日**: 2026-06-19
**最終更新日**: 2026-06-19（初版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js`, `plugin/src/css/desktop.css`
**対象ファイル（従／同期対象）**: `src/kc-calendar.js`, `docs/kc-calendar.js`
**ステータス**: 初版・未確定事項あり（§7 参照）

---

## 改訂履歴

| 版 | 日付 | 変更概要 |
|---|---|---|
| 初版 | 2026-06-19 | 新規作成。コード調査に基づく仮説裏取りと修正方針の設計。 |

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
9. [既存要件（REQ_month-cell-fixed-height.md）との関係](#9-既存要件req_month-cell-fixed-heightmdとの関係)
10. [関連資料](#10-関連資料)

---

## 1. 背景・目的

### 1.1 ユーザー症状

「月ビューの日付セルにまだスペースがあるのに、早く `+N more` が表示される。表示できる件数が少なすぎる。」

具体的には、目視でセルの下半分が空白になっているにもかかわらず予定の表示が打ち切られ、`+N more` に集約されてしまう。

### 1.2 本要件の目的

`_calcMaxItems()` が **always** `moreH`（`+more` 行の高さ）を差し引いた空き領域を基準に最大件数を算出しているため、実際に overflow が発生しないセルでも表示容量が 1 件分少なくなっている問題を解消する。

本来あるべき挙動（Google カレンダー方式）:
- そのセルの全アイテム（終日バー + span バー + 単日 chip）が **容量内に収まるなら全部表示し、`+more` は出さない**
- **収まらない時だけ**、最終スロットを `+more` に置き換える（`+more` がスロットを 1 つ消費する）

### 1.3 関連する既存要件

本要件の変更は以下の既存確定要件と密接に関連する。それぞれ §9 で整合性を詳述する。

- `REQ_month-cell-fixed-height.md`（第 5 版）: FR-1〜FR-7、セル高固定・表示件数動的算出の根幹
- `REQ_month-overflow-spacer-fix.md`（第 3 版）: usedSlots 過大計上の修正（localMax 中間案を実装済み）

---

## 2. 現状分析（調査結果）

### 2.1 仮説裏取り: `_calcMaxItems()` が常に `moreH` を引いている（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 4889

```javascript
var available = cellH - dateHeadH - padding - moreH;  // ← 常に moreH を差し引く
// ...
var max = Math.floor(available / PITCH);
```

**結論: 仮説は事実。** `moreH` は overflow の有無に関わらず**常に差し引かれる**。
overflow しないセルでも `available` が `moreH` 分だけ小さく計算され、`maxItems` が実容量より 1 件少なくなる。

#### 数値例（実測値で計算）

| パラメータ | 値 |
|---|---|
| cellH（5 週月、1080px 画面高） | 約 170px |
| dateHeadH（dateline 実測） | 約 28px |
| padding（セル上下） | 4px |
| moreH（ダミー実測） | 約 21px（height 20px + marginTop 1px） |
| PITCH（BAR_H+BAR_GAP） | 23px（20+3） |

```
available（現状） = 170 - 28 - 4 - 21 = 117px
maxItems（現状）  = floor(117 / 23) = 5

available（修正後）= 170 - 28 - 4      = 138px
baseCapacity      = floor(138 / 23) = 6
```

overflow なしのセルは 6 件表示できるのに、現状は 5 件で打ち切られ `+1 more` になる。

#### 影響の大きさ

- 全セルで 1 件分の表示が損なわれている
- 5 週月・6 週月を問わず一律に発生する
- 「ちょうど収まる件数」のセルが必ず `N-1 件 + +1 more` の形になる

### 2.2 `alldayLimit` による 1 件追加の二重控除（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 5201

```javascript
var alldayLimit = (maxItems != null) ? Math.max(0, maxItems - 1) : Infinity;
```

`alldayLimit = maxItems - 1` の `-1` は「`+more` 行のための 1 枠確保」として設計されている（`REQ_month-cell-fixed-height.md` FR-4 §7.9 より）。

しかし `_calcMaxItems()` がすでに `moreH` を差し引いて `maxItems` を算出しているため、**`+more` 枠の控除が二重になっている**。

- `_calcMaxItems()` の `-moreH`: more 行のスペースを先取り控除 → `maxItems` が 1 件少ない
- `alldayLimit = maxItems - 1`: さらに終日バーを 1 件減らす

**結果**: 終日バーが 1 本しかないセルで `alldayLimit = maxItems - 1 = 4`（本来 5 なら `alldayLimit = 5` でよいところ）となり、終日バー表示可能数も不当に少なくなっている。

**ただし**: 現状 `alldayLimit = maxItems - 1` の `-1` は「chip を 1 件以上確保するため」の設計意図も併記されている。修正後も chip への最低 1 枠保証は必要なため、方針の再整理が必要（§7.1 を参照）。

### 2.3 `spanLimit` の設計（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 5286

```javascript
var spanLimit = (maxItems != null) ? maxItems : Infinity;
```

span バーの制限は `offsetLane >= spanLimit` で判定している（`plugin/src/js/desktop.js:5308`）。
`offsetLane` は 0 始まりなので `offsetLane >= maxItems` は「maxItems 本目以降を非表示」を意味する。これは `moreH` 控除の問題とは独立しているが、`maxItems` 自体が 1 件少ない影響を受ける。

### 2.4 `placeMonthTimedEvents()` の chip 表示枠計算（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 5400

```javascript
var remaining = maxItems - usedSlots;
```

chip の表示枠は `maxItems - usedSlots`。`more` 行の 1 枠はここでは控除されていない。
**chip overflow の判定は「total >= maxItems」** ではなく「`remaining <= 0`（= `usedSlots >= maxItems`）で打ち切る」方式。

`more` のスロット確保は `alldayLimit = maxItems - 1` （終日バー）と `placeMonthAlldayEvents` 側の件数制限によって行われており、chip 側には `more` 用の明示的控除はない。

### 2.5 padding の計算（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 4842

```javascript
var padding = 4;  // CSS: padding: 2px → 上下計 4px
```

CSS での `.kc-month-cell` の `padding` 設定が `2px` 上下の計 4px であることをコードと一致確認。過大見積もりや二重計上はなし。

### 2.6 `moreH` の実測方式（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 4868〜4887

```javascript
var moreH = 20;  // フォールバック
var dummyMore = document.createElement('div');
dummyMore.className = 'kc-month-more';
// ... visibility:hidden で in-flow 挿入して getBoundingClientRect
var mH = dummyMore.getBoundingClientRect().height;
if (mH > 0) {
  var moreMarginTop = 1;  // .kc-month-more: margin-top: 1px
  // ...
  moreH = mH + moreMarginTop;
}
```

`moreH` は CSS の height + margin-top の合計を実測する。フォールバック 20px + margin 1px = 21px。過大見積もりの懸念はない。

### 2.7 `PITCH` の実測方式（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 4847〜4864

`PITCH` はダミー chip 2 本の top 差分を実測。フォールバック `BAR_H + BAR_GAP = 23px`。こちらも適切。

### 2.8 セル高の取得（確認済み）

**ファイル**: `plugin/src/js/desktop.js`  
**行番号**: 4829

```javascript
var cellH = firstCell.getBoundingClientRect().height;
```

`min-height: 90px` と `height: 100%`（`REQ_month-cell-fixed-height.md` FR-1 の CSS 修正済み）により、セル高はグリッド均等分割値に固定されて正しく取得される。頭打ち・過小計測の問題なし。

### 2.9 `floor` による端数の影響（軽微・許容範囲）

```
例: available = 138px、PITCH = 23px
floor(138/23) = 6、端数 = 138 - 6*23 = 0px（ぴったり）

例: available = 140px
floor(140/23) = 6、端数 = 140 - 6*23 = 2px（2px の余白がセル下端に出る）
```

`floor` 切り捨てで 0〜22px の端数余白が生じるが、これは表示に影響しない許容範囲。整数件数への丸めとして適切。

### 2.10 usedSlots の過大計上（REQ_month-overflow-spacer-fix.md 問題との関連）

`REQ_month-overflow-spacer-fix.md`（現在 localMax 中間案が実装済み）で扱う「週共通 alldayLaneCount が終日バーのないセルの usedSlots に嵩上げされる」問題は、本要件の `moreH` 常時控除とは独立した別の「少なすぎ」要因である。

両者を比較すると:
- 本要件（`moreH` 常時控除）: **全セルに一律 -1 件** の影響（影響大）
- overflow-spacer-fix の残課題: 特定の週構成（終日バーあり週に span バーが存在する一部セル）で chip 枠が削減される（影響中・限定的）

本要件は全セルに影響する根本問題のため、先行して対処する。

### 2.11 現状コードにおける「少なすぎ」要因のまとめ

| 要因 | 影響範囲 | 影響度 | 本要件で対処 |
|---|---|---|---|
| `_calcMaxItems()` で `moreH` を常時控除 | 全セル | 大（常時 -1 件） | はい（FR-1） |
| `alldayLimit = maxItems - 1` の `-1` が `moreH` 控除後の maxItems に対して適用される | 終日バーのある全セル | 中（終日バーが追加 1 件減る） | はい（FR-2） |
| `spanLimit = maxItems` が同様に影響 | span バーのある週の全セル | 小〜中 | はい（FR-3 の整合で修正） |
| usedSlots 過大計上（overflow-spacer-fix 残課題） | 特定週構成のセル | 中（localMax で一部緩和済み） | いいえ（別 REQ） |
| PITCH・dateHeadH・padding の過大見積もり | なし（適切に実測） | なし | 対処不要 |

---

## 3. 要件

### 3.1 機能要件

#### FR-1: `_calcMaxItems()` を `baseCapacity` 算出に変更する

- `_calcMaxItems()` の返り値を、`moreH` を差し引かない **`baseCapacity`**（セル内に物理的に配置できる最大スロット数）とする
- 計算式変更: `available = cellH - dateHeadH - padding`（`moreH` を引かない）
- `baseCapacity = Math.floor(available / PITCH)`
- 関数名は `_calcMaxItems()` を維持し、返り値の意味のみを「more スロット控除後の件数」→「セルの物理収容スロット数」に変更する
- フォールバック（DOM 未構築時）は引き続き `MAX_CELL_ITEMS = 5` を返す

#### FR-2: overflow 判定をセルごとに行い、overflow 時のみ more スロットを確保する

以下の 2 段階で処理する:

**ステップ 1: `baseCapacity` を全セル共通で算出**（既存の `_calcMaxItems()` 呼び出し位置を維持）

**ステップ 2: セルごとの overflow 判定（`placeMonthEvents()` のセルループ内）**

```
total = usedSlots（終日 + span の実描画スロット数）
      + dayTimedEvents.length（その日の単日時間予定の全件数）

if (total <= baseCapacity):
    全件表示（more を出さない）
    alldayLimit = baseCapacity - 1 相当の最低 1 枠チップ確保 → 不要（全件収まるため制限は実効なし）
    spanLimit   = baseCapacity
    chipsAdded  = dayTimedEvents.length（全件）
    hiddenCount = 0
else:
    displaySlots = baseCapacity - 1  （最終スロットを more に充てる）
    displaySlots = Math.max(0, displaySlots)
    終日バー・span バー・chip をこの枠で制限し、超過分を more に集約
```

#### FR-3: `alldayLimit` / `spanLimit` を `baseCapacity` 基準に統一する

**現状**:
- `alldayLimit = maxItems - 1`（`moreH` 控除済み maxItems からさらに -1）
- `spanLimit = maxItems`（同上）

**修正後**:
- `alldayLimit = baseCapacity - 1`（more スロット確保のための -1。overflow が確定したセルのみ実効化）
  - ただし「overflow なしセルでは alldayLimit の -1 が実効にならない」ことを §7.1 の判断で確定する
- `spanLimit = baseCapacity`（`offsetLane < baseCapacity` を満たすもののみ描画）

**注意**: `alldayLimit = baseCapacity - 1` の `-1` は「chip を 1 件以上確保するため」の設計意図を維持する。overflow 確定セルでのみ有効になる（overflow なしセルでは全件収まるため `alldayLimit` の上限に達しない）。

#### FR-4: FR-6（最終スロット+1 方式）および FR-4（バー件数制限）との整合維持

- `REQ_month-cell-fixed-height.md` FR-6（chip 0 本でも `usedSlots > 0` なら spacer を挿入）の動作を変更しない
- spacer 高さの計算（`usedSlots * BAR_H + (usedSlots - 1) * BAR_GAP`）は変更しない
- `applyOverflow()` の呼び出しインターフェースは変更しない

#### FR-5: `+more` の可視性保証を修正後も維持する

- overflow 確定セル（`hiddenCount > 0`）では `+more` が必ずセル内に完全表示されること
- overflow 確定セルでは `displaySlots = baseCapacity - 1` を上限とすることで、`+more` の表示領域（1 スロット分）が確保される
- `+more` 要素の下端が `cellEl.getBoundingClientRect().bottom` を超えないこと

### 3.2 非機能要件

#### NFR-1: 既存 FR-6・FR-7・usedSlots 関連ロジックを壊さない

- `REQ_month-cell-fixed-height.md` の FR-6（最終スロット+1 方式）を維持する
- FR-7（週行数動的化）との組み合わせ（5 週月 vs 6 週月での `baseCapacity` 差異）が正しく動作すること
- `REQ_month-overflow-spacer-fix.md` の localMax 中間案（実装済み）を破壊しない

#### NFR-2: パフォーマンス影響なし

- `_calcMaxItems()` は `placeMonthEvents()` 冒頭で 1 回のみ呼ぶ構造を維持する（セルごとに呼ばない）
- overflow 判定は `placeMonthEvents()` の既存セルループ内に追加する（ループを増やさない）

---

## 4. 修正対象箇所一覧

### 4.1 JS 修正（`plugin/src/js/desktop.js`）

| 行番号 | 対象関数 | 変更内容 |
|---|---|---|
| 4889 | `_calcMaxItems()` | `available` の計算式から `- moreH` を削除。`available = cellH - dateHeadH - padding`に変更 |
| 4899 | `_calcMaxItems()` | 変数名コメントと `_log` メッセージを「baseCapacity」に合わせて更新（機能変更ではなく可読性） |
| 5201 | `placeMonthAlldayEvents()` | `alldayLimit` の計算を `baseCapacity - 1` に変更（名称が `maxItems` から `baseCapacity` に変わる以外は同じ式） |
| 5286 | `placeMonthTimedSpanEvents()` | `spanLimit` を `baseCapacity` に変更（名称のみの変更） |
| 5475 | `placeMonthEvents()` | `_calcMaxItems()` の返り値を `var baseCapacity = _calcMaxItems();` として受け取る（変数名変更） |
| 5509（alldayResult 呼び出し） | `placeMonthEvents()` | `placeMonthAlldayEvents()` への引数を `baseCapacity` に変更 |
| 5527（spanResult 呼び出し） | `placeMonthEvents()` | `placeMonthTimedSpanEvents()` への `maxItems` 引数を `baseCapacity` に変更 |
| 5550（chip 配置） | `placeMonthEvents()` のセルループ | 以下の overflow 判定ロジックを追加:  ① `total = usedSlots + dayTimedEvents.length` を計算  ② `total <= baseCapacity` なら全件表示（chip 全件・`hiddenCount = 0`）  ③ `total > baseCapacity` なら `displaySlots = baseCapacity - 1` を上限として chip 配置・more 表示 |
| 5550（`placeMonthTimedEvents` 呼び出し） | `placeMonthEvents()` | セルごとの overflow 判定後、収まる場合は `maxItems` 相当に大きな値（または `baseCapacity`）を渡して全件表示。超過の場合は `baseCapacity` を渡して `remaining = baseCapacity - usedSlots` で制限 |

**変更前後の計算比較**:

```
【変更前（現状）】
available = cellH - dateHeadH - padding - moreH  ← more を常時控除
maxItems  = floor(available / PITCH)
alldayLimit = maxItems - 1
spanLimit   = maxItems
remaining   = maxItems - usedSlots             ← chip 全セルで制限

overflow なしセルでも maxItems = baseCapacity - 1 相当になる

【変更後】
baseCapacity = floor((cellH - dateHeadH - padding) / PITCH)
alldayLimit  = baseCapacity - 1               ← 終日バーが多すぎる場合の上限
spanLimit    = baseCapacity                   ← span バーの上限

各セルで:
  total = usedSlots + dayTimedEvents.length
  if (total <= baseCapacity):
      chip を全件表示（remaining = baseCapacity - usedSlots、上限に達しない）
      hiddenCount = 0  → more を出さない
  else:
      displayCap = baseCapacity - 1  （more が最終スロットを占有）
      chip 表示枠 = displayCap - usedSlots（最低 0）
      hiddenCount > 0  → applyOverflow() を呼ぶ
```

### 4.2 変更対象外（変更しない箇所）

| 箇所 | 理由 |
|---|---|
| `_calcMaxItems()` の `moreH` 実測ロジック（4868-4887） | `moreH` の実測コードは残す（`baseCapacity` 計算には使わないが、将来の参照や他用途のため or 削除してコードを簡潔にするかは builder が判断） |
| `placeMonthTimedEvents()` の spacer 挿入ロジック（5379-5396） | FR-6（最終スロット+1 方式）は維持 |
| `applyOverflow()` | インターフェース変更なし |
| `placeMonthAlldayEvents()` の `colLaneCounts` 記録ロジック | そのまま維持 |
| `placeMonthTimedSpanEvents()` の `colLaneCounts` 記録ロジック（localMax 実装済み） | そのまま維持 |

---

## 5. 受入基準

Given / When / Then 形式で記述する。

### AC5.1 overflow なしセルで全件表示される（主要 AC）

- **Given**: 月ビューで特定の日（A 日）に時間予定が N 件登録されており、N は `baseCapacity - usedSlots` 以下である（セルに収まる件数）
- **When**: 月ビューを表示する
- **Then**: A 日のセルに N 件の chip がすべて表示され、`+more` が表示されない
- **And**: セルの高さは他の日と同一（FR-1 セル高固定が維持されている）

### AC5.2 overflow ありセルで最終スロットが +more に変わる

- **Given**: 月ビューで特定の日（B 日）に時間予定が M 件登録されており、M > `baseCapacity - usedSlots` である（セルに収まらない）
- **When**: 月ビューを表示する
- **Then**: B 日のセルに `baseCapacity - usedSlots - 1` 件の chip が表示され、最終スロットに `+K more` が表示される（K = M - (baseCapacity - usedSlots - 1)）
- **And**: `+K more` のセル内完全表示が保証されている（クリップなし）

### AC5.3 「ちょうど収まる件数」の日で +more が出ない

- **Given**: 月ビューで C 日に時間予定が `baseCapacity - usedSlots` 件ちょうど登録されている
- **When**: 月ビューを表示する
- **Then**: C 日のセルに全件が表示され、`+more` が表示されない
- **Note**: 修正前は「N-1 件 + +1 more」になっていたケースが修正後は「N 件表示 / more なし」に変わる

### AC5.4 +1 more が +2 more 以上に変わる場合は正しく更新される

- **Given**: 修正前に `+1 more` が表示されていた日（D 日）
- **When**: 修正後の月ビューを表示する
- **Then**: D 日で全件が収まれば `+more` が消え、収まらなければ正しい件数の `+K more` が表示される

### AC5.5 終日バーが多い日の more 可視性が維持される

- **Given**: 月ビューで終日バーが `baseCapacity - 1` 本を超える日（E 日）
- **When**: 月ビューを表示する
- **Then**: `alldayLimit = baseCapacity - 1` により終日バーが制限され、`+more` がセル内に完全表示される
- **And**: `REQ_month-cell-fixed-height.md` AC5.8 の条件（終日 2 本・span 2 本・単日 5 件・cellH=156px）で `+more` がクリップされない

### AC5.6 overflow なしセルで +more をクリックしてもポップオーバーが開かない

- **Given**: 月ビューで予定が全件収まるセル（overflow なし）
- **When**: 月ビューを確認する
- **Then**: `+more` 要素が存在せず、ポップオーバーが開く要素がない

### AC5.7 span バーのみの列（usedSlots>0・chip=0）での more 位置が維持される

- **Given**: span バーのみが存在する列（例: k/891 の 2026-05-26）が月ビューに表示されている
- **When**: 月ビューを表示する
- **Then**: `+more` が `dateline + spacer(usedSlots 分)` の直後（最終スロット+1）に表示される（FR-6 維持）
- **And**: `+more` より下のセル最下端側に余白が集まる

### AC5.8 5 週月で表示件数が 6 週月より増える

- **Given**: 同一ウィンドウサイズで 5 週月（2026/6）と 6 週月（2026/8）をそれぞれ月ビューで表示する
- **When**: `_calcMaxItems()` の返り値（= `baseCapacity`）を DevTools で確認する
- **Then**: 5 週月の `baseCapacity` が 6 週月より大きい（セルが高い分だけ収容スロットが増える）
- **And**: 5 週月で overflow なしだった日が 6 週月でも overflow なしである（週数が増えてもセル高が下がり収容可能数が減る分だけ `+more` が増えるのは許容）

### AC5.9 既存 AC（REQ_month-cell-fixed-height.md）のリグレッションなし

- **Given**: 本修正が適用されている
- **When**: `REQ_month-cell-fixed-height.md` の AC5.1〜AC5.19 を確認する
- **Then**: AC5.1（セル高固定）・AC5.4（リサイズ後再計算）・AC5.7（+N more ポップオーバー）・AC5.8（more 可視性）・AC5.13（more クリップなし）・AC5.15（最終スロット+1 位置）・AC5.16〜AC5.19（FR-7 行数動的化）がすべて合格する

---

## 6. 検証項目・テストシナリオ

### 6.1 主要修正箇所の確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| `_calcMaxItems()` の返り値変化確認 | 修正前後で DevTools の `[KC.maxitems]` ログを比較 | 修正後は `moreH` 引き算がなくなり、`baseCapacity` が修正前の `maxItems` より 1 大きくなっている |
| 「ちょうど収まる件数」の日 | baseCapacity - usedSlots ちょうどの予定数がある日を月ビューで表示 | `+more` が表示されない（全件表示）。修正前は `+1 more` だったことを比較確認 |
| 「1 件だけ超過する」日 | baseCapacity - usedSlots + 1 件の予定がある日を月ビューで表示 | `N-1 件 + +1 more` が表示される。`+more` がセル内に収まる |
| 「大量予定（10 件以上）」の日 | 10 件以上の予定がある日を月ビューで表示 | 正しい件数が制限され `+K more`（K は正しい超過数）が表示される |

### 6.2 終日バー・span バーとの組み合わせ確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 終日バー 1 本 + 単日予定 N 件（収まる） | 終日 1 + 単日 (baseCapacity-1) 件の日を月ビューで表示 | 全件表示。more なし |
| 終日バー 1 本 + 単日予定 N 件（超過） | 終日 1 + 単日 baseCapacity 件の日を月ビューで表示 | 終日 1 本 + 単日 (baseCapacity-2) 件 + `+more`（more がスロット 1 を消費） |
| span バー 1 本 + 単日予定 N 件（収まる） | span バーのある日の単日予定が (baseCapacity-1) 件以内 | 全件表示。more なし |
| k/891 2026-05-25 再検証（終日 2 + span 2 + 単日 5） | 月ビューで 2026-05-25 を確認 | REQ_month-cell-fixed-height.md AC5.8 の条件を継続して満たす |
| k/891 2026-05-26 再検証（span のみ） | 月ビューで 2026-05-26 を確認 | FR-6 の最終スロット+1 方式が維持される（AC5.15 継続合格） |

### 6.3 overflow なし / あり の境界確認（DevTools 使用）

| 確認項目 | 確認方法 | 期待値 |
|---|---|---|
| `[KC.place]` ログで `hidden=0` のセルに `+more` がないこと | DevTools コンソールで KC_DEBUG ログを確認 | `hidden=0` のセルに `.kc-month-more` が存在しない |
| `[KC.place]` ログで `hidden>0` のセルに `+more` があること | 同上 | `hidden>0` のセルに `.kc-month-more` が存在し、テキストが `+K more`（K=hidden 数）と一致 |
| `baseCapacity` の変化をログで確認 | `[KC.maxitems]` ログで `moreH` 引き算がないことを確認 | available = cellH - dateHeadH - padding（moreH なし）で計算されている |

### 6.4 リサイズ・全画面切替後の再計算確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| ウィンドウリサイズ後 | 月ビュー表示中にウィンドウを縦方向に縮め、200ms 待つ | `baseCapacity` が再計算され chip 数が更新される |
| 全画面 ON/OFF | 全画面ボタンで切替後に月ビューを確認 | `baseCapacity` が全画面/通常のセル高に基づいて再計算される |

### 6.5 実機確認手順（SAML 認証環境 k/891）

1. `plugin/dist/plugin.zip` を kintone（bushiroad-group.cybozu.com）に手動アップロードする
2. 検証アプリ（k/891/）の月ビューで予定件数が異なる複数の日を並べて目視確認する
3. **「ちょうど収まる件数」の日**: セル下部に余白があり `+more` が表示されていないことを確認する（修正前と比較）
4. **「1 件だけ超過する日」**: `+1 more` が表示され、セル内に収まっていることを確認する
5. **終日バーありの日**: 終日バー + chip が正しく表示され、以前より 1 件多く chip が表示されること（又は `+more` が消えること）を確認する
6. **大量予定の日（10 件以上）**: 正しい件数が表示され `+K more` の K が正確であることを確認する
7. DevTools の KC_DEBUG ログ（`[KC.maxitems]`・`[KC.place]`）で `baseCapacity` 値と hidden 数が一致していることを確認する
8. `REQ_month-cell-fixed-height.md §6.6` の手順 5, 6, 7 を再実行して既存 AC が合格することを確認する

### 6.6 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| セル高固定 | `REQ_month-cell-fixed-height.md` AC5.1（全行均等高） |
| more 可視性 | AC5.8（k/891 2026-05-25）・AC5.13（クリップなし）・AC5.15（最終スロット+1） |
| FR-7 週行数 | AC5.16〜AC5.19（5 週月・6 週月行数・DnD・ポップオーバー） |
| ポップオーバー | `REQ_month-overflow-popup.md` 全 AC |
| DnD | `REQ_month-dnd.md` 全 AC |

---

## 7. 未確定事項・リスク・前提

### 7.1 [未確定] `alldayLimit = baseCapacity - 1` の `-1` の扱い方

**問題**:

現状 `alldayLimit = maxItems - 1` の `-1` には 2 つの設計意図が混在している:
1. 「`+more` 行のための最低 1 枠確保」（`REQ_month-cell-fixed-height.md §7.9`）
2. 「chip を 1 件以上確保するため」（FR-4 コメント）

修正後は「`+more` 枠確保」は overflow 確定セルのみで必要になる。

**選択肢**:

- **案 A（推奨）**: `alldayLimit = baseCapacity - 1` を維持する。overflow なしセルでは全件収まるため実効的に上限に達することはなく（終日バーが `baseCapacity - 1` 本を超えるシナリオは overflow になる）、安全側に倒したままでよい。
- **案 B**: overflow 判定後に `alldayLimit` を動的変更する。overflow なしなら `alldayLimit = baseCapacity`、overflow ありなら `alldayLimit = baseCapacity - 1`。ただし `placeMonthAlldayEvents` は `placeMonthEvents` のセルループより前（週単位）で呼ばれるため、セルごとの overflow 判定結果を先読みできない構造上の問題がある。

**管理者への確認事項**: 案 A でよいか確認を求める。案 A を採用する場合、builder は `alldayLimit = baseCapacity - 1` のままにして終日バーの `-1` の意味を「常に chip / more に最低 1 枠残す安全マージン」として維持すること。

### 7.2 [前提] `moreH` 実測コードの扱い

`_calcMaxItems()` 内の `moreH` 実測コード（ダミー `.kc-month-more` 挿入）は、`baseCapacity` 計算には不要になる。以下の選択肢がある:

- **案 A（削除）**: 不要なコードを削除してコードを簡潔にする
- **案 B（残置）**: 将来用途やデバッグログのため残置する

builder が判断して選択すること。

### 7.3 [リスク] overflow 判定のセルループ増加

現状の `placeMonthEvents()` セルループは「chip 配置 → hiddenCount 計算 → overflow 表示」の 1 パスで完結している。FR-2 の overflow 判定を追加する場合、`total = usedSlots + dayTimedEvents.length` の計算は同ループ内で完結するため、ループ増加は発生しない。ただし条件分岐が増えるため、既存の `[KC.place]` ログも `baseCapacity`・`total` を含む形で更新が必要。

### 7.4 [前提] `placeMonthAlldayEvents` の呼び出しタイミング

`placeMonthAlldayEvents` は週単位のループで呼ばれ、各セルのセルループより前に実行される。このため「overflow 判定の結果を受けて `alldayLimit` を変える」案 B（§7.1）は現在の呼び出し構造上困難である。`alldayLimit = baseCapacity - 1` の案 A が構造的に自然。

### 7.5 [リスク] 既存の「more 常時確保」が意図的仕様だった可能性

`_calcMaxItems()` が `moreH` を引いている設計は、`REQ_month-cell-fixed-height.md §2.4` で「正しい設計方向」と評価されていた。しかし当時の設計意図は「セル高が固定されていないとき」の先取り控除だった可能性がある。

現在はセル高が CSS で固定されているため（`height: 100%`）、「more を常に先取り控除する」設計は不要になったと判断する。この判断を要件書に明記する。

→ **管理者への確認**: 本判断（more の先取り控除を廃止し baseCapacity ベースに移行する）について承認を得てから実装に入ること。

### 7.6 [前提] `_calcMaxItems()` の呼び出し頻度

現状: `placeMonthEvents()` 冒頭で 1 回のみ呼ばれる。修正後も同様に 1 回呼びで `baseCapacity` を取得し、全セルで使い回す（セルごとに呼ばない）。PITCH・dateHeadH が全セルで共通であるため 1 回計算で十分。

---

## 8. 想定 UX / シーケンス

### 8.1 修正後の表示件数の比較

**例: cellH=170px、PITCH=23px、dateHeadH=28px、padding=4px、moreH=21px**

| 状況 | 修正前 maxItems | 修正後 baseCapacity | 差分 |
|---|---|---|---|
| 予定 0 件のセル | 5 | 6 | +1 スロット |
| 単日予定 5 件のセル（収まる） | 5 件中 5 件表示 → ちょうど5件でギリギリ `+more` なし | 5 件全部収まる、表示変化なし | 差なし（もともと収まっていた） |
| 単日予定 6 件のセル | 5 件 + `+1 more` | 6 件全件表示、`+more` なし | **`+more` が消える** |
| 単日予定 7 件のセル | 5 件 + `+2 more` | 6 件 + `+1 more` | **1 件多く表示** |
| 単日予定 10 件のセル | 5 件 + `+5 more` | 6 件 + `+4 more` | **1 件多く表示** |

### 8.2 修正後のセル描画フロー（FR-2 overflow 判定追加）

```
[placeMonthEvents() 実行]
    ↓
[baseCapacity = _calcMaxItems()]
    ← moreH を引かない純粋な物理収容スロット数
    ↓
[週ループ]
  [placeMonthAlldayEvents(weekEl, weekYMD, weekAllday, baseCapacity)]
      ← alldayLimit = baseCapacity - 1 まで終日バーを描画
      ← 超過分を hiddenByCol として返す
    ↓
  [spanLimit = baseCapacity で placeMonthTimedSpanEvents を呼ぶ]
      ← offsetLane >= baseCapacity のバーを非表示（hiddenByCol に計上）
    ↓
  [セルループ]
    [usedSlots = spanResult.colLaneCounts[colIdx] または alldayResult.colLaneCounts[colIdx]]
    [dayTimedEvents を抽出]
    [total = usedSlots + dayTimedEvents.length を計算]
    if (total <= baseCapacity):
        chip = placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, baseCapacity)
            → remaining = baseCapacity - usedSlots （上限に達しない: 全件表示）
        hiddenCount = 0  → more を出さない
    else:
        chip = placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, baseCapacity)
            → remaining = baseCapacity - usedSlots
            → ただし dayTimedEvents が remaining を超えたら打ち切り
        hiddenCount = (dayTimedEvents.length - chipsAdded)
                    + hiddenAllday.length + hiddenSpan.length
        hiddenCount > 0 → applyOverflow()
            ← +more はスロット (baseCapacity - 1 + 1) = baseCapacity 番目の位置に配置
            ← spacer(usedSlots 本分) + chip(chipsAdded 本分) の直後
    ↓
  [next cell]
```

**注**: `placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, baseCapacity)` の呼び出し引数は `baseCapacity` になる。`remaining = baseCapacity - usedSlots` が計算される。overflow なしセルでは `dayTimedEvents.length <= remaining` なので全件配置される。overflow ありセルでは `remaining` 枠で打ち切り（ただし overflow 判定で `total > baseCapacity` が確定しているため `remaining` 枠を使い切る）。**overflow ありセルでは `remaining` が `baseCapacity - 1 - usedSlots` ではなく `baseCapacity - usedSlots` であることに注意**: `+more` の 1 スロット分は `placeMonthTimedEvents` 側では控除せず、chip 配置後に `hiddenCount > 0` があれば `applyOverflow()` で `+more` を追加する（`+more` は flex フローの最後に付加され、スロット baseCapacity 番目の位置に表示される）。

→ **builder 注意**: overflow ありセルで chip が `baseCapacity - usedSlots` 枠すべて埋めてしまうと `+more` がスロット `baseCapacity + 1` 番目に追加されてセルを超える可能性がある。以下の条件分岐が必要かを builder が判断すること（§7.1 の確認後）:

```javascript
// overflow ありセルでの chip 上限
var chipCap = total > baseCapacity
  ? Math.max(0, baseCapacity - 1 - usedSlots)  // +more のために 1 枠確保
  : Math.max(0, baseCapacity - usedSlots);      // overflow なしは全件
```

### 8.3 修正前後の「ちょうど収まる件数」シナリオ

```
【条件】baseCapacity=6, usedSlots=0, dayTimedEvents=6 件

修正前（maxItems=5）:
  remaining = 5 - 0 = 5
  chip 5 件表示、hiddenTimed = 1 件
  hiddenCount = 1 → +1 more が表示される
  → セルにまだスペースがあるのに more が出る（ユーザー症状）

修正後（baseCapacity=6）:
  total = 0 + 6 = 6 <= baseCapacity=6 → overflow なし
  chip 6 件全表示
  hiddenCount = 0 → more が出ない
  → セルのスペースをフルに使い切る
```

---

## 9. 既存要件（REQ_month-cell-fixed-height.md）との関係

### 9.1 整合する既存 FR

| 既存 FR | 本要件との関係 |
|---|---|
| FR-1（セル高固定） | 変更なし。セル高固定があるからこそ `baseCapacity` が安定して動作する。依存関係を維持 |
| FR-2（動的算出） | `_calcMaxItems()` を維持・改善。`moreH` 控除をやめてより正確な `baseCapacity` を算出する |
| FR-3（収まらない予定を more に委ねる） | 変更なし。ただし「収まる」の定義が `maxItems` から `baseCapacity` に厳密化される |
| FR-5（リサイズ時の再計算） | 変更なし。`_calcMaxItems()` の呼び出し経路を維持 |
| FR-7（週行数動的化） | 変更なし。`weekCount` が変わると `cellH` が変わり `baseCapacity` も変わる。5 週月は baseCapacity が大きくなりより多く表示できる（AC5.8 で確認） |

### 9.2 見直しとなる既存 FR / 仕様

| 既存仕様 | 本要件での見直し内容 |
|---|---|
| `_calcMaxItems()` が `moreH` を引く設計（FR-2 の計算式） | **廃止**: `moreH` は overflow 非確定の段階では引かない。`available = cellH - dateHeadH - padding` に変更 |
| `alldayLimit = maxItems - 1` の `-1` が「more 行の先取り控除後の maxItems」に対して適用される二重控除 | **解消**: `alldayLimit = baseCapacity - 1` になり、「more 控除後 maxItems」からのさらなる `-1` ではなく「物理容量から安全マージン 1 枠を引く」という単一の控除になる |
| `spanLimit = maxItems`（same issue） | **解消**: `spanLimit = baseCapacity` になる |

### 9.3 「more の常時確保」が意図的仕様として設計されたか

`REQ_month-cell-fixed-height.md §2.4` には「`_calcMaxItems()` の設計は**正しい方向**」と記載されているが、これは CSS 側でセル高が固定されていない時代（第 1 版）の評価である。

第 5 版現在はセル高が CSS で固定（`height: 100%`）されており、`_calcMaxItems()` の計算は安定している。「セルが動的に伸びる場合に備えた保守的な more 先取り控除」は不要になったと判断する。

→ この判断は意図的な仕様廃止であり、管理者の確認（§7.5）を得てから実装すること。

### 9.4 FR-6（最終スロット+1 方式）との完全な整合

FR-6 は「`+more` がバー群より上に表示される視覚的逆転を防ぐ」仕様であり、spacer 挿入ロジック（`placeMonthTimedEvents` の `usedSlots > 0` なら spacer 挿入）は本要件の変更後も維持される。

overflow なしセルでは `hiddenCount = 0` のため `applyOverflow()` が呼ばれず `+more` が生成されないため、「spacer の直後に more が表示される」問題は発生しない（more が存在しないから）。

overflow ありセルでは spacer → chip → more の順序は変わらず FR-6 仕様を満たす。

---

## 10. 関連資料

| 資料 | 関連箇所 |
|---|---|
| `plugin/src/js/desktop.js:4825-4906` | `_calcMaxItems()` — 修正対象。`available` 計算式の `-moreH` を削除 |
| `plugin/src/js/desktop.js:5164-5246` | `placeMonthAlldayEvents()` — `alldayLimit = baseCapacity - 1` への変更 |
| `plugin/src/js/desktop.js:5261-5339` | `placeMonthTimedSpanEvents()` — `spanLimit = baseCapacity` への変更 |
| `plugin/src/js/desktop.js:5369-5412` | `placeMonthTimedEvents()` — 変更なし（FR-6 維持） |
| `plugin/src/js/desktop.js:5420-5429` | `applyOverflow()` — 変更なし |
| `plugin/src/js/desktop.js:5435-5577` | `placeMonthEvents()` — overflow 判定ロジック追加・変数名変更 |
| `requirements/REQ_month-cell-fixed-height.md` | 第 5 版 FR-1〜FR-7。本要件はこの要件の延長で計算精度を高める |
| `requirements/REQ_month-overflow-spacer-fix.md` | 第 3 版 localMax 中間案（実装済み）。本要件と並存 |

---

*本要件定義書: 初版（2026-06-19）。未確定事項: §7.1（alldayLimit の `-1` の扱い方・案 A/B 選択）、§7.5（`more` 常時確保廃止の管理者承認）。builder は §7.1 および §7.5 の確認が取れてから実装を開始すること。主要変更は `_calcMaxItems()` の計算式 1 行（`- moreH` の削除）と `placeMonthEvents()` のセルループへの overflow 判定追加の 2 箇所。変数名 `maxItems` → `baseCapacity` の rename は `placeMonthEvents()` および各サブ関数への引数受け渡し箇所に波及する。*
