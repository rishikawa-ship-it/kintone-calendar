# 要件定義書: 予定重なり表示改善（週ビュー / 日ビュー カスケード配置）

**文書番号**: REQ_overlap-rendering
**作成日**: 2026-05-21
**最終更新日**: 2026-05-21（確定版 第 6 版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js`, `plugin/src/css/desktop.css`
**対象ファイル（従／同期対象）**: `src/kc-calendar.js`, `src/kc-calendar.css`
**ステータス**: 確定版 第 6 版

### 更新履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-21 | ドラフト 第 1 版 | 初版作成。ユーザー承認前の設計案段階 |
| 2026-05-21 | 確定版 第 1 版 | ユーザー回答（2026-05-21）を反映。スコープを週ビュー / 日ビューのカラム分割に限定。月ビュー `+N more` 展開は Phase 2 へ分離。設計案 A 採用確定 |
| 2026-05-21 | 確定版 第 2 版 | §5.1 表現の明確化（Google 方式の確定）。部分重複 3 件ケースにアルゴリズム動作詳細を追記。FR-1 に最大同時重なり件数による列数決定を明示。§7.6 にアルゴリズム選定確定を追記 |
| 2026-05-21 | 確定版 第 3 版 | ユーザー指摘（2026-05-21）によりレイアウト方式を等分割からカスケード（ずらし配置）に変更。FR-1 / §4 / §5.1 / §6.1 / §7.6 を全面改訂。NFR にカスケード固有リスクを追加。§7.10 に未確定事項を追記 |
| 2026-05-21 | 確定版 第 4 版 | ユーザーフィードバック（2026-05-21）を反映。縦方向オフセット `INDENT_Y_PX = 8` を追加。FR-1 の数式を拡張。§4 受入基準に AC4.10 を追加。§5.1 期待値表に top / height 列を追記。§6.1 視覚イメージを縦・横両方向に更新。§7.11 INDENT_Y_PX 確定値と根拠を追加。§7.10 に height 極小化リスクを追記 |
| 2026-05-21 | 確定版 第 5 版 | ユーザーフィードバック（2026-05-21）を反映。縦オフセット撤回・横拡大。`INDENT_Y_PX = 0`（撤回）、`INDENT_X_PX = 14 → 24` に拡大。§1.6 変更経緯を追記。FR-1 数式から INDENT_Y_PX 関連を削除。AC4.10 を横方向露出の表現に書き換え。§5.1 / §5.2 期待値表を再計算。§6.1 視覚イメージを横ずらしのみに更新・不採用案に第 4 版を追記。§7.6 確定値更新。§7.10 height リスク解消注記。§7.11 を旧確定値として archive 扱い |
| 2026-05-21 | 確定版 第 6 版 | 第 5 版の横 24px 固定カスケードから FullCalendar 互換の「等分割 + 半重ね + 右側余白」方式に方針転換。FR-1 数式を全面改訂（INDENT_X_PX 固定 → col_width 可変）。§1.7 に変更経緯を追記。AC4.1〜4.3 を等分割+半重ね期待値に書き換え、AC4.11 を新規追加。§5.1 / §5.2 期待値表を新数式で再計算。§6.1 設計案記録を更新。§7.6 に OVERLAP_RATIO / RIGHT_MARGIN_PX 確定値を追記、INDENT_X_PX を archive 化。§7.10 に col_width 極小化リスクを追記。§7.11 / §7.12 を archive 化 |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（既存実装の調査結果）](#2-現状分析既存実装の調査結果)
3. [要件](#3-要件)
4. [受入基準](#4-受入基準)
5. [検証項目・テストシナリオ](#5-検証項目テストシナリオ)
6. [想定 UX / シーケンス](#6-想定-ux--シーケンス)
7. [確定済み事項 / 未確定事項](#7-確定済み事項--未確定事項)

---

## 1. 背景・目的

### 1.1 ユーザー報告

「月、日の予定の重なり方を修正してほしいです。現状だと下にある予定が完全に隠れて見えなくなるケースが起こり得ます。」

検証用アプリ（k/891/）の 5/25 で以下の状況が実機で確認された。

**月ビュー 5/25 のセル状況:**
- 「終日だよ」（5/25-5/26 終日予定）
- 「10:00 かさなる？」（5/25 10:00 〜 5/26 17:00 日跨ぎ時間予定）
- 「00:00 タイトル」（5/25 00:00 〜 5/26 00:00、24h 時間予定）

**日ビュー 5/25 の状況:**
- 「タイトル」予定が 00:00 〜 24:00 で列幅いっぱいに表示
- 「かさなる？」（10:00 〜）が重なる時間帯でタイトル予定の裏に隠れる

### 1.2 HANDOVER.md との対応

`HANDOVER.md §4` 未着手項目「重複時間予定の並列表示」および `REQ_day-view.md §2.2 Phase 月-Day-2` にスコープアウト記載がある。本要件定義書はこれを対象に具体化する。

### 1.3 目的（Phase 1 スコープ）

**本要件定義書のスコープは週ビュー / 日ビューの時間予定カスケード配置描画に限定する。**

週ビュー・日ビューにおいて、時間帯が重なる予定が互いを完全に隠すことなく視認・操作できる表示に改善する。月ビューの `+N more` クリック展開は別タスクとして後送りする（別途 `REQ_month-overflow-popup.md` で起票予定）。

### 1.4 第 2 版からの変更経緯

第 2 版では「等分割カラム方式（Google カレンダー方式の貪欲法）」を採用し、builder が実装した。その後ユーザーが Google カレンダー実機画像を共有し、「等分割ではなくカスケード（ずらして部分的に重なる）レイアウトが Google カレンダーの本来の表示」と指摘。ユーザー確認の結果、**カスケード方式への変更**で合意（2026-05-21）。

### 1.5 第 3 版からの変更経緯（第 4 版）

第 3 版で確定したカスケード仕様（`INDENT_X_PX = 14px` の水平方向ずらし）を実装・実機検証後、ユーザーから以下のフィードバックがあった。

**ユーザーフィードバック（2026-05-21）**:
「同じ時間から始まると下の予定が見えなくなるので、もう少しずらして重ねてほしい」

**技術的原因**:
同時刻スタートの場合、col=0 と col=1 の `top` 位置が同じになり、z-index で前面の col=1 が col=0 を完全に覆う。水平方向のオフセットのみでは「左ラベル文字」しか覗かず、col=0 の上端も見えない状態となる。

**対応方針**:
縦方向にも少しずらすことで、col=0 の上端が col=1 の背後から見えるようにする。Google カレンダー画像に近い「縦横ともずらして重ねる」表現に近づける。

### 1.6 第 4 版からの変更経緯（第 5 版）

第 4 版で確定した縦横両方向オフセット（`INDENT_X_PX = 14`、`INDENT_Y_PX = 8`）を実装・実機検証後、ユーザーから以下のフィードバックがあった。

**ユーザーフィードバック（2026-05-21）**:
「縦にずらすと開始時刻が分かりづらいので横にずらしてください」

**技術的背景**:
`INDENT_Y_PX = 8` により各 colIdx の `top` が元の時刻ベースからずれる。kintone カレンダーアプリの主要用途は「開始時刻の把握」であり、時刻軸に対するバーの位置が視覚的に時刻を表す。縦方向ずれは開始時刻の認識を阻害するため、機能的に不適切と判断された。

**対応方針**:
縦オフセット（`INDENT_Y_PX`）を撤回し、横オフセット（`INDENT_X_PX`）を 14 → 24 に拡大することで「下の予定が横方向に見える」状態を実現する。`top` は常に元の時刻ベース値を使用し、時刻認識を最優先とする。

**確定値変更まとめ**:

| 定数 | 第 4 版 | 第 5 版 | 変更理由 |
|---|---|---|---|
| `INDENT_X_PX` | 14 | 24 | 縦オフセット撤廃の補償として横露出を拡大（1〜2 文字分のラベル確保） |
| `INDENT_Y_PX` | 8 | 0（撤回） | 時刻認識阻害のため廃止 |

### 1.7 第 5 版からの変更経緯（第 6 版）

第 5 版の横 24px 固定カスケード（`INDENT_X_PX = 24`）は実機検証を中断し、Web 調査を実施した。

**調査結果**:
Google カレンダーの重なり表示の実際の挙動は「等分割を基本としつつ後発を半重ね（`slotEventOverlap` 互換）」方式であることが判明した。FullCalendar（Google カレンダーと同等のレイアウトを実装する OSS）の `slotEventOverlap=true` 挙動と一致する。

**具体的な違い**:
- 第 5 版（INDENT_X_PX 固定）: N 件の右端位置が不定。件数が増えると右端が揃わず視覚的な乱れが生じる
- 第 6 版（col_width 可変）: N 件で常に右端位置が `overlayWidth - RIGHT_MARGIN_PX` に揃う。FullCalendar 互換の挙動

**ユーザー指示（2026-05-21）**:
「B 案で、新規追加のことを考えて右側に余白を設けてほしい」

**対応方針**:
`INDENT_X_PX` 固定方式を撤回し、グループ内最大同時件数 N を用いた可変幅（`col_width`）方式に転換する。`RIGHT_MARGIN_PX = 24` を設けて新規予定追加クリック領域を確保する。

**確定値変更まとめ（第 5 版 → 第 6 版）**:

| 項目 | 第 5 版 | 第 6 版 |
|---|---|---|
| 方式 | INDENT_X_PX 固定カスケード | 等分割 + OVERLAP_RATIO 半重ね |
| `INDENT_X_PX` | 24（廃止 → archive） | 廃止 |
| `OVERLAP_RATIO` | なし | 0.5（新規） |
| `RIGHT_MARGIN_PX` | なし | 24（新規） |
| `col_width` | 不定（right = セル右端固定） | `usable_w / (1 + (N-1) * OVERLAP_RATIO)` |
| 右端揃え | overlayWidth - GUTTER | overlayWidth - RIGHT_MARGIN_PX |

---

## 2. 現状分析（既存実装の調査結果）

### 2.1 週ビュー / 日ビューの時間予定描画（placeEvents）

**調査ファイル**: `plugin/src/js/desktop.js`

#### 週ビューの placeEvents（行番号 2980〜3293）— 改修対象

時間予定は列（曜日）ごとに `.kc-overlay` コンテナを生成し、その中に `.kc-event` を `position: absolute` で配置する。

```
colCell.querySelector('.kc-overlay')  // 各日付セルに 1 個だけ生成
  └─ div.kc-event  (top: X%, height: Y%)
  └─ div.kc-event  (top: X2%, height: Y2%)  ← 重なる場合は直接重なって配置
