# REQ_month-overflow-spacer-fix: 月ビュー usedSlots 過大計上によるスペーサー余白・+N more 過多不具合の修正

**文書番号**: REQ_month-overflow-spacer-fix
**作成日**: 2026-06-17
**最終更新日**: 2026-06-19（第 3 版: §12 追補）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js`
**対象ファイル（従／同期対象）**: `src/kc-calendar.js`, `docs/kc-calendar.js`
**ステータス**: 第 3 版・未確定事項あり（§7、§11.6、§12.6 参照）

---

## 改訂履歴

| 版 | 日付 | 変更概要 |
|---|---|---|
| 初版 | 2026-06-17 | 新規作成 |
| 第 2 版 | 2026-06-19 | §11 追補: span バー絶対配置 top の余白問題（effectiveLaneCount 週共通値の影響）を分析。場合分け (a)/(b) の判定、連結描画の構造確認、推奨方針を追加 |
| 第 3 版 | 2026-06-19 | §12 追補: 中間案（跨ぐ列の終日本数最大値で top を決める）の実装可否評価、spacer 局所化修正との整合分析、builder への具体的変更指示を追加 |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（調査結果）](#2-現状分析調査結果)
3. [要件](#3-要件)
4. [修正方針の比較検討](#4-修正方針の比較検討)
5. [修正対象箇所一覧](#5-修正対象箇所一覧)
6. [受入基準](#6-受入基準)
7. [未確定事項・リスク・前提](#7-未確定事項リスク前提)
8. [検証項目・テストシナリオ](#8-検証項目テストシナリオ)
9. [想定 UX / シーケンス](#9-想定-ux--シーケンス)
10. [関連資料](#10-関連資料)
11. [追補: span バー絶対配置 top の余白問題（第 2 版）](#11-追補-span-バー絶対配置-top-の余白問題第-2-版)
12. [追補: 中間案（跨ぐ列の終日本数最大値で top を決める）の実装可否評価（第 3 版）](#12-追補-中間案跨ぐ列の終日本数最大値で-top-を決める実装可否評価第-3-版)

---

## 1. 背景・目的

### 1.1 問題の概要

月ビューで同じ週の別の日に「終日バー」または「日跨ぎ時間予定バー（span バー）」がある場合に、**それらのバーが存在しない日のセルにも週共通レーン分のスペーサー（`spacer`）高さが確保され、その分だけ chip 表示枠（`remaining`）が不当に削減される**。結果として本来表示できるはずの単日時間予定が表示されず、不要な「+N more」が出現する。

### 1.2 発生条件

本番環境（k 本番）で再現。同じ週に複数のテストレコードを作成した際に発生。

- ある日（例: 火曜）に終日バーや span バーがある
- その週の別の日（例: 木曜）には終日バー・span バーが存在しない
- 木曜セルにも火曜分の `usedSlots` が波及し、chip 表示枠が削減される

### 1.3 本要件の目的

`usedSlots`（セルのバー占有スロット数）をセル局所の実描画数に基づいて正確に算出するよう修正し、バーが存在しないセルにスペーサーが過大挿入されて chip 枠が削減される不具合を解消する。

---

## 2. 現状分析（調査結果）

### 2.1 関連する既存仕様（REQ_month-cell-fixed-height.md 第 5 版）の前提

既存要件 `REQ_month-cell-fixed-height.md`（確定版第 5 版）では以下の仕様が確定・実装済みである。本修正はこれらを破壊してはならない。

- **FR-4**: 終日バー・span バーの合計スロット数が `maxItems - 1` を超えないよう件数制限する
- **FR-5**: ウィンドウリサイズ・全画面切替時に `placeMonthEvents()` を再実行し `maxItems` を再計算する
- **FR-6**: chip が 0 本でも `usedSlots > 0` なら spacer を必ず挿入する（最終スロット+1 方式）。+N more がバー群より上に表示される視覚的逆転（§2.6 問題）を防ぐ仕様

### 2.2 問題の核心：「週共通レーン値」と「セル局所バー数」の乖離

#### placeMonthTimedSpanEvents（plugin/src/js/desktop.js:5288-5295）

```javascript
// 各列のスロット数（終日 + span）を更新（制限内のもののみ）
for (var ci = ev.colStart; ci < ev.colStart + ev.span; ci++) {
  if (ci >= 0 && ci < 7) {
    result.colLaneCounts[ci] = Math.max(
      result.colLaneCounts[ci],
      offsetLane + 1   // ← offsetLane = alldayLaneCount + ev.lane（週共通値）
    );
  }
}
```

`offsetLane` は「週全体の終日バー有効レーン数（`alldayLaneCount`）+ span バー固有レーン番号（`ev.lane`）」であり、**そのバーが span する全セル列に一律同じ値を書き込む**。

たとえば月曜〜水曜にかかる span バー（lane=0, alldayLaneCount=1）がある場合:

```
colLaneCounts = [2, 2, 2, 0, 0, 0, 0]
                 ↑月 ↑火 ↑水 ↑木...   木曜以降は 0 のまま
```

これ自体はバーが実際に月〜水に描画されているので正しい。

問題は、**終日バーが「月・火」のみに存在するケース**（例）で起きる。

```
終日バー A: 月〜火にかかる（lane=0）
span バー B: 火〜木にかかる（alldayLaneCount=1, ev.lane=0 → offsetLane=1）
```

`placeMonthAlldayEvents` の `colLaneCounts`（plugin/src/js/desktop.js:5201-5207）:

```
alldayResult.colLaneCounts = [1, 1, 0, 0, 0, 0, 0]
                               ↑月 ↑火 ↑水 ↑木...  水曜以降は 0
```

`placeMonthTimedSpanEvents` の `colLaneCounts`（plugin/src/js/desktop.js:5288-5295）:

```
spanResult.colLaneCounts = [0, 2, 2, 2, 0, 0, 0]
                              ↑月 ↑火 ↑水 ↑木  ← 木曜に span バーが実描画されているので木=2 は正しい
```

`placeMonthEvents` での `usedSlots` 算出（plugin/src/js/desktop.js:5493）:

```javascript
var usedSlots = spanResult.colLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0;
```

この式は「`spanResult` が 0 なら `alldayResult` にフォールバック」する。

#### 問題が起きる具体的ケース

**ケース: 同週、別の列にバーがある。本日のセル（木曜）にはバーなし**

```
週構成（月〜日）:
  月: 終日バー A のみ（alldayResult.colLaneCounts[0] = 1, spanResult.colLaneCounts[0] = 0）
  火: 終日バー A + span バー B（alldayResult[1] = 1, spanResult[1] = 2）
  水: span バー B のみ（alldayResult[2] = 0, spanResult[2] = 2）
  木: バーなし（alldayResult[3] = 0, spanResult[3] = 0）
  金: 単日時間予定 3 件
```

木曜の `usedSlots = spanResult[3] || alldayResult[3] || 0 = 0`。これは正しい。

**しかし問題のケースは異なる構造で起きる。**

`placeMonthTimedSpanEvents` で `offsetLane = alldayLaneCount + ev.lane` を計算する際、`alldayLaneCount` は **週全体の終日バー有効レーン数（`alldayResult.effectiveLaneCount`）** が渡される（plugin/src/js/desktop.js:5484）。

```javascript
var spanResult = placeMonthTimedSpanEvents(
  weekEl, weekYMD, weekTimedSpan, alldayResult.effectiveLaneCount, maxItems
);
```

`alldayResult.effectiveLaneCount` は「週のどこかに終日バーがある限り 1 以上になる」週共通値である。

**問題が発生する具体例**:

```
週構成:
  月: 終日バー A（alldayResult.effectiveLaneCount = 1）
  火: span バー B（火〜水）
  水: span バー B の末尾
  木: 単日時間予定 3 件、バーなし

spanResult の計算:
  span バー B の offsetLane = alldayLaneCount(1) + ev.lane(0) = 1
  → colLaneCounts[1] = 2（火）
  → colLaneCounts[2] = 2（水）
  （木はバーがないので colLaneCounts[3] = 0）

木曜の usedSlots = spanResult.colLaneCounts[3] || alldayResult.colLaneCounts[3] || 0
                 = 0 || 0 || 0 = 0  ← これは木曜に限っては正しい
```

実はこのケースでは `usedSlots` は 0 になっており問題は起きない。

**真の問題ケース: 終日バーが木曜を跨いでいる場合**

```
週構成:
  月〜木: 終日バー A（4 日間）
  火〜水: span バー B
  木: 単日時間予定 3 件

alldayResult.colLaneCounts:
  [1, 1, 1, 1, 0, 0, 0]  ← 月〜木に終日バー A（lane=0 → colLaneCounts = 1）

alldayResult.effectiveLaneCount = 1（週共通）

spanResult（span バー B: 火〜水、offsetLane = 1+0 = 1）:
  colLaneCounts[1] = Math.max(0, 1+1) = 2
  colLaneCounts[2] = Math.max(0, 1+1) = 2

木曜の usedSlots = spanResult.colLaneCounts[3] || alldayResult.colLaneCounts[3] || 0
                 = 0 || 1 || 0 = 1
```

この場合、木曜は終日バー A が実際に描画されているので `usedSlots = 1` は**正しい**。

**さらに絞り込む: 問題が起きる正確な条件**

報告された不具合「バーが存在しない日のセルにも週共通レーン分の spacer が確保される」は、以下の構造で起きる。

```
週構成:
  月: span バー C（月〜火。alldayLaneCount=0 の週）
  火: span バー C の末尾
  水: 単日時間予定 N 件。バーなし。
  木: 単日時間予定 M 件。バーなし。

alldayResult.effectiveLaneCount = 0（終日バーなし）

spanResult（span バー C: 月〜火、offsetLane = 0+0 = 0）:
  colLaneCounts[0] = 1（月）
  colLaneCounts[1] = 1（火）
  colLaneCounts[2] = 0（水: 正しい）

水曜の usedSlots = 0 → 問題なし
```

この単純なケースでは問題が起きない。**問題が起きるのは span バーが週を大きく跨ぐ場合**:

```
週構成:
  月: span バー D（月〜金、5 日間。alldayLaneCount=0）
  水: 単日時間予定 3 件

spanResult（span バー D: 月〜金、offsetLane=0）:
  colLaneCounts[0] = 1, [1] = 1, [2] = 1, [3] = 1, [4] = 1

水曜の usedSlots = spanResult.colLaneCounts[2] = 1  ← span バーが実際に水曜を跨いでいるので正しい
```

**これも正しい**。span バー D は水曜を実際に跨いで描画されている。

ここで問題のケースに戻る。実際の不具合報告を精査すると、問題は「**別の日の span バーが存在するだけで、バーが跨いでいない日の usedSlots が増える**」というものではなく、以下の構造:

**真の不具合構造: alldayLaneCount の週共通伝播による spacer 過大計上**

```
週構成:
  月: 終日バー A（1 本）
  水: 日跨ぎ span バー B（水〜木）。alldayLaneCount = alldayResult.effectiveLaneCount = 1（月の終日バー由来）
  木: 単日時間予定 3 件。「終日バーなし・span バー B の末尾は実描画あり」

spanResult（span バー B: 水〜木、alldayLaneCount=1, ev.lane=0 → offsetLane=1）:
  colLaneCounts[2] = 2（水）
  colLaneCounts[3] = 2（木）← 木曜は span バーが実描画されている（正しい）

木曜の usedSlots = spanResult.colLaneCounts[3] = 2
  → spacer 高さ = 2×24 + 1×3 = 51px
  → remaining = maxItems - 2（maxItems=3 の場合: remaining=1）
  → 本来 3 件表示できるはずが 1 件しか表示できない
