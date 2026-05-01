# 要件定義書: 終日イベント表示 Google カレンダー方式への再設計

**文書番号**: REQ_allday-bar-redesign  
**作成日**: 2026-04-30  
**更新日**: 2026-05-01（§10 ユーザー回答に基づき §3.4・§3.5・§3.6・§4・§6・§7・§8・§9・§10 を更新）  
**作成者**: designer (サブエージェント)  
**対象ファイル**: `src/kc-calendar.js`, `src/kc-calendar.css`（および `docs/` ミラー）  
**ステータス**: 確定版（未確定事項 0 件）

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
10. [未確定事項 / ユーザー確認項目](#10-未確定事項--ユーザー確認項目)

---

## 1. 目的・背景

### 1.1 現状の問題

週ビューの終日スロット（`.kc-allday`）は、`display: grid` で 7 列に分割された `.kc-adcell` セルが横並びに配置される。日跨ぎ終日イベントは各セルの `.kc-adbox` に `seg-start / seg-middle / seg-end` クラス付きの `.kc-ad-event` タイルを個別に生成し、`left/right: -1px` で隣セルへ張り出すことで連続バーに見せようとしている。

しかし、この方法には構造的な限界がある:

- **border-left の描画主体**: `border-left: 1px solid var(--kc-border)` は各 `.kc-adcell` 要素自身が描画する。`.kc-ad-event.seg-middle` が `left: -1px` で張り出しても、それは *別の grid item の上* に乗るのではなく、*その grid item の独立した stacking context の内側* で動くにすぎない。
- **z-index が効かない**: `.kc-ad-event` は `.kc-adbox` → `.kc-adcell` の内側であり、隣セルの `.kc-adcell` とは兄弟ではなく親が異なる。`z-index` を上げても、覆いたい `border-left` は自分の祖先 stacking context の外にある要素が描くものなので、構造的に重ね替えができない。
- **結果**: 多日跨ぎの終日イベントバーが、列の境界線（`border-left`）で必ず途切れて見える。

この問題は CSS ハックの積み重ねでは解消できず、DOM 構造自体を変える必要がある。

### 1.2 Google カレンダー方式への切り替えの意義

Google カレンダーおよび FullCalendar は以下の方式で終日イベントを描画する:

- 終日イベント専用の「絶対配置レイヤ」を行全体に対して 1 つ用意する
- 各イベントを **1 個の `div`** として `left: (開始列/7)*100%`、`width: (span/7)*100%`、`top: lane * (バー高+gap)` で絶対配置する
- セルの `border-left` はあくまで背景・クリック受付専用の要素が担い、イベントバーは完全に別レイヤで描かれるため、境界線とバーが干渉しない

この方式は単日・跨ぎ・週またぎ・同行複数イベントをすべて同一の仕組みで一元処理できる。また将来実装予定の月ビュー（`KC.RenderMonth`）でも同様の絶対配置レイヤを採用できるため、設計の一貫性が高まる。

---

## 2. スコープ

### 2.1 対象（スコープ内）

| 項目 | 詳細 |
|---|---|
| 終日イベントの DOM 構造 | `.kc-allday` 配下に絶対配置レイヤ `.kc-ad-events` を追加し、`.kc-ad-event` の親を `.kc-adcell` から `.kc-ad-events` に変更 |
| CSS | `.seg-start / .seg-middle / .seg-end` 削除、`.kc-ad-events` 追加、`.kc-ad-event` の新配置スタイル |
| JS — `renderAlldayRow` | `.kc-ad-events` レイヤの生成ロジックを追加 |
| JS — `placeEvents` 終日ブロック | per-event レーン割当 + 単一バー append 方式に書き換え |
| 補助関数 | `assignLanes(events)` / `eventToBarPosition(event, weekStart)` 等 |
| 描画ケース | 単日 / 跨ぎ / 週またぎ（前週開始 or 翌週終了）/ 同行複数レーン |
| レーン展開トグル UI | デフォルト折りたたみ状態からの手動展開 / 折りたたみ機能（§3.5 参照） |
| ソート規則の確定 | `$created` 昇順による `assignLanes` 前ソート（§3.4 参照） |
| ホバー効果の置き換え | `.kc-adbox:hover` を `.kc-adcell:hover` に切り替え（§6.2 参照） |

### 2.2 スコープ外

| 項目 | 理由 |
|---|---|
| 時間ありイベント（`.kc-event`） | 構造的な問題がなく変更不要 |
| 月ビュー（`KC.RenderMonth`） | 別タスクとして定義済み |
| ドラッグ＆ドロップによる終日への変更 / 解除 | 既存挙動維持のみ（`KC.DnD` ロジック変更なし） |
| `KC.Dialog` のフォーム構造 | 変更なし |
| トグル状態の永続化（localStorage 等） | 初版はメモリのみ。リロードで折りたたみに戻る |

---

## 3. 設計方針

### 3.1 DOM 構造の再設計

#### 現状（変更前）

```
.kc-allday  (sticky + grid 8col: time-col + 7day + scrollbar-spacer)
  ├─ .kc-gutter
  ├─ .kc-adcell[data-date="YYYY-MM-DD"]  × 7
  │     └─ .kc-adbox
  │           └─ .kc-ad-event.seg-start   (イベント先頭セグメント)
  │           └─ .kc-ad-event.seg-middle  (中間セグメント)
  │           └─ .kc-ad-event.seg-end     (末尾セグメント)
  └─ (scrollbar spacer)
```

問題点: `.kc-ad-event` が `.kc-adcell` の内側にあるため、隣セルの `border-left` を z-index で覆えない。

#### 変更後

```
.kc-allday  (sticky + grid 8col: time-col + 7day + scrollbar-spacer)
  ├─ .kc-gutter
  ├─ .kc-adcell[data-date="YYYY-MM-DD"]  × 7   ← 背景色・クリック領域・border-left 担当のみ
  ├─ (scrollbar spacer)
  ├─ .kc-ad-events                              ← NEW: 絶対配置レイヤ（イベントバー専用）
  │     └─ .kc-ad-event  (イベントごとに 1 個、position: absolute で位置指定)
  │     └─ .kc-ad-event
  │     └─ ...
  └─ .kc-allday-toggle                          ← NEW: 横断トグルバー（行最下部）
        ├─ アイコン (▼/▲)
        └─ ラベル ("もっと表示 (+N)" / "折りたたむ")
```

`.kc-ad-events` は `.kc-allday` の grid 外に置くために `position: absolute` を使う（詳細は §3.2 参照）。

`.kc-allday-toggle` は `.kc-allday` の最下部を横断する 1 要素として配置し、特定の 1 日（列）ではなく週全体に共通のトグルとして機能する。

### 3.2 `.kc-ad-events` レイヤの配置仕様

`.kc-ad-events` は `.kc-allday` 内で `position: absolute; inset: 0` に配置し、`.kc-allday` 自体に `position: relative` を与える（現状 `position: sticky` のため、`position: sticky` + `position: relative` の重複問題が生じない — sticky は layout position であり、relative は stacking context 確立として共存可能）。

- `pointer-events: none` — `.kc-adcell` へのクリック（終日セル選択）を透過させる
- `.kc-ad-events` は `z-index: 1` — `.kc-adcell` の `border-left` より前面に来る

```
.kc-allday {
  position: sticky;          /* 既存を維持 */
  /* position: relative は sticky と共存可能なため、absolute 子を持つのに追加指定不要 */
  /* sticky 要素自体が包含ブロックになる */
}

.kc-ad-events {
  position: absolute;
  top: 0;
  /* left の起点: grid の time-col 幅分をオフセットする */
  left: var(--kc-time-col-w);
  /* right の終点: scrollbar spacer 幅分を除く */
  right: var(--kc-scrollbar-w, 0px);
  bottom: var(--kc-allday-toggle-h, 24px);  /* トグルバー分の余白を確保 */
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}
```

### 3.3 バーの位置計算式

`.kc-ad-events` の幅を「7 列分（time-col と scrollbar-spacer を除いた領域）」として扱う。

```
colStart  = 週開始日から数えた開始列インデックス (0–6)
span      = バーが占める列数 (1–7)
lane      = レーン番号 (0 始まり)
BAR_H     = CSS 変数 --kc-ad-bar-h (例: 22px)
BAR_GAP   = CSS 変数 --kc-ad-bar-gap (例: 3px)
BAR_TOP   = 4px  (レーン0の上端パディング)

left  = (colStart / 7) * 100%
width = (span / 7) * 100%
top   = BAR_TOP + lane * (BAR_H + BAR_GAP)
height = BAR_H
```

> **注意**: `left` と `width` の基準は `.kc-ad-events` の幅（= time-col と scrollbar-spacer を除いた 7 列分）であるため、`--kc-time-col-w` と `--kc-scrollbar-w` の補正は `.kc-ad-events` の `left/right` プロパティで吸収する。JS 内の計算では純粋に `(colStart / 7) * 100%` を使えばよい。

### 3.4 レーン割り当てアルゴリズム

1 週内のすべての終日イベント（`overlap.length > 0` のもの）を対象に、描画前にレーンを一括割り当てする。

**ソート規則（2026-05-01 確定）**:
- 第一キー: 作成日時 (`created`) 昇順（ISO 8601 文字列として辞書順比較可）
- 第二キー（タイブレーカ）: レコード ID (`id`) 昇順

```javascript
function assignLanes(weekEvents) {
  // weekEvents: 当週にかかる終日イベントの配列
  // 各要素に { colStart, span, created, id } が付与済みであること

  // 作成日時昇順 → ID 昇順でソート（ソート規則確定: 2026-05-01）
  weekEvents.sort(function(a, b) {
    if (a.created < b.created) return -1;
    if (a.created > b.created) return 1;
    return Number(a.id) - Number(b.id);
  });

  // lane 占有テーブル: laneOccupied[lane] = { endCol: number }[]
  var laneOccupied = [];

  weekEvents.forEach(function(ev) {
    var lane = 0;
    // 最小の空きレーンを探す
    while (true) {
      if (!laneOccupied[lane]) { laneOccupied[lane] = []; break; }
      var conflict = laneOccupied[lane].some(function(r) {
        return r.endCol > ev.colStart;  // 既存バーの終端が今回の開始より後なら衝突
      });
      if (!conflict) break;
      lane++;
    }
    laneOccupied[lane].push({ endCol: ev.colStart + ev.span });
    ev.lane = lane;
  });

  return weekEvents;
}
```

**折りたたみ時の表示レーン数（2026-05-01 確定）**:

- 折りたたみ時の表示レーン数 = `min(必要レーン数, 3)`
  - 必要レーン数 1 → 行高は 1 レーン分
  - 必要レーン数 2 → 行高は 2 レーン分
  - 必要レーン数 3 → 行高は 3 レーン分
  - 必要レーン数 4 以上 → 折りたたみ時は 3 レーン分のみ表示し、超過分はトグルで展開
- 行高は動的計算: `calc(var(--kc-allday-lane-h) * 表示レーン数 + 余白)` — JS から `alldayEl.style.height` を書き換えて制御する
- `--kc-allday-h` は「折りたたみ時の最大高（= 3 レーン分）」として再定義し、必要レーン数が 3 未満のときは行高を縮める仕組みを用いる（§7.2 参照）
- トグル UI は必要レーン数が 3 を超える場合**のみ**表示する（必要レーン数 ≤ 3 のときはトグルを描画しない）

### 3.5 レーン展開トグル UI

**2026-05-01 ユーザー確定**: 終日行の最下部を横断する 1 本のバーとしてトグルを配置する（「行下部横断バー」方式）。

#### 3.5.1 デフォルト（折りたたみ）状態

- `KC.State.alldayExpanded = false`（初期値）
- 表示レーン数: `min(必要レーン数, 3)`（動的。§3.4 参照）
- 3 レーン目を超えるレーンは `overflow: hidden` で非表示
- トグル UI 表示条件: 必要レーン数 > 3 のときのみ描画する
  - 条件: `maxLane >= 3`（`maxLane` は当週イベントの最大レーン番号、0 始まり）
  - 必要レーン数 ≤ 3 のときはトグル UI を DOM から除去するか `display: none` にする

#### 3.5.2 トグル UI の配置（確定）

**配置**: `.kc-allday` の最下部に、行全体（週全体）を横断する 1 要素として配置する。

- DOM 上は `.kc-allday` の直接の子要素（`.kc-ad-events` の兄弟、その後ろ）として配置する
- 範囲: 週全体共通（特定の 1 日に紐づかない列横断要素）
- 旧案 A / B / C（右端・行頭・ヘッダー統合）は採用しない

**スタイル指針**: builder は以下いずれかで実装する（自由度を残す）。

- **案 1（推奨）**: `.kc-allday` を `display: flex; flex-direction: column` に変更し、`.kc-allday-toggle` を flex の最終アイテムとして自然に最下部に収める
- **案 2**: `.kc-allday-toggle` に `position: absolute; bottom: 0; left: 0; right: 0; height: var(--kc-allday-toggle-h, 24px)` を指定してオーバーレイ配置する

いずれの場合も、`.kc-allday-toggle` の高さは CSS 変数 `--kc-allday-toggle-h`（推奨値: `24px`）で制御する（§7.1 参照）。

#### 3.5.3 トグル UI の形状

以下いずれかを builder が選択して実装する（どちらでも可）:

- **形式 1（テキスト + アイコン）**: 折りたたみ時「▼ もっと表示 (+N)」、展開時「▲ 折りたたむ」
  - `N` は隠れているイベントの件数（= 必要レーン数 - 3 レーン分に収まらないバーの数）
- **形式 2（ピル型）**: 折りたたみ時「+N more」、展開時「▲」

共通仕様:
- セレクタ: `.kc-allday-toggle`（新規クラス）
- `cursor: pointer`
- `pointer-events: auto`（`.kc-ad-events` の `pointer-events: none` 配下には置かない）
- 非表示条件: `必要レーン数 ≤ 3`（`maxLane < 3`）のとき `display: none` または DOM から除去

#### 3.5.4 展開時の挙動（per-week toggle）

> **設計方針（重要）**: これは **per-week toggle** であり、Google カレンダーの "+N more" のような **per-day toggle ではない**。トグルを押すと、その週の**すべての日**が共通で展開される。レーン 4 以降を持たない曜日列も行高が一律拡張し、空白として表示される。

1. `KC.State.alldayExpanded = true` にセット
2. `.kc-allday` の高さを展開する:
   - 展開高 = `calc(var(--kc-allday-lane-h) * 必要レーン数 + 余白)` で JS から動的算出
   - JS から `alldayEl.style.height` を書き換える
3. `.kc-ad-events` の `overflow: hidden` を解除（または `.kc-allday` 自体の `overflow` を変更）
4. `.kc-allday .kc-gutter` の `height` も同値に合わせる（グリッド行高と合わせるため）
5. トグル UI のラベルを「▲ 折りたたむ」に更新

#### 3.5.5 折りたたみ時の挙動（再折りたたみ）

1. `KC.State.alldayExpanded = false` にセット
2. `.kc-allday` の高さを動的計算値（`min(必要レーン数, 3) * --kc-allday-lane-h + 余白`）に戻す（`alldayEl.style.height` を更新）
3. `.kc-ad-events` の `overflow: hidden` を復元
4. トグル UI のラベルを「▼ もっと表示 (+N)」に更新

#### 3.5.6 状態の永続化

- 初版: **メモリのみ**。`KC.State.alldayExpanded` に保持するが、ページリロードで `false` に戻る
- `localStorage` 等への永続化は将来タスクとする

#### 3.5.7 アニメーション

builder 判断に委ねる。CSS `transition: height 0.2s ease` を追加してもしなくてもよい。

### 3.6 週切り替え時の状態リセット

**2026-05-01 ユーザー確定**: 前週 / 翌週 / 今日ボタン押下時に `KC.State.alldayExpanded = false` へリセットする。

- リセットのタイミング: `_pickModule` 経由で `refresh()` が呼ばれる際（前週・今日・次週ボタンのいずれかの押下時）
- 実装箇所: `refresh()` の冒頭で `KC.State.alldayExpanded = false` を実行する
- 理由: 週が変わると必要レーン数が異なるため、前週での展開状態を引き継ぐと意図しない高さのままになる可能性がある

### 3.7 補助関数の仕様

```javascript
/**
 * 当週におけるイベントの表示位置を計算する
 * @param {KcEvent} evt - イベントオブジェクト（created フィールドを含む）
 * @param {string[]} weekYMD - 当週 7 日の YYYY-MM-DD 文字列配列 (index 0=日曜 or 月曜)
 * @returns {{ colStart: number, span: number, adDateRange: string } | null}
 *   当週に表示範囲がない場合は null
 */
function eventToBarPosition(evt, weekYMD) { ... }

/**
 * 当週の終日イベントにレーン番号を付与する（破壊的変更）
 * ソート規則: created 昇順 → id 昇順（2026-05-01 確定）
 * @param {Array} weekEvents - eventToBarPosition の結果配列（created, id を含む）
 * @returns {Array} lane プロパティが付与された配列
 */
function assignLanes(weekEvents) { ... }

/**
 * レーン展開トグル UI を更新する
 * @param {HTMLElement} toggleEl - .kc-allday-toggle 要素
 * @param {number} maxLane - 当週の最大レーン番号（0 始まり）
 * @param {boolean} expanded - 現在の展開状態
 */
function updateAlldayToggle(toggleEl, maxLane, expanded) { ... }

/**
 * 折りたたみ時の表示レーン数を算出する
 * @param {number} maxLane - 当週の最大レーン番号（0 始まり）
 * @returns {number} 表示レーン数（1〜3 の範囲）
 */
function calcCollapsedLanes(maxLane) {
  return Math.min(maxLane + 1, 3);
}
```

> **旧 §3.6** は本更新で §3.7 に繰り下げた。

---

## 4. 受け入れ条件（Done の定義）

各条件は Given/When/Then 形式で記述する。

### 4.1 単日終日イベント

- **Given**: `allday: true`、開始日 = 終了日 - 1日（kintone の終日保存仕様）で 1 件登録済み
- **When**: 当日が含まれる週を表示する
- **Then**: 該当列 1 セル幅の連続バーが表示され、クリックで編集ポップアップが開く

### 4.2 同週内連続終日イベント（日跨ぎ）

- **Given**: 週の水曜〜金曜の 3 日間にまたがる終日イベントが登録済み
- **When**: 当該週を表示する
- **Then**: 水〜金の 3 列にわたる 1 本の連続バーが描画される。列境界線（`border-left`）がバーに一切重ならない（縦線が見えない）

### 4.3 週またぎ（前週開始）

- **Given**: 前週木曜〜今週火曜の終日イベントが登録済み
- **When**: 今週を表示する
- **Then**: 今週の日曜〜火曜（colStart: 0、span: 3）のバーのみが描画される（前週分は描画されない）

### 4.4 週またぎ（翌週終了）

- **Given**: 今週木曜〜翌週月曜の終日イベントが登録済み
- **When**: 今週を表示する
- **Then**: 今週の木曜〜土曜（colStart: 4、span: 3）のバーのみが描画される（翌週分は描画されない）

### 4.5 同行複数レーン（重複あり）

- **Given**: 月曜〜水曜の終日イベント A と、火曜〜木曜の終日イベント B が登録済み（期間が重複）
- **When**: 当該週を表示する
- **Then**: A と B が縦方向に異なるレーンに配置され、互いに重ならずに表示される

### 4.6 同行複数レーン（重複なし）

- **Given**: 月曜の終日イベント A と木曜の終日イベント B が登録済み（期間が重複しない）
- **When**: 当該週を表示する
- **Then**: A と B が同じレーン 0 に横並びで配置される（レーンを無駄に占有しない）

### 4.7 クリック→編集ポップアップの動作維持

- **Given**: 任意の終日イベントが表示されている
- **When**: バー（`.kc-ad-event`）をクリックする
- **Then**: `KC.Popup.openEdit(evt.id)` が呼ばれ、既存の編集ポップアップが開く
- **And**: `.kc-adcell` クリックによる新規作成ダイアログも引き続き動作する

### 4.8 既存 refresh → render サイクルの維持

- **Given**: 前週 / 翌週ボタン、今日ボタン、イベント保存 / 削除のいずれかを操作した
- **When**: `KC.RenderWeek.refresh()` → `renderGrid()` → `placeEvents()` が実行される
- **Then**: 終日イベントが正しく再描画される（古いバーが残らない、新しいバーが正しい位置に出る）

### 4.9 src / docs 同期

- **Given**: `src/kc-calendar.js` および `src/kc-calendar.css` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` および `docs/kc-calendar.css` が同一内容に同期されている（CLAUDE.md ルール準拠）

### 4.10 折りたたみ時の動的行高（必要レーン数 ≤ 3）

- **Given**: 当該週の終日イベントのレーン数が 1、2、3 のいずれかである
- **When**: 週ビューを表示する
- **Then**: 行高が `--kc-allday-lane-h * 表示レーン数 + 余白` に動的に設定され、不要な余白が生じない
  - 1 レーン分の高さ: `--kc-allday-lane-h * 1 + 余白`
  - 2 レーン分の高さ: `--kc-allday-lane-h * 2 + 余白`
  - 3 レーン分の高さ: `--kc-allday-lane-h * 3 + 余白`（= `--kc-allday-h`）
- **And**: トグル UI（`.kc-allday-toggle`）は表示されない（`maxLane < 3`）

### 4.11 折りたたみ表示とトグル UI の表示（必要レーン数 > 3）

- **Given**: 当該週の終日イベントのレーン数が 4 以上である
- **When**: 週ビューを表示する（折りたたみ状態）
- **Then**: 行高が `--kc-allday-lane-h * 3 + 余白`（= `--kc-allday-h`）に設定され、4 レーン目以降が `overflow: hidden` で非表示になっている
- **And**: トグル UI（`.kc-allday-toggle`）が最下部横断バーとして表示される

### 4.12 トグルクリックで週全体が展開（per-week toggle）

- **Given**: 折りたたみ状態（`KC.State.alldayExpanded === false`）でトグル UI が表示されている
- **When**: トグル UI をクリックする
- **Then**: `.kc-allday` の高さが `--kc-allday-lane-h * 必要レーン数 + 余白` に拡大し、すべてのレーンが表示される
- **And**: トグルラベルが「▲ 折りたたむ」に変わる
- **And**: レーン 4 以降を持たない曜日列も一律に行高が拡張し、空白として表示される（per-day ではなく per-week の挙動）

### 4.13 トグル再クリックで折りたたみ

- **Given**: 展開状態（`KC.State.alldayExpanded === true`）でトグル UI が表示されている
- **When**: トグル UI をクリックする
- **Then**: `.kc-allday` の高さが `--kc-allday-lane-h * 3 + 余白`（= `--kc-allday-h`）に戻り、4 レーン目以降が非表示になる
- **And**: トグルラベルが「▼ もっと表示 (+N)」に戻る

### 4.14 週切り替えで折りたたみにリセット

- **Given**: トグルで展開状態（`KC.State.alldayExpanded === true`）になっている
- **When**: 前週・次週・今日ボタンのいずれかを押して週を切り替える
- **Then**: `KC.State.alldayExpanded` が `false` にリセットされ、新しい週が折りたたみ状態で表示される

### 4.15 ページリロードで折りたたみに戻る

- **Given**: 展開状態のまま画面をリロードする
- **When**: ページ読み込みが完了する
- **Then**: `KC.State.alldayExpanded` が `false` の初期値に戻り、折りたたみ状態で表示される（永続化なし）

### 4.16 ソート順の確認（作成日時昇順）

- **Given**: 月曜に 2 件の重複終日イベントが登録済みで、それぞれ異なる作成日時を持つ
- **When**: 当該週を表示する
- **Then**: 作成日時が古いイベントがレーン 0 に、新しいイベントがレーン 1 に配置される

### 4.17 ホバー効果の動作確認

- **Given**: 終日スロット（`.kc-adcell`）上にイベントバーが表示されていない空きエリアがある
- **When**: その `.kc-adcell` 上にマウスカーソルを乗せる
- **Then**: `var(--kc-muted)` の背景色がセル全体に適用される（`.kc-adbox:hover` ではなく `.kc-adcell:hover` で実現）

---

## 5. データモデル / 状態

### 5.1 KcEvent への追加情報

`KcEvent` オブジェクト（`src/kc-calendar.js:317` の `_recordToEvent` 関数が生成）に以下のフィールドを追加する。

**追加フィールド（2026-05-01 確定）**:

| フィールド | 型 | 取得元 | 用途 |
|---|---|---|---|
| `created` | `string` (ISO 8601) | `rec.$created.value` | `assignLanes` 内のソートキー（第一キー） |

既存フィールドとの整合:

- `allday: boolean` — 終日フラグとして引き続き使用する
- `lane: number` — 描画時に `placeEvents()` 内ローカル変数として算出する。`State.events` には保持しない
- `colStart: number`、`span: number` — 同上、描画時ローカルのみ

理由: `lane` は表示週が変わると変化する（週またぎや複数イベントの組み合わせによる）ため、State への保持は誤りの元になる。ただし `created` は不変のため `State.events` への保持が適切。

### 5.2 KcEvent モデル定義（更新後全体像）

```javascript
// KcEvent（_recordToEvent が返すオブジェクト）
{
  id:       string,          // レコード ID
  rev:      string,          // リビジョン番号
  created:  string,          // 作成日時 (ISO 8601) ← NEW
  title:    string,
  device:   string,
  status:   string,
  color:    string,
  place:    string,
  userName: string,
  userMail: string,
  account:  string,
  memo:     string,
  start:    string,          // ISO 8601
  end:      string,          // ISO 8601
  allday:   boolean
}
```

### 5.3 KC.State への追加

```javascript
KC.State = {
  // ... 既存フィールド ...
  alldayExpanded: false   // NEW: レーン展開トグル状態。初期値 false（折りたたみ）
};
```

### 5.4 `placeEvents` の終日処理フロー（更新後）

```
placeEvents() 内の終日ブロック:
  1. alldayWrap から .kc-ad-events を取得（querySelector）
  2. .kc-ad-events の innerHTML を '' でクリア
  3. S.events から allday イベントのみ抽出
  4. eventToBarPosition(evt, weekYMD) を呼び出し、当週に重なるものだけ残す
  5. assignLanes(weekEvents) でレーン割り当て（created 昇順 → id 昇順ソート後にレーン計算）
  6. 最大レーン番号（maxLane）を算出
  7. 表示レーン数 = calcCollapsedLanes(maxLane) = min(maxLane + 1, 3)
  8. updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded) でトグル UI を更新
     （maxLane < 3 ならトグル非表示）
  9. 各イベントに対して .kc-ad-event を生成し、left/width/top/height を設定して
     .kc-ad-events に appendChild
  10. .kc-allday の高さを S.alldayExpanded に応じて設定:
      - 展開時: --kc-allday-lane-h * (maxLane + 1) + 余白
      - 折りたたみ時: --kc-allday-lane-h * min(maxLane + 1, 3) + 余白