```

**重なり時の現状**: 複数の `.kc-event` が同じ `top / height` 範囲を占める場合、後から追加された要素が上層（z-index 上位）になるため、先に追加された要素が完全に隠れる。**列分割（カラム分割）ロジックは存在しない**。

CSS（`desktop.css:499-515`）では `.kc-event` に `left: 6px; right: 6px;` が固定されており、全イベントが列幅 100% で描画される。重なりを避ける width / left の動的計算は行われていない。

#### 日ビューの placeEvents（行番号 4238〜4452）— 改修対象

週ビューと同一構造。`--kc-col-count: 1` で 1 列になるが、オーバーラップ解消ロジックはない。

**結論**: **週ビュー・日ビューともに、時間帯が重なる複数予定は互いを隠す状態で描画されており、カラム分割等のオーバーフロー対策は実装されていない。**

### 2.2 月ビューのセル内表示制御（参考情報 — Phase 1 スコープ外）

**調査ファイル**: `plugin/src/js/desktop.js:3510〜4040`

月ビューでは以下の 3 レイヤでイベントを表示する。

| 表示種別 | 関数 | 仕組み |
|---|---|---|
| 終日バー | `placeMonthAlldayEvents`（3783〜3830 行） | `KC.Lanes.assignLanes` でレーン番号を付与し、絶対座標で `.kc-month-ad-events` レイヤに配置 |
| 日跨ぎ時間予定バー | `placeMonthTimedSpanEvents`（3842〜3875 行） | 終日バーのレーン数 (`alldayLaneCount`) を下オフセットにして同レイヤに積む |
| 単日時間予定 chip | `placeMonthTimedEvents`（3905〜3948 行） | `usedSlots`（終日 + 日跨ぎバーのレーン数）分のスペーサーを挿入し、chip を下に積む |

月ビューの終日バー・日跨ぎバーは `KC.Lanes.assignLanes` でレーン分割済み。単日 chip は件数上限 + `+N more` でオーバーフロー制御済みだが、`+N more` のクリック展開は未実装（`applyOverflow` の click ハンドラなし）。

**月ビューの `+N more` 展開は Phase 2 として別タスクで対応する。**

### 2.3 既存の z-index 構成

`plugin/src/css/desktop.css` より抜粋:

| 要素 | z-index | 役割 |
|---|---|---|
| `.kc-time-col` | 30 | 時刻ガター（sticky）|
| `.kc-ad-events` | 1 | 終日バー絶対配置レイヤ（週・日）|
| `.kc-ad-event` | 2 | 終日バー本体（`kc-ad-events` 上層）|
| `.kc-overlay` | 20 | 時間予定絶対配置レイヤ |
| `.kc-event--ghost` | 9999 | DnD ゴースト |
| `.kc-month-ad-events` | 1 | 月ビュー終日バーレイヤ |
| `.kc-month-chip` / `.kc-month-more` | 2 | 月ビュー chip / +N more |

`.kc-event` 自身には z-index 指定なし。`position: absolute` の重なり順は DOM 追加順（後追加が上層）に依存する。

### 2.4 第 2 版実装済みコードの現状

builder が第 2 版要件に基づき等分割レイアウトを実装済み。

**`_calcOverlapLayout`（週ビュー: `desktop.js:3085〜3116`）**
- 貪欲法で colIdx / maxCols を付与する
- `endTimes` 配列で空きカラムを管理し、境界接触（`endMin === startMin`）は重なりに含めない
- 結果を seg.colIdx / seg.maxCols に書き込む

**`_calcOverlapLayoutDay`（日ビュー: `desktop.js:4432〜4459`）**
- 週ビュー版と同一アルゴリズム

**DOM 生成（週ビュー: `desktop.js:3228〜3253`、日ビュー: `desktop.js:4540〜4556`）**
- `seg.maxCols > 1` のとき等分割（`colW = usableW / maxCols`）でインラインスタイルを設定
- `overlayWidth` が 0 の場合はパーセント計算にフォールバック

**今回の変更対象**: DOM 生成部のインラインスタイル計算式を等分割 + 半重ね + 右側余白方式に変更する。`_calcOverlapLayout` / `_calcOverlapLayoutDay` のアルゴリズム自体（colIdx / maxCols の付与ロジック）は変更不要。

### 2.5 調査で明確になった現状まとめ

| ビュー | 問題の有無 | Phase 1 対応 |
|---|---|---|
| 週ビュー（時間予定） | **あり** — カラム分割なし。重なった予定は DOM 順依存で一方が隠れる | **対象** |
| 日ビュー（時間予定） | **あり（週と同一構造）** — 1 列なので重なりが特に顕著 | **対象** |
| 月ビュー（終日バー） | なし — `KC.Lanes.assignLanes` でレーン分割済み | Phase 1 対象外 |
| 月ビュー（日跨ぎ時間バー） | なし（設計上） | Phase 1 対象外 |
| 月ビュー（単日 chip `+N more` 展開） | 未実装 | Phase 2（別タスク）|

---

## 3. 要件

### 3.1 機能要件（Phase 1 スコープ）

#### FR-1: 日ビュー / 週ビュー — 時間予定の等分割 + 半重ね配置（確定版 第 6 版）

時間帯が重なる複数の時間予定を、FullCalendar `slotEventOverlap=true` 互換の「等分割 + 半重ね + 右側余白」方式で表示する。グループ内最大同時件数 N を基に列幅を可変計算し、右側 24px を新規予定追加用の余白として確保する。`top` は常に時刻ベース値を使用し、時刻認識を最優先とする。

| 属性 | 内容 |
|---|---|
| 対象ビュー | 日ビュー、週ビュー |
| 対象要素 | `.kc-event`（時間予定バー） |
| 対象条件 | 同一日内で時間帯がオーバーラップする 2 件以上の予定 |
| 配置方式 | 等分割 + 半重ね方式（後述の数式参照） |
| colIdx 付与 | 既存の貪欲法（`_calcOverlapLayout` / `_calcOverlapLayoutDay`）をそのまま利用 |
| 非対象 | 終日予定（既存の `KC.Lanes.assignLanes` で対応済み）|

**等分割 + 半重ね配置の数式（確定値）:**

```
N              = グループ内最大同時件数（_calcOverlapLayout の maxCols 値）
OVERLAP_RATIO  = 0.5     // 後発を 50% 右にオフセットして重ねる
RIGHT_MARGIN_PX = 24    // 新規予定追加用の右側余白（px）
GUTTER         = 6      // 左余白（既存維持、CSS の left:6px に対応）