```

ただし、この場合も「木曜に span バー B が実際に描画されている」ので `usedSlots=2` は**正しい**。问题は木曜に span バー B が実描画されている分の usedSlots に加えて、**月曜の終日バー由来の alldayLaneCount=1 が木曜セルの usedSlots に嵩上げされている**点。

正確には: 木曜には終日バーが実際に存在しないが、span バー B の `offsetLane = 1` の「1」が `alldayLaneCount=1`（月曜の終日バー由来）を含んでいるため、木曜の `colLaneCounts[3] = 2` の内訳が「終日バー 1 本 + span バー 1 本」を意味するにもかかわらず、**実際の木曜のセルには終日バーが存在しない**。

結果として:
- spacer 高さは `2本分 = 51px` 確保される
- しかしセルの絶対配置レイヤ（`.kc-month-ad-events`）には span バー B が `top = dateline_h + offsetLane * pitchPx = dateline_h + 1 * 27` の位置に描画されている
- **spacer の高さ（51px）は span バー B の実際の占有高さと一致しているのでレイアウト自体は正しい**
- しかし「終日バーが実際には存在しない」木曜の chip 表示枠が `maxItems - 2 = 1` に削減されてしまう

### 2.3 正確な不具合定義

#### セル局所の実描画バー数 vs 週共通 offsetLane 由来の usedSlots の乖離

`placeMonthTimedSpanEvents` における `offsetLane = alldayLaneCount + ev.lane` は次の 2 つの合成:

1. `alldayLaneCount`（`alldayResult.effectiveLaneCount`）= 週内いずれかのセルに終日バーがある場合の**週共通**オフセット
2. `ev.lane` = span バーのレーン番号

`colLaneCounts[ci] = offsetLane + 1` は「そのセルに終日バーも span バーも実描画されている」前提の値だが、**終日バーが実際にそのセルに存在しない場合でも `alldayLaneCount` 分が加算されてしまう**。

これにより:
- セル局所での実描画バー本数 = span バー 1 本のみ（終日バーなし）
- `usedSlots` に記録される値 = 2（終日バーオフセット 1 + span レーン 1）

**spacer 高さは `usedSlots=2` 本分（51px）確保され、chip 表示枠は maxItems から 2 を引いた値になる。セルに実際に見えるバーは span バー 1 本なので、spacer がバー 1 本分多く確保されていることになる。**

### 2.4 既存実装の現状確認（plugin/src/js/desktop.js の実コード）

| 箇所 | 行番号（概算） | 現状の動作 |
|---|---|---|
| `placeMonthTimedSpanEvents()` の `colLaneCounts` 記録 | 5288-5295 | `offsetLane + 1` をバー span 全列に記録。`offsetLane = alldayLaneCount + ev.lane` |
| `placeMonthEvents()` の `usedSlots` 算出 | 5493 | `spanResult.colLaneCounts[colIdx] \|\| alldayResult.colLaneCounts[colIdx] \|\| 0` |
| `placeMonthTimedEvents()` の spacer 挿入 | 5339-5356 | `usedSlots > 0` なら spacer を挿入（FR-6 確定仕様） |
| `placeMonthTimedEvents()` の `remaining` | 5360 | `remaining = maxItems - usedSlots` |

### 2.5 問題のある数値例

**条件**: maxItems=3、木曜セル

| 項目 | 現状 | あるべき姿 |
|---|---|---|
| alldayResult.effectiveLaneCount（週共通） | 1 | 1 |
| alldayResult.colLaneCounts[木曜] | 0（終日バーなし） | 0 |
| spanResult.colLaneCounts[木曜] | 2（span バー B の offsetLane+1） | 1（span バー B は実描画 1 本だが終日オフセット分が乗っている） |
| usedSlots（木曜） | 2 | 1（span バー 1 本分） |
| spacer 高さ | 51px（2 本分） | 27px（1 本分）OR 現状維持（後述 §4 参照） |
| remaining | 1 | 2 |
| 表示できる chip 数 | 1 件 | 2 件 |

---

## 3. 要件

### 3.1 機能要件

#### FR-1: セル局所で実際に見える span バー本数を usedSlots に正確に反映する

- `placeMonthTimedEvents()` に渡す `usedSlots` は、そのセルに**実際に描画されているバー（終日バー + span バー）の合計本数**に基づいていること
- span バーの `offsetLane` に週共通 `alldayLaneCount` が含まれていても、そのセルに終日バーが**実際には存在しない**場合は、終日バー分のスロットを `usedSlots` に加算しないこと

#### FR-2: spacer 高さと chip 表示枠の整合性を維持する（FR-6 との両立）

- `placeMonthTimedEvents()` の spacer 挿入は FR-6（最終スロット+1 方式）の確定仕様を維持する
- 「chip が 0 本でも `usedSlots > 0` なら spacer を挿入する」動作は変更しない
- spacer 高さと span バーの絶対配置上端が視覚的に一致すること（chip がバーに重ならないこと）

#### FR-3: chip 表示枠の正確な算出

- `remaining = maxItems - usedSlots` の `usedSlots` が修正後の正確な値になることで、不当に削減されていた chip 表示枠が回復すること
- 修正前に不要な「+N more」が表示されていたセルで、chip が正しい件数表示されること

#### FR-4: 既存確定仕様（REQ_month-cell-fixed-height.md FR-4/FR-5/FR-6）を壊さないこと

- 終日バー・span バーの合計スロット数が `maxItems - 1` を超えないよう件数制限する FR-4 の動作を維持する
- ウィンドウリサイズ・全画面切替時の再計算（FR-5）を維持する
- chip 0 本でも `usedSlots > 0` なら spacer を挿入する FR-6 の最終スロット+1 方式を維持する
- `+N more` の可視性保証（`hiddenCount > 0` のセルで `+N more` がクリップされない）を維持する

### 3.2 非機能要件

#### NFR-1: 絶対配置バーと flex フロー内要素の視覚的整合を維持する

- span バーは `.kc-month-ad-events` レイヤに絶対配置（`top = dateline_h + offsetLane * pitchPx`）されており、その上端位置はレーンと `alldayLaneCount` に依存する
- spacer 高さを変更する場合は、spacer 下端（= chip 開始位置）が span バー下端と一致するよう計算すること
- spacer 高さを変更することで chip が span バーと重なる事態を発生させないこと

#### NFR-2: 既存の描画シーケンス（placeMonthEvents のオーケストレーション）を大きく変えない

- `placeMonthAlldayEvents` → `placeMonthTimedSpanEvents` → セルごとの `placeMonthTimedEvents` の呼び出し順序を変更しない
- 各関数のシグネチャ変更は最小限にとどめる

---

## 4. 修正方針の比較検討

### 4.1 問題の整理

問題の本質は次の 2 つの値が乖離していること:

- **A**: そのセルで `span バーが実際に描画される top 位置**（= `dateline_h + offsetLane * pitchPx`。`offsetLane = alldayLaneCount + ev.lane` を使用）
- **B**: そのセルで `spacer` が確保すべき高さ（= `usedSlots * BAR_H + (usedSlots - 1) * BAR_GAP`）

現状は `usedSlots = spanResult.colLaneCounts[colIdx] = offsetLane + 1` なので A と B は一致している。問題は「**終日バーが実際にそのセルに存在しない場合でも `alldayLaneCount` 分が usedSlots に含まれており、chip 表示枠が削減される**」点。

つまり:
- spacer 高さとバー top 位置の整合は取れている（レイアウトは正しい）
- chip 枠計算（`remaining = maxItems - usedSlots`）だけが過大に削減されている

### 4.2 案 A: セルごとの実描画バー数で usedSlots を再計算

**方針**:
`usedSlots`（spacer 挿入用）はそのまま `spanResult.colLaneCounts[colIdx]` を使い、`remaining`（chip 枠）の計算にだけ「そのセルに実際に存在する終日バー本数 + span バー本数」を使う分離設計にはしない。代わりに `spanResult.colLaneCounts[colIdx]` の記録値を「そのセルで実際に描画される span バーの占有スロット数（終日バー実描画分を加算した正確な値）」に修正する。

具体的には:
- `placeMonthAlldayEvents` の `colLaneCounts[ci]` は現状の「そのセルで実描画された終日バーの最大レーン+1」を維持（正しい）
- `placeMonthTimedSpanEvents` の `colLaneCounts[ci]` を「`offsetLane + 1`（週共通値）」から「`alldayResult.colLaneCounts[ci]`（そのセルの実終日バー数）+ `ev.lane + 1`（span バー固有スロット）」に変える

変更イメージ（`placeMonthTimedSpanEvents` 内、plugin/src/js/desktop.js:5288-5295 付近）:

```javascript
// 現状:
result.colLaneCounts[ci] = Math.max(
  result.colLaneCounts[ci],
  offsetLane + 1   // alldayLaneCount（週共通）+ ev.lane + 1
);

// 案 A:
// alldayColLaneCounts[ci] = そのセルの実終日バー数（関数引数として受け取る）
result.colLaneCounts[ci] = Math.max(
  result.colLaneCounts[ci],
  alldayColLaneCounts[ci] + (ev.lane || 0) + 1
);
```

`placeMonthTimedSpanEvents` のシグネチャを変更し、`alldayLaneCount`（週共通スカラー）の代わりに `alldayColLaneCounts`（7 要素配列）を受け取るよう修正する。ただし絶対配置の `top` 計算（`offsetLane * pitchPx`）は週共通 `alldayLaneCount` に基づいており変更しない。

**絶対配置 top との整合確認**:
- span バーの `top = dateline_h + offsetLane * pitchPx`。`offsetLane = alldayLaneCount（週共通）+ ev.lane`。変更しない。
- spacer 高さ = `usedSlots * BAR_H + (usedSlots - 1) * BAR_GAP`
- `usedSlots = alldayColLaneCounts[ci]（セル局所） + ev.lane + 1`

**ズレが生じるか？**

例: alldayLaneCount=1（週共通）、alldayColLaneCounts[木]=0（木曜に終日バーなし）、ev.lane=0

- 案 A の `usedSlots` = 0 + 0 + 1 = 1 → spacer 高さ = 1 × 24 = 24px
- span バーの `top = dateline_h + 1 * pitchPx = dateline_h + 27px`（offsetLane=1 で週共通計算）

spacer 下端（dateline_h + 24px）< span バー上端（dateline_h + 27px）。ギャップ 3px（= BAR_GAP）が生じるが、span バー上端より chip 開始位置が上にある状態。chip は `spacer` の下に flex フローで続くため、spacer 高さが span バーの上端より低い場合、**chip が span バーに重なる可能性がある**。

正確に言えば:
- spacer 下端 = dateline_h + usedSlots * BAR_H + (usedSlots-1) * BAR_GAP
- span バー上端 = dateline_h + offsetLane * pitchPx（= offsetLane * (BAR_H + BAR_GAP)）

案 A では `usedSlots = alldayColLaneCounts[ci] + ev.lane + 1` を使う。

`offsetLane = alldayLaneCount（週共通）+ ev.lane` に対し `usedSlots = alldayColLaneCounts[ci] + ev.lane + 1`。

alldayColLaneCounts[ci] < alldayLaneCount の場合（= そのセルに週共通より少ない終日バー実描画数）:

`usedSlots < offsetLane + 1` → spacer 高さ < span バー上端 → **chip が span バーと重なるリスクあり**

**評価**:

| 観点 | 評価 |
|---|---|
| chip 枠（remaining）の正確化 | 達成（セル局所バー数で計算） |
| chip 重なりリスク | **あり**。spacer 高さが span バー上端を下回る場合に chip が絶対配置バーに重なる可能性がある |
| +N more の可視性（FR-6） | 維持。usedSlots が正確化されるため spacer も適切な高さになる |
| Google カレンダー的バー揃え | 影響なし（span バーの top 計算は変更しない） |
| 実装難易度 | 中（シグネチャ変更必要）|

**重なりリスクの詳細確認**:

実際のケースで計算する:
- alldayLaneCount=1、alldayColLaneCounts[木]=0、ev.lane=0（span バー 1 本）
- span バー top = dateline_h + 1 * 27 = dateline_h + 27
- 案 A の spacer 高さ = 1 * 24 + 0 * 3 = 24px
- spacer 下端 = dateline_h + 24
- span バー上端 = dateline_h + 27（pitchPx=27）
- chip は dateline_h + 24 以降に配置される → **span バー上端（dateline_h+27）の 3px 手前から chip が始まる**

chip 高さは BAR_H = 24px なので chip の下端 = dateline_h + 24 + 24 = dateline_h + 48。span バー下端 = dateline_h + 27 + 24 = dateline_h + 51。

**chip の範囲: dateline_h+24 〜 dateline_h+48。span バーの範囲: dateline_h+27 〜 dateline_h+51。重複あり（3px〜24px の範囲で重なる）。**

したがって案 A はそのままでは chip 重なりを引き起こす。回避するには spacer 高さを「span バー下端位置」まで確保する必要がある（後述 §4.4）。

### 4.3 案 B: spacer 高さは週共通レーンのまま、remaining 計算だけセル局所バー数に基づかせる

**方針**:
`usedSlots`（spacer 用）と `localUsedSlots`（chip 枠計算用）を分離する。

- `usedSlots`（spacer 高さ計算用）= 現状の `spanResult.colLaneCounts[colIdx]`（週共通 offsetLane 基準）を維持 → FR-6 の spacer 挿入・バーとの整合はそのまま維持
- `localUsedSlots`（chip 枠計算用）= セル局所の実描画バー数 = `alldayResult.colLaneCounts[colIdx] + セル局所 span バー本数`

`remaining = maxItems - localUsedSlots`（セル局所値で計算）

変更箇所:

1. `placeMonthTimedSpanEvents` の返り値に `localColLaneCounts`（7 要素配列）を追加する
   - `localColLaneCounts[ci]` = `alldayColLaneCounts[ci]（セル局所終日バー数）+ (ev.lane + 1)（span バー固有スロット数）`
   - spacer 用の `colLaneCounts` は変更しない（週共通 offsetLane+1 のまま）

2. `placeMonthEvents` での `usedSlots` 算出を 2 系統に分ける:

```javascript
// spacer 用（バーとの整合のため週共通値）
var usedSlots = spanResult.colLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0;
// chip 枠計算用（セル局所の実描画数）
var localUsedSlots = spanResult.localColLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0;

// placeMonthTimedEvents には spacer 用の usedSlots を渡す（FR-6 維持）
var chipsAdded = placeMonthTimedEvents(cellEl, dayTimedEvents, usedSlots, maxItems, localUsedSlots);
```

