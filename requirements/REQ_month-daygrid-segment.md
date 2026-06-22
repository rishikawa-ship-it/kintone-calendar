# REQ_month-daygrid-segment: 月ビュー FullCalendar dayGrid 方式への改修設計

**文書番号**: REQ_month-daygrid-segment
**作成日**: 2026-06-22
**最終更新日**: 2026-06-22（初版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js` / `plugin/src/css/desktop.css`
**ステータス**: 初版・設計検討段階（実装着手前の規模感・影響範囲の見極め用）

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状アーキテクチャの整理](#2-現状アーキテクチャの整理)
3. [目標アーキテクチャの設計](#3-目標アーキテクチャの設計)
4. [DnD・リサイズへの影響](#4-dndリサイズへの影響)
5. [既存資産との整合・破壊範囲](#5-既存資産との整合破壊範囲)
6. [段階導入フェーズ案と工数感](#6-段階導入フェーズ案と工数感)
7. [受入基準（目標状態）](#7-受入基準目標状態)
8. [未確定事項・リスク・要ユーザー判断](#8-未確定事項リスク要ユーザー判断)
9. [参照先・関連資料](#9-参照先関連資料)

---

## 1. 背景・目的

### 1.1 確定した根本原因

月ビューの「複数日（終日・日跨ぎ）バー」は **1 本の DOM 要素が週内を水平方向に横断する絶対配置要素**であり、表示位置（`top`）も表示/非表示の上限判定も **週単位** で決まる構造になっている。

この構造から以下の 2 問題が不可分の根として生じる。

| 問題 | メカニズム |
|---|---|
| 余白問題 | span バーの `top` は `alldayLaneCount`（週全体の終日バーレーン数）を使うため、終日バーが存在しない列でもそのセルの spacer/chip 開始位置が週共通値で押し下げられる |
| 表示件数が少なすぎる問題 | `baseCapacity`（=`_calcMaxItems()`）は週単位で一律適用されるため、終日バーが多い日に引っ張られて空き余裕のある日でも打ち切られる |

直近の修正履歴:

- `d3114a8`（localMax 余白修正）: span バーの `top` 計算を「跨ぐ列の終日バー最大値（localMax）」で計算する中間案。チップには効くがバーが主役のこのアプリでは体感改善しなかった。
- `a259ead`（件数修正）: `+N more` 行の「常時 1 スロット確保」を廃止して overflow 時のみ確保する修正。チップには効くが、バーの overflow 判定が週単位のままなので根本解決にならない。
- 実機で最新ビルドが稼働していることはビルドスタンプで確認済み。デプロイ問題ではなくロジックの構造問題と確定。

### 1.2 目標

**FullCalendar dayGrid / Googleカレンダー方式**（以下「dayGrid 方式」）を参照アーキテクチャとして採用し、以下を実現する。

1. あふれ判定を **日（セル）ごと** に行う。同じ複数日イベントでも「入る日は表示・満杯の日だけ +more に畳む」
2. バーの段（level/lane）は週内で一貫させ **まっすぐ繋がって見せる**（連続バーの見た目維持）
3. `+more` 行は overflow した日にのみ消費する（先取り確保しない）

> **FullCalendar dayGrid の参照挙動**（実装前調査済み）:
> - 複数日イベントは週を横断するが、ある日では +more に隠れ別の日では表示される
> - `dayMaxEvents` の数に +more 自体は含めない
> - 段（row）は週内で揃えるが、そのセルに入らない段のイベントはそのセルだけ非表示になる

### 1.3 本ドキュメントの目的

実装着手前に規模感・影響範囲を見極めること。設計書として確定したあと、実装は管理者経由で builder に委譲する。

---

## 2. 現状アーキテクチャの整理

### 2.1 月ビュー描画の全体フロー

```
placeMonthEvents()                       ← 週ループのオーケストレーター
  ├── _calcMaxItems()                    ← セル実高から baseCapacity 算出（全セル共通1値）
  ├── 週ループ (weekEls.forEach)
  │     ├── placeMonthAlldayEvents()     ← 週内終日バーを配置・週単位 lane 割当
  │     │     └── KC.Lanes.assignLanes() ← 週内ソート→グリーディ lane 割当
  │     ├── placeMonthTimedSpanEvents()  ← 週内日跨ぎバーを終日バーの下に積む
  │     │     └── KC.Lanes.assignLanes() ← 同上
  │     └── セルループ (cellEls.forEach)
  │           ├── placeMonthTimedEvents() ← 単日 chip を配置（spacer + chip 積み）
  │           └── applyOverflow()        ← hiddenCount > 0 なら +N more を追加
  └── (終了)