usable_w       = overlayWidth - GUTTER - RIGHT_MARGIN_PX
col_width      = usable_w / (1 + (N - 1) * OVERLAP_RATIO)
overlap_offset = col_width * OVERLAP_RATIO

各 colIdx について:
  left    = GUTTER + colIdx * overlap_offset    (px)
  width   = col_width                           (px)
  top     = 元の時刻ベース top                  (px、縦オフセットなし)
  height  = 元の時刻ベース height               (px、縦オフセットなし)
  right   = auto
  z-index = 10 + colIdx
```

**各値の意味:**
- `OVERLAP_RATIO = 0.5`: 後発予定（col=1 以降）が前発予定に対して col_width の 50% だけ右にオフセットして重なる
- `col_width`: N 件で全予定が右端 `overlayWidth - RIGHT_MARGIN_PX` 付近に揃うように可変計算される
- `RIGHT_MARGIN_PX = 24`: セル右端から 24px を新規予定追加クリック用の空白として確保する
- `left`: colIdx が増えるほど左端を右にずらす（1 ステップ = overlap_offset px）
- `top`: 時刻ベース値を変更しない（縦オフセットなし）。開始時刻の視認性を最優先とする
- `height`: 時刻ベース値を変更しない（縦オフセットなし）
- `z-index`: colIdx が大きい（後ろに配置）ほど前面に表示される

**検算例（overlayWidth = 200px、N = 3）:**

```
usable_w       = 200 - 6 - 24    = 170px
col_width      = 170 / (1 + 2×0.5) = 85px
overlap_offset = 85 × 0.5        = 42.5px