3. `placeMonthTimedEvents` の `remaining` 計算:

```javascript
// 現状: remaining = maxItems - usedSlots
// 案 B:  remaining = maxItems - (localUsedSlots ?? usedSlots)
var remaining = maxItems - (localUsedSlots !== undefined ? localUsedSlots : usedSlots);
```

**絶対配置 top との整合確認**:

- spacer 高さは `usedSlots`（週共通値）を維持するため、span バー上端 = spacer 下端（現状と同じ）
- chip 枠計算だけ `localUsedSlots` を使うため、chip の配置位置自体は変わらない（spacer 高さが変わらないため）

chip が span バーに重なる問題は**発生しない**。

**FR-6（最終スロット+1 方式）との整合**:

FR-6 の「`+N more` の位置 = 最終スロット+1」は spacer + chip 群の後に `more` が来ることで担保される。
- spacer 高さは `usedSlots`（週共通）で変わらない
- chip 枠は `localUsedSlots` で計算されるため chip が増えることがある
- `more` の位置 = dateline + spacer + chip 群、の後ろ → chip が増えた分だけ more が下に来る

chip が増えた結果 `more` がセル高を超えるリスク:
- `localUsedSlots < usedSlots` の場合、remaining が増える（chip が増える）
- remaining_max = maxItems - localUsedSlots
- more の top = dateline_h + spacer(usedSlots) + chip(remaining_max * pitchPx)
- = dateline_h + usedSlots*BAR_H + (usedSlots-1)*BAR_GAP + (maxItems - localUsedSlots) * pitchPx

`localUsedSlots < usedSlots` の場合: chip 増加分が spacer の差（usedSlots - localUsedSlots）を超えると more がセル高を超える可能性がある。ただし `usedSlots - localUsedSlots` 分の chip スロットが余分に取れるため、**most の top は現状より高くなるが maxItems の上限制約で抑制される**。

具体例（maxItems=3、alldayLaneCount=1、alldayColLaneCounts[木]=0、ev.lane=0）:
- usedSlots = 2（週共通）、localUsedSlots = 1（セル局所）
- spacer 高さ = 2*24 + 1*3 = 51px
- remaining = 3 - 1 = 2（chip 2 本）
- more の top = dateline_h + 51 + 2*27 = dateline_h + 105

セル高 156px の場合: dateline_h(32) + 105 = 137。more 下端 = 157。**セル高（156px）をわずかに超える。**

`more` の可視性（FR-6）が崩れる可能性がある。ただし、この計算は dateline_h=32px を足しているため:
more 下端 = 32 + 51（spacer） + 54（chip 2本）+ 20（more 高さ） = 157px > 156px

1px はみ出す計算になる。BAR_H=24、pitchPx=27 の前提では、**案 B は FR-6 の `+N more` 可視性保証を壊す可能性がある**。

**評価**:

| 観点 | 評価 |
|---|---|
| chip 枠（remaining）の正確化 | 達成（localUsedSlots で計算） |
| chip 重なりリスク | **なし**（spacer 高さは変更しない） |
| +N more の可視性（FR-6） | **要注意**。chip が増えた結果 more がセル高を超える可能性がある（セル高・maxItems の具体値次第） |
| Google カレンダー的バー揃え | 影響なし |
| 実装難易度 | 中（返り値追加・引数追加）|

### 4.4 案 C（推奨）: usedSlots のセル局所化＋spacer 高さを span バー下端に合わせる

**方針**:
案 A の改良版。`usedSlots` をセル局所の実描画バー数に基づかせ、かつ spacer 高さを「絶対配置 span バーの下端位置」に合わせることで chip 重なりを防ぐ。

具体的には:
- `placeMonthTimedSpanEvents` の `colLaneCounts[ci]` に加えて、span バーの絶対配置上の「最大 offsetLane」（週共通 alldayLaneCount を使った値）を `offsetColLaneCounts[ci]` として別途記録して返す
- `placeMonthTimedEvents` に渡す `usedSlots` は「セル局所の実描画バー数（`localUsedSlots`）」を使う（chip 枠計算、spacer 高さ計算の両方）
- spacer 高さは `usedSlots * BAR_H + (usedSlots - 1) * BAR_GAP` で計算するが、span バーが存在する場合は `max(usedSlots, offsetColLaneCounts[ci])` を spacer 高さの基底とする

別の言い方:
- spacer は「span バーの下端をカバーするのに必要な高さ」と「実描画バー本数に基づく chip 開始位置」のどちらか大きい方を使う

変更イメージ:

```javascript
// placeMonthEvents 内
var localUsedSlots = spanResult.localColLaneCounts[colIdx]
                       || alldayResult.colLaneCounts[colIdx] || 0;
var spanBarEndSlots = spanResult.colLaneCounts[colIdx] || 0;  // 週共通 offsetLane 基準（spacer 下端合わせ用）
var spacerSlots = Math.max(localUsedSlots, spanBarEndSlots);  // どちらか大きい方

// placeMonthTimedEvents に渡す:
//   spacerSlots: spacer 高さ計算用（バー重なり防止）
//   localUsedSlots: chip 枠（remaining）計算用
var chipsAdded = placeMonthTimedEvents(cellEl, dayTimedEvents, spacerSlots, localUsedSlots, maxItems);
```

```javascript
// placeMonthTimedEvents の変更
function placeMonthTimedEvents(cellEl, timedEvents, spacerSlots, localUsedSlots, maxItems) {
  if (spacerSlots > 0) {
    // spacer は spacerSlots（バー下端合わせ）で挿入
    ...
    spacerH = spacerSlots * BAR_H + (spacerSlots - 1) * BAR_GAP;
    ...
  }
  // chip 枠は localUsedSlots で計算
  var remaining = maxItems - localUsedSlots;
  ...
}
```

**絶対配置 top との整合確認**:

- spacer 高さ = `spacerSlots * BAR_H + (spacerSlots - 1) * BAR_GAP`
- `spacerSlots = max(localUsedSlots, colLaneCounts[ci])` = `max(alldayColLaneCounts[ci] + ev.lane + 1, offsetLane + 1)` = `offsetLane + 1`（週共通値が常に >= セル局所値）

したがって spacer 高さは現状の週共通値ベースと同じになり、chip が span バーに重ならない。

**FR-6 の `+N more` 可視性との整合**:

remaining = maxItems - localUsedSlots（セル局所値）

more の top = dateline_h + spacer(spacerSlots=offsetLane+1 本分) + chip(remaining 本分)

案 A の問題（chip が増えて more がセル高を超える）は、spacer が週共通値で維持されているため more の top が現状より増加する方向にはならない。逆に more の top は「spacer 固定 + chip 増加」で上昇する。

ただし remaining = maxItems - localUsedSlots であり localUsedSlots <= usedSlots のため、chip 数が増えることで more が下がる可能性がある。

具体例:
- usedSlots(週共通)=2、localUsedSlots=1、maxItems=3
- spacer = 2本分 = 51px
- remaining = 3 - 1 = 2（chip 2本）
- more の top = 32 + 51 + 2*27 = 137

セル高 156px: more 下端 = 137 + 20 = 157 > 156。**1px 超過**。

案 C でも同じ問題が発生しうる。

**根本的な問題**: chip 表示枠を増やすと more がセル高を超えるリスクがある。

この問題への対処:
- `remaining` の上限を「spacer を除いたセル内残高に収まる本数」で制限する
- = `Math.min(maxItems - localUsedSlots, floor((cellH - dateline_h - spacerH - moreH) / pitchPx))`
- しかしこれは `_calcMaxItems()` の計算と重複する

より簡潔には: **`remaining = maxItems - spacerSlots`（spacer 高さ基準で chip 枠も計算）という現状の式は正しいが、`spacerSlots` をセル局所化する** という解釈にする。

案 C の再定義:
- `spacerSlots = max(localUsedSlots, weekCommonOffsetLane + 1)`（どちらか大きい方）
- `remaining = maxItems - spacerSlots`（spacer 高さ基準で chip 枠計算）

この場合:
- spacer 高さ = spacerSlots ベース → バー重なりなし
- remaining = maxItems - spacerSlots（週共通値ベース）→ more 可視性維持
- **ただし chip 枠は改善されない**（weekCommonOffsetLane + 1 >= localUsedSlots のため spacerSlots = weekCommonOffsetLane + 1 = 現状と同じ）

これでは何も変わらない。

### 4.5 修正方針の整理と推奨案

問題の根本は「**span バーの絶対配置 `top` が `alldayLaneCount`（週共通）を使って計算されており、spacer もそれに合わせる必要がある**」という設計制約と「**chip 枠を正確に計算したい**」という要求の間に矛盾があること。

ここで重要な観察:

**spacer 高さ = span バーが実際にそのセルに描画されている場合、その span バーの下端をカバーする高さと一致するべきである。**

`offsetLane + 1` 本分の spacer は、そのセルに「offsetLane 番目のレーンに span バーが実描画されている」場合には正しい。問題は「**そのセルの spacer が、そのセルには存在しない終日バーのレーン分まで確保してしまう**」点。

ここで着目すべきは: `alldayLaneCount` は週共通値だが、**そのセルに終日バーが実際になければ spacer のうち `alldayLaneCount` 分はバーとの整合には不要**である。span バーの絶対配置 `top` は週共通の `alldayLaneCount` を使っているが、**実際には同じ `.kc-month-ad-events` レイヤに終日バーがない列では、span バーの絶対配置 `top` が大きすぎて視覚的なギャップが生じている可能性がある**。

この観点から、本修正は「spacer / chip 枠を修正する JS 変更」と同時に「span バーの絶対配置 `top` の計算がセル局所終日バー数を考慮しているか」を builder が実機確認することも必要である。

#### 推奨案: 案 B（spacer 高さ維持 + remaining のみセル局所化）を FR-6 可視性制約で補正

最もリスクが少ない修正として案 B を推奨する。ただし、chip 枠拡大による more 可視性崩れリスクを `remaining` 上限で抑制する補正を加える。

**推奨修正の詳細**:

1. `placeMonthTimedSpanEvents` の返り値に `localColLaneCounts`（7 要素配列）を追加する
   - `localColLaneCounts[ci]` = `alldayColLaneCounts[ci]（セル局所終日バー数）+ (ev.lane + 1)（span バー固有スロット数）`
   - 既存の `colLaneCounts`（spacer 用 = 週共通 offsetLane 基準）は変更しない

2. `placeMonthTimedSpanEvents` のシグネチャに `alldayColLaneCounts`（7 要素配列）を追加する
   - 現行: `(weekEl, weekYMD, spanEvents, alldayLaneCount, maxItems)`
   - 変更後: `(weekEl, weekYMD, spanEvents, alldayLaneCount, alldayColLaneCounts, maxItems)`

3. `placeMonthEvents` で `localUsedSlots` を計算し `placeMonthTimedEvents` に渡す
   - `usedSlots`（spacer 用）= 現状通り `spanResult.colLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0`
   - `localUsedSlots`（chip 枠用）= `spanResult.localColLaneCounts[colIdx] || alldayResult.colLaneCounts[colIdx] || 0`

4. `placeMonthTimedEvents` の `remaining` 計算を変更する
   - 現行: `remaining = maxItems - usedSlots`
   - 変更後: `remaining = maxItems - Math.max(localUsedSlots, ...) ← 後述の上限補正あり`
   - more 可視性保証: `remaining = Math.min(remaining, maxItems - usedSlots)`（spacer 高さ分は chip 枠から除いた上限を超えない）

   これは結局 `remaining = maxItems - usedSlots`（現状）になるのでは？

   **正確な補正式**:
   ```
   remaining = min(
     maxItems - localUsedSlots,  // セル局所バー数に基づく上限
     maxItems - usedSlots        // spacer 高さに基づく上限（more 可視性保証）
   )
   = maxItems - max(localUsedSlots, usedSlots)
   = maxItems - usedSlots  // usedSlots >= localUsedSlots のため
   ```

   これは現状と同じになる。**つまり「spacer 高さを変えずに remaining のみ増やす」ことは、more 可視性制約と両立しない。**

#### 最終的な推奨案の再定義

本問題の正確な根本原因は次のいずれかに絞られる:

**根本原因 X**: `offsetLane = alldayLaneCount（週共通）+ ev.lane` が、そのセルに終日バーが存在しない場合でも `alldayLaneCount` 分だけ余分に大きく、spacer が余分に高くなり chip 枠が削減される。

修正の方向性は 2 つしかない:

- **修正方向 α（spacer を縮める）**: そのセルの実描画終日バー数を `offsetLane` に使い、spacer を縮める。→ chip 枠が増えるが、span バーの `top`（週共通計算）との不整合でギャップが生じる可能性がある。そのギャップが「空白」として視覚的に許容できるかどうかが鍵。
  
- **修正方向 β（span バーの top 計算をセル局所化）**: span バーの絶対配置 `top` もセル局所の実終日バー数に基づかせる。→ Google カレンダー方式（週内でバーを同じ高さに揃える）が崩れる。これは設計上の制約（§要件§3.2 NFR-1 参照）により採用不可。