```

ファイル参照: `plugin/src/js/desktop.js` 5449 行〜（`placeMonthEvents`）

### 2.2 主要変数・関数の役割

#### 定数群（`desktop.js` 4803〜4812 行）

| 定数 | 値 | 役割 |
|---|---|---|
| `BAR_H` | 20px | バー（終日/span）の高さ |
| `BAR_GAP` | 3px | バー間の垂直余白 |
| `BAR_TOP` | 0px | `.kc-month-ad-events` レイヤ内での先頭バー top オフセット（レイヤ top が CSS で dateline_h に設定済み） |
| `BAR_X_GAP` | 3px | バー右端の横余白（隣接バー境目を視覚分離） |
| `MAX_CELL_ITEMS` | 5 | `_calcMaxItems()` 失敗時のフォールバック上限 |

#### `_calcMaxItems()` — `desktop.js` 4835 行

セル実高・dateline 実高・chip/more の実測ピッチから **全セル共通の整数 `baseCapacity`** を算出する。

```
baseCapacity = floor((cellH - dateHeadH - padding) / PITCH)
```

- `PITCH`: ダミー chip 2 枚を in-flow 挿入してピッチを実測（CSS 変更追従）
- `dateHeadH`: `.kc-month-dateline` の `getBoundingClientRect().height` を実測
- 返り値 0〜10（最低 0: 極小セルで chip もバーも置けない）

**週単位問題の根**: 全セル共通 1 値。週ごと/日ごとの上限差異を吸収できない。

#### `KC.Lanes.assignLanes(weekEvents)` — `desktop.js` 3713 行

週内イベント配列にグリーディに lane（0 始まり整数）を付与する。

ソート規則: 色あり降順 → 開始日時昇順 → 終了日時降順 → 作成日時昇順 → ID 昇順（`commit 1a8cbe5` で確定）

**週単位問題の根**: `weekEvents` が週全体を対象とし、lane が週内で一意に決まる。特定日だけ +more になることを考慮しない。

#### `KC.Lanes.eventToBarPosition(evt, weekYMD)` — `desktop.js` 3665 行

週内のイベント colStart/span を算出する。週末でクランプ（翌週にはみ出ない）。返り値は `{colStart, span, adDateRange}` または null（週内に重なりなし）。

#### `buildMonthAlldayBar(ev)` — `desktop.js` 4925 行

`.kc-ad-event.kc-ad-event--month` 要素を生成。絶対配置で週内 `colStart` と `span` に基づいた `left`, `width`, `top`, `height` をインライン設定する。

```javascript
el.style.left   = ((ev.colStart / 7) * 100) + '%';
el.style.width  = 'calc(' + ((ev.span / 7) * 100) + '% - ' + BAR_X_GAP + 'px)';
el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
el.style.height = BAR_H + 'px';
```

DnD ハンドラ（`startMoveAlldayMonth`, `startResizeAlldayMonth`）が `mousedown` で登録される。1要素に左右リサイズハンドルが内包される。

**週単位問題の根**: `left`/`width` が週全幅に対する % で計算されるため、日ごとに要素を分割できない。

#### `buildMonthTimedSpanBar(ev)` — `desktop.js` 5069 行

`.kc-month-chip--span` 要素。buildMonthAlldayBar と同様の絶対配置方式。

#### `placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, baseCapacity)` — `desktop.js` 5176 行

戻り値:
- `laneCount`: 週全体の最大 lane 数（制限前）
- `effectiveLaneCount`: 制限後の実効 lane 数（`min(laneCount, alldayLimit)`）
- `colLaneCounts[7]`: 各列の実描画 lane 数（セル局所値）
- `hiddenByCol[7][]`: 各列の非表示イベント配列

制限上限: `alldayLimit = baseCapacity - 1`（overflow 確定時のみ -1 が効く案 A）。`alldayLimit` を超える lane のバーは**全セルで非表示**にして `hiddenByCol` に記録する。

**週単位問題**: `alldayLimit` は全列共通。ある列では空きがあっても週の最大 lane 数で打ち切られる。

#### `placeMonthTimedSpanEvents(weekEl, weekYMD, spanEvents, alldayLaneCount, alldayColLaneCounts, baseCapacity)` — `desktop.js` 5275 行

戻り値:
- `colLaneCounts[7]`: 各列の実描画スロット数（終日+span の合計、localMax 方式）
- `hiddenByCol[7][]`: 各列の非表示日跨ぎイベント配列

span バーの `top` 計算:

```javascript
var localMax = max(alldayColLaneCounts[ci] for ci in ev's span);
var offsetLane = localMax + ev.lane;
```

`localMax`（`d3114a8` で導入）が中間案の核心。ただし span バー 1 要素の `top` は **1 つの値**（週内最大セルの localMax）で固定されるため、列ごとに top を変えることはできない。これが残余余白問題（構造的天井）の原因。

#### `applyOverflow(cellEl, remaining, hiddenEvents)` — `desktop.js` 5434 行

`remaining > 0` のとき `.kc-month-more` を `cellEl.appendChild()`。件数は「終日超過 + span 超過 + chip 超過」の合計。

---

## 3. 目標アーキテクチャの設計

### 3.1 dayGrid 方式の核心

**FullCalendar / Google カレンダーの描画モデル**:

1. イベントには週内一貫した **row（段）番号** を付与する（週単位 lane 割当は維持）
2. 各セル（日）は **そのセルに当たる row** が `dayMaxEvents` を超えたらそのセルだけ +more に畳む
3. バー要素は **セルをまたがず、各セルのセグメントとして分割して描画する**（隣接セグメントを視覚的に連結する）

この設計により:
- あふれ判定がセル単位 → 「空いている日は表示・満杯の日だけ +more」が実現できる
- row 番号は週内共通 → バーが週を通じてまっすぐ繋がって見える
- 連続バーの途切れはないが行が埋まれば +more になる（Google カレンダーと同じ）

### 3.2 案 X: セグメント分割方式（推奨）

**概要**: バーを日（セル）ごとのセグメント要素群として描画する。各セグメントはセル内に収まる CSS で作り、隣接するセグメントは border/padding を調整して連結 1 本に見せる。

**描画モデル**:

```
従来:
  .kc-month-ad-events（週全幅の絶対配置レイヤ）
    └── .kc-ad-event（left: X%, width: Y% で週全幅を横断する 1 要素）

案 X:
  各 .kc-month-cell（セル）
    └── .kc-month-ad-events（セル幅いっぱいの絶対配置レイヤ、またはフロー）
          └── .kc-ad-event--seg（セル幅 100% または in-flow のセグメント要素）
                （隣接セルのセグメントと CSS で視覚的に連結）
```

**週内一貫 lane の維持**:

- `KC.Lanes.assignLanes()` は週単位で実行し、イベントに `lane` を付与する（変更なし）
- 各セグメントの `top` = `lane * (BAR_H + BAR_GAP)` （全セルで同一 → まっすぐ繋がる）
- セルの `baseCapacity` を超える `lane` のセグメントは **そのセルだけ** 非表示にして +more にカウントする

**あふれ判定の日別化**:

各セル `colIdx` で個別に `baseCapacity` と比較する。

```
セル colIdx の使用スロット数 = そのセルの lane=0〜N のうち実描画数
overflow 判定: 使用スロット数 + 単日 chip 数 > baseCapacity
```

**連結見せ方の実装**:

- 連続するセグメントの左端 (`colStart` より後のセル) は `border-radius-left: 0`
- 連続するセグメントの右端 (`colEnd` より前のセル) は `border-radius-right: 0`
- セル境界で隙間が出ないよう `margin: 0; padding-right: BAR_X_GAP`（末尾のみ余白）
- 週をまたいで連続する場合は翌週先頭・前週末尾でも同様に処理

**DnD への影響**: §4 で詳述（大幅な変更が必要）

**メリット**:
- あふれ判定がセル単位になる → 根本問題解決
- spacer が不要になる（各セルの in-flow でバー位置が確定）
- `.kc-month-ad-events` の絶対配置レイヤを廃止できる（構造を単純化）
- `localMax` 方式 (`d3114a8`) も不要になる（削除できる）

**デメリット**:
- DnD が根本的に変わる（詳細は §4）
- +more で隠れているセルのセグメントは描画しないか visibility: hidden にするか要検討
- 連結の視覚的一貫性（バーが折れない）を CSS だけで担保する作り込みが必要

### 3.3 案 Y: 1 要素絶対配置＋セル単位クリップ方式（却下）

**概要**: バーは現行通り週全幅の 1 要素として絶対配置する。+more 判定とそのセルでの可視/不可視だけをセル単位で保持する。

**実現可能性の評価**:

1 要素の絶対配置 `div` を特定列だけ部分的に「非表示」にする方法:

- **clip-path / mask**: 列単位でクリップできるが、セル境界を動的に計算する必要がある。セルの幅が均等ではない（祝日・週末の色分けなどで幅が変わりうる）環境では不正確になる。
- **visibility: hidden**: 要素全体の表示/非表示しかできない。特定列だけ隠す手段がない。
- **overflow: hidden + 列幅分割 CSS**: 親要素で `overflow: hidden` してバーを一部隠す手法はテーブルレイアウト前提の CSS Trick であり、今の flex ベースのセル構造には適用不可。

**結論: 案 Y は技術的に実現不可**。「1 要素のまま特定列だけ非表示」は CSS/DOM で本質的に困難。却下。

### 3.4 段割当（lane/row）の週一貫維持と日別 overflow の両立方法

セグメント分割（案 X）採用前提での設計:

```
1. KC.Lanes.assignLanes(weekEvents)  ← 週内ソート + グリーディ lane 割当（変更なし）

2. 週内の各セル colIdx に対して:
   a. そのセルを「横切る」イベント（colStart <= colIdx < colStart+span）を列挙
   b. それらを lane 順に並べ、lane が baseCapacity を超えるものを overflow リスト入り
   c. overflow リストのイベントは +more に計上（セル colIdx のみ）
   d. 描画するセグメントは lane < baseCapacity のもののみ

3. lane 番号は週内で共通 → 全セルで同じ高さのレーンに描画 → バーがまっすぐ揃う
   ただし overflow セルではその lane のセグメントは描画しない（=バーが途切れる）
   Google カレンダー同様: バーが途切れる日があっても良い（仕様として許容）
```

**連続バー途切れの視覚影響（ユーザー確認事項）**: Google カレンダーでもある日は +more に隠れて途切れる。同アプリ（Wi-Fi貸与）では多数の長期バーが主役なのでこの途切れがどの程度許容されるかは要ユーザー判断（§8.1 参照）。

### 3.5 ソートルール（`commit 1a8cbe5` 確定）の維持

`KC.Lanes.assignLanes()` 内のソート（色あり降順 → 開始昇順 → 終了降順 → created 昇順 → id 昇順）は案 X でも変更しない。週内 lane 割当のロジック自体は維持し、セグメント描画時にその lane を参照する。

---

## 4. DnD・リサイズへの影響

### 4.1 現状 DnD の前提

月ビューの終日バー DnD は「1 本の `.kc-ad-event` 要素」に対して以下が配線されている。

| 処理 | 関連関数（ファイル:行） | 現状の前提 |
|---|---|---|
| 移動開始 | `startMoveAlldayMonth` (3181) | `barEl`（1 要素）の `mousedown` → `_drag.origBar = barEl` |
| 移動中ゴースト | `_onMoveAlldayMoveMonth` (2390) | `_positionMonthGhost` で `fixed` ゴーストを body に挿入 |
| リサイズ開始 | `startResizeAlldayMonth` (3214) | 左右ハンドルが `barEl` 内に内包される |
| ゴーストの位置 | `_positionMonthGhost` (3148) | `data-date` セルの `getBoundingClientRect` から固定ゴーストを配置 |
| span バーリサイズ | `startResizeTimedSpanMonth` | span バー用の左右リサイズハンドル（同様の構造） |
| chip 移動 | `startMoveMonthChip` (3397) | chip 要素（セル内）の `mousedown` |

### 4.2 案 X（セグメント化）での DnD 設計

**基本方針**: 複数セグメントのうち「表示されている 1 つのセグメント」に DnD ハンドラを配線する。非表示（+more に隠れた）セグメントからは DnD を起動しない。

| 変更点 | 内容 |
|---|---|
| `origBar` の概念 | 従来は 1 要素。案 X ではドラッグ対象セグメント要素 1 つ（例: 開始日セルのセグメント、または mousedown したセグメント） |
| 他セルのセグメント薄表示 | `kc-ad-event--dragging` を全セグメントに一括適用するため、同イベント ID を持つ全セグメントへの参照が必要 |
| ゴースト | `_positionMonthGhost` は変更不要（セル座標から fixed ゴーストを配置する仕組みは流用可能） |
| リサイズハンドル | 開始日セルのセグメントに左ハンドル、終了日セルのセグメントに右ハンドルを配置する（現行と同様） |

**週をまたいで +more に隠れるバーをドラッグする場合のエッジケース**:

- ある週では visible セグメントあり・別の週では全部 +more のとき: visible なセグメントから DnD 起動 → その週の終了日で新 end を計算する通常ロジックが適用される
- 開始日のセグメントが +more で隠れている日: その日の +more ポップオーバーから開くと編集ダイアログが表示される（DnD 不可）。DnD は visible なセグメントのみ起点とする

**工数への影響**: DnD は全面的に書き直す必要はないが、以下の変更が必要:

1. `startMoveAlldayMonth` / `startResizeAlldayMonth`: `barEl` の代わりにセグメント要素を受け取るように変更。全セグメント要素の参照を `_drag.allSegs` として保持する処理を追加。
2. `_onMouseUpAllday`: API 送信後の `placeMonthEvents` 再描画は変わらない。
3. セグメント生成関数（新設 `buildMonthAlldaySegment`）: `buildMonthAlldayBar` と同様だが `left: 0; width: 100%` のセル相対配置に変える。左端・右端の角丸有無を `isStart`/`isEnd` フラグで制御。

**リサイズ**: `startResizeAlldayMonth` のシグネチャは変わるが、月をまたぐリサイズの対象セルが変わるだけでロジックは維持できる。

### 4.3 +more で隠れたバーが含まれる週をドラッグしたときのエッジケース

現状: バーが +more に隠れていてもバー要素は DOM に存在する（visibility: hidden 等ではなく、描画対象外として `hiddenByCol` に記録されるが要素は生成されない）。

案 X: overflow セルにはセグメント要素を生成しない方針が最もシンプル。ただし開始日/終了日が overflow セルにある場合は、その日のリサイズハンドルが存在しない。→ **リサイズは visible なセグメントの端からのみ可能** とする仕様（ユーザー確認必要 §8.2）。

---

## 5. 既存資産との整合・破壊範囲

### 5.1 活かせる資産

| 資産 | 変更要否 | 理由 |
|---|---|---|
| `KC.Lanes.assignLanes()` | 変更なし | 週単位 lane 割当ロジックはそのまま再利用 |
| `KC.Lanes.eventToBarPosition()` | 変更なし | colStart/span 計算はセグメント描画でも使用 |
| `KC.Lanes.timedEventToBarPosition()` | 変更なし | 日跨ぎ時間予定の span 計算で再利用 |
| `_calcMaxItems()` | 変更なし | セル実高からの baseCapacity 算出はそのまま使用 |
| `applyOverflow()` | 変更なし | +N more 生成ロジックは変わらない |
| `KC.MonthOverflowPopup` | 変更なし | ポップオーバー機能はそのまま使用 |
| DnD ゴースト生成 (`_positionMonthGhost`) | 変更なし | fixed ゴーストの配置ロジックはそのまま使用 |
| Google風デザイン（1a8cbe5）の色・角丸 | 活かす | セグメント要素に同じスタイルを適用。左端/右端の角丸制御を追加 |
| BAR_H / BAR_GAP / BAR_X_GAP 定数 | 変更なし | サイズ定数は維持 |
| chip / +more の配置ロジック | 部分維持 | spacer 廃止、chip は従来通り in-flow |
| URL 同期（REQ_url-state-sync） | 影響なし | 描画レイヤの変更なので URL 状態とは独立 |

### 5.2 置換・破壊される資産

| 資産 | 影響 | 理由 |
|---|---|---|
| `buildMonthAlldayBar()` (4925) | 置換（新関数 `buildMonthAlldaySegment`）| 左端/右端フラグ追加、絶対配置を相対配置に変更 |
| `buildMonthTimedSpanBar()` (5069) | 置換（新関数 `buildMonthTimedSpanSegment`）| 同上 |
| `placeMonthAlldayEvents()` (5176) | 大幅改修 | セルごとにセグメント生成する方式に変更 |
| `placeMonthTimedSpanEvents()` (5275) | 大幅改修 | 同上 |
| `.kc-month-ad-events`（週全幅絶対配置レイヤ） | 削除または役割変更 | セグメントはセル内に収まるため不要になる可能性あり |
| `spacer`（`.kc-month-chip-spacer`）| 廃止 | セル in-flow でバーとchipが自然に積まれるため不要 |
| `localMax` 方式（`d3114a8`）| 廃止 | セグメント化で根本解決するため不要 |
| `effectiveLaneCount`（週共通値） | 廃止 | セル局所 lane カウントに置換 |
| `offsetLane`（alldayLaneCount + ev.lane）| 廃止 | セグメントはセル局所の lane 順に積む |

### 5.3 REQ との整合状況

| 既存 REQ | 影響区分 | 詳細 |
|---|---|---|
| REQ_month-cell-fixed-height（FR-1〜7）| 活かす（FR-1〜3, 5, 6 の意図は維持）| FR-4 の「終日+span の合計制限」はセグメント方式で自然に実現。FR-6 の spacer 方式は廃止（セル in-flow で代替）。FR-7（週行数動的化）は変更なし |
| REQ_month-overflow-spacer-fix（localMax 中間案）| 廃止 | セグメント化で spacer/usedSlots 問題が根本解決 |
| REQ_month-maxitems-too-few（a259ead）| 廃止 | chip の `+more` 常時確保廃止は維持。バー overflow のセル別判定が新実装に代わる |
| REQ_month-event-design-google（1a8cbe5）| 活かす | 色塗り・⏱アイコン・透明 chip・BAR_X_GAP はセグメントでも維持 |
| REQ_month-overflow-popup | 変更なし | hiddenByCol の構造が変わるが applyOverflow 呼び出しは維持 |
| REQ_month-dnd（DnD 全般）| 影響あり（§4 参照）| セグメント化に伴う DnD 配線変更が必要 |
| REQ_month-cell-fixed-height FR-5（リサイズ再計算）| 変更なし | placeMonthEvents 再実行フローは維持 |
| URL 同期（REQ_url-state-sync）| 変更なし | |

---

## 6. 段階導入フェーズ案と工数感

### 6.1 フェーズ分割の方針

全体を一度に変えるリスクが高いため（DnD・デザイン・overflow 判定がすべて連動）、以下の 3 フェーズに分割する。

### フェーズ 1: セグメント化描画の実装（DnD なし）

**目的**: バーを日ごとのセグメント要素に変え、セル単位の overflow 判定を実現する。DnD は後フェーズで対応するため、フェーズ 1 では DnD を一時的に無効化またはセグメント先頭要素にのみ付ける最小限実装とする。

**変更範囲**:
- `buildMonthAlldayBar` → `buildMonthAlldaySegment`（新設、左右角丸フラグ追加）
- `buildMonthTimedSpanBar` → `buildMonthTimedSpanSegment`（新設、同上）
- `placeMonthAlldayEvents` の大幅改修（セルループ内にセグメント生成を移動）
- `placeMonthTimedSpanEvents` の大幅改修（同上）
- `placeMonthTimedEvents` の spacer 廃止（セル in-flow で代替）
- `.kc-month-ad-events` の CSS 変更（セル幅基準に変更）
- `placeMonthEvents` のセルループ改修（セル別 overflow 判定）

**規模**: **L**（200〜400 行規模の改修。既存の placeMonthAlldayEvents/placeMonthTimedSpanEvents 全体が書き換えになる）

**実機検証範囲**:
- 各日の overflow が独立して動作すること（「ある日は表示・隣の日は +more」が正常に機能する）
- バーが連結して見えること（角丸の有無が正しく制御される）
- +more クリックで正しい件数のポップオーバーが表示される
- リサイズ・全画面切替で再描画が正常動作する
- DnD は未検証（フェーズ 1 では無効または最小限のみ）

### フェーズ 2: DnD 作り直し

**目的**: フェーズ 1 で変わったセグメント構造に合わせて DnD を再配線する。

**変更範囲**:
- `startMoveAlldayMonth`: セグメント要素対応。全セグメント参照の `_drag.allSegs` 追加
- `startResizeAlldayMonth`: 左ハンドルは開始日セグメント、右ハンドルは終了日セグメントに分離
- `_onMoveAlldayMoveMonth`: 移動中の全セグメント薄表示ロジック
- `startMoveMonthChip`: chip のセグメント移動（chip 自体はセル内要素のまま → ほぼ変更なし）
- `startResizeTimedSpanMonth`: 日跨ぎ時間予定バーの span バーリサイズ対応

**規模**: **M**（100〜200 行。DnD 関数群の改修。ゴースト生成・API 送信ロジックは流用可能）

**実機検証範囲**:
- 終日バーの移動（複数週をまたぐ長期バーを含む）
- 終日バーのリサイズ（左端・右端ハンドル）
- overflow セル（+more）にある日のバーを DnD する際のエッジケース
- span バーの移動・リサイズ

### フェーズ 3: 後処理・整理

**目的**: フェーズ 1〜2 で不要になった旧コードの除去と CSS 整理。

**変更範囲**:
- `localMax` 方式コードの削除（`placeMonthTimedSpanEvents` の `alldayColLaneCounts` 関連処理）
- `spacer`（`.kc-month-chip-spacer`）関連 CSS/JS の削除
- `effectiveLaneCount`/`offsetLane` 変数の削除
- REQ_month-overflow-spacer-fix の暫定コード削除
- CSS の `.kc-month-ad-events` ルール整理

**規模**: **S**（50 行未満。コード除去とテストのみ）

**実機検証範囲**: 全機能リグレッションテスト

### 6.2 最小中間ゴール（フェーズ 1 のみで体感改善可能か）

フェーズ 1（DnD なし）だけで以下が実現できる:

- **余白問題解消**: spacer 廃止 + セル in-flow により、終日バーがないセルに不要な余白が発生しない
- **件数不足解消**: セル単位 overflow 判定により「他日のバーに引っ張られた打ち切り」がなくなる

Wi-Fi 貸与アプリの主要ユースケース（複数日バーの閲覧）はフェーズ 1 だけで大幅に改善する。DnD（予約の日程変更）はフェーズ 2 待ちとなるが、フェーズ 1 実施後の実機確認でユーザーが「閲覧性が目に見えて改善した」と判断できれば、フェーズ 2 を続けて進めるかどうかをユーザーが判断できる。

**最小中間ゴール: フェーズ 1 の完了 = 余白・件数問題の体感改善**

---

## 7. 受入基準（目標状態）

全フェーズ完了後の検証可能な受入基準を Given/When/Then で記述する。

### AC-1 セル単位 overflow 判定（フェーズ 1）

- **Given**: 同一イベント（3 日間）が存在し、1 日目は空いているが 2 日目は baseCapacity に達している
- **When**: 月ビューを表示する
- **Then**: 1 日目のセルにはそのイベントのバーが表示される
- **And**: 2 日目のセルでは `+N more` にそのイベントが含まれ、バーは表示されない

### AC-2 バーの連結表示（フェーズ 1）

- **Given**: 複数日にわたるバーが存在する
- **When**: 月ビューを表示する
- **Then**: 隣接するセルのセグメントが視覚的に 1 本のバーとして連結して見える（境界で角丸がなく隙間がない）
- **And**: 週をまたぐ場合は前週末・後週先頭で途切れるが、週内は連結されている

### AC-3 余白解消（フェーズ 1）

- **Given**: ある週の月曜に終日バーが 1 本あるが木曜にはバーがない。木曜には単日予定 3 件ある。baseCapacity=3
- **When**: 月ビューを表示する
- **Then**: 木曜セルに単日予定 3 件が chip として表示される
- **And**: 木曜セルに不要な spacer 余白がなく `+N more` が表示されない

### AC-4 段の一貫性（フェーズ 1）

- **Given**: 同じ週内に 2 本の複数日バーがある
- **When**: 月ビューを表示する
- **Then**: 各バーは週内の全セル（表示されているセル）で同じ段（高さ）に表示される

### AC-5 DnD 移動（フェーズ 2）

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーをドラッグして別の日付セルにドロップする
- **Then**: kintone レコードの日付が更新され、カレンダーが再描画される
- **And**: 移動先が +more に隠れているセルへのドロップも正常に動作する

### AC-6 DnD リサイズ（フェーズ 2）

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーの右端ハンドルをドラッグして期間を延長する
- **Then**: kintone レコードの end 日付が更新され、カレンダーが再描画される

### AC-7 既存機能リグレッション（全フェーズ）

- **Given**: フェーズ完了後の実装
- **When**: 月ビューの既存機能（+N more ポップオーバー、検索バー、URL 同期、ビュー切替、全画面モード）を操作する
- **Then**: 各機能が変更前と同等に動作する

---

## 8. 未確定事項・リスク・要ユーザー判断

### 8.1 [要ユーザー判断] バーが途切れる日の許容

**事項**: dayGrid 方式ではバーが +more に隠れた日にセグメントが描画されない。したがってバーは「入らない日で途切れる」。Google カレンダーでも同様の挙動。

**リスク**: Wi-Fi 貸与の長期予約（例: 7 日間）において、中間日で途切れた場合に「予約が取れているのに一部の日にバーが見えない」という混乱が起きないか。

**確認ポイント**: ユーザーは Google カレンダー同様の「途切れあり」を許容できるか。許容不可なら「途切れ日でも常にバーを 1 本は表示する」仕様（baseCapacity の 1 本目は必ず確保）を追加検討する必要がある。

### 8.2 [要ユーザー判断] overflow セルのリサイズ制約

**事項**: 開始日または終了日のセグメントが +more に隠れている場合、そのハンドルでのリサイズが不可になる（visible セグメントの端にしかハンドルが配置されない）。

**リスク**: 「リサイズしたいのにハンドルが見えない」場面が生じうる。

**対応候補**: +more ポップオーバーから編集ダイアログを開いてフォームで日付変更する回避策を案内する、またはリサイズハンドルの visible セグメントへの移設ロジックを追加する。

### 8.3 [設計リスク] 週をまたぐバーの連結 CSS の複雑さ

**事項**: セグメントを「左端なし角丸」「右端なし角丸」「両端なし（週途中のみ）」「両端あり（単日）」の 4 パターンで制御する必要がある。CSS クラス 2〜3 個の組み合わせで実現できる想定だが、実装時に flexbox/grid のセル境界における誤差（1px ずれ）が生じる可能性がある。

**対応**: builder が試作ブランチで先に CSS 連結パターンを確認してから描画ロジック本体に着手することを推奨。

### 8.4 [設計リスク] `.kc-month-ad-events` レイヤの扱い

**事項**: 現状の `.kc-month-ad-events` は週全幅の絶対配置レイヤ。セグメント化後はセル内に収まるため、このレイヤを廃止してセル内 in-flow に変えるか、セル単位の `.kc-month-ad-events` に変えるか要検討。

**DnD ghost との関係**: 現状の月ビュー DnD ゴーストは `position: fixed` で body に直接挿入される方式（`_positionMonthGhost` 参照）。これはレイヤを変えても影響しない。

### 8.5 [前提] src / docs 版への同期タイミング

本修正の正本は `plugin/src/js/desktop.js` / `plugin/src/css/desktop.css`。`src/kc-calendar.js` および `docs/kc-calendar.js` は旧版扱いであり、同期は管理者判断による。

### 8.6 [確認済み] 余白がある程度残る点の許容

**結論: 許容する（設計上の制約として明記）**。

dayGrid 方式でも段を週内で揃えることで「入らない日の lane 分の空きスペース」は残る（Google カレンダーも同様）。これは「まっすぐ繋がって見せる」要件と「余白ゼロ」要件を同時に満たすことが構造的に不可能であることによる。

改善後の余白は「他日の終日バー由来の不当な余白（現状の問題）」ではなく「段を揃えるための構造的余白（Google カレンダー同様）」であり、許容範囲内と判断する。

---

## 9. 参照先・関連資料

| 資料 | パス | 参照理由 |
|---|---|---|
| 正本 JS | `plugin/src/js/desktop.js` | 現状コード（全調査対象） |
| 正本 CSS | `plugin/src/css/desktop.css` | 月ビュースタイル |
| セル高固定要件 | `requirements/REQ_month-cell-fixed-height.md` | FR-1〜7 との整合確認（特に FR-6, FR-7） |
| localMax 中間案 | `requirements/REQ_month-overflow-spacer-fix.md` | フェーズ 3 で廃止する対象コードの記述元 |
| 件数修正要件 | `requirements/REQ_month-maxitems-too-few.md` | フェーズ 1 で代替される修正の要件 |
| Googleカレンダー風デザイン | `requirements/REQ_month-event-design-google.md` | セグメント要素に引き継ぐスタイル仕様 |
| DnD 要件 | `requirements/REQ_month-dnd.md` | フェーズ 2 で参照する DnD 受入基準 |
| KC.Lanes 定義 | `plugin/src/js/desktop.js:3629` | assignLanes の仕様確認 |
| buildMonthAlldayBar | `plugin/src/js/desktop.js:4925` | フェーズ 1 で置換する関数 |
| buildMonthTimedSpanBar | `plugin/src/js/desktop.js:5069` | フェーズ 1 で置換する関数 |
| placeMonthAlldayEvents | `plugin/src/js/desktop.js:5176` | フェーズ 1 で大幅改修する関数 |
| placeMonthTimedSpanEvents | `plugin/src/js/desktop.js:5275` | フェーズ 1 で大幅改修する関数 |
| placeMonthEvents | `plugin/src/js/desktop.js:5449` | フェーズ 1 でセルループを改修する関数 |
| startMoveAlldayMonth | `plugin/src/js/desktop.js:3181` | フェーズ 2 で改修する DnD 関数 |
| startResizeAlldayMonth | `plugin/src/js/desktop.js:3214` | フェーズ 2 で改修する DnD 関数 |
| _positionMonthGhost | `plugin/src/js/desktop.js:3148` | フェーズ 2 でほぼ変更不要のゴースト配置関数 |