col=0: left=6px,    width=85px, 右端=91px
col=1: left=48.5px, width=85px, 右端=133.5px
col=2: left=91px,   width=85px, 右端=176px
右側余白 = 200 - 176 = 24px ✓
```

**`_calcOverlapLayout` / `_calcOverlapLayoutDay` の変更不要:**
colIdx / maxCols の付与ロジックは変更しない。第 6 版では `maxCols`（= N）を col_width の計算基準として使用する。DOM 生成部のインラインスタイル計算式のみ書き換える。

**`overlayWidth` が 0 の場合のフォールバック:**
第 5 版までと同様、`overlayWidth` が 0 の場合はパーセント計算にフォールバックする（builder 裁量で既存フォールバックロジックを維持すること）。

#### FR-2: 日ビュー / 週ビュー — クリック挙動（既存維持）

配置表示後も、各 `.kc-event` クリック時は新規タブで kintone レコード詳細を表示する（既存挙動を維持。`KC.Popup.openEdit` 等の変更なし）。z-index による前面/背面制御でクリックターゲットが決まる（前面の予定が優先）。

右側 `RIGHT_MARGIN_PX = 24px` の余白は `.kc-event` が存在しない空白領域となるため、その領域のクリックは新規予定追加として機能する（既存の空白クリックハンドラが動作する）。

#### FR-3: 日ビュー / 週ビュー — 重複カラムと DnD の整合性

FR-1 の配置後も、各 `.kc-event` の DnD（`KC.DnD.startMove` / `startResize`）が正常に動作すること。

| 挙動 | Phase 1 仮採用 | 備考 |
|---|---|---|
| DnD ゴースト幅 | フル幅（`kc-event--ghost` CSS を変更しない） | 実装担当が必要に応じて差し戻し提案可 |
| drop 後の colIdx | `KC.Render.renderGrid` 再計算で自動決定 | 再描画時に新しい重なり状態を再計算 |

> **注記**: DnD ゴースト幅は Phase 1 で「フル幅ゴースト」を仮採用する。配置との視覚的不整合が生じる場合、実装担当は差し戻し提案を行うこと（§7 参照）。

### 3.2 非機能要件

| ID | 要件 | 補足 |
|---|---|---|
| NFR-1 | パフォーマンス | 重複計算は `placeEvents` の既存ループ内で完結し、DOM 操作の追加回数を最小化する |
| NFR-2 | DnD 互換性 | `KC.DnD` の `_drag.origBars` / `allBars` への影響が最小であること |
| NFR-3 | CSS 非破壊 | `.kc-event` の既存 CSS（border-radius / padding / font-size 等）を変更しない。`left` / `right` / `width` / `top` / `height` / `z-index` のインラインスタイル上書きのみで対応する |
| NFR-4 | プラグイン実機確認 | 実機アップロード（`plugin/dist/plugin.zip`）後に動作確認する（SAML 認証のため手動） |
| NFR-5 | 従ファイル同期 | `plugin/src/` 改修後、`src/kc-calendar.js` / `src/kc-calendar.css` にも同等の変更を同期する（CLAUDE.md 編集ルール準拠） |
| NFR-6 | 極端な重なり時の可読性リスク | N が大きい場合（例: N=10）、col_width が極小化してタイトルが読めなくなるリスクがある。フォールバック設計は未確定（§7.10 参照） |

---

## 4. 受入基準

Given / When / Then 形式で記述する。

### AC4.1 日ビュー — 2 件重なりが等分割 + 半重ねで表示される

- **Given**: 日ビューで 10:00〜11:00 の予定 A と 10:30〜11:30 の予定 B が存在する（N=2）
- **When**: 日ビューを表示する
- **Then**: 予定 A（col=0）と予定 B（col=1）が同じ幅（col_width）で表示される
- **And**: 予定 B の left が予定 A の left + col_width * 0.5 の位置（50% オフセット）から開始する
- **And**: 予定 A・B の top は各自の時刻ベース値（縦オフセットなし）で、開始時刻が正しく認識できる
- **And**: 予定 B の z-index が予定 A より大きいため、予定 B が前面に表示される
- **And**: 予定 A のラベル左端が予定 B の背後から視認できる
- **And**: 予定 A・B のどちらもクリックでき、新規タブで kintone レコード詳細が表示される

### AC4.2 日ビュー — 3 件重なりが全件同幅で 50% オフセット連なりになる

- **Given**: 09:00〜12:00 の予定 A（col=0）、10:00〜11:00 の予定 B（col=1）、10:30〜13:00 の予定 C（col=2）が同日に存在する（N=3）
- **When**: 日ビューを表示する
- **Then**: A / B / C の width がすべて同じ col_width 値で表示される
- **And**: B の left = A の left + overlap_offset、C の left = A の left + overlap_offset × 2 で 50% ずつ段差を付けて表示される
- **And**: top は A / B / C ともに各自の時刻ベース値（縦オフセットなし）
- **And**: C（col=2、z-index 最大）が最前面に表示される

### AC4.3 週ビュー — 同一日の重なり予定が等分割 + 半重ねになる

- **Given**: 週ビューで特定の曜日に 14:00〜15:00 の予定 A と 14:30〜16:00 の予定 B が存在する（N=2）
- **When**: 週ビューを表示する
- **Then**: A（col=0）と B（col=1）が同じ col_width で表示される
- **And**: B は A に対して 50% オフセット（col_width * 0.5）の位置から開始する
- **And**: B の right 端が `overlayWidth - RIGHT_MARGIN_PX` 付近に揃う

### AC4.4 重なりなし予定はインラインスタイル未設定のまま

- **Given**: 重なる予定がない日の予定がある
- **When**: 日ビュー / 週ビューを表示する
- **Then**: 予定は既存通り `left: 6px; right: 6px`（列幅ほぼ全幅）で表示される（インラインスタイル未設定でフォールバック）

### AC4.5 DnD が配置後も動作する

- **Given**: 日ビューで重なり表示された予定 A がある
- **When**: 予定 A をドラッグして別の時間帯に移動する
- **Then**: `KC.DnD.startMove` が正常に動作し、API 更新後に正しい時刻で再描画される

### AC4.6 クリック挙動が変化しない

- **Given**: 日ビュー / 週ビューで重なり表示された予定がある
- **When**: 任意の予定バーをクリックする
- **Then**: 新規タブで kintone レコード詳細画面が表示される（既存挙動と同じ）

### AC4.7 週ビューリグレッション — 終日バー表示が壊れない

- **Given**: 週ビューに終日予定が複数件表示されている
- **When**: 第 6 版配置実装後に週ビューを確認する
- **Then**: `KC.Lanes.assignLanes` による終日バーのレーン配置が従前通り動作する（`REQ_allday-bar-redesign.md` の全 AC が合格）

### AC4.8 プラグイン実機確認

- **Given**: `plugin/dist/plugin.zip` を kintone にアップロードし検証アプリ（k/891/）に適用している
- **When**: 5/25 の日ビューを表示する
- **Then**: 「タイトル」（00:00〜24:00）と「かさなる？」（10:00〜翌 17:00 日跨ぎ）が等分割 + 半重ね表示され、両方クリックできる
- **And**: 右側 24px が空白として残り、その領域をクリックすると新規予定追加が可能である

### AC4.9 z-index 優先順 — 後方カラムが前面に表示される

- **Given**: 日ビューで 2 件重なり（col=0 / col=1）が存在する
- **When**: col=0 と col=1 の重なり領域を確認する
- **Then**: col=1 の予定が col=0 の予定より前面（z-index: 11 > 10）に表示される
- **And**: col=0 の予定のラベル左端は col=1 の予定の左端より左側に位置し、視認できる

### AC4.10 同時刻スタートでも後発（col=N-1）が前面、先発（col=0）の左端が露出

- **Given**: 日ビューで同一開始時刻（例: 10:00）の予定 A（col=0）と予定 B（col=1）が存在する
- **When**: 日ビューを表示する
- **Then**: 予定 A の top と予定 B の top は同じ時刻ベース値（縦オフセットなし）で、開始時刻が正しく認識できる
- **And**: 予定 B（col=1）が最前面に表示される
- **And**: 予定 A（col=0）の左端が予定 B の背後から横方向に露出して視認できる（露出幅 = overlap_offset px）

### AC4.11 クリック領域: 重なり群の右側 24px は空白セルとして認識される（第 6 版新規）

- **Given**: 日ビュー / 週ビューで重なり予定グループが表示されている
- **When**: セルの右端から 24px 以内の領域をクリックする
- **Then**: その領域には `.kc-event` が存在しないため、空白セルとしてクリックが認識される
- **And**: 新規予定追加ダイアログ / モーダルが起動する（既存の空白セルクリック挙動と同等）

---

## 5. 検証項目・テストシナリオ

### 5.1 等分割 + 半重ね配置の境界値テスト

**アルゴリズム**: 既存の貪欲法（`_calcOverlapLayout` / `_calcOverlapLayoutDay`）で colIdx / maxCols を付与し、第 6 版数式でインラインスタイルを決定する。

```
N              = maxCols（グループ内最大同時件数）
usable_w       = overlayWidth - GUTTER - RIGHT_MARGIN_PX
col_width      = usable_w / (1 + (N - 1) * OVERLAP_RATIO)
overlap_offset = col_width * OVERLAP_RATIO
left(colIdx)   = GUTTER + colIdx * overlap_offset
```

| シナリオ | 予定の構成 | 期待結果 |
|---|---|---|
| 重なりなし | 09:00〜10:00 と 10:00〜11:00（境界が接するのみ） | 2 件ともフル幅・元の top / height（インラインスタイル未設定）|
| 完全重複 2 件（N=2） | 10:00〜11:00 が 2 件 | col=0 / col=1 が同じ col_width。col=1 は col=0 の 50% オフセット位置から開始。z-index: 10 / 11 |
| 部分重複（3 件、maxCols=2） | A: 09:00〜11:00, B: 10:00〜12:00, C: 11:00〜13:00 | maxCols=2。A が col=0、B が col=1、C が col=0 を共有。B のみが col=1 で overlap_offset のオフセットを持つ |
| 3 件同時重なり（N=3） | 10:00〜11:00 が 3 件 | A / B / C が同一 col_width。各 50% オフセットで連なる。右端が overlayWidth - 24px 付近に揃う |
| 4 件同時重なり（N=4） | 10:00〜11:00 が 4 件 | col=3 の right 端が overlayWidth - 24px 付近に揃うことを確認 |

#### 部分重複（3 件）のアルゴリズム動作詳細（変更なし）

予定構成: A（09:00〜11:00）、B（10:00〜12:00）、C（11:00〜13:00）

**colIdx 付与（貪欲法）**:
- A（09:00〜11:00）: 空きカラムのうち最小 → col=0 を取得
- B（10:00〜12:00）: col=0 は A が占有中 → col=1 を取得
- C（11:00〜13:00）: A は 11:00 で終了しており col=0 が空き → col=0 を再利用

**座標（maxCols=2、overlayWidth=200、N=2 として計算）**:
- usable_w = 170、col_width = 113.3px、overlap_offset = 56.7px
- A: `left: 6px`、width: 113.3px、top: 時刻ベース、z-index: 10
- B: `left: 62.7px`、width: 113.3px、top: 時刻ベース（縦オフセットなし）、z-index: 11
- C: `left: 6px`、width: 113.3px、top: 時刻ベース、z-index: 10（A の col=0 を共有）

**理由**: A と C は時間が重ならない（A は 11:00 終了、C は 11:00 開始。境界接触は重複扱いしない）ため、同一 colIdx を再利用できる。B のみが A・C の両方と時間が重なるため col=1 になる。

### 5.2 幅計算の確認テスト（第 6 版: overlayWidth=200px 基準）

`overlayWidth = 200px`、`GUTTER = 6`、`RIGHT_MARGIN_PX = 24`、`OVERLAP_RATIO = 0.5` で計算する。top / height は時刻ベース値のまま変化しないため、left / width のみ検証する。

| N（maxCols） | colIdx | usable_w | col_width | overlap_offset | 期待 left | 期待 right 端 |
|---|---|---|---|---|---|---|
| 2 | 0 | 170px | 113.3px | 56.7px | 6px | 119.3px |
| 2 | 1 | 170px | 113.3px | 56.7px | 62.7px | 176px ≒ 200-24 ✓ |
| 3 | 0 | 170px | 85px | 42.5px | 6px | 91px |
| 3 | 1 | 170px | 85px | 42.5px | 48.5px | 133.5px |
| 3 | 2 | 170px | 85px | 42.5px | 91px | 176px ≒ 200-24 ✓ |
| 4 | 0 | 170px | 68px | 34px | 6px | 74px |
| 4 | 3 | 170px | 68px | 34px | 108px | 176px ≒ 200-24 ✓ |

**height 極小化リスク**: 縦オフセットなしのため発生しない。

**col_width 極小化リスク**: N が大きくなると col_width が縮小する（§7.10 参照）。

### 5.3 DnD 整合性テスト

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 重なり表示された予定の移動 | 重なり表示された予定をドラッグ | ドラッグ開始・終了ともに正常。DnD 後の再描画で新しい重なり状態が正しく計算される |
| 重なり表示された予定のリサイズ | 重なり表示された予定の上下ハンドルをドラッグ | 上下リサイズが正常動作。左右幅は変化しない |
| DnD ゴースト幅 | 重なり表示の予定をドラッグ開始 | ゴーストはフル幅で表示される（Phase 1 仮採用）|

### 5.4 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| 週ビュー終日バー | `REQ_allday-bar-redesign.md §4` 全 AC が合格 |
| 日ビュー全般 | `REQ_day-view.md §4` AC4.1〜AC4.19 が合格 |
| 月ビュー全般 | `REQ_month-view.md §4` AC4.1〜AC4.25 が合格（月ビューは非改修だが念のため確認）|
| 月ビュー DnD | `REQ_month-dnd.md` の全 AC が合格 |

---

## 6. 想定 UX / シーケンス

### 6.1 採用設計案の変遷

#### 第 2 版（不採用）: 等分割カラム方式

全予定を `cellWidth / maxCols` で均等分割。ユーザーが Google カレンダー実機画像で指摘した通り、Google カレンダーの実際の表示とは異なるため不採用。

#### 第 3 版〜第 5 版（不採用）: 固定 INDENT_X_PX カスケード方式

`colIdx * INDENT_X_PX` の固定オフセットで横方向にずらす方式。第 3 版（INDENT_X_PX=14）、第 4 版（縦横両方向）、第 5 版（INDENT_X_PX=24）と変遷したが、右端位置が N に依存して不定になる問題が残り、FullCalendar 互換の挙動と乖離するため不採用。

#### 第 6 版（採用）: FullCalendar 互換 — 等分割 + 半重ね + 右側余白

ユーザー確認（2026-05-21）により **等分割 + OVERLAP_RATIO 半重ね + RIGHT_MARGIN_PX 右側余白** を採用確定。

**概要**: グループ内最大同時件数 N を用いて col_width を可変計算し、全予定が右端 `overlayWidth - RIGHT_MARGIN_PX` に揃うように配置する。後発予定は前発予定に対して col_width * 0.5 だけ右にオフセットして重なる。`top` は時刻ベース値のまま（縦オフセットなし）。

**視覚イメージ（2 件重なり、overlayWidth=200px、N=2）:**

```
|<-- 6px -->|<--- col_width=113px --->|         |<-- 24px -->|
|           [予定 A col=0, z-index:10            ]           |
|           [予定 B col=1, z-index:11            ]           |
             |<-- 57px -->|