**推奨案: 修正方向 α + ギャップを視覚的に許容する**

`usedSlots` = `alldayResult.colLaneCounts[colIdx]（セル局所終日バー数）+ span バー固有スロット数` で計算する。これにより:

- spacer 高さ = セル局所バー数ベースで縮まる
- chip 枠 = `maxItems - usedSlots（セル局所）` で正確化
- span バーの `top` = 週共通 `offsetLane * pitchPx`（変更なし）

結果として「spacer 下端（chip 開始位置）」と「span バー上端」の間に `(alldayLaneCount - alldayColLaneCounts[ci]) * pitchPx` のギャップが生じる。

このギャップは終日バーがないセルで span バーが終日バーレーン分だけ高い位置に描画されることを意味する。chip は span バーより前（上）から始まるが、chip と span バーは z-index で層が分かれており視覚的な重なりは `z-index` で解決される。実際の視覚的問題が発生するかは builder の実機確認が必要（§7.1 参照）。

**推奨案の修正範囲**:

`placeMonthTimedSpanEvents` の `colLaneCounts` 記録ロジックを変更し、セル局所の終日バー数（`alldayColLaneCounts`）を使って `offsetLane` をセル局所化する:

```javascript
// 変更前（現状）:
result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], offsetLane + 1);

// 変更後（推奨）:
var localOffsetLane = (alldayColLaneCounts[ci] || 0) + (ev.lane || 0);
result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], localOffsetLane + 1);
```

これにより `usedSlots`（`spanResult.colLaneCounts[colIdx]`）が自動的にセル局所化され、既存の `remaining = maxItems - usedSlots` と `spacerH = usedSlots * BAR_H + ...` の計算式はそのまま使える。

**chip 重なりリスクの評価（最終確認）**:

- spacer 高さ = `localUsedSlots * BAR_H + (localUsedSlots - 1) * BAR_GAP`
- span バー top = dateline_h + `(alldayLaneCount + ev.lane) * pitchPx`

localUsedSlots = `alldayColLaneCounts[ci] + ev.lane + 1`。alldayColLaneCounts[ci] <= alldayLaneCount のため:

`localUsedSlots * pitchPx` と span バーの `offsetLane * pitchPx` の差:
= `(alldayColLaneCounts[ci] + ev.lane + 1) * pitchPx - (alldayLaneCount + ev.lane) * pitchPx`
= `(alldayColLaneCounts[ci] + 1 - alldayLaneCount) * pitchPx`
= `(alldayColLaneCounts[ci] - alldayLaneCount + 1) * pitchPx`

alldayColLaneCounts[ci] < alldayLaneCount の場合（= そのセルに週全体より少ない終日バー実描画数）、この値は 0 以下 = spacer 下端 <= span バー上端 → chip 開始位置 <= span バー上端 → **chip が span バーに潜り込む（重なる）可能性がある**。

具体例: alldayLaneCount=1、alldayColLaneCounts[木]=0、ev.lane=0:
- spacer 高さ = 1 * 24 + 0 * 3 = 24px
- span バー top = dateline_h + 1 * 27 = dateline_h + 27

chip 開始位置 = dateline_h + 24 < span バー上端 = dateline_h + 27。chip が span バーの上端から 3px 下まで重なる。

重なり幅 = 3px（= BAR_GAP）。chip 高さ = 24px、span バー高さ = 24px。**chip が span バーの上部 3px と視覚的に重なる**。

この 3px の重なりが実用上問題になるかは builder の実機確認が必要。CSS の `z-index` 設定次第では chip が span バーの上に描画され視覚的影響は軽微である可能性もある。

---

**本文書における推奨案の最終決定**:

推奨案は **案 B（spacer 高さ維持・remaining のみセル局所化）＋補正付き** ではなく、**案 A の改良版（usedSlots セル局所化＋chip 重なりリスクを builder が実機確認）** とする。

理由: more 可視性（FR-6）との両立を厳密に担保するには spacer 高さを変更せず remaining を増やす方法では上限が現状と変わらない（§4.5 の計算通り）。chip 表示枠の回復には `usedSlots` のセル局所化（= spacer 縮小）が必須であり、chip 重なりリスクは builder が実機確認のうえ z-index 調整で軽減できる可能性が高い。

---

## 5. 修正対象箇所一覧

### 5.1 JS 修正（plugin/src/js/desktop.js）

| 行番号（概算） | 対象関数 | 変更内容 |
|---|---|---|
| 5248 付近 | `placeMonthTimedSpanEvents()` のシグネチャ | `alldayLaneCount`（週共通スカラー）に加え、`alldayColLaneCounts`（7 要素配列）を引数として追加する。後方互換を保ちたい場合はオプション引数として扱う |
| 5288-5295 | `placeMonthTimedSpanEvents()` 内 `colLaneCounts` 記録ロジック | `offsetLane + 1`（週共通）を `localOffsetLane + 1` = `(alldayColLaneCounts[ci] || 0) + (ev.lane || 0) + 1`（セル局所）に変更。span バーの `top` 計算（`buildMonthTimedSpanBar` に渡す `ev.lane = offsetLane`）は変更しない |
| 5483-5484 | `placeMonthEvents()` の `placeMonthTimedSpanEvents` 呼び出し | `alldayResult.colLaneCounts`（7 要素配列）を追加引数として渡す |
| 5493 | `placeMonthEvents()` 内 `usedSlots` 算出 | 修正不要（`spanResult.colLaneCounts[colIdx]` が自動的にセル局所値になる） |
| 5329-5372 | `placeMonthTimedEvents()` | 修正不要（spacer 挿入・remaining 計算はそのまま。`usedSlots` の正確化で自動修正される） |

### 5.2 同期対象（src/kc-calendar.js、docs/kc-calendar.js）

- src 版・docs 版は現在旧版扱い（CLAUDE.md メモ参照）のため、plugin 版の修正が安定してから同期する。同期タイミングは管理者の判断による。

---

## 6. 受入基準

### AC6.1 バーが存在しない日のセルで chip 枠が正確に確保される

- **Given**: 同週内のある日（月曜）に終日バーがあり、別の日（木曜）にはバーがなく単日時間予定 3 件がある。maxItems=3
- **When**: 月ビューを表示する
- **Then**: 木曜セルの chip 枠（remaining）が 3 になり、3 件すべて chip として表示される
- **And**: 木曜セルに「+N more」が表示されない

### AC6.2 span バーが存在する日の chip 枠はそのセルの実 span バー数に基づく

- **Given**: 同週の火〜水に span バーがある。月曜には終日バー 1 本がある（alldayLaneCount=1）。水曜には単日時間予定がある。maxItems=3
- **When**: 月ビューを表示する
- **Then**: 水曜の usedSlots = 2（月曜由来の終日バー offset + span バー 1 本）ではなく、水曜の実描画バー数（span バー 1 本＋水曜の実終日バー 0 本 = 1）に基づいた値になる
- **And**: 水曜の chip 枠 = maxItems - 実 usedSlots（修正後）

### AC6.3 span バーが実際に描画されているセルの chip 重なりが発生しない

- **Given**: 修正後の実装で span バーが存在するセルに chip が表示されている
- **When**: 月ビューを DevTools で確認する
- **Then**: chip の DOM 上の位置が span バーの DOM 上の位置と重複して「chip テキストが span バーによって隠れる」状態になっていない（z-index または位置で分離されている）
- **And**: クリックイベントが chip・span バーそれぞれ独立して機能する

### AC6.4 FR-6（最終スロット+1 方式）が維持される

- **Given**: span バーのみが存在するセル（単日時間予定 0 件）がある
- **When**: 月ビューを表示する
- **Then**: `+N more` 要素が dateline + spacer の直後に配置され、span バーより上（dateline 直下）に表示される視覚的逆転が発生しない
- **And**: spacer が `usedSlots > 0` のセルに必ず挿入されている

### AC6.5 FR-4 の件数制限が維持される

- **Given**: 終日バー + span バーの合計スロット数が `maxItems - 1` を超えるケースがある
- **When**: 月ビューを表示する
- **Then**: 表示されるバーの合計本数が `maxItems - 1` 以下に制限されている
- **And**: 超過分が `+N more` にカウントされポップオーバーに表示される

### AC6.6 `+N more` のセル内可視性が維持される

- **Given**: `hiddenCount > 0` のセルがある
- **When**: 月ビューを表示する
- **Then**: `+N more` 要素の下端が `cellEl.getBoundingClientRect().bottom` を超えていない

---

## 7. 未確定事項・リスク・前提

### 7.1 [未確定] chip と span バーの視覚的重なり（実機確認必須）

推奨案（usedSlots セル局所化）の適用後、spacer 高さがセル局所値（< 週共通値）になるため、chip の開始位置が span バーの絶対配置 `top` より上になる可能性がある（差は最大 `alldayLaneCount * pitchPx`、典型値 27px）。

**未確定内容**: z-index の設定状況および実機でのレンダリング結果。chip が span バーの上に z-index で被さるか、下に回り込むかによって視覚的影響が変わる。

**builder への申し送り**:
- `.kc-month-chip`、`.kc-month-ad-events`、`.kc-month-chip--span` の z-index 設定を確認する
- 修正後の実機で「chip テキストが span バーに隠れる」または「span バーの見た目が chip に隠れる」現象が発生しないか確認する
- 問題が発生する場合は以下のいずれかを検討する:
  - spacer 高さを週共通値に戻した案 B（remaining のみセル局所化）を代わりに採用する
  - chip の z-index を span バーより高く設定する（クリック競合のリスク確認要）

### 7.2 [未確定] span バーの絶対配置 top とセル内実終日バー数の不一致が見た目上問題になるか

span バーの `top = dateline_h + offsetLane * pitchPx`（週共通 alldayLaneCount を含む）は変更しない。そのため alldayLaneCount > alldayColLaneCounts[ci] のセル（終日バーがない日に span バーが来る）では、span バーが終日バー分だけ高い位置に浮いて描画される。これは修正前から同様の動作だが、spacer 縮小により「バーの上（dateline との間）に余白」が視覚的に生じる。

**builder への申し送り**: この余白が実機で許容できるか確認する。問題があれば案 B（spacer 維持）への切り替えを検討する。

### 7.3 [前提] src/docs 版への同期タイミング

本修正の対象は `plugin/src/js/desktop.js` のみ。`src/kc-calendar.js` および `docs/kc-calendar.js` は旧版扱いであり、同期は管理者の判断による。要件定義書としては plugin 版の修正範囲のみを記述する。

### 7.4 [前提] 本修正は REQ_month-cell-fixed-height.md 第 5 版の FR-4/FR-5/FR-6/FR-7 と独立

本修正は FR-4/FR-5/FR-6/FR-7 の実装済み仕様を変更しない。これらとの競合は発生しない前提で要件化している。

### 7.5 [リスク] alldayColLaneCounts 引数の追加による後方互換

`placeMonthTimedSpanEvents` のシグネチャ変更により、もし他の呼び出し箇所があればコンパイルエラー・実行時エラーが発生する。

**builder への申し送り**: `placeMonthTimedSpanEvents` の呼び出し箇所を `plugin/src/js/desktop.js` 全体で確認し、修正漏れがないようにすること。

---

## 8. 検証項目・テストシナリオ

### 8.1 基本再現ケース（不具合修正の確認）

| シナリオ ID | テスト条件 | 操作 | 期待結果 |
|---|---|---|---|
| TC-1 | 同週: 月曜に終日バー 1 本、木曜に単日時間予定 3 件（バーなし）、maxItems=3 | 月ビューを表示 | 木曜セルに chip 3 件表示。「+N more」なし |
| TC-2 | 同週: 月〜水に終日バー 1 本（4 日間）、火〜水に span バー 1 本（2 日間）、木曜に単日時間予定 3 件 | 月ビューを表示 | 木曜セルに chip 2 件（usedSlots=1）。現状の chip 1 件（usedSlots=2）から改善されること |
| TC-3 | 同週: 月〜金に span バー 1 本（5 日間、alldayLaneCount=0）、水曜に単日時間予定 3 件 | 月ビューを表示 | 水曜の usedSlots=1（span バー実描画 1 本）。chip 枠 = maxItems - 1 |
| TC-4 | 同週: 月〜日に span バー 2 本が重なる（alldayLaneCount=0）、水曜に単日時間予定 3 件 | 月ビューを表示 | 水曜の usedSlots=2（span バー 2 本）。chip 枠 = maxItems - 2 |

### 8.2 chip 重なりの確認（§7.1 に対応）

| シナリオ ID | テスト条件 | 操作 | 期待結果 |
|---|---|---|---|
| TC-5 | TC-2 の構成で修正後を確認 | DevTools の Elements で chip と span バーの位置を確認 | chip と span バーの視覚的重なりが許容範囲内（chip テキストが隠れない） |
| TC-6 | alldayLaneCount=1、木曜に span バーかつ chip あり | 実機での見た目確認 | chip クリック・span バークリックが独立して機能する |