```

---

## 6. 既存コードからの差分

### 6.1 削除する CSS

| セレクタ | 所在 | 削除理由 |
|---|---|---|
| `.kc-ad-event.seg-start` | `kc-calendar.css:356–360` | 不要になるセグメント方式 |
| `.kc-ad-event.seg-middle` | `kc-calendar.css:361–365` | 同上 |
| `.kc-ad-event.seg-end` | `kc-calendar.css:366–370` | 同上 |
| `.kc-ad-event { z-index: 1 }` | `kc-calendar.css:343` | 新構造では不要（`.kc-ad-events` レイヤが z-index を持つ） |
| `.kc-adbox { ... }` | `kc-calendar.css:331–335` | `.kc-adbox` 要素自体を削除するため |
| `.kc-adbox:hover` （`.kc-time-slot:hover, .kc-adbox:hover` の後半部分） | `kc-calendar.css:466–469` | `.kc-adcell:hover` に置き換えるため削除（Q3 確定: 2026-05-01） |

> **Q3 確定内容（2026-05-01）**: ホバー効果は案 A「`.kc-adcell:hover { background: var(--kc-muted) }`」に置き換える。`.kc-adbox` を透明レイヤとして残す案 B は採用しない。

### 6.2 変更する CSS

| 対象 | 変更内容 |
|---|---|
| `.kc-allday` | `position: sticky` は維持。`overflow: visible` に変更（絶対配置子が切れないようにする。現状 `overflow` 未指定のため確認要）。トグル UI が外側に露出する場合は `overflow: visible` が必要 |
| `.kc-adcell` | `position: relative` を維持。`.kc-adbox` が不要になるため内部 padding や height の見直し |
| `.kc-ad-event` | `position: absolute` に変更。`inset: 4px 6px` を削除。新配置スタイル（left/width/top/height）を JS から直接設定するため CSS 側はデフォルトのみ定義 |
| `.kc-time-slot:hover, .kc-adbox:hover` ルール | `.kc-adbox:hover` を除去し、`.kc-adcell:hover` を別途追加（下記 §6.3 参照） |

**ホバー領域について**: `.kc-adbox` 廃止後、ホバー対象は `.kc-adcell` 全体となる。`.kc-adcell` はクリック領域（終日セル選択 / 新規作成）と同一であるため、ホバー領域とクリック領域がほぼ一致する。これは意図した設計である。

### 6.3 追加する CSS

```css
/* 終日イベントバー専用絶対配置レイヤ */
.kc-ad-events {
  position: absolute;
  top: 0;
  left: var(--kc-time-col-w);
  right: var(--kc-scrollbar-w, 0px);
  bottom: var(--kc-allday-toggle-h, 24px);  /* トグルバー分の余白 */
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

/* 新方式の終日イベントバー */
.kc-ad-event {
  position: absolute;
  height: var(--kc-ad-bar-h, 22px);
  background: #eef2ff;
  border: 1px solid var(--kc-border);
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 13px;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  pointer-events: auto;   /* レイヤは none だがバー自体は auto でクリック受付 */
  box-sizing: border-box;
}

/* 終日セルのホバー効果（.kc-adbox:hover の代替）  ← Q3 確定: 2026-05-01 */
.kc-adcell:hover {
  background: var(--kc-muted);
}

/* レーン展開トグルバー（行最下部横断）  ← 未確定-A 確定: 2026-05-01 */
.kc-allday-toggle {
  /* builder は §3.5.2 の案 1（flex）または案 2（absolute）で配置すること */
  width: 100%;
  height: var(--kc-allday-toggle-h, 24px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  font-size: 12px;
  color: var(--kc-subtext);
  gap: 4px;
  white-space: nowrap;
  border-top: 1px solid var(--kc-border);
  background: transparent;
  box-sizing: border-box;
}
.kc-allday-toggle:hover {
  color: var(--kc-text);
  background: var(--kc-muted);
}
```

### 6.4 削除する JS

| 箇所 | 所在 | 削除理由 |
|---|---|---|
| `isMulti` の判定と `seg-start / seg-middle / seg-end` の付与 | `kc-calendar.js:960–971` | 不要 |
| `overlap.forEach` による各 `.kc-adcell` への append ロジック | `kc-calendar.js:962–1013` | 新方式に全面置換 |
| `renderAlldayRow` 内の `.kc-adbox` 生成 | `kc-calendar.js:848–850` | `.kc-adbox` 廃止のため |

### 6.5 追加する JS

#### `KC.Api.loadEvents` の `fields` 配列への追加（Q2 対応）

現状 `loadEvents`（`kc-calendar.js:361`）の `fieldList` は `['$id', '$revision']` で始まり、`KC.Config.FIELD` の値を動的追加している（`kc-calendar.js:385–388`）。`$created` はシステムフィールドのため `FIELD` オブジェクトに含まれず、明示的に追加する必要がある。

```javascript
// 変更前 (kc-calendar.js:385)
var fieldList = ['$id', '$revision'];

// 変更後
var fieldList = ['$id', '$revision', '$created'];
```

#### `KC.Api._recordToEvent` への `created` フィールド追加（Q2 対応）

現状 `_recordToEvent`（`kc-calendar.js:317`）は `$created` を取得していない。以下を追加する:

```javascript
// ev オブジェクトの初期化ブロック（kc-calendar.js:323–335 相当）に追加
var ev = {
  id:       rec.$id.value,
  rev:      rec.$revision.value,
  created:  rec.$created ? rec.$created.value : '',  // NEW: 作成日時 (ISO 8601)
  // ... 以下既存フィールド ...
};
```

#### `KC.State` への `alldayExpanded` 追加

```javascript
// KC.State 定義箇所に追加
KC.State = {
  // ... 既存フィールド ...
  alldayExpanded: false  // NEW: レーン展開トグル状態
};
```

#### `renderAlldayRow` への追加

```javascript
// 7 つの .kc-adcell を append した後、.kc-ad-events レイヤとトグル UI を追加
var eventsLayer = document.createElement('div');
eventsLayer.className = 'kc-ad-events';
wrap.appendChild(eventsLayer);

var toggleEl = document.createElement('div');
toggleEl.className = 'kc-allday-toggle';
toggleEl.style.display = 'none';  // 初期非表示。placeEvents で制御
wrap.appendChild(toggleEl);
```

#### `refresh()` の冒頭への状態リセット追加（未確定-C 確定: 2026-05-01）

```javascript
// refresh() の冒頭（週切り替えの処理が始まる直前）に追加
KC.State.alldayExpanded = false;
```

#### `placeEvents` の終日ブロック書き換え

```javascript
// 変更前: overlap.forEach(...) で各セルに append
// 変更後:
var eventsLayer = alldayWrap ? alldayWrap.querySelector('.kc-ad-events') : null;
var toggleEl = alldayWrap ? alldayWrap.querySelector('.kc-allday-toggle') : null;
if (eventsLayer) eventsLayer.innerHTML = '';

var weekEvents = [];
(S.events || []).forEach(function(evt) {
  if (!evt.allday) return;
  var pos = eventToBarPosition(evt, weekYMD);
  if (!pos) return;
  weekEvents.push(Object.assign({}, evt, pos));
});

assignLanes(weekEvents);  // created 昇順 → id 昇順でソート後にレーン付与

var maxLane = weekEvents.reduce(function(m, ev) { return Math.max(m, ev.lane || 0); }, -1);
// 折りたたみ時の表示レーン数: min(必要レーン数, 3)（未確定-B 確定: 2026-05-01）
var collapsedLaneCount = Math.min(maxLane + 1, 3);

if (toggleEl) updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded);

weekEvents.forEach(function(ev) {
  if (!eventsLayer) return;
  var el = buildAlldayBar(ev);  // DOM 生成サブ関数
  eventsLayer.appendChild(el);
});

// 高さ制御: 動的計算（未確定-B 確定: 2026-05-01）
if (alldayWrap) {
  var BAR_TOP  = 4;
  var BAR_H    = 22;  // --kc-ad-bar-h
  var BAR_GAP  = 3;   // --kc-ad-bar-gap
  var BAR_BTM  = 4;
  var TOGGLE_H = 24;  // --kc-allday-toggle-h

  var displayLanes = S.alldayExpanded ? (maxLane + 1) : collapsedLaneCount;
  if (displayLanes < 1) displayLanes = 1;  // 終日イベント 0 件でも最低 1 レーン分確保

  var totalH = BAR_TOP + (BAR_H + BAR_GAP) * displayLanes - BAR_GAP + BAR_BTM + TOGGLE_H;
  alldayWrap.style.height = totalH + 'px';

  // .kc-gutter の高さも同期（grid 行高が .kc-allday の height を参照しているため）
  var gutter = alldayWrap.querySelector('.kc-gutter');
  if (gutter) gutter.style.height = totalH + 'px';
}
```

#### 新規補助関数

- `eventToBarPosition(evt, weekYMD)` — 位置計算
- `assignLanes(weekEvents)` — レーン割り当て（created 昇順 → id 昇順ソート込み）
- `calcCollapsedLanes(maxLane)` — 折りたたみ時表示レーン数算出（`min(maxLane + 1, 3)`）
- `buildAlldayBar(evWithPos)` — `.kc-ad-event` DOM 生成
- `updateAlldayToggle(toggleEl, maxLane, expanded)` — トグル UI 更新（maxLane < 3 のときは `display: none`）

---

## 7. CSS 変数 / レイアウト

### 7.1 新規 CSS 変数

| 変数名 | 確定値 | 説明 |
|---|---|---|
| `--kc-ad-bar-h` | `22px` | 終日イベントバー 1 本の高さ |
| `--kc-ad-bar-gap` | `3px` | バー間の縦隙間 |
| `--kc-ad-bar-top` | `4px` | `.kc-ad-events` 上端からの最初のバーまでのオフセット |
| `--kc-allday-lane-h` | `25px` | 1 レーン分の高さ + gap（= `--kc-ad-bar-h` + `--kc-ad-bar-gap` = 22 + 3）。JS から展開高さを計算する際に参照 |
| `--kc-allday-toggle-h` | `24px` | 行下部横断トグルバーの高さ（未確定-A 確定: 2026-05-01） |

### 7.2 `--kc-allday-h` の扱い（確定: 2026-05-01）

**役割の再定義**: `--kc-allday-h` は「**折りたたみ時の最大高（= 3 レーン分）**」として機能する。

- 必要レーン数が 3 未満のとき: 行高を `--kc-allday-lane-h * 必要レーン数 + 余白` に縮める（JS が動的に `style.height` を書き換える）
- 必要レーン数が 3 のとき: 行高 = `--kc-allday-h`（3 レーン分の最大値）
- 必要レーン数が 4 以上のとき: 折りたたみ時は行高 = `--kc-allday-h`（3 レーン分）、展開時は JS が動的に上書き

3 レーン分の推奨値計算:

```
必要高 = BAR_TOP + (BAR_H + BAR_GAP) * 3 - BAR_GAP + BAR_BTM + TOGGLE_H
       = 4 + (22 + 3) * 3 - 3 + 4 + 24
       = 4 + 75 - 3 + 4 + 24 = 104px
```

したがって `--kc-allday-h` を `104px` に更新することを推奨する（トグルバー高 24px を含む）。

> 旧版の `--kc-allday-h: 55px`（2 レーン分）は廃止し、3 レーン分の値に更新する。

### 7.3 高さ計算式（確定: 2026-05-01）

#### 折りたたみ時（動的、必要レーン数に応じて縮小）

```
折りたたみ高 = BAR_TOP + (BAR_H + BAR_GAP) * min(必要レーン数, 3) - BAR_GAP + BAR_BTM + TOGGLE_H
= calc(var(--kc-allday-lane-h) * min(必要レーン数, 3) + (BAR_TOP - BAR_GAP + BAR_BTM) + TOGGLE_H)
```

#### 展開時（全レーン表示）

```
展開高 = BAR_TOP + (BAR_H + BAR_GAP) * 必要レーン数 - BAR_GAP + BAR_BTM + TOGGLE_H
= calc(var(--kc-allday-lane-h) * 必要レーン数 + (BAR_TOP - BAR_GAP + BAR_BTM) + TOGGLE_H)
```

> JS から CSS 変数を読む場合: `getComputedStyle(document.documentElement).getPropertyValue('--kc-ad-bar-h')` で取得できるが、文字列のパースが必要なため、初版は定数（22, 3, 4, 24）をハードコードして実装し、将来的に CSS 変数参照に移行することを推奨する。

---

## 8. エッジケース / 検証ケース

| ケース | 期待動作 | 備考 |
|---|---|---|
| 開始日 == 終了日 — 1 日（単日終日） | 1 列幅のバーが 1 本表示される | `span = 1, colStart = 当日の列インデックス` |
| 開始日が表示週より前（週またぎ） | `colStart = 0`（日曜 or 月曜）から始まるバー | `eventToBarPosition` で clamp 処理 |
| 終了日が表示週より後（週またぎ） | `colStart + span = 7` までのバー | 同上 |
| 両方週またぎ（全週をカバー） | 7 列幅のバー 1 本 | `colStart = 0, span = 7` |
| 同日に終日が 1 件 | 行高 = 1 レーン分。トグル非表示 | 動的縮小（未確定-B 確定: 2026-05-01） |
| 同日に終日が 2 件（重複あり） | 行高 = 2 レーン分。トグル非表示 | 動的縮小 |
| 同日に終日が 3 件（重複あり） | 行高 = 3 レーン分（= --kc-allday-h）。トグル非表示 | 最大折りたたみ高 |
| 同日に終日が 4 件以上（重複あり） | 行高 = 3 レーン分。4 件目以降は `overflow: hidden` で不可視。トグル UI 表示 | トグルで展開すると全件見える |
| 違う期間の終日が同行で時間帯重複 | `assignLanes` が衝突を検出し別レーンに割り当て | `endCol > colStart` の衝突判定 |
| 終日が 0 件 | `.kc-ad-events` は空のまま正常描画。トグル UI 非表示。行高は 1 レーン分 | エラーなし |
| 必要レーン数 ≤ 3 のとき | トグル UI は表示されない（`maxLane < 3`） | 未確定-B 確定: 2026-05-01 |
| トグル押下時（展開） | 当週全曜日が一律に行高拡張。レーンを持たない曜日も空白として拡張 | per-week toggle。per-day ではない（未確定-A 確定: 2026-05-01） |
| 週切り替え（前週/次週/今日） | `KC.State.alldayExpanded = false` にリセットされ、新しい週が折りたたみ状態で表示 | 未確定-C 確定: 2026-05-01 |
| イベントに `color` 指定あり | バー背景色・ドット色が `evt.color` で上書き | 既存ロジック（`isLightColor`）を流用 |
| イベントに `color` 指定なし | デフォルト `#eef2ff` が適用される | 変更なし |
| D&D で終日 → 時間あり変更 | `KC.DnD` 既存ロジックで `allday: false` になり `placeEvents` 再実行 | 時間ありとして再描画されることを確認 |
| D&D で時間あり → 終日変更 | 逆方向も同様 | 既存挙動維持を確認 |
| `.kc-adcell` ホバー（バーなし領域） | `var(--kc-muted)` の背景色がセル全体に適用 | `.kc-adcell:hover` で実現（`.kc-adbox:hover` ではない） |
| `$created` 取得失敗時 | `created` フィールドが空文字になり、ID 昇順（第二キー）でソートされる | フォールバック正常動作 |

---

## 9. 次タスクへの引き継ぎ

### 9.1 builder への指示

- **ブランチ**: `feature/allday-bar-redesign` で作業すること（worktree 推奨）
- **編集対象**: `src/kc-calendar.js` と `src/kc-calendar.css` を同時に変更すること
- **sync**: `src/` 変更後、必ず `docs/` にも同内容を同期すること（CLAUDE.md ルール）
- **参照**: 本要件定義書 §3〜§7 を実装仕様として使用すること。特に以下を優先的に実装:
  - §3.2（`.kc-ad-events` の配置）
  - §3.3（位置計算式）
  - §3.4（`assignLanes` のソート規則、折りたたみ時動的レーン数）
  - §3.5（レーン展開トグル UI — 行下部横断バー方式。配置案が確定済みのため仮実装不要）
  - §3.6（週切り替え時の `KC.State.alldayExpanded = false` リセット）
  - §6.2・§6.3（`.kc-adcell:hover` への切り替え）
  - §6.5（`$created` フィールドの追加、`refresh()` 冒頭のリセット追加）
  - §7.2（`--kc-allday-h` を 104px に更新）
- **関数分離**: `eventToBarPosition` / `assignLanes` / `calcCollapsedLanes` / `buildAlldayBar` / `updateAlldayToggle` はそれぞれ独立した内部関数として `placeEvents` の前に定義し、責務を分離すること（`coding-rules.md` の「1 関数 1 責務」ルール準拠）
- **XSS 対策**: `textContent` を使用し、`innerHTML` にユーザー入力を直接代入しないこと（`DESIGN.md §9.3`）
- **コメント**: 既存コードの JSDoc 相当のコメントスタイルに合わせること
- **トグル配置**: `§3.5.2` の案 1（flex）または案 2（absolute）を選択して実装すること。配置案は確定済みのため、仮実装の必要はない

### 9.2 reviewer への指示

§4「受け入れ条件」の各項目（4.1〜4.17）を 1 つずつ順に確認すること。

特に以下に重点を置く:

1. **4.2（連続バー）**: 列境界線がバーに重なっていないかを目視確認する
2. **4.5・4.6（レーン）**: 重複ありの場合に別レーン、重複なしの場合に同レーンになるかを確認する
3. **4.7（クリック）**: `.kc-adcell` クリック（新規作成）と `.kc-ad-event` クリック（編集）の両方が動作するかを確認する
4. **4.9（sync）**: `src/` と `docs/` の差分が 0 であることを `diff` コマンドで確認する
5. **4.10（動的行高）**: 必要レーン数 1 / 2 / 3 のそれぞれで行高が正しく縮小されることを確認する
6. **4.11（トグル表示条件）**: 必要レーン数 ≤ 3 のときにトグルが非表示であることを確認する
7. **4.12（per-week toggle）**: トグル展開時に全曜日が一律拡張することを確認する（特定列だけ拡張されないこと）
8. **4.14（週切り替えリセット）**: 前週/次週/今日ボタン押下後に折りたたみ状態に戻ることを確認する
9. **4.16（ソート）**: 作成日時の異なる複数イベントのレーン順を確認する
10. **4.17（ホバー）**: `.kc-adcell:hover` で背景色が変わることを確認する

---

## 10. 未確定事項 / ユーザー確認項目

### 10.1 解決済み事項（2026-05-01 回答受領）

| 項目 | 質問内容 | 回答 | 反映箇所 |
|---|---|---|---|
| Q1（レーン上限） | 固定上限か可変か | デフォルト折りたたみ + 展開トグル UI | §3.5、§4.11〜4.14、§5.3、§6.5、§7.2 |
| Q2（ソート規則） | ソート順の指定 | 作成日時（`$created`）昇順 → ID 昇順 | §3.4、§5.1〜5.2、§6.5 |
| Q3（ホバー効果） | `.kc-adbox:hover` の置き換え先 | 案 A: `.kc-adcell:hover` | §6.1〜6.3、§8 |
| 未確定-A（トグル UI 配置） | 配置案 A / B / C の選択 | 行下部横断バー（新案）を採用。既存 A/B/C は不採用 | §3.1、§3.5.2、§6.3 |
| 未確定-B（折りたたみレーン数） | 初期表示レーン数の確定 | 最大 3、動的圧縮。`min(必要レーン数, 3)` | §3.4、§4.10〜4.11、§6.5、§7.2 |
| 未確定-C（週切り替え時リセット） | 週切り替え時のトグル状態 | 常に折りたたみへリセット（`KC.State.alldayExpanded = false`） | §3.6、§4.14、§6.5、§8 |

### 10.2 新たな未確定事項

なし。すべての未確定事項が解決した。

---

*本要件定義書は未確定事項 0 件で確定版とする。builder への委譲を開始してよい。*