```

B の left（≒63px）が A の内部に入り込む。A の左端から B の左端の間（57px）が露出する。右側 24px は空白（新規予定追加用）。

**視覚イメージ（3 件重なり、overlayWidth=200px、N=3）:**

```
|<--6-->|<--- col_width=85px --->|              |<-- 24px -->|
|       [予定 A col=0, z-index:10               ]           |
|       [予定 B col=1, z-index:11               ]           |
|       [予定 C col=2, z-index:12               ]           |
         |<-42->|<-42->|
```

A / B / C がすべて同じ col_width=85px。各 42.5px オフセット。右側 24px は空白。

**シーケンス（週ビュー placeEvents 内）:**

```
1. 当日の全時間予定を開始時刻昇順に並べる（既存: _calcOverlapLayout が担当）
2. 各予定に colIdx / maxCols を付与する（既存: 貪欲法で空きカラム再利用）
3. グループの N = maxCols を用いて col_width / overlap_offset を計算
   usable_w       = overlayWidth - GUTTER - RIGHT_MARGIN_PX
   col_width      = usable_w / (1 + (N - 1) * OVERLAP_RATIO)
   overlap_offset = col_width * OVERLAP_RATIO
4. .kc-event の left / width / top / height / right / z-index をインラインスタイル設定
   left    = GUTTER + colIdx * overlap_offset                (px)
   width   = col_width                                       (px)
   top     = baseTop                                         (px、変更なし)
   height  = baseHeight                                      (px、変更なし)
   right   = 'auto'
   z-index = 10 + colIdx