### 8.3 FR-6 維持の確認

| シナリオ ID | テスト条件 | 操作 | 期待結果 |
|---|---|---|---|
| TC-7 | span バーのみのセル（chip 0 件・usedSlots > 0） | 月ビューを表示 | spacer が usedSlots 分挿入される。+N more が spacer 直後（バー群下）に表示 |
| TC-8 | hiddenCount > 0 のセル（修正後） | 月ビューを表示 | +N more の下端がセル高内に収まる |

### 8.4 リグレッションテスト

| 確認対象 | 確認手順 |
|---|---|
| FR-4 件数制限 | 終日バー + span バーが maxItems-1 を超えるケースで +N more に正しくカウントされること |
| +N more ポップオーバー | 修正後の `+N more` をクリックしポップオーバーに隠れ予定が正しく表示されること |
| 月 DnD | 修正後のビューで DnD が正常動作すること（REQ_month-dnd.md の全 AC） |

### 8.5 実機検証手順（k 本番）

1. 同週の異なる日（例: 月・木）にテストレコードを作成する
   - 月曜: 終日予定 1 件（終日バーとして描画）
   - 水〜木曜: 日跨ぎ時間予定 1 件（span バーとして描画）
   - 木曜: 単日時間予定を maxItems 件以上登録する（例: 4 件以上）

2. 月ビューを表示し、木曜セルの chip 表示数を確認する
   - **修正前の期待**: chip 1〜2 件 + 「+N more」が表示される
   - **修正後の期待**: chip が増えて「+N more」が消えるか件数が減少する

3. DevTools Console で `[KC.place]` ログを確認する（`KC_DEBUG=1` 設定時）
   - 木曜の `usedSlots` / `remaining` / `hidden` の値が修正前後で変化していることを確認

4. TC-5 / TC-6 の chip 重なり確認を実機で行う

---

## 9. 想定 UX / シーケンス

### 9.1 修正後の計算フロー

```
[placeMonthEvents() 実行]
    ↓
[_calcMaxItems() でセル実高から maxItems を算出]（変更なし）
    ↓
[placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, maxItems)]
    ← alldayResult.colLaneCounts[ci]: セル局所の実描画終日バー数（変更なし）
    ← alldayResult.effectiveLaneCount: 週共通の終日バー有効レーン数（span バーの top 計算に使用）（変更なし）
    ↓
[placeMonthTimedSpanEvents(weekEl, weekYMD, spanEvents,
    alldayResult.effectiveLaneCount,      ← span バー top 計算用（週共通）（変更なし）
    alldayResult.colLaneCounts,           ← ★新規追加引数（セル局所終日バー数配列）
    maxItems)]
    ← offsetLane = alldayLaneCount（週共通）+ ev.lane（span バー top 計算、変更なし）
    ← localOffsetLane = alldayColLaneCounts[ci]（セル局所）+ ev.lane（★修正箇所）
    ← colLaneCounts[ci] = localOffsetLane + 1（★修正後: セル局所値）
    ← buildMonthTimedSpanBar に渡す lane = offsetLane（週共通）（変更なし）
    ↓
[セルごとの placeMonthTimedEvents(cellEl, timedEvents, usedSlots, maxItems)]
    ← usedSlots = spanResult.colLaneCounts[colIdx]（★修正後: セル局所値）
    ← spacer 高さ = usedSlots * BAR_H + (usedSlots-1) * BAR_GAP（変更なし）
    ← remaining = maxItems - usedSlots（変更なし。usedSlots がセル局所値になったため chip 枠が正確化）
    ↓
[hiddenCount / applyOverflow](変更なし)
```

### 9.2 修正前後の数値比較例

**条件**: maxItems=3、月曜に終日バー 1 本（alldayLaneCount=1）、火〜木曜に span バー 1 本（lane=0）、木曜に単日時間予定 3 件

| セル | 修正前 usedSlots | 修正後 usedSlots | 修正前 remaining | 修正後 remaining |
|---|---|---|---|---|
| 月曜 | 1（終日バーあり） | 1（変わらず） | 2 | 2 |
| 火曜 | 2（終日 1 + span 1） | 2（変わらず）| 1 | 1 |
| 水曜 | 2（週共通 offsetLane = 1+0 = 1 → +1 = 2） | 2（alldayColLaneCounts[水]=0 + 0 + 1 = 1 → ★1）| 1 | 2 ← 改善 |
| 木曜 | 2（同上） | 1（alldayColLaneCounts[木]=0 + 0 + 1 = 1）| 1 | 2 ← 改善 |

注: 火曜は終日バーも span バーも実描画されているため usedSlots は変わらない。

---

## 10. 関連資料

| 資料 | 関連箇所 |
|---|---|
| `requirements/REQ_month-cell-fixed-height.md`（第 5 版） | FR-4/FR-5/FR-6/FR-7 — 本修正が維持すべき確定仕様 |
| `plugin/src/js/desktop.js:5248-5299` | `placeMonthTimedSpanEvents()` — 主修正対象 |
| `plugin/src/js/desktop.js:5329-5372` | `placeMonthTimedEvents()` — 修正不要（usedSlots 正確化で自動修正）|
| `plugin/src/js/desktop.js:5395-5534` | `placeMonthEvents()` — 呼び出し引数の追加 |
| `plugin/src/js/desktop.js:5152-5228` | `placeMonthAlldayEvents()` — `colLaneCounts` 返却（修正不要）|
| `plugin/src/js/desktop.js:5493` | `usedSlots` 算出 — 修正不要（spanResult.colLaneCounts が自動修正される）|

---

*本要件定義書: 第 3 版（2026-06-19 更新）。§12 として中間案の実装可否評価を追加。未確定事項: §7.1（chip 重なりリスク）、§7.2（バー上余白の視覚確認）、§12.6（副作用の許容可否）。中間案の推奨方針と builder への変更指示は §12.5/§12.7 参照。*

---

## 12. 追補: 中間案（跨ぐ列の終日本数最大値で top を決める）の実装可否評価（第 3 版）

### 12.1 中間案の定義

span バーの絶対配置 `top` を決める `offsetLane` の計算を、現状の「週共通 `effectiveLaneCount`（スカラー）+ `ev.lane`」から「**そのバーが実際に跨ぐ列（colStart〜colStart+span-1）の `alldayColLaneCounts[ci]` の最大値 + `ev.lane`**」に変更する。

```javascript
// 現状（週共通）:
var offsetLane = alldayLaneCount + (ev.lane || 0);
// alldayLaneCount = alldayResult.effectiveLaneCount（週全体の終日バー有効レーン数）

// 中間案（跨ぐ列のローカル最大値）:
var localMax = 0;
for (var ci = ev.colStart; ci < ev.colStart + ev.span; ci++) {
  if (ci >= 0 && ci < 7) {
    localMax = Math.max(localMax, alldayColLaneCounts ? (alldayColLaneCounts[ci] || 0) : alldayLaneCount);
  }
}
var offsetLane = localMax + (ev.lane || 0);
```

1バー = 1DOM要素・単一 `top` は維持するため連結描画は破綻しない。

### 12.2 単一 top・単一 DOM の制約下での破綻確認

#### 12.2.1 span バー同士のレーン割り当てとの整合

`KC.Lanes.assignLanes`（desktop.js:3703-3741）の動作:

- 入力: `weekEvents`（`colStart`, `span` 付き配列）
- アルゴリズム: 「既存バーの `endCol > ev.colStart` なら衝突」判定でグリーディに最小レーンを割り当て
- 出力: 各 `ev.lane`（0 始まり整数）が付与される

`assignLanes` が割り当てる `ev.lane` は**水平方向の衝突**のみに基づく。以下の週構成を考える:

```
span バー A: colStart=0, span=3（月〜水）
span バー B: colStart=2, span=3（水〜金）
→ 水曜で衝突 → assignLanes: A.lane=0, B.lane=1

span バー C: colStart=4, span=2（木〜金）
→ A と重なりなし・B と水〜金で重なり → B.lane=1 と衝突 → C.lane=0
```

中間案での `offsetLane` 計算:

- `alldayColLaneCounts` = [0,0,0,0,1,0,0]（金曜のみ終日バー 1 本）

バー A（月〜水）: `localMax = max(alldayColLaneCounts[0,1,2]) = 0` → `offsetLane = 0 + 0 = 0` → `top = 0px`
バー B（水〜金）: `localMax = max(alldayColLaneCounts[2,3,4]) = max(0,0,1) = 1` → `offsetLane = 1 + 1 = 2` → `top = 2 × 23 = 46px`
バー C（木〜金）: `localMax = max(alldayColLaneCounts[3,4]) = max(0,1) = 1` → `offsetLane = 1 + 0 = 1` → `top = 23px`

現状（週共通 `effectiveLaneCount=1`）:
バー A: `offsetLane = 1 + 0 = 1` → `top = 23px`
バー B: `offsetLane = 1 + 1 = 2` → `top = 46px`
バー C: `offsetLane = 1 + 0 = 1` → `top = 23px`

**注目点**: 中間案では A が `top=0px`、C が `top=23px` で異なる高さになるのに対し、A と C は `assignLanes` 上で同じ `ev.lane=0` を持つ。

#### 12.2.2 span バー同士の視覚的衝突の有無

`ev.lane` は「水平に重なるバー同士が縦にずれる」ことを保証する。中間案では `ev.lane` が同じ（= 水平衝突なし）であっても `localMax` が異なると `offsetLane` が異なり、**水平的に重ならない 2 本のバーが異なる `top` を持つ**ことになる。

視覚的衝突（同一位置に 2 本重なる）が発生するか？

**条件**: 水平に重なる 2 本のバーが同じ `offsetLane` になる場合 → 重なる

`assignLanes` の衝突判定は `ev.lane` で処理されており、`offsetLane` の重複は別途検討が必要。

2 本のバー X（`ev.lane=0`, `offsetLane=a`）と Y（`ev.lane=0`, `offsetLane=a`）が水平に重ならない（`assignLanes` が同じ lane を許容した）場合、`top` が同じでも水平位置が重ならないため視覚的衝突はない。

2 本のバー X（`ev.lane=0`, `offsetLane=a`）と Y（`ev.lane=1`, `offsetLane=a`）が水平に重なる場合:
- `assignLanes` は Y に `ev.lane=1` を与えた（X と衝突しているため）
- しかし中間案では `offsetLane = localMax + ev.lane` なので、X の `localMax` と Y の `localMax` が異なれば `offsetLane` が一致する可能性がある
- 例: X の `localMax=1`, `ev.lane=0` → `offsetLane=1`。Y の `localMax=0`, `ev.lane=1` → `offsetLane=1`
- **この場合 top が同じになり、水平に重なる 2 本が同じ高さに描画される = 完全に重なる視覚的衝突が発生する**

**この衝突が実際に起きる条件の具体例**:

```
週構成:
  alldayColLaneCounts = [1, 0, 0, 0, 0, 0, 0]（月曜だけ終日バー 1 本）
  span バー X: 月〜水（colStart=0, span=3）
  span バー Y: 月〜水（colStart=0, span=3、同じ期間の別予定）
  → assignLanes: X.lane=0, Y.lane=1

中間案の offsetLane:
  X: localMax = max(alldayColLaneCounts[0,1,2]) = max(1,0,0) = 1
     offsetLane = 1 + 0 = 1 → top = 23px
  Y: localMax = 1（同じ colStart/span なので同じ）
     offsetLane = 1 + 1 = 2 → top = 46px
  → 衝突なし。この例は安全。
```

```
週構成:
  alldayColLaneCounts = [2, 0, 0, 0, 0, 0, 0]（月曜に終日バー 2 本）
  span バー X: 月〜水（lane=0）
  span バー Y: 火〜木（lane=0）← X と火〜水で重なり... 実際は assignLanes が Y.lane=1 にする
  
  しかし:
  span バー P: 火〜水（lane=0）
  span バー Q: 月〜水（lane=1）← P と火〜水で重なり... assignLanes: P.lane=0, Q.lane=1
  
  中間案の offsetLane:
  P（火〜水, lane=0）: localMax = max(alldayColLaneCounts[1,2]) = 0 → offsetLane = 0 + 0 = 0 → top = 0
  Q（月〜水, lane=1）: localMax = max(alldayColLaneCounts[0,1,2]) = 2 → offsetLane = 2 + 1 = 3 → top = 69px
  → P と Q は水平に重なるが top は 0 vs 69px で衝突なし。安全。
```

**衝突が起きるケースを構成する**:

```
alldayColLaneCounts = [0, 1, 0, 0, 0, 0, 0]（火曜のみ終日バー 1 本）
span バー R: 月〜火（colStart=0, span=2, lane=0）
  localMax = max(alldayColLaneCounts[0,1]) = 1 → offsetLane = 1 + 0 = 1 → top = 23px
span バー S: 火〜水（colStart=1, span=2, lane=0）
  ← R と火曜で重なる → assignLanes: R.lane=0, S.lane=1
span バー S: lane=1
  localMax = max(alldayColLaneCounts[1,2]) = max(1,0) = 1 → offsetLane = 1 + 1 = 2 → top = 46px
  → 衝突なし
```

```
alldayColLaneCounts = [0, 0, 1, 0, 0, 0, 0]（水曜のみ終日バー 1 本）
span バー T: 月〜水（colStart=0, span=3, lane=0）
  localMax = max(alldayColLaneCounts[0,1,2]) = 1 → offsetLane = 1 + 0 = 1 → top = 23px
span バー U: 水〜金（colStart=2, span=3, lane=0）
  ← T と水曜で重なる → assignLanes: T.lane=0, U.lane=1
  localMax = max(alldayColLaneCounts[2,3,4]) = max(1,0,0) = 1 → offsetLane = 1 + 1 = 2 → top = 46px
  → 衝突なし
```

**衝突の発生条件の整理**:

水平に重なる 2 本のバー X（lane=a）と Y（lane=b, b>a）の `offsetLane` が一致する条件:
```
localMax_X + a = localMax_Y + b
⟺ localMax_X - localMax_Y = b - a
```

`b > a`（b-a >= 1）なので `localMax_X > localMax_Y`（X の方が終日バーが多い列を跨ぐ）かつその差が `b-a` に一致する場合に衝突。

具体的には:
- X が終日バーの多い列を多く含む範囲に存在し
- Y が終日バーの少ない列を多く含む範囲に存在し
- X と Y が一部列で水平に重なる

このケースは「週の片端（例: 月曜）に終日バーが集中していて、month-to-end バー X（月〜土）と短い Y（火〜水）が重なる」という典型的なパターンで起きうる。

#### 12.2.3 終日バー本体との衝突確認

終日バー（`buildMonthAlldayBar`）の `top` は以下で決まる（desktop.js:3824-3828）:

```javascript
var BAR_TOP = 4;  // 週ビューの buildAlldayBar（BAR_TOP=4）
el.style.top = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
```

ただし月ビューの `.kc-month-ad-events` の `BAR_TOP = 0`（desktop.js:4794）。`buildMonthAlldayBar` は `buildAlldayBar` を流用しており、`BAR_TOP` の値が共有されているか確認が必要。

`placeMonthAlldayEvents`（desktop.js:5226）:
```javascript
var bar = buildMonthAlldayBar(ev);
```

`buildMonthAlldayBar` の定義を探します。
<br>

実際には `buildMonthAlldayBar` は月ビュー専用の関数として定義されているはずです。`BAR_TOP = 0` のスコープを確認します。

`var BAR_TOP = 0` は `KC.RenderMonth` の IIFE スコープ内（desktop.js:4794）で宣言されており、`buildMonthTimedSpanBar` と `placeMonthAlldayEvents` が呼ぶ `buildMonthAlldayBar` が同スコープ内にあれば、両者は同じ `BAR_TOP = 0` を参照する。

この前提で終日バーと span バーの `top` 計算を整理する:

- 終日バー（lane N）の `top` = `BAR_TOP + N * (BAR_H + BAR_GAP)` = `0 + N * 23` = `N * 23 px`
- span バーの現状の `top` = `BAR_TOP + offsetLane * (BAR_H + BAR_GAP)` = `offsetLane * 23 px`
  - `offsetLane = effectiveLaneCount + ev.lane`
  - 終日バー最後（lane = effectiveLaneCount-1）の `top` = `(effectiveLaneCount-1) * 23 px`
  - 終日バー最後の**底辺** = `(effectiveLaneCount-1) * 23 + 20 px`
  - span バー（ev.lane=0）の `top` = `effectiveLaneCount * 23 px`
  - → ギャップ = `effectiveLaneCount * 23 - [(effectiveLaneCount-1) * 23 + 20]` = `23 - 20 = 3 px`（= BAR_GAP）✓ 正しく隣接

中間案での span バー（ev.lane=0）の `top` = `localMax * 23 px`

- そのセルの実際の終日バー最後（lane = alldayColLaneCounts[ci]-1）の底辺 = `(alldayColLaneCounts[ci]-1)*23 + 20`
- span バー上端 = `localMax * 23` ここで `localMax = max over span の alldayColLaneCounts[ci]`

**そのセルの終日バー数が `localMax` より小さい場合**（= そのセルには終日バーが少ない）:
- 終日バー最後の底辺 = `(alldayColLaneCounts[ci]-1)*23 + 20`
- span バー上端 = `localMax * 23`
- ギャップ = `localMax * 23 - [(alldayColLaneCounts[ci]-1)*23 + 20]`
  = `(localMax - alldayColLaneCounts[ci] + 1) * 23 - 20`
  = `(localMax - alldayColLaneCounts[ci]) * 23 + 3`

`localMax > alldayColLaneCounts[ci]` の場合: ギャップ > 3px → 終日バーと span バーの間に空白が残る（ただし現状より小さい）

**そのセルの終日バー数が `localMax` と等しい場合**:
ギャップ = 3px（BAR_GAP）= 正しく隣接 ✓

**そのセルに終日バーが 0 本で `localMax > 0` の場合**:
span バー上端 = `localMax * 23 px`。終日バーなし。dateline の直下（adLayer top）から `localMax * 23` px の空白が生じる。**ただし現状（effectiveLaneCount 週共通）より小さい空白になる（`localMax <= effectiveLaneCount`）**。

**そのセルに終日バーが 0 本で `localMax = 0`（跨ぐ列に終日バーなし）の場合**:
span バー上端 = 0px → adLayer top 直下から描画 → 余白消滅 ✓ これが中間案の狙い

### 12.3 第 1 版の spacer 局所化修正との整合

第 1 版実装（現在の `placeMonthTimedSpanEvents`）では `colLaneCounts[ci]` をセル局所値（`localAlldayCount + ev.lane + 1`）で記録している（desktop.js:5300-5308）。`localAlldayCount = alldayColLaneCounts[ci] || 0`。

```javascript
var localAlldayCount = alldayColLaneCounts
  ? (alldayColLaneCounts[ci] || 0)
  : alldayLaneCount;
var localOffsetLane = localAlldayCount + (ev.lane || 0);
result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], localOffsetLane + 1);
```

この `colLaneCounts[ci]` が `placeMonthTimedEvents` の `usedSlots` になり、`spacerH = usedSlots * BAR_H + (usedSlots-1) * BAR_GAP` になる。

現状の第 1 版の「spacer 基準」と「span バー top 基準」の不整合:
- spacer 高さ = `(alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3`（セル局所）
- span バー top = `(effectiveLaneCount + ev.lane) * 23`（週共通）

中間案で span バーの top を `(localMax + ev.lane) * 23` に変えると:
- spacer 高さ = `(alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3`
- span バー top = `(localMax + ev.lane) * 23`

ここで `spacer 下端 = spacer 高さ = (alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3`

span バー上端（adLayer からの相対） = `(localMax + ev.lane) * 23`

両者が一致する（= chip がバーと重ならない）条件:
```
spacer 下端 = span バー上端
(alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3 = (localMax + ev.lane) * 23
alldayColLaneCounts[ci] * 23 + 23 - 3 = localMax * 23
alldayColLaneCounts[ci] * 23 + 20 = localMax * 23
```

`alldayColLaneCounts[ci] = localMax` の場合: `localMax * 23 + 20 = localMax * 23` → 不成立。常にギャップ 3px 残る（= BAR_GAP 分のギャップ = 正常）。
`alldayColLaneCounts[ci] < localMax` の場合: 左辺 < 右辺 → spacer 下端 < span バー上端 → **chip がバーの上から始まる（重なる方向ではなく、chip が先に終わって span バーが後から来る）**。

待って、この方向を整理する。

adLayer 内の座標系（adLayer 上端 = 0px）:
- span バー上端 = `(localMax + ev.lane) * 23`

flex フロー（dateline 下端 = 0px 相当、ただし adLayer の top は dateline 分を含む CSS で設定済み）の座標系:
- spacer はセル内 flex フローの要素。spacer 高さ = `(alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3`
- chip は spacer の直後から始まる

**adLayer（絶対配置）と flex フロー（relative）の座標原点は異なる**ことに注意。

- adLayer の top = dateline_h + 4px = 24 + 4 = 28px（セル上端からの相対）
- spacer は dateline 直後に挿入される。dateline の `min-height = 24px`（CSS `--kc-month-dateline-h`）
- chip 開始位置（セル上端からの相対）= dateline 高さ + spacer 高さ
  = 24 + `(alldayColLaneCounts[ci] + ev.lane + 1) * 23 - 3`（第 1 版 spacer）

span バー上端（セル上端からの相対）= adLayer top + span バー top
  = 28 + `(localMax + ev.lane) * 23`（中間案）
  = 28 + `(effectiveLaneCount + ev.lane) * 23`（現状）

chip 開始位置 = span バー上端の場合、重ならずに隣接。chip 開始位置 < span バー上端の場合、chip が先に配置されバーが下にある（chipがバーに重なる）。

中間案で `alldayColLaneCounts[ci] = localMax`（そのセルが localMax を達成している列、例えば終日バー最多の列）:
chip 開始 = 24 + `(localMax + ev.lane + 1) * 23 - 3` = 24 + `localMax*23 + ev.lane*23 + 20`
span バー上端 = 28 + `(localMax + ev.lane) * 23` = 28 + `localMax*23 + ev.lane*23`
差 = chip 開始 - span バー上端 = (24 + localMax*23 + ev.lane*23 + 20) - (28 + localMax*23 + ev.lane*23) = 16px

chip 開始位置が span バー上端より **16px 下** → chip はバーの途中から始まる →**chipはバーと重なる**。

これは現状（effectiveLaneCount 週共通）でも同様の問題があった（初版 §4.5 の 3px 重なり問題）。中間案では `localMax = alldayColLaneCounts[ci]` の場合、重なりが 16px と大きくなる。

いや、計算をやり直す。spacer 高さは `usedSlots * BAR_H + (usedSlots-1) * BAR_GAP`。`usedSlots = alldayColLaneCounts[ci] + ev.lane + 1`（第 1 版）。

spacer 高さ = `(alldayColLaneCounts[ci] + ev.lane + 1) * 20 + (alldayColLaneCounts[ci] + ev.lane) * 3`
            = `(alldayColLaneCounts[ci] + ev.lane + 1) * 20 + (alldayColLaneCounts[ci] + ev.lane) * 3`

これが span バー bottom（バーを全部カバーする高さ）と等しくなるべき。

span バーの bottom（adLayer からの相対） = `(localMax + ev.lane) * 23 + BAR_H = (localMax + ev.lane) * 23 + 20`

flex フローの chip 開始位置（adLayer からの相対）= spacer 高さ（adLayer top からの相対に換算すると、adLayer top = dateline_h + 4 = 28 なので、spacer 高さを adLayer からの距離として見るには spacer の top をずらして考える）

**正確な座標整理**:

セル上端を 0 とする。

- dateline 下端: `dateline_h = 24px`（CSS min-height）
- adLayer 上端: `24 + 4 = 28px`（CSS `top: calc(--kc-month-dateline-h + 4px)`）
- spacer 高さ: `h_spacer = usedSlots * BAR_H + (usedSlots-1) * BAR_GAP`
  - `usedSlots = alldayColLaneCounts[ci] + ev.lane + 1`（第 1 版セル局所値）
- chip 開始位置（セル上端から）: `24 + h_spacer`

adLayer 内で span バー top = `(localMax + ev.lane) * 23`（中間案）
span バー上端（セル上端から）: `28 + (localMax + ev.lane) * 23`

chip がバーに重ならない条件: `chip 開始位置 >= span バー上端`
```
24 + h_spacer >= 28 + (localMax + ev.lane) * 23
h_spacer >= 4 + (localMax + ev.lane) * 23
(usedSlots * 20 + (usedSlots-1) * 3) >= 4 + (localMax + ev.lane) * 23
usedSlots * 23 - 3 >= 4 + (localMax + ev.lane) * 23
usedSlots * 23 >= 7 + (localMax + ev.lane) * 23
usedSlots >= (localMax + ev.lane) + 7/23  ≈ localMax + ev.lane + 0.3
usedSlots >= localMax + ev.lane + 1  (整数条件)
```

`usedSlots = alldayColLaneCounts[ci] + ev.lane + 1`。`alldayColLaneCounts[ci] >= localMax` なら `usedSlots >= localMax + ev.lane + 1` → 条件を満たす。

`alldayColLaneCounts[ci] < localMax`（= そのセルの終日バーが跨ぐ列の最大値より少ない）なら `usedSlots < localMax + ev.lane + 1` → 条件不満足 → **chip がバーより上に配置されてしまう（重なる）**。

**結論**: 中間案で `localMax = max(alldayColLaneCounts[ci] over span 全列)` を span バーの top 基準にした場合、**spacer の `usedSlots` も同じ基準（`localMax + ev.lane + 1`）で計算しなければ chip と span バーが重なる**。

第 1 版の spacer 局所化（`alldayColLaneCounts[ci]` 基準）と中間案の top 局所化（`localMax` 基準）は**互いに異なる基準**であり、そのままでは不整合になる。