```

**利点:**
- 全 N 件の右端位置が `overlayWidth - RIGHT_MARGIN_PX` に揃い、視覚的に整然としている
- 右側 24px が常に空白として確保され、新規予定追加のクリック領域が担保される
- FullCalendar / Google カレンダーと同等のレイアウト感
- top が時刻ベース値のまま変わらないため、開始時刻の認識を阻害しない
- `_calcOverlapLayout` のアルゴリズム変更不要（colIdx / maxCols 付与ロジックを再利用）

### 6.2 実装対象ファイル

| 優先度 | ファイル | 変更内容 |
|---|---|---|
| 主（先行） | `plugin/src/js/desktop.js:3228〜3253`（週ビュー DOM 生成部） | インラインスタイル計算式を第 6 版数式（usable_w / col_width / overlap_offset）に変更。`top` / `height` は時刻ベース値をそのまま使用。`z-index` インライン設定を維持 |
| 主（先行） | `plugin/src/js/desktop.js:4540〜4556`（日ビュー DOM 生成部） | 同上 |
| 主（先行） | `plugin/src/css/desktop.css:499〜518`（`.kc-event` セレクタ） | `z-index` CSS 基底値なし（インライン上書きで対応するため変更不要の可能性あり）。インライン `z-index` が競合する場合は確認すること |
| 従（後同期） | `src/kc-calendar.js` | `plugin/src/js/desktop.js` の変更を同期 |
| 従（後同期） | `src/kc-calendar.css` | `plugin/src/css/desktop.css` の変更を同期 |

**`_calcOverlapLayout` / `_calcOverlapLayoutDay` 関数は変更不要。**

### 6.3 月ビュー `+N more` 展開（Phase 2 — 本要件定義書のスコープ外）

月ビューの `+N more` クリックで非表示件数の詳細を展開するポップオーバーは **Phase 2 として別タスクで対応する**。別途 `REQ_month-overflow-popup.md` を起票予定。

---

## 7. 確定済み事項 / 未確定事項

### 7.1 [確定] スコープ

**確定値**: Phase 1 のみ（等分割 + 半重ね + 右側余白配置）。週ビュー / 日ビューのレイアウトを実装する。月ビューの `+N more` 展開は今回のスコープ外（別タスクで後送り）。
**確定日**: 2026-05-21

月ビュー関連の項目は **Phase 1 では対象外。別タスクで起票予定**（`REQ_month-overflow-popup.md`）。

### 7.2 [確定] 最大列数制限

**確定値**: 制限なし。重なる件数だけ colIdx が増える。col_width が極小化するリスクは NFR-6 / §7.10 に記載。
**確定日**: 2026-05-21（継続）

### 7.3 [確定] 設計案の選択

**確定値**: 等分割 + 半重ね + 右側余白方式採用（FullCalendar 互換、2026-05-21）。等分割カラム方式（第 2 版）→ 固定 INDENT_X_PX カスケード（第 3〜5 版）→ 等分割 + OVERLAP_RATIO 半重ね（第 6 版）と段階的に確定。
**確定日**: 2026-05-21

### 7.4 [確定] クリック UX

**確定値**: z-index 順で前面の予定が優先クリックされる。各予定の click ハンドラは既存通り（`KC.Popup.openEdit` 等の変更なし）。右側 RIGHT_MARGIN_PX 領域は空白セルとして新規予定追加クリックが可能。
**確定日**: 2026-05-21

### 7.5 [要検討] DnD ゴースト幅

**Phase 1 仮採用値**: フル幅ゴースト（`kc-event--ghost` CSS を変更しない）。
**確定日**: 2026-05-21（仮採用）

**所見**: 等分割 + 半重ね表示されている時の DnD ゴースト幅は要検討事項として残す。Phase 1 ではフル幅ゴーストを仮採用するが、実装担当が視覚的不整合を確認した場合は差し戻し提案を行うこと。差し戻しの場合は管理者経由でユーザー確認を取る。

### 7.6 [確定] アルゴリズム選定と配置定数（第 6 版）

**確定値**:
- colIdx / maxCols 付与: 既存の貪欲法（`_calcOverlapLayout` / `_calcOverlapLayoutDay`）を変更なしで利用
- `OVERLAP_RATIO = 0.5`（後発予定の左端オフセット比率）
- `RIGHT_MARGIN_PX = 24`（新規予定追加用の右側余白）
- `GUTTER = 6`（セル左端の基本余白、CSS の `left: 6px` に対応）
- `z-index = 10 + colIdx`（`.kc-time-col` の z-index:30 / `.kc-overlay` の z-index:20 より小さく、`kc-event--ghost` の z-index:9999 より小さい）

**`OVERLAP_RATIO = 0.5` の根拠**:
- FullCalendar の `slotEventOverlap=true` と同等の挙動
- Web 調査で Google カレンダーの実際の重なり表示と整合することを確認
- 50% = 後発予定が前発予定の中央付近から開始し、互いのラベル領域が均等に露出する

**`RIGHT_MARGIN_PX = 24` の根拠**:
- 新規予定追加クリック用の余白として 24px を確保
- 第 5 版の `INDENT_X_PX = 24` と同値であり UI 規則性を保つ
- 指先タップでの新規作成を考慮した最小余白幅

**`INDENT_X_PX`（第 5 版まで）撤回**:
固定オフセット方式は N 件での右端位置が不定になるため廃止。§7.12 に archive 化。

**確定日**: 2026-05-21（第 6 版で OVERLAP_RATIO / RIGHT_MARGIN_PX を新規採用。INDENT_X_PX を廃止）

### 7.7 [前提] プラグイン版対象

`plugin/src/js/desktop.js` および `plugin/src/css/desktop.css` が主改修対象。`src/kc-calendar.js` / `src/kc-calendar.css` は従（同期対象）。旧カスタマイズ版単独の実装は行わない（HANDOVER.md §5 参照）。

### 7.8 [前提] 月ビュー終日バー・日跨ぎバーは対象外

月ビューの終日バー（`KC.Lanes.assignLanes` でレーン分割済み）と日跨ぎ時間予定バー（`placeMonthTimedSpanEvents`）は、既存実装で重なりが制御されているため本要件のスコープ外とする。

### 7.9 [リスク] Phase 2 実機未検証

MEMORY.md および HANDOVER.md §4 の記録通り、時間予定 DnD（Phase 2）は実機未検証。第 6 版配置実装後、日ビュー / 週ビューの時間予定 DnD が正しく動作するかは実機検証が必要。

### 7.10 [未確定] N が極端に大きい場合の col_width 極小化フォールバック（第 6 版追記）

**未確定事項**:
N が大きい場合（例: N=10）、col_width が極小化してタイトルが読めなくなるリスクがある。

**col_width 極小化の発生目安（overlayWidth=200px 基準）**:

| N | col_width | 最小露出幅（overlap_offset） |
|---|---|---|
| 5 | 170 / (1 + 4×0.5) = 56.7px | 28.3px |
| 8 | 170 / (1 + 7×0.5) = 37.8px | 18.9px |
| 10 | 170 / (1 + 9×0.5) = 30.9px | 15.5px |

**N >= 8〜10 程度から col_width が 30〜38px となり、タイトル可読性が著しく低下する。**

**将来の対応候補（未確定）**:
1. `min col_width` を設定し（例: 40px）、それ以下になる場合は超過分の予定を `+N` 省略表示
2. N が閾値を超えた場合は純粋な重ね合わせ（z-index のみ増加）にフォールバック
3. 左端オフセットの増加を止め、後方カラムは前面重ね表示のみとする

**管理者への報告事項**: Phase 1 実装後の実機確認で多件数重なりの可読性を検証し、ユーザーの意見を踏まえてフォールバック設計を別途決定すること。

### 7.11 [archive] INDENT_Y_PX 第 4 版確定値（撤回済み旧確定値）

> **本セクションは第 4 版で確定したが、第 5 版で撤回された旧確定値として archive 扱いとする。**
> 撤回理由: ユーザーフィードバック「縦にずらすと開始時刻が分かりづらい」（2026-05-21）。現行確定値は §7.6 を参照。

**旧確定値（第 4 版）**: `INDENT_Y_PX = 8`
**撤回日**: 2026-05-21（第 5 版）

**旧確定根拠（参考）**:

| 観点 | 検討内容 |
|---|---|
| テキスト高さとの比率 | `.kc-evt-title` は `font-size: 16px`、`line-height` は通常 1.2〜1.4 倍で実高さは約 19〜22px。8px はその約 1/2 強であり、「上端がほんの少し覗く」表現として視覚的に自然な比率と判断した |
| 時刻ズレ感の最小化 | overlayHeight を 1440 分で割った 1 分あたりの高さ（標準 1px/min 程度）に対し、8px は約 8 分相当のずれに収まるとした。しかし実機確認で時刻認識への影響が想定より大きかったため撤回 |
| 同時刻スタートでの上端露出面積 | 8px × 14px（INDENT_Y_PX × INDENT_X_PX）= 112px² の矩形が col=0 の上端に露出するとした |
| height 縮小への影響 | 30 分予定で col=3 時に `height = 30 - 24 = 6px` となるリスクがあった。撤回により height 極小化リスクは解消（§7.10 参照） |

### 7.12 [archive] INDENT_X_PX 第 5 版確定値（撤回済み旧確定値）

> **本セクションは第 5 版で確定したが、第 6 版で撤回された旧確定値として archive 扱いとする。**
> 撤回理由: FullCalendar 互換の等分割 + 半重ね方式への方針転換（2026-05-21）。現行確定値は §7.6 を参照。

**旧確定値（第 5 版）**: `INDENT_X_PX = 24`
**撤回日**: 2026-05-21（第 6 版）

**旧確定根拠（参考）**:
- 最小ラベル視認性: `.kc-evt-title` は `font-size: 16px` / `font-weight: 700`、全角 1 文字が 16px 程度。24px は 1〜2 文字分のラベル露出を確保できる値
- 縦オフセット撤回の補償: 第 4 版の `INDENT_X_PX = 14` は縦方向露出との組み合わせで設計されていたため 24 に拡大

**撤回の理由**:
固定オフセット方式では N 件での右端位置が不定になり、FullCalendar 互換の「右端揃え」が実現できなかった。第 6 版の `OVERLAP_RATIO = 0.5` + `RIGHT_MARGIN_PX = 24` の可変幅方式に移行。

---

## 参照した既存実装行番号（サマリ）

| 内容 | ファイル:行番号 | Phase 1 改修 |
|---|---|---|
| 週ビュー `placeEvents`（時間予定配置） | `plugin/src/js/desktop.js:2980〜3293` | **対象** |
| 週ビュー `_calcOverlapLayout`（colIdx 付与） | `plugin/src/js/desktop.js:3085〜3116` | **変更不要**（colIdx / maxCols 付与ロジックはそのまま）|
| 週ビュー DOM 生成（インラインスタイル計算） | `plugin/src/js/desktop.js:3228〜3253` | **対象**（第 6 版数式: col_width / overlap_offset で計算。top / height は時刻ベース値のまま）|
| 日ビュー `placeEvents`（時間予定配置） | `plugin/src/js/desktop.js:4238〜4452` | **対象** |
| 日ビュー `_calcOverlapLayoutDay`（colIdx 付与） | `plugin/src/js/desktop.js:4432〜4459` | **変更不要** |
| 日ビュー DOM 生成（インラインスタイル計算） | `plugin/src/js/desktop.js:4540〜4556` | **対象**（第 6 版数式: col_width / overlap_offset で計算。top / height は時刻ベース値のまま）|
| `.kc-event` CSS（left/right 固定）| `plugin/src/css/desktop.css:499〜518` | 確認必要（z-index の CSS 基底値なし、競合なければ変更不要）|
| `.kc-overlay` CSS（z-index 20）| `plugin/src/css/desktop.css:529〜534` | 参考（変更なし予定）|
| `.kc-event--ghost`（z-index 9999）| `plugin/src/css/desktop.css:562〜569` | 変更なし（最前面を維持）|
| 月ビュー `MAX_CELL_ITEMS` | `plugin/src/js/desktop.js:3513` | Phase 2 |
| 月ビュー `_calcMaxItems`（動的算出）| `plugin/src/js/desktop.js:3526〜3530` | Phase 2 |
| 月ビュー `placeMonthAlldayEvents` | `plugin/src/js/desktop.js:3783〜3830` | 対象外 |
| 月ビュー `placeMonthTimedSpanEvents` | `plugin/src/js/desktop.js:3842〜3875` | 対象外 |
| 月ビュー `placeMonthTimedEvents` | `plugin/src/js/desktop.js:3905〜3948` | Phase 2 |
| 月ビュー `applyOverflow`（+N more）| `plugin/src/js/desktop.js:3955〜3962` | Phase 2 |
| 月ビュー `placeMonthEvents`（オーケストレーター）| `plugin/src/js/desktop.js:3968〜4040` | Phase 2 |
| `KC.Lanes.assignLanes` | `plugin/src/js/desktop.js:2562〜2598` | 参考（変更なし予定）|

---

*本要件定義書: 確定版 第 6 版（2026-05-21）。FullCalendar 互換の等分割 + 半重ね（OVERLAP_RATIO=0.5）+ 右側余白（RIGHT_MARGIN_PX=24）方式に確定。INDENT_X_PX 固定カスケード（第 5 版）は archive 化。月ビュー `+N more` 展開は別タスク（`REQ_month-overflow-popup.md`）で管理。*