**整合させるには**: spacer の `usedSlots` も `localMax + ev.lane + 1` に揃える必要がある。

これは `colLaneCounts[ci]` の記録値を `localMax + ev.lane + 1` に変更することで達成できる:

```javascript
// 中間案での colLaneCounts 記録（span バーの描画範囲全列に一律 localMax ベースの値を書き込む）
result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], localMax + (ev.lane || 0) + 1);
```

これにより:
- `usedSlots = colLaneCounts[ci] = localMax + ev.lane + 1`
- `spacerH = usedSlots * 23 - 3 = (localMax + ev.lane + 1) * 23 - 3`
- chip 開始位置 = `24 + (localMax + ev.lane + 1) * 23 - 3 = 24 + localMax * 23 + ev.lane * 23 + 20`
- span バー上端 = `28 + (localMax + ev.lane) * 23 = 28 + localMax * 23 + ev.lane * 23`
- chip 開始 - span バー上端 = `(24 + localMax * 23 + ev.lane * 23 + 20) - (28 + localMax * 23 + ev.lane * 23) = 16`

chip 開始位置が span バー上端より **16px 下** = chip は span バーの下 16px 位置から始まる → **chip と span バーは重ならない** ✓

これは現状（effectiveLaneCount 週共通）と同様の整合状態。`spacer 高さ = adLayer 最下バーの底辺位置` に揃う。

ただし `alldayColLaneCounts[ci]` ではなく `localMax` を使うため、**そのセルに終日バーが存在しない（alldayColLaneCounts[ci]=0）が localMax>0 の場合、spacer が localMax 分確保される**。

これは中間案の「別の日にしか終日バーがない場合の押し下げ」が colLaneCounts（spacer）にも反映されることを意味する。

**中間案の余白効果が spacer にも引き継がれるか**:

中間案の目的「バーが跨がない別日の終日本数による押し下げを除去」は span バーの top についてのみ達成される。spacer は `localMax` で計算されるため、**バーが跨ぐ列に終日バーがある場合は spacer もその分高くなる**（chip 枠は削減される）。これは正しい（バーが跨ぐ列に終日バーがある場合は spacer でその下に chip を配置する必要がある）。

バーが跨ぐ列に終日バーが 0 本（`localMax=0`）の場合: spacer = `ev.lane + 1` 本分（span バー固有レーン数のみ）。これも正しい。

**初版（alldayColLaneCounts[ci] 基準）との比較**:

初版では各セルで `alldayColLaneCounts[ci]` を使うため、同一 span バーでも列によって `colLaneCounts[ci]` が異なる値になる。

中間案では同一 span バーの全跨ぎ列に `localMax + ev.lane + 1` が均一に記録される。

どちらが正しいか：
- 初版: 各セルの終日バー実数に基づく正確な値だが、span バーの top（localMax 基準）と spacer（alldayColLaneCounts[ci] 基準）の不整合が残る
- 中間案: span バーの描画範囲全体で最も終日バーが多い列を基準にするため、一部のセルで spacer が若干過剰だが top と spacer の基準が揃う

中間案の方が top と spacer の整合が取れており、chip 重なりが発生しない。

### 12.4 span バー同士の衝突（§12.2.2 の詳細整理）

§12.2.2 で確認した「水平に重なる 2 本のバーが同じ `offsetLane` になる」ケースの発生条件を最終的に整理する。

中間案の `offsetLane_ev = localMax_ev + ev.lane`。

2 本のバー X（lane=a）と Y（lane=b, b>a）が水平に重なる場合:
- `assignLanes` は衝突を検出して b > a を保証する
- `offsetLane_X = localMax_X + a`、`offsetLane_Y = localMax_Y + b`
- 衝突が起きる条件: `offsetLane_X = offsetLane_Y` ⟺ `localMax_X + a = localMax_Y + b` ⟺ `localMax_X - localMax_Y = b - a`

`b - a >= 1`（assignLanes の保証）。`localMax_X - localMax_Y >= 1` かつ `localMax_X - localMax_Y = b - a` の場合、2 本のバーが視覚的に同じ `top` に来る。

**これが起きる典型例**:

X が「月〜土」（長い）、Y が「火〜水」（短い、X と重なる）の場合:
- `assignLanes`: X.lane=0, Y.lane=1
- alldayColLaneCounts = [2, 1, 0, 0, 0, 0, 0]（月曜に 2 本、火曜に 1 本）
- `localMax_X` = max(alldayColLaneCounts[0..5]) = 2
- `localMax_Y` = max(alldayColLaneCounts[1,2]) = max(1,0) = 1
- `offsetLane_X = 2 + 0 = 2`、`offsetLane_Y = 1 + 1 = 2` → **同じ top、視覚的衝突発生**

この衝突では X と Y が水平に重なる列（火〜水）で視覚的に 2 本のバーが重なって表示される。

**この衝突の発生頻度と重大性**:
- 複数の span バーが存在する場合に起きる可能性がある
- 終日バーの分布が不均一な場合（週の一部にしか終日バーがない）に発生しやすい
- 実際のカレンダー運用では「複数の span バーが同じ週に存在しかつ終日バーが偏在する」パターンは発生しうる

**現状（週共通 effectiveLaneCount）では同様の衝突が起きるか**:

`offsetLane_X = effectiveLaneCount + 0`、`offsetLane_Y = effectiveLaneCount + 1` → 必ず 1 違いとなり衝突しない。

**週共通方式では span バー同士の top 衝突は発生しない。中間案ではこの保証が失われる。**

### 12.5 中間案の実装可否と結論

#### 実装可否: **条件付き可能**

中間案は技術的に実装できるが、以下の条件が必要:

1. **span バーの top 基準と spacer（colLaneCounts）の基準を揃える**: `localMax = max(alldayColLaneCounts[ci] over span 全列)` を計算し、span バーの top と colLaneCounts の両方に使用する
2. **span バー同士の top 衝突リスクを許容するか、または追加の衝突回避ロジックを入れる**

衝突回避を諦めて「条件付き可」とするか、衝突回避ロジックを追加するかは設計判断。

#### 12.6 副作用と許容可否の論点

| 副作用 | 説明 | 許容可否 |
|---|---|---|
| span バー同士の top 衝突 | 複数 span バーが同週に存在し終日バーが偏在する場合、水平に重なる 2 本が同じ top になる可能性がある | 設計判断が必要（下記参照）|
| 週内で span バーの高さが不揃いになる | バーが跨ぐ列の終日バー数によって top が変わるため、月曜〜土曜にまたがる長い span バーの高さと短い span バーの高さが揃わない | Google カレンダー的揃えの部分的放棄。§11.6 選択肢 1 との比較が必要 |
| spacer が localMax 基準になる | alldayColLaneCounts[ci]=0 でも localMax>0 の場合、chip 枠が初版（alldayColLaneCounts[ci] 基準）より少なくなる | 初版より chip 枠回復が劣るケースがある |

**top 衝突の許容可否**: これが最大のリスク。ただし発生条件が「複数 span バー かつ 終日バーが特定列に集中 かつ assignLanes で lane が 1 ずれた 2 本が localMax の差でちょうど相殺」という複合条件のため、実運用では発生頻度が低い可能性がある。実機で再現させて許容可否を判断することを推奨する。

#### 12.7 builder への具体的変更指示

中間案を採用する場合の変更箇所（実装可否結論: 条件付き推奨、top 衝突の実機確認を前提）:

**変更箇所 1: `placeMonthTimedSpanEvents`（desktop.js:5277 付近）**

`ev` ごとに `localMax`（跨ぐ列の終日バー数最大値）を計算し、span バーの top と colLaneCounts の両方に使う。

変更前（現状）:
```javascript
weekEvents.forEach(function (ev) {
  var offsetLane = alldayLaneCount + (ev.lane || 0);  // 週共通

  // ...（spanLimit チェック）...

  var evWithOffset = Object.assign({}, ev, { lane: offsetLane });
  var bar = buildMonthTimedSpanBar(evWithOffset);
  adLayer.appendChild(bar);

  for (var ci = ev.colStart; ci < ev.colStart + ev.span; ci++) {
    if (ci >= 0 && ci < 7) {
      var localAlldayCount = alldayColLaneCounts
        ? (alldayColLaneCounts[ci] || 0)
        : alldayLaneCount;
      var localOffsetLane = localAlldayCount + (ev.lane || 0);
      result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], localOffsetLane + 1);
    }
  }
});
```

変更後（中間案）:
```javascript
weekEvents.forEach(function (ev) {
  // 中間案: バーが跨ぐ列の alldayColLaneCounts の最大値を求める
  var localMax = 0;
  if (alldayColLaneCounts) {
    for (var ci2 = ev.colStart; ci2 < ev.colStart + ev.span; ci2++) {
      if (ci2 >= 0 && ci2 < 7) {
        localMax = Math.max(localMax, alldayColLaneCounts[ci2] || 0);
      }
    }
  } else {
    localMax = alldayLaneCount;  // alldayColLaneCounts 未指定時は週共通値にフォールバック
  }

  // top は localMax ベース（連結描画は単一 top を維持）
  var offsetLane = localMax + (ev.lane || 0);

  // spanLimit チェックは offsetLane（中間案）で判定
  // ただし週共通 alldayLaneCount との整合が必要。
  // spanLimit は maxItems（全体上限）なので offsetLane の基準が変わっても正しく機能する。
  if (offsetLane >= spanLimit) {
    for (var ci = ev.colStart; ci < ev.colStart + ev.span; ci++) {
      if (ci >= 0 && ci < 7) result.hiddenByCol[ci].push(ev);
    }
    return;
  }

  var evWithOffset = Object.assign({}, ev, { lane: offsetLane });
  var bar = buildMonthTimedSpanBar(evWithOffset);
  adLayer.appendChild(bar);

  // colLaneCounts も localMax ベースで揃える（spacer と top の基準を統一）
  for (var ci = ev.colStart; ci < ev.colStart + ev.span; ci++) {
    if (ci >= 0 && ci < 7) {
      result.colLaneCounts[ci] = Math.max(result.colLaneCounts[ci], offsetLane + 1);
      // offsetLane = localMax + ev.lane なので、全跨ぎ列に一律同じ値を書く。
      // 初版（alldayColLaneCounts[ci] ベース）から変更点:
      //   以前: localAlldayCount = alldayColLaneCounts[ci]（セル固有）
      //   現在: localMax（跨ぐ列の最大値）を使うため全跨ぎ列に同じ値
    }
  }
});
```

**変更箇所 2: `placeMonthEvents`（desktop.js:5498-5503）**

呼び出し側は変更不要。`alldayResult.effectiveLaneCount` は spanLimit チェックの上限（FR-4）用として渡しているが、中間案では `offsetLane` の基準が変わるため FR-4 の `spanLimit` との整合を確認すること。

具体的には: `spanLimit = maxItems`（全体上限）と `offsetLane = localMax + ev.lane` の比較は引き続き正しく機能する。`alldayLaneCount`（週共通）は中間案では spanLimit チェックには使わず `localMax` を使うため、`placeMonthTimedSpanEvents` に渡す `alldayLaneCount`（第 1 引数）は `alldayColLaneCounts` 未指定時のフォールバックとしてのみ使われる。変更不要。

**実機確認事項（builder 必須）:**

1. `alldayColLaneCounts` が不均一な週（例: 月曜に終日バー 2 本・他日 0 本）で複数 span バーを作成し、top 衝突が発生しないかを確認する
2. top 衝突が発生した場合は衝突回避ロジックの追加（下記参照）または週共通方式への差し戻しを検討する
3. spacer が `localMax` 基準（全跨ぎ列で同一値）になることで chip 枠が初版より少なくなるケースを確認する

**衝突回避ロジック（発生時のフォールバック案）:**

`offsetLane` が他の描画済みバーと衝突する場合は `offsetLane` を 1 増やす後処理を入れる。ただし実装が複雑化するため、まず実機で衝突が発生するかを確認してから判断すること。

### 12.8 追補の受入基準

#### AC12.1 中間案で余白が削減される

- **Given**: 月曜に終日バー 1 本、火〜木曜に span バー 1 本（月曜は跨がない）がある週
- **When**: 月ビューを表示する
- **Then**: span バーの top = `0 * 23 = 0px`（adLayer 内）。余白なし（または週共通方式より小さい余白）

#### AC12.2 span バーの top と spacer が揃う

- **Given**: 上記と同じ週構成、木曜に単日時間予定 2 件
- **When**: 月ビューを表示する
- **Then**: 木曜の spacer 高さ = `(0 + 0 + 1) * 23 - 3 = 20px`。chip が span バーより上から始まらない

#### AC12.3 終日バーと span バーが衝突しない

- **Given**: 月曜に終日バー 1 本（lane=0）、月〜水にまたがる span バー 1 本（ev.lane=0）
- **When**: 月ビューを表示する
- **Then**: span バーの top = `1 * 23 = 23px`（adLayer 内）。終日バー底辺 = `0 * 23 + 20 = 20px`。ギャップ = 3px（BAR_GAP）。重なりなし

---

## 11. 追補: span バー絶対配置 top の余白問題（第 2 版）

### 11.1 追補の背景

初版の修正（`placeMonthTimedSpanEvents` の `colLaneCounts` セル局所化）は実装・ビルド済みだが、ユーザーから「**終日レーン分の余白が出る事象がまだ治っていない**」と指摘があった。この事象は初版の §7.2 で「修正前から同様の挙動・許容範囲か要確認」とした件であり、本追補でその根本原因と修正方針を分析する。

### 11.2 現象の正確な定義

**現象**: 終日バーが存在しない（または週の他の日にしか終日バーがない）セルで、日跨ぎ予定バー（span バー）が `dateline` 直下ではなく、その下に `effectiveLaneCount × pitchPx` ぶんだけ空白を空けた位置に描画される。ユーザーはこの空白（余白）を消したい。

**具体例**: alldayLaneCount=1（月曜に終日バーあり）、木曜に span バーのみ（終日バーなし）

```
期待（余白なし）:
  [dateline: 24px]
  [span バー: top=28px = dateline 直下]

実際（余白あり）:
  [dateline: 24px]
  [空白: 23px（= 1 × pitchPx）]  ← alldayLaneCount 分のオフセット
  [span バー: top=51px = 28 + 1×23]
```

### 11.3 連結描画の構造確認

`buildMonthTimedSpanBar`（desktop.js:5055-5134）の実装:

```javascript
el.style.left   = ((ev.colStart / 7) * 100) + '%';
el.style.width  = ((ev.span / 7) * 100) + '%';
el.style.top    = (BAR_TOP + ev.lane * (BAR_H + BAR_GAP)) + 'px';
el.style.height = BAR_H + 'px';
```

- `el.style.left` と `el.style.width` で週をまたがる横幅を `%` 指定で設定
- **1つの `div` 要素が `.kc-month-ad-events`（週全幅に張った絶対配置レイヤ）内に 1 本のバーとして描画される**
- `ev.span` が複数列でも DOM 要素は 1 つであり、セルごとに分割されていない

**重要な制約**: `top` は `ev.lane`（= `offsetLane`）の単一値で決まる。1つのバー = 1つの `top` 値のため、**セルごとに異なる `top` を設定することは現在の実装では不可能**。週内でセルをまたぐ span バーに「左端のセルは top=28px、右端のセルは top=51px」のような段差をつけることはできない。

### 11.4 場合分け: (a) 純粋バグ vs (b) 設計上のトレードオフ

#### (a) 週全体に終日予定が 1 件もないのに余白が出る（純粋バグの可能性）

**コードからの判定**:

`alldayResult.effectiveLaneCount` は `placeMonthAlldayEvents`（desktop.js:5152-5234）内で次の式で算出される:

```javascript
result.laneCount = maxLane + 1;  // weekEvents が空なら maxLane=-1 → laneCount=0
result.effectiveLaneCount = (alldayLimit === Infinity)
  ? result.laneCount
  : Math.min(result.laneCount, alldayLimit);
```

`weekEvents` は:

```javascript
if (!adLayer || !alldayEvents || alldayEvents.length === 0) return result;
// result.effectiveLaneCount = 0（初期値のまま）
```

`alldayEvents` は `placeMonthEvents` 内でフィルタリングされる（desktop.js:5476-5480）:

```javascript
var weekAllday = filteredMonthEvents.filter(function (evt) {
  if (!evt.allday) return false;
  return KC.Lanes.eventToBarPosition(evt, weekYMD) !== null;
});
```

`evt.allday` フラグで正確に終日予定のみを選別しており、フィルタリングロジックに明らかな漏れはない。`alldayEvents.length === 0` の場合は早期 return して `effectiveLaneCount = 0` のまま返す。

**判定: ケース (a)（週全体に終日予定ゼロなのに余白が出る）は、コード上は発生しない。** `alldayEvents` が空なら `effectiveLaneCount = 0` が渡され `offsetLane = 0 + ev.lane` となり余白は生じない。

ただし一点注意: **`filteredMonthEvents` には `KC.SearchFilter` と `KC.EventFilter` が適用される**。検索フィルタや絞り込みにより終日予定が除外されていても `effectiveLaneCount` が 0 に更新される（フィルタ前の終日予定に依存するバグが隠れていない）。コード上は `filteredMonthEvents` のみを使っているので、フィルタ後に終日予定が 0 件なら `effectiveLaneCount = 0` になる。これは正しい。

**結論: 純粋バグとしてのケース (a) は存在しない。**

#### (b) 同じ週の別の日に終日予定があるため span バーが週共通で押し下げられている

**コードからの判定**:

`placeMonthTimedSpanEvents`（desktop.js:5277-5288）内:

```javascript
var offsetLane = alldayLaneCount + (ev.lane || 0);
// alldayLaneCount = alldayResult.effectiveLaneCount（週共通値）
var evWithOffset = Object.assign({}, ev, { lane: offsetLane });
var bar = buildMonthTimedSpanBar(evWithOffset);
```

`alldayLaneCount` は週共通値（`alldayResult.effectiveLaneCount`）であり、月曜に終日バーがあれば `alldayLaneCount=1` として**週の全 span バーに適用される**。木曜の span バーも `offsetLane = 1 + 0 = 1` となり `top = 0 + 1 * 23 = 23px` の位置に描画される（= dateline 下端（28px）からさらに 23px 下 = 51px）。

**判定: ケース (b) が発生する。週のいずれかの日に終日予定が存在すれば、その週の全 span バーが終日レーン分だけ押し下げられる。これはバグではなく Google カレンダー方式の設計的帰結（週内でバーを同じ高さに揃えるための意図的な実装）だが、ユーザーの期待とは異なる。**

**両方ありうるか**: コード上は (a) の純粋バグは確認できない。報告された余白問題は (b) のみに起因すると判定する。

### 11.5 span バー top のセル局所化に関する技術検討

#### 11.5.1 top 計算をセル局所化する方法

現状の `buildMonthTimedSpanBar` は `ev.lane`（= `offsetLane`）の単一値で `top` を計算する。これをセル局所化するには「1バー = 1DOM要素」の前提を変える必要がある。

**方法案: バーを列ごとに分割描画する**

現在はバーが 1 要素で `colStart=1, span=3`（火〜木）なら `left=14.3%, width=42.9%` で一括描画する。これを「火曜セル分（top = 終日バーなし → top=0px）」「水曜セル分（top=0px）」「木曜セル分（top=0px）」のように列ごとに個別の DOM 要素に分割すれば、各列でセル局所の `alldayColLaneCounts[ci]` を `top` に反映できる。

**分割描画の実装コスト・破壊範囲**:

- `buildMonthTimedSpanBar` の呼び出しを「1バー → 1要素」から「1バー → n 要素（n = バーが跨ぐセル数）」に変更する
- `ev.colStart` / `ev.span` を各セルのスライスに分割する
- DnD（`KC.DnD.startMoveMonthTimedSpan` / `startResizeMonthTimedSpan`）はバー要素に `dataset.evId` で紐づく。分割後は複数 DOM 要素が同一 `evId` を持つため、どの要素をドラッグ対象にするか DnD ロジックの変更が必要になる
- リサイズハンドル（左端・右端）は元々の先頭・末尾セルの要素にのみ配置する必要があるため、分割要素の識別（先頭か末尾か中間か）が必要
- 破壊範囲が大きく、DnD・リサイズの全動作を再検証する必要がある

**結論: 分割描画は実装コストが大きく DnD への影響も広い。推奨しない。**

#### 11.5.2 top 計算をセル局所化できないことの確認

バーが複数列にまたがる限り、「同一バーが週の左端では top=28px、右端では top=51px」という段差は CSS の単一 `position: absolute` 要素では表現できない。**1 要素 1 top 値という制約は変更できない。**

したがって span バーの `top` をセル局所化するには「バーの分割描画」が唯一の実装手段であり、そのコストは上述の通り大きい。

#### 11.5.3 .kc-month-ad-events の top 位置をセル局所化する代替案

`.kc-month-ad-events` は現在 `position: absolute; left: 0; right: 0; top: calc(--kc-month-dateline-h + 4px)` で**週全体に 1 枚**貼られている（desktop.css:918-925）。これをセル単位（1 セルに 1 adLayer）にする案も考えられるが:

- 終日バー（`placeMonthAlldayEvents`）は週またぎの横幅を `%` で描くため、セル単位の adLayer では終日バーの連結描画も分割が必要になる
- 修正範囲がさらに大きくなる

**この案も実装コストが大きすぎ、推奨しない。**

### 11.6 推奨方針とユーザーへの判断材料

#### 場合分けの最終判定

| ケース | 発生するか | 内容 |
|---|---|---|
| (a) 週全体に終日予定なしなのに余白が出る | **発生しない**（コード上確認済み） | `alldayEvents.length === 0` なら `effectiveLaneCount = 0` になり余白は生じない |
| (b) 週の別の日に終日予定があるため span バーが押し下げられる | **発生する**（設計的帰結） | Google カレンダー方式の週内バー縦揃え仕様による。純粋なバグではなくトレードオフ |

**ユーザーが報告した余白事象は (b) のみに起因すると判定する。**

#### 選択肢の提示（ユーザー判断を要する）

**選択肢 1: 現状維持（週内バー縦揃えを優先）**

同じ週の同じレーンに終日バーと span バーが揃って表示される。Google カレンダーと同様のレイアウト。終日バーが存在する日と存在しない日で span バーの高さが統一されるため、週をまたぐ長い span バーが一直線に描画される。余白は発生するが、これは終日バーとの位置合わせのための意図的なスペース。

**選択肢 2: バー分割描画でセル局所 top を実現（余白を消す・連結を犠牲にする）**

- 実装コスト: 大（DnD・リサイズの全面見直しが必要）
- 効果: 終日バーのないセルでは span バーが dateline 直下から描画され余白がなくなる
- 副作用: 週をまたぐ span バーが列ごとに異なる高さで描画されるため「1 本の連続したバー」に見えなくなる可能性がある（各セルの adLayer top が異なる場合、隣接セルのバー要素の top が揃わず段差が生じる）

**選択肢 3: span バーの top をセル局所化しつつ視覚的連結を CSS clip で保つ（中程度コスト）**

各セルに対応した span バー断片を描画し、`border-radius` の左端・右端を制御して「連結しているように見せる」CSS 技法。終日バーの連結描画（`buildMonthAlldayBar`）が既に同様のアプローチ（`border-radius: 0` で中間断片の角丸を消す）を採用しているため、参考実装は存在する。

- 実装コスト: 中（`buildMonthTimedSpanBar` の分割とスタイル制御が必要。DnD への影響は依然として大きい）
- 効果: 余白がなくなり、視覚的連結も維持できる可能性がある

#### 推奨方針

**短期（即時対応）**: 選択肢 1（現状維持）。

余白の原因が (b)（設計的トレードオフ）と確定したため、余白はバグではなく終日バーとの縦揃えのための意図的なスペース。ユーザーへの説明として「同じ週に終日バーがある場合、span バーがその下に揃って表示される仕様」として案内することを推奨する。

**中長期（ユーザーが余白解消を強く望む場合）**: 選択肢 3（分割描画 + CSS 連結）。

ただし DnD・リサイズへの影響が大きいため、別途 REQ として要件化し、DnD 全面検証を含む工数を確保してから着手することを推奨する。選択肢 2（単純分割）は「連結が破綻する」副作用が大きいため推奨しない。

### 11.7 追補の受入基準

#### AC11.1 ケース (a)（終日予定なし週での余白）が発生しないことを確認

- **Given**: 月ビューの特定週に終日予定が 1 件もない
- **When**: その週に span バーがある日の月ビューを表示する
- **Then**: span バーが dateline 直下（top = 0px、adLayer の top = dateline+4px 分で既に dateline 下）から描画されており、余白がない
- **And**: DevTools で `alldayResult.effectiveLaneCount` が 0 であることを確認できる

#### AC11.2 ケース (b)（週の別の日に終日予定がある場合の押し下げ）が仕様通りに発生することを確認

- **Given**: 月ビューの特定週（例: 月曜）に終日予定が 1 件あり、木曜に span バーがある
- **When**: 月ビューを表示する
- **Then**: 木曜の span バーが `top = 1 × pitchPx = 23px`（adLayer 内）の位置に描画されている（終日レーン 1 本分下）
- **And**: 月曜の終日バーと木曜の span バーが同じ高さレーンに揃って表示されている（週内縦揃え）

### 11.8 追補の検証手順

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| ケース (a) の非発生確認 | 終日予定なしの週に span バーを作成し月ビューを表示 | span バーが dateline 直下から描画される。余白なし |
| ケース (b) の発生確認（仕様通り） | 月曜に終日予定、木曜に span バーを作成し月ビューを表示 | 木曜の span バーが月曜の終日バーと同じ高さレーンに揃って表示される |
| ユーザーへの説明確認 | 上記 (b) の状態をユーザーに見せる | 「終日バーとの縦揃えのための余白」として理解されるか確認 |
