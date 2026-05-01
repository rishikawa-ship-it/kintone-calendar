# 要件定義書: 予定のドラッグ日時変更（移動・リサイズ）

**文書番号**: REQ_event-drag-resize  
**作成日**: 2026-04-30  
**更新日**: 2026-05-01（ユーザー指示 8 件を反映。§1.3 に日跨ぎ表示復活の上書き宣言を明記）/ 2026-05-01（ユーザー回答 4 件を確定事項として反映。§10 未確定事項 5 件 → 1 件に削減）  
**作成者**: designer (サブエージェント)  
**対象ファイル**: `src/kc-calendar.js`, `src/kc-calendar.css`（および `docs/` ミラー）  
**ステータス**: 確定版（未確定事項 1 件 — §10 参照）

> **重要: 2026-05-01 ユーザー指示による過去意思決定の上書き**  
> 時間予定の日跨ぎ（24:00 超）表示について、従来実装では開始日の 24:00 でバーを切っていたが、2026-05-01 のユーザー回答により **Google カレンダー準拠**（当日と翌日の両方にバー表示）へ変更することが確定した。本要件書はこの上書きを前提として記述する。

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

### 1.1 既存 `KC.DnD` の現状と限界

`src/kc-calendar.js:551–730` に `KC.DnD` モジュールが定義されているが、調査の結果 **以下の致命バグにより実質未動作**であることが判明した。

| バグ ID | 内容 | 該当箇所 |
|---|---|---|
| A | `.kc-cell` に `data-date` 属性が付与されていない → `KC.DnD._dayFromEvent` が `new Date(undefined)` を返し日付移動が全て破綻する | `src/kc-calendar.js:1083–1097`（`renderRows` 関数） |
| B | 終日バー `.kc-ad-event` に `mousedown` ハンドラが配線されていない → 終日 DnD が全く動かない | `src/kc-calendar.js:975–1022`（`buildAlldayBar` 関数） |
| C | CSS クラス名不整合: CSS は `.kc-event.ghost`（`kc-calendar.css:553`）だが JS は `.kc-ghost` クラスを付与（`kc-calendar.js:572`）→ ゴースト UI が完全に無効 | `kc-calendar.css:553–556` / `kc-calendar.js:572` |
| D | `startResize` 関数は実装済み（`kc-calendar.js:634–716`）だが上下端リサイズハンドル DOM が存在せず呼び出し元もない → リサイズ操作が不可能 | `kc-calendar.js:634–716` |
| E | クリック/ドラッグの閾値判定なし → マウスダウン直後に DnD が発動し意図しない誤発動が起きる | `kc-calendar.js:1264–1272` |

既存の実装思想（`cloneNode` ベースの複数ゴースト生成 + `mouseover` による日付追跡）は上記バグを内包したまま放置されており、Google カレンダー相当の UX を提供できない。

### 1.2 Google カレンダー風 DnD で達成したい UX

- 予定バーを掴んで別の日・時間帯へドラッグするだけで日時が変更できる
- バーの上下端（時間予定）または左右端（終日予定）をドラッグするだけで期間を変更できる
- ドラッグ中は単一のゴーストバーが追従し、現在の想定日時をリアルタイム表示する
- 誤操作（5px 未満の微小移動）はクリックとして扱い、DnD を発動しない
- ESC キーでドラッグをキャンセルし、元の状態に戻れる
- API 失敗時は alert で通知する（将来タスクで改善予定）

### 1.3 日跨ぎ表示復活（2026-05-01 ユーザー指示で上書き）

従来の `placeEvents`（`kc-calendar.js:1188–1275`）は時間予定を **開始日の単一列にのみ描画**し、24:00 を超える場合はその日の終端（高さ 100%）でバーを切っていた。

2026-05-01 のユーザー回答により、時間予定の **日跨ぎ表示を Google カレンダー準拠で復活**させることが確定した。

- データ保存: `start`/`end` に実際の跨ぎ日時を保存可（例: `2026-05-01T22:00:00Z` 〜 `2026-05-02T02:00:00Z`）
- 表示: 表示週内の **各日に分割セグメントを描画**（当日分 + 翌日分）
- ドラッグ後 API 更新時も跨ぎ日時をそのまま送信する

関連設計書: `requirements/REQ_allday-bar-redesign.md`（終日バーの絶対配置方式と同じ思想を時間予定にも適用する）

---

## 2. スコープ

### 2.1 対象（スコープ内）

| 項目 | 詳細 |
|---|---|
| 時間予定の移動 | 縦方向 15 分スナップ・横方向 1 日スナップ。ドラッグで日時変更 |
| 時間予定のリサイズ（上端） | バー上端ハンドルを縦方向へドラッグ、15 分スナップで開始時刻変更 |
| 時間予定のリサイズ（下端） | バー下端ハンドルを縦方向へドラッグ、15 分スナップで終了時刻変更 |
| 終日予定の移動 | 横方向ドラッグで 1 日スナップ移動 |
| 終日予定のリサイズ（左端） | バー左端ハンドルを横方向へドラッグ、1 日スナップで開始日変更 |
| 終日予定のリサイズ（右端） | バー右端ハンドルを横方向へドラッグ、1 日スナップで終了日変更 |
| 時間予定の日跨ぎ表示復活 | 24:00 跨ぎを許可し、当日と翌日に分割セグメントを描画（Google 準拠） |
| ESC キャンセル | ドラッグ中に ESC でキャンセル、元の状態に戻す |
| 5px ドラッグ閾値 | マウスダウン後 5px 未満の移動はクリックとして扱い DnD を発動しない |
| 単一バー方式ゴースト UI | ドラッグ中は 1 個の `div` を絶対配置で追従させる（`cloneNode` 廃止） |
| ゴースト内時刻ラベル | ゴーストバー内に「HH:MM 〜 HH:MM」を表示する（時間予定のみ） |
| `$revision` 楽観ロック対応 | `KC.Api.updateEvent` のペイロードに `revision: ev.rev` を含める |
| 楽観的 UI 更新 | API コミット成功時は全再取得せず `KC.State.events` をインプレース更新して再描画 |
| 既存バグ A〜E の同時修正 | 上記 §1.1 の全バグを本タスクで解消する |

### 2.2 スコープ外

| 項目 | 理由 |
|---|---|
| 月ビュー DnD | `KC.RenderMonth` がスタブのため別タスク |
| 終日 ⇄ 時間あり相互変換 | `allday` フィールド型固定。フィールド設計変更が必要なため別タスク |
| 重複時間予定の並列表示 | 別タスクで定義済み |
| キーボード / タッチ操作 | 別フェーズ（本要件はマウスのみ） |
| API 失敗時の UI 通知改善 | 別タスク（現状 alert 据え置き） |
| `KC.DnD.beginSelection` | コード内で参照されているが実装なし（`DESIGN.md:206` 参照）。本タスクではスコープ外として明記し、未実装のまま残す |
| スロットクリックの新規作成スナップ粒度 | 現状 30 分維持（変更なし） |

---

## 3. 設計方針

### 3.1 全体アーキテクチャ

```
[mousedown on .kc-event / .kc-ad-event / resize-handle]
  │
  ├─ 5px 閾値判定（mousemove で距離を計測）
  │    │ 5px 未満: DnD 不発動 → クリックとして通過
  │    └ 5px 以上: DnD 開始
  │
  ├─ ghost 生成（単一 div を document.body に絶対配置）
  │
  ├─ mousemove ループ
  │    ├─ 時間予定移動:  カーソル位置 → スロット行 → 15 分スナップ座標 → ghost 追従
  │    ├─ 時間予定リサイズ: カーソル Y → 15 分スナップ → ghost 高さ/上端変更
  │    ├─ 終日移動:      カーソル位置 → .kc-adcell のコラム → 1 日スナップ → ghost 追従
  │    └─ 終日リサイズ:  カーソル X → .kc-adcell のコラム → 1 日スナップ → ghost 幅/左端変更
  │
  ├─ [ESC] → キャンセル（ghost 除去、状態クリア、クリックブロック解除）
  │
  └─ mouseup
       ├─ ghost 除去
       ├─ delta === 0 の場合: 変更なし → 何もしない
       └─ delta > 0 の場合:
            ├─ KC.State.events を楽観的にインプレース更新
            ├─ KC.Render.renderGrid()（即時 UI 反映）
            └─ KC.Api.updateEvent({ id, start, end, revision }) を非同期送信
                 ├─ 成功: 何もしない（楽観更新が正）
                 └─ 失敗: alert(err.message) + KC.Render.refresh()（ロールバック）
```

### 3.2 時間予定の DnD（移動）

#### 3.2.1 ドラッグ開始

- トリガー: `.kc-event` バー本体の `mousedown`（ボタン 0 のみ）
- 5px 閾値を超えた時点で DnD モードに移行
- 開始時刻 (`ev.start`) とカーソルがバー内のどの位置にあるかをオフセット（分単位）として保持する
- ドラッグ中は元バー（`.kc-event`）に `.kc-event--dragging` クラスを付与し `opacity: 0.4`（確定: 2026-05-01 ユーザー回答 B）にして位置を維持する

#### 3.2.2 ゴースト追従ロジック（移動）

```
カーソルの (x, y) → 対応する .kc-cell の data-date（日付列）+ .kc-row の data-hour（時刻行）を取得
→ 開始分 = スナップ(カーソルY座標をピクセル/分で換算、15分単位) - offsetMin
→ 終了分 = 開始分 + 元の持続時間（分）
→ ghost の top / height / left（列幅）を設定
→ ghost 内ラベルを更新: "HH:MM〜HH:MM"（全角チルダ・スペースなし）
```

**15 分スナップ計算式**:
```
rowHeightPx = kc-rows の高さ / 24 / 2   // 30 分スロット高
slotMin     = 30
snapMin     = 15
rawMin      = (カーソルY - rows.getBoundingClientRect().top) / rowHeightPx * slotMin
snappedMin  = Math.round(rawMin / snapMin) * snapMin
```

#### 3.2.3 マウスアップ（移動確定）

- 新しい `start` / `end` を ISO 8601 文字列として算出
- 元の `start`/`end` と同一なら何もしない
- 異なれば楽観更新 → API 送信

### 3.3 時間予定のリサイズ（上端・下端）

#### 3.3.1 リサイズハンドル DOM

`placeEvents` 内で `.kc-event` を生成する際、上端・下端にハンドル要素を追加する。

```html
<div class="kc-event">
  <div class="kc-resize-handle kc-resize-handle--top"></div>
  <!-- タイトル・メタ -->
  <div class="kc-resize-handle kc-resize-handle--bottom"></div>
</div>
```

- ハンドル高: `--kc-dnd-handle-h`（確定: **8px**）
- ハンドル `cursor`: 上端 `ns-resize`、下端 `ns-resize`
- ハンドル `mousedown` → `KC.DnD.startResize(ev, 'top'|'bottom', mousedown)`
- **可視性（確定: 2026-05-01 ユーザー回答 B）**: デフォルト `opacity: 0`、`.kc-event:hover .kc-resize-handle--top` / `.kc-resize-handle--bottom` 時に `opacity: 1`（ホバー時のみ出現）。ハンドル領域（高さ 8px）は常に DOM に存在し、透明な状態でヒットエリアは有効なままとする

#### 3.3.2 上端リサイズ

- `top` / `height` を変化させ `start` のみを更新
- 下限: `end - 15分` 以上に `start` を縮められない（最小 15 分）
- ゴーストの高さが変化する

#### 3.3.3 下端リサイズ

- `height` を変化させ `end` のみを更新
- 下限: `start + 15分` 以上に `end` を縮められない（最小 15 分）

### 3.4 終日予定の DnD（移動）

- トリガー: `.kc-ad-event` バー本体の `mousedown`（バグ B 修正により `buildAlldayBar` 内に追加）
- 5px 閾値を超えた時点で DnD 開始
- `_dayFromCell(e)` を使い `.kc-adcell[data-date]` からドラッグ先の日付を取得
- ゴースト（終日バー型）を `kc-allday` 上に絶対配置で追従させる
- マウスアップ時: `start` / `end` を delta 日分シフト、API 送信

### 3.5 終日予定のリサイズ（左端・右端）

- `.kc-ad-event` の左端 / 右端に `.kc-resize-handle--left` / `.kc-resize-handle--right` を追加
- 1 日スナップでコラム単位移動
- 最小スパン: 1 日（`start < end` を維持）
- ゴーストの `left` / `width` がリアルタイムに変化する
- **可視性（確定: 2026-05-01 ユーザー回答 B）**: デフォルト `opacity: 0`、`.kc-ad-event:hover .kc-resize-handle--left` / `.kc-resize-handle--right` 時に `opacity: 1`（ホバー時のみ出現）。ハンドル領域（幅 6px）は常に DOM に存在する

### 3.6 ゴースト UI の構造

#### 3.6.1 時間予定ゴースト

```html
<div class="kc-event kc-event--ghost" style="position:fixed; ...">
  <div class="kc-evt-title">予定タイトル</div>
  <div class="kc-evt-ghost-time">HH:MM〜HH:MM</div>
</div>
```

- `position: fixed` で `document.body` に直接 append（スクロールオフセット不要）
- `pointer-events: none` で下のグリッドへのイベントを透過

#### 3.6.2 終日予定ゴースト

```html
<div class="kc-ad-event kc-event--ghost" style="position:absolute; ...">
  <span class="dot"></span>
  <span class="kc-ad-evt-title">予定タイトル</span>
</div>
```

- `.kc-allday` 内に `position: absolute` で配置
- 既存の `.kc-ad-events` レイヤと同じ座標系を使用

#### 3.6.3 CSS クラス名統一

**既存の不整合（バグ C）を修正する。**

| 用途 | 新クラス名 | 変更前 |
|---|---|---|
| ゴーストバー共通 | `.kc-event--ghost` | `.kc-event.ghost`（CSS）/ `.kc-ghost`（JS）で不整合 |
| ゴースト時刻ラベル | `.kc-evt-ghost-time` | 新規追加 |

### 3.7 ゴースト内時刻ラベル

- 時間予定のゴーストバー内に `<div class="kc-evt-ghost-time">HH:MM〜HH:MM</div>` を表示する
- **時刻フォーマット（確定: 2026-05-01 ユーザー回答 A）**: `HH:MM〜HH:MM`（全角チルダ・スペースなし）
  - 例: `10:00〜11:00`、`22:30〜00:15`
- **表示位置**: タイトル（`.kc-evt-title`）の下に小さめのフォント（11px）で続けて表示する
  - DOM 構成は §3.6.1 参照（`kc-evt-title` の直後に `kc-evt-ghost-time`）
- 終日予定のゴーストには時刻ラベルを表示しない
- ゴースト追従中は `mousemove` のたびに `textContent` を更新する（XSS 対策として `innerHTML` は使用しない）

### 3.8 ESC キャンセル

- `document.addEventListener('keydown', ...)` を DnD 開始時に登録（mouseup で除去）
- ESC 押下時:
  1. ghost 要素を `document.body` / `.kc-allday` から除去
  2. 元バーの `opacity` を元に戻す
  3. `KC.DnD._drag` を `null` にクリア
  4. `document.body.style.userSelect = ''` を戻す
  5. `mousemove` / `mouseup` リスナを除去

### 3.9 5px ドラッグ閾値

- `mousedown` 時点では DnD を開始しない
- `mousemove` で `Math.hypot(e.clientX - startX, e.clientY - startY)` を計算し、`DND_THRESHOLD = 5`（px）を超えた時点で初めて DnD を開始する
- 閾値を超えるまでは `mousemove` / `mouseup` ハンドラを仮登録しておき、超えた時点でゴーストを生成する

### 3.10 楽観的 UI 更新と `$revision` 楽観ロック

#### 3.10.1 楽観的更新フロー

```
mouseup → delta 確認 → 新 start/end 算出
  → KC.State.events 内の対象イベントをインプレース更新
  → KC.Render.renderGrid()  ← 即時描画
  → KC.Api.updateEvent(...) ← 非同期（await しない）
       ├─ 成功: 戻り値の $revision を KC.State.events に反映
       └─ 失敗: alert(err.message) + KC.Render.refresh() でサーバー値に戻す
```

#### 3.10.2 `revision` の送信

`KC.Api.updateEvent`（`src/kc-calendar.js:452–490`）の PUT リクエストに `revision: ev.rev` を追加する。

```javascript
await kintone.api(url, 'PUT', {
  app: KC.Config.getAppId(),
  id: ev.id,
  revision: ev.rev,   // 楽観ロック: 競合時は kintone が 409 を返す
  record: record
});
```

### 3.11 時間予定の日跨ぎ表示復活

#### 3.11.1 現状の問題（バグ A を含む）

`placeEvents`（`kc-calendar.js:1188–1275`）は時間予定を開始日の単一列にのみ配置し、`endMin = 24 * 60` で切っている。`.kc-cell` に `data-date` が付与されておらず（バグ A）、日付移動の基盤が壊れている。

#### 3.11.2 変更後の動作

- `placeEvents` の時間予定ブロックを **per-event の分割描画** に書き換える
- 各時間予定に対して、表示週内の各日（`weekYMD[0]〜weekYMD[6]`）と期間が重なるか判定し、重なる日ごとにセグメントを生成する

```
セグメント計算:
  dayStart = max(ev.start, dayの 00:00)
  dayEnd   = min(ev.end,   dayの 24:00)
  topPct    = (dayStart からその日の 00:00 を引いた分) / (24*60) * 100
  heightPct = (dayEnd - dayStart の分) / (24*60) * 100
```

- **日跨ぎセグメントの視覚連結（確定: 2026-05-01 ユーザー回答 A）**: 当日下端と翌日上端を直角寄りにして連続感を出す
  - セグメントには以下のクラスを付与する（終日バーの `seg-start` / `seg-end` 思想を時間予定に展開）:
    - `.kc-event--span-start`: 当日（開始日）のセグメント。下端の角丸を直角寄りに（`border-bottom-left-radius: 1px; border-bottom-right-radius: 1px`）
    - `.kc-event--span-end`: 翌日（終了日）のセグメント。上端の角丸を直角寄りに（`border-top-left-radius: 1px; border-top-right-radius: 1px`）
    - `.kc-event--span-middle`: 中間日（3 日以上跨ぎ）のセグメント。上下端とも直角寄り（`border-radius: 1px`）。当面は span-start / span-end のみで足りる想定だが、将来の 3 日以上跨ぎに備えて定義しておく
  - 通常（日跨ぎなし）のセグメントはクラス付与なし。デフォルトの `border-radius: 4px` を維持する
  - セグメント生成時に JS で付与する（`placeEvents` 内の per-day ループ内で判定）

#### 3.11.3 `renderRows` への `data-date` 付与（バグ A 修正）

`renderRows`（`kc-calendar.js:1065–1098`）の `.kc-cell` 生成部分に `data-date` 属性を追加する。

```javascript
// 変更前 (kc-calendar.js:1089)
var cell = document.createElement('div');
cell.className = 'kc-cell';

// 変更後
var cellDate = U.addDays(range.start, c);
cell.dataset.date = U.fmtYMD(cellDate);
```

---

## 4. 受け入れ条件（Done の定義）

各条件は Given/When/Then 形式で記述する。

### AC4.1 時間予定の移動（同日内）

- **Given**: 13:00〜14:00 の時間予定が登録済みで週ビューに表示されている
- **When**: バーを 15:00 の位置までドラッグして放す
- **Then**: API が `start: 15:00, end: 16:00` で更新呼び出しされ、バーが 15:00〜16:00 の位置に再描画される
- **And**: ドラッグ中はゴーストバーが 15:00〜16:00 位置に追従する

### AC4.2 時間予定の移動（日付跨ぎ）

- **Given**: 月曜 10:00〜11:00 の時間予定が登録済み
- **When**: バーを水曜の 10:00 位置にドラッグして放す
- **Then**: API が水曜の `start: 10:00, end: 11:00` で更新呼び出しされ、水曜の 10:00〜11:00 に再描画される

### AC4.3 時間予定の 15 分スナップ

- **Given**: 任意の時間予定が表示されている
- **When**: バーを 12:07 相当の位置にドラッグして放す
- **Then**: 開始時刻は 12:00 にスナップし（15 分単位で丸め）、`start` が 12:00 として更新される
- **And**: 12:08〜12:22 の位置にドラッグして放すと 12:15 にスナップする

### AC4.4 時間予定のリサイズ（下端）

- **Given**: 13:00〜14:00 の時間予定が表示されている
- **When**: 下端ハンドルを 15:00 位置にドラッグして放す
- **Then**: API が `end: 15:00` で更新呼び出しされ、バーが 13:00〜15:00 に伸びる

### AC4.5 時間予定のリサイズ（上端）

- **Given**: 13:00〜14:00 の時間予定が表示されている
- **When**: 上端ハンドルを 12:00 位置にドラッグして放す
- **Then**: API が `start: 12:00` で更新呼び出しされ、バーが 12:00〜14:00 に伸びる

### AC4.6 時間予定の最小リサイズ（30 分未満阻止）

- **Given**: 13:00〜14:00 の時間予定が表示されている
- **When**: 下端ハンドルを 13:00 以下（元の start と同じ or それ以前）にドラッグして放す
- **Then**: `end = start + 15分` にクランプされ、API は `end: 13:15` で呼び出される（13:00〜13:15 が最小）

### AC4.7 終日予定の移動

- **Given**: 月曜の終日予定が登録済み
- **When**: バーを木曜の列にドラッグして放す
- **Then**: API が木曜の `start` / `end` で更新呼び出しされ、木曜に再描画される

### AC4.8 終日予定のリサイズ（右端）

- **Given**: 月曜〜水曜の終日予定が登録済み
- **When**: 右端ハンドルを金曜列にドラッグして放す
- **Then**: API が月曜〜金曜の期間で更新呼び出しされ、連続バーが月曜〜金曜に伸びる

### AC4.9 終日予定のリサイズ（左端）

- **Given**: 月曜〜水曜の終日予定が登録済み
- **When**: 左端ハンドルを水曜列にドラッグして放す
- **Then**: API が水曜〜水曜の期間（1 日）で更新呼び出しされ、バーが水曜の 1 列に縮む

### AC4.10 ゴースト内時刻ラベル

- **Given**: 13:00〜14:00 の時間予定をドラッグ中
- **When**: ゴーストバーが 15:00〜16:00 の位置に来ている
- **Then**: ゴーストバー内に「15:00〜16:00」（全角チルダ・スペースなし）の文字列が表示されている
- **And**: ラベルはタイトルの下に 11px フォントで表示されている

### AC4.11 5px ドラッグ閾値（誤発動防止）

- **Given**: 任意の時間予定バーが表示されている
- **When**: バーをマウスダウンして 3px 以内で放す（純クリック相当）
- **Then**: DnD が発動せず、`KC.Popup.openEdit` が呼ばれる（クリックとして扱われる）

### AC4.12 5px ドラッグ閾値（DnD 発動）

- **Given**: 任意の時間予定バーが表示されている
- **When**: バーをマウスダウンして 6px 以上動かす
- **Then**: DnD が発動し、ゴーストバーが表示される

### AC4.13 ESC キャンセル

- **Given**: 時間予定をドラッグ中（ゴーストバーが表示されている）
- **When**: ESC キーを押す
- **Then**: ゴーストバーが除去され、元のバーが元の位置・元の opacity に戻る
- **And**: API は呼び出されない
- **And**: その後のマウスアップで DnD が再発動しない

### AC4.14 楽観的 UI 更新

- **Given**: 13:00〜14:00 の時間予定が表示されている
- **When**: 15:00〜16:00 へドラッグして放す
- **Then**: API レスポンスを待たずに即座にバーが 15:00〜16:00 に描画更新される
- **And**: API 成功後は再描画しない（ちらつきがない）

### AC4.15 楽観ロック（`$revision` 送信）

- **Given**: 任意の予定をドラッグ移動して放す
- **When**: `KC.Api.updateEvent` が呼ばれる
- **Then**: PUT リクエストのペイロードに `revision: ev.rev` が含まれる

### AC4.16 API 失敗時の楽観ロールバック

- **Given**: 他のユーザーが同時に同じ予定を更新しており `$revision` 競合が発生する状況
- **When**: ドラッグ移動して放す
- **Then**: API が 409 エラーを返し、`alert(err.message)` が表示される
- **And**: `KC.Render.refresh()` が呼ばれ、サーバー側の最新状態でカレンダーが再描画される

### AC4.17 時間予定の日跨ぎ表示（復活）

- **Given**: 月曜 22:00〜火曜 02:00 の時間予定が登録済み
- **When**: 当週を表示する
- **Then**: 月曜の 22:00〜24:00 にバーセグメント 1 が表示される
- **And**: 火曜の 00:00〜02:00 にバーセグメント 2 が表示される
- **And**: 2 つのセグメントは同じ予定タイトルを持つ

### AC4.18 バグ A 修正（`.kc-cell` に `data-date` 付与）

- **Given**: 週ビューが描画された後
- **When**: DevTools で `.kc-cell` 要素を確認する
- **Then**: すべての `.kc-cell` 要素に `data-date="YYYY-MM-DD"` 属性が設定されている

### AC4.19 バグ B 修正（終日バーへの mousedown 配線）

- **Given**: 終日予定バー（`.kc-ad-event`）が表示されている
- **When**: バーをドラッグする
- **Then**: 終日 DnD が起動し、ゴーストバーが追従する

### AC4.20 バグ C 修正（ゴーストクラス名統一）

- **Given**: 時間予定または終日予定をドラッグ中
- **When**: DevTools でゴーストバーを確認する
- **Then**: 要素のクラスリストに `kc-event--ghost` が含まれており、CSS の `.kc-event--ghost` スタイルが適用されている（旧 `.kc-event.ghost` / `.kc-ghost` は使用されない）

### AC4.21 バグ D 修正（リサイズハンドル DOM 生成）

- **Given**: 時間予定バーが表示されている
- **When**: バー上端 / 下端にカーソルを近づける
- **Then**: カーソルが `ns-resize` に変わり、ハンドル要素（`.kc-resize-handle--top` / `.kc-resize-handle--bottom`）が DOM に存在する

### AC4.23 リサイズハンドルのホバー時出現（時間予定）

- **Given**: 時間予定バーが表示されている（カーソルはバーの外）
- **When**: カーソルがバー外にある状態
- **Then**: ハンドル要素（`.kc-resize-handle--top` / `.kc-resize-handle--bottom`）は `opacity: 0` で不可視
- **When**: カーソルをバー上にホバーする
- **Then**: ハンドル要素が `opacity: 1` になり可視化される（`transition` を伴う）

### AC4.24 リサイズハンドルのホバー時出現（終日予定）

- **Given**: 終日予定バーが表示されている（カーソルはバーの外）
- **When**: カーソルがバー外にある状態
- **Then**: ハンドル要素（`.kc-resize-handle--left` / `.kc-resize-handle--right`）は `opacity: 0` で不可視
- **When**: カーソルをバー上にホバーする
- **Then**: ハンドル要素が `opacity: 1` になり可視化される

### AC4.25 日跨ぎセグメントの角丸（当日下端・翌日上端）

- **Given**: 月曜 22:00〜火曜 02:00 の時間予定が登録済み
- **When**: 当週を表示する
- **Then**: 月曜のセグメント（`.kc-event--span-start`）の下端（`border-bottom-*-radius`）が直角寄り（1px）になっている
- **And**: 火曜のセグメント（`.kc-event--span-end`）の上端（`border-top-*-radius`）が直角寄り（1px）になっている
- **And**: 日跨ぎなし予定のバーはデフォルト `border-radius: 4px` のまま変化がない

### AC4.26 ドラッグ中の元バー薄表示

- **Given**: 時間予定バーが表示されている
- **When**: バーをドラッグ開始し 5px 閾値を超える
- **Then**: 元バーに `.kc-event--dragging` クラスが付与され、`opacity: 0.4` で薄く表示される
- **When**: ドラッグを放す（mouseup）または ESC キャンセルする
- **Then**: `.kc-event--dragging` クラスが除去され、元の opacity に戻る

### AC4.22 src / docs 同期

- **Given**: `src/kc-calendar.js` および `src/kc-calendar.css` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` および `docs/kc-calendar.css` が同一内容に同期されている（`CLAUDE.md` ルール準拠）

---

## 5. データモデル / 状態

### 5.1 KcEvent（変更なし）

`KcEvent` オブジェクト（`DESIGN.md §6`）に追加フィールドは**不要**。`rev` は既存フィールドであり、楽観ロックに利用する。

| フィールド | 型 | 説明 | DnD での利用 |
|---|---|---|---|
| `id` | string | kintone レコード ID | API 更新時の識別子 |
| `rev` | string | リビジョン番号 | `revision` パラメータとして送信 |
| `start` | string | 開始日時（ISO 8601） | 移動・リサイズで更新 |
| `end` | string | 終了日時（ISO 8601） | 移動・リサイズで更新 |
| `allday` | boolean | 終日フラグ | 移動モードの切り替え（終日 vs 時間予定） |
| `title` | string | 予定タイトル | ゴーストバーのラベル表示 |

### 5.2 `KC.DnD._drag`（内部ローカル状態）

DnD 中の状態は `KC.DnD._drag` オブジェクトとして保持する（`KC.State` には追加しない）。

```javascript
KC.DnD._drag = {
  type:        'move' | 'resize-top' | 'resize-bottom' | 'resize-left' | 'resize-right',
  ev:          KcEvent,          // ドラッグ対象イベント
  ghost:       HTMLElement,      // ゴースト要素（単一 div）
  startX:      number,           // mousedown 時の clientX（閾値判定用）
  startY:      number,           // mousedown 時の clientY（閾値判定用）
  started:     boolean,          // 5px 閾値超えで true（DnD 発動済み）
  deltaDay:    number,           // 日数差分（終日・時間予定移動用）
  newStart:    string | null,    // 確定後の新 start（mouseup 時 API 送信用）
  newEnd:      string | null,    // 確定後の新 end（mouseup 時 API 送信用）
};
```

### 5.3 `KC.Api.updateEvent` のペイロード変更

既存の実装（`kc-calendar.js:452–490`）に `revision` フィールドを追加する。

```javascript
// 変更前
await kintone.api(url, 'PUT', {
  app: KC.Config.getAppId(),
  id: ev.id,
  record: record
});

// 変更後
await kintone.api(url, 'PUT', {
  app: KC.Config.getAppId(),
  id: ev.id,
  revision: ev.rev,   // NEW: 楽観ロック用リビジョン
  record: record
});
```

---

## 6. 既存コードからの差分

### 6.1 削除する CSS

| セレクタ | 所在 | 削除理由 |
|---|---|---|
| `.kc-event.ghost` | `kc-calendar.css:553–556` | バグ C: クラス名不整合。`.kc-event--ghost` に統一 |

### 6.2 変更する CSS

| 対象 | 変更内容 |
|---|---|
| `.kc-event` | バー本体に `cursor: grab` を追加 |

### 6.3 追加する CSS

```css
/* ゴーストバー（時間予定・終日予定共通）*/
.kc-event--ghost {
  opacity: 0.85;
  pointer-events: none;
  border: 2px dashed var(--kc-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 9999;
}

/* ゴーストバー内の時刻ラベル（確定: 全角チルダ "HH:MM〜HH:MM"、タイトル下に小さく表示） */
.kc-evt-ghost-time {
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
  opacity: 0.9;
}

/* 時間予定リサイズハンドル（確定: ホバー時のみ出現・デフォルト opacity: 0） */
.kc-resize-handle--top,
.kc-resize-handle--bottom {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--kc-dnd-handle-h, 8px);   /* 確定: 8px */
  cursor: ns-resize;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.15s;
}
.kc-resize-handle--top    { top: 0; }
.kc-resize-handle--bottom { bottom: 0; }

/* 時間予定バーホバー時にリサイズハンドルを表示 */
.kc-event:hover .kc-resize-handle--top,
.kc-event:hover .kc-resize-handle--bottom {
  opacity: 1;
}

/* 終日予定リサイズハンドル（確定: ホバー時のみ出現・デフォルト opacity: 0） */
.kc-resize-handle--left,
.kc-resize-handle--right {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;   /* 確定: 終日予定ハンドル幅 6px */
  cursor: ew-resize;
  opacity: 0;
  transition: opacity 0.15s;
}
.kc-resize-handle--left  { left: 0; }
.kc-resize-handle--right { right: 0; }

/* 終日予定バーホバー時にリサイズハンドルを表示 */
.kc-ad-event:hover .kc-resize-handle--left,
.kc-ad-event:hover .kc-resize-handle--right {
  opacity: 1;
}

/* ドラッグ中の元バー（薄表示: 確定 opacity: 0.4 — Google カレンダー標準） */
.kc-event--dragging {
  opacity: 0.4;
}

/* ドラッグ中の cursor 変更 */
body.kc-dnd-active,
body.kc-dnd-active * {
  cursor: grabbing !important;
  user-select: none;
}

/* 時間予定バーの grab カーソル */
.kc-event {
  cursor: grab;
}

/* 日跨ぎ時間予定の角丸調整（確定: 当日下端・翌日上端を直角寄り 1px で連続感を演出） */
.kc-event--span-start {
  border-bottom-left-radius: 1px;
  border-bottom-right-radius: 1px;
}

.kc-event--span-end {
  border-top-left-radius: 1px;
  border-top-right-radius: 1px;
}

.kc-event--span-middle {
  border-radius: 1px;
}
```

### 6.4 削除する JS

| 箇所 | 所在 | 削除理由 |
|---|---|---|
| `KC.DnD.startMove` の `cloneNode` ベースのゴースト生成 | `kc-calendar.js:572–607` | 単一バー方式に全面置換 |
| `KC.DnD.startMove` の `mouseover` による日付追跡 | `kc-calendar.js:589–608` | `mousemove` + 座標計算方式に変更 |
| `KC.DnD.startResize` の `cloneNode` ベースのゴースト生成 | `kc-calendar.js:658–680` | 同上 |
| `KC.DnD.startResize` の `mouseover` による日付追跡 | `kc-calendar.js:650–681` | 同上 |
| `placeEvents` 内の `div.addEventListener('mousedown', KC.DnD.startMove)` 直接呼び出し | `kc-calendar.js:1269–1272` | 5px 閾値付きのラッパーに変更 |

### 6.5 追加・変更する JS

#### `renderRows` への `data-date` 付与（バグ A 修正）

`kc-calendar.js:1083–1097` の `.kc-cell` 生成部分に `data-date` を追加する。

```javascript
// 追加: weekRange の range を renderRows スコープで利用するため先頭で取得
var range = weekRange(S.current);

for (var h = 0; h < 24; h++) {
  for (var c = 0; c < 7; c++) {
    var cell = document.createElement('div');
    cell.className = 'kc-cell';
    var cellDate = U.addDays(range.start, c);
    cell.dataset.date = U.fmtYMD(cellDate);  // NEW: data-date 付与（バグ A 修正）
    // ... 既存の className 付与 ...
    row.appendChild(cell);
  }
}
```

#### `buildAlldayBar` への `mousedown` 配線（バグ B 修正）

`kc-calendar.js:975–1022` の `buildAlldayBar` 関数内にハンドラを追加する。

```javascript
// クリックハンドラの後に追加
el.addEventListener('mousedown', function (mdEvt) {
  if (mdEvt.button !== 0) return;
  mdEvt.stopPropagation();
  KC.DnD.startMoveAllday(ev, mdEvt);  // NEW（バグ B 修正）
});

// 左右リサイズハンドル DOM を append（バグ D の終日版相当）
var leftHandle  = document.createElement('div');
leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
leftHandle.addEventListener('mousedown', function (mdEvt) {
  mdEvt.stopPropagation();
  KC.DnD.startResizeAllday(ev, 'left', mdEvt);
});

var rightHandle = document.createElement('div');
rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
rightHandle.addEventListener('mousedown', function (mdEvt) {
  mdEvt.stopPropagation();
  KC.DnD.startResizeAllday(ev, 'right', mdEvt);
});

el.appendChild(leftHandle);
el.appendChild(rightHandle);
```

#### `placeEvents` の時間予定ブロック変更（日跨ぎ表示復活 + スパンクラス付与）

`kc-calendar.js:1188–1275` の時間予定配置ロジックを per-day 分割描画に書き換える。バーへのリサイズハンドル追加（バグ D 修正）も同時に行う。

日跨ぎセグメント生成時は以下の条件でクラスを付与すること:

```
セグメント種別判定（per-day ループ内）:
  isFirst = (dayIndex === 最初にヒットした日のインデックス) かつ ev.start が前日以前
  isLast  = (dayIndex === 最後にヒットした日のインデックス) かつ ev.end が翌日以降
  isMultiDay = 2 日以上にわたるセグメント

  if (isMultiDay && isFirst)  → el.classList.add('kc-event--span-start')
  if (isMultiDay && isLast)   → el.classList.add('kc-event--span-end')
  if (isMultiDay && !isFirst && !isLast) → el.classList.add('kc-event--span-middle')
```

リサイズハンドル（`.kc-resize-handle--top` / `.kc-resize-handle--bottom`）も各セグメントに追加する。ただし日跨ぎの中間セグメント（`span-middle`）へのハンドル追加は不要（将来考慮）。

#### `KC.DnD` の全面書き換え

既存の `startMove` / `startResize` を削除し、以下の新関数群を定義する。

| 新関数名 | 責務 |
|---|---|
| `KC.DnD._startDrag(ev, mousedown, type)` | 共通の DnD 開始処理（閾値判定ループ登録）|
| `KC.DnD.startMove(ev, mousedown)` | 時間予定移動: `_startDrag` を `type='move'` で呼ぶ |
| `KC.DnD.startResize(ev, side, mousedown)` | 時間予定リサイズ: `_startDrag` を `type='resize-top'|'resize-bottom'` で呼ぶ |
| `KC.DnD.startMoveAllday(ev, mousedown)` | 終日予定移動 |
| `KC.DnD.startResizeAllday(ev, side, mousedown)` | 終日予定リサイズ |
| `KC.DnD._onMouseMove(e)` | mousemove ハンドラ（5px 閾値判定 + ゴースト追従） |
| `KC.DnD._onMouseUp(e)` | mouseup ハンドラ（確定 or 0 delta 判定 + API 送信） |
| `KC.DnD._onKeyDown(e)` | keydown ハンドラ（ESC キャンセル） |
| `KC.DnD._cancel()` | 共通キャンセル処理 |
| `KC.DnD._snapMin(rawMin, snap)` | 分単位の 15 分スナップ計算 |
| `KC.DnD._commitOptimistic(newEv)` | 楽観的 UI 更新（State 更新 + renderGrid + API 送信） |

#### `KC.Api.updateEvent` への `revision` 追加

`kc-calendar.js:484` の PUT リクエストに `revision: ev.rev` を追加する（§5.3 参照）。

---

## 7. CSS 変数 / レイアウト

### 7.1 新規 CSS 変数

| 変数名 | 確定値 | 説明 |
|---|---|---|
| `--kc-dnd-handle-h` | `8px` | 時間予定リサイズハンドルの高さ（上端・下端） |

> **補足**: 終日予定リサイズハンドルの幅は CSS 変数化せず、`6px` を直値で指定する（§6.3 参照）。統一が必要になった場合は `--kc-dnd-handle-w: 6px` として追加すること。

### 7.2 JS 定数（CSS 変数ではなく JS 内定数で管理）

| 定数名 | 値 | 説明 |
|---|---|---|
| `DND_THRESHOLD` | `5` | ドラッグ発動閾値（px） |
| `DND_SNAP_MIN` | `15` | 時間予定の分スナップ粒度（分） |
| `DND_MIN_DURATION` | `15` | リサイズ時の最小持続時間（分） |

### 7.3 カーソル仕様

| 状態 | カーソル | 適用箇所 |
|---|---|---|
| バー本体（通常） | `grab` | `.kc-event`、`.kc-ad-event` |
| ドラッグ中 | `grabbing` | `body.kc-dnd-active *` |
| 上下端ハンドル | `ns-resize` | `.kc-resize-handle--top`、`.kc-resize-handle--bottom` |
| 左右端ハンドル | `ew-resize` | `.kc-resize-handle--left`、`.kc-resize-handle--right` |

---

## 8. エッジケース / 検証ケース

| ケース | 期待動作 | 備考 |
|---|---|---|
| 30 分未満リサイズ（下端を start 以下に移動） | `end = start + 15分` にクランプ。最小 15 分 | AC4.6 |
| 24:00 跨ぎ（時間予定を 23:00〜翌 02:00 にドラッグ） | データ保存可、翌日セグメントも描画 | Google 準拠。AC4.17 |
| 0:00 上回り（上端を 00:00 以前に移動） | `start = 00:00`（その日の 0 時）にクランプ | 00:00 未満は不可 |
| 週またぎドラッグ（グリッド外へのドラッグ） | グリッド外に出た時点で最終セルを基準にクランプして確定 | week を超えた移動は週切替操作で対応 |
| ドラッグ中にウィンドウ blur（フォーカス喪失） | `window.addEventListener('blur', KC.DnD._cancel)` でキャンセル | mouseleave ではなく blur で検知 |
| `$revision` 競合（409 エラー） | alert 表示 + `KC.Render.refresh()` でロールバック | AC4.16 |
| ESC キャンセル後の mouseup | DnD が再発動しない（`_drag === null` を確認） | AC4.13 |
| 純クリック判定（5px 未満の mousedown → mouseup） | `KC.Popup.openEdit` が呼ばれる（DnD 不発動） | AC4.11 |
| 全画面モード時のスクロールオフセット | `position: fixed` のゴーストは `clientX/Y` を直接使用するためオフセット不要 | スクロール補正なしで正常動作 |
| スクロール中のドラッグ（`kc-body` が縦スクロール） | `getBoundingClientRect()` で毎 mousemove 取得するため常に正確な座標を得る | リアルタイム計算のため問題なし |
| イベントが 0 件（ゴーストのみ） | 異常なし。DnD が発動するイベント自体が存在しないため触れない | |
| 同一予定の同時編集（楽観ロック競合） | API 409 → alert + refresh でサーバー値へロールバック | AC4.16 |
| リサイズハンドルが狭いバー（高さ < 16px）で重なる | ハンドルは `z-index: 1` を持ち、タイトル文字より前面。高さ 8px のため 16px 未満でも表示 | 最小高 16px 未満のバーは両ハンドルが重なる（仕様として許容） |
| ドラッグ中にポップアップが開く | `stopPropagation` + `_started === false` の場合のみ click を通すため、DnD 中のクリックは無視される | |
| 終日と時間予定が同じ日に重なる | 各々の DnD は独立して動作する。干渉なし | |

---

## 9. 次タスクへの引き継ぎ

### 9.1 builder への指示

- **ブランチ**: `feature/event-drag-resize` で作業すること（`isolation: "worktree"` 推奨）
- **編集対象**: `src/kc-calendar.js` と `src/kc-calendar.css` を同時に変更すること
- **sync**: `src/` 変更後、必ず `docs/` にも同内容を同期すること（`CLAUDE.md` ルール）
- **ルール準拠**: `coding-rules.md`・`kintone-rules.md`・`DESIGN.md §9` を遵守すること
- **バグ A〜E は全て修正する**: 本要件の実装と同時に既存バグ A〜E を必ず解消すること（§1.1 参照）
- **参照**: 本要件定義書 §3〜§7 を実装仕様として使用すること。特に優先的に実装する内容:
  - §3.1（全体アーキテクチャ: mousedown → 閾値判定 → ghost 生成 → mousemove → mouseup → API）
  - §3.9（5px 閾値判定）
  - §3.6（ゴースト UI の構造と `.kc-event--ghost` への統一）
  - §3.10（楽観的 UI 更新と `revision` 送信）
  - §3.11（`renderRows` への `data-date` 付与 + 日跨ぎ表示復活 + スパンクラス付与）
  - §3.7（ゴースト時刻ラベルのフォーマット確定: `HH:MM〜HH:MM` 全角チルダ）
  - §6.3（CSS 確定: `.kc-event--dragging { opacity: 0.4 }`、ハンドルホバー表示、スパンクラス角丸）
  - §6.5（`buildAlldayBar` への `mousedown` 配線、リサイズハンドル DOM 生成）
- **XSS 対策**: ゴーストバーの時刻ラベル・タイトルは `textContent` を使用し、`innerHTML` にユーザー入力を直接代入しないこと（`DESIGN.md §9.3`）
- **関数分離**: `KC.DnD` 内に `_startDrag`・`_onMouseMove`・`_onMouseUp`・`_onKeyDown`・`_cancel` 等の責務を分離した内部関数を定義すること（`coding-rules.md` の「1 関数 1 責務」ルール準拠）
- **`KC.DnD.beginSelection`**: `DESIGN.md:206` に記載があるが実装なし。本タスクでは実装せず、スタブまたはコメントとして残すこと
- **スロットクリックのスナップ**: 既存の 30 分スナップは変更しないこと（DnD のみ 15 分スナップ）

### 9.2 reviewer への指示

§4「受け入れ条件」の各項目（AC4.1〜AC4.22）を 1 つずつ順に確認すること。

特に以下に重点を置く:

1. **AC4.1〜4.3（時間予定移動・15 分スナップ）**: 12:07 → 12:00、12:08 → 12:15 のスナップを実測確認
2. **AC4.11〜4.12（5px 閾値）**: 微小移動でポップアップが開き、大きな移動で DnD が発動することを確認
3. **AC4.13（ESC キャンセル）**: ESC 後のマウスアップで API が呼ばれないことをネットワークタブで確認
4. **AC4.14〜4.16（楽観更新・ロック）**: ちらつきの有無、409 時のロールバックを確認
5. **AC4.17（日跨ぎ表示）**: 23:00〜翌 01:00 の予定が 2 日に分割描画されることを確認
6. **AC4.18（バグ A 修正）**: DevTools で `.kc-cell[data-date]` が全セルに存在することを確認
7. **AC4.20（バグ C 修正）**: `.kc-ghost` / `.kc-event.ghost` が DOM に出現しないことを確認
8. **AC4.22（sync）**: `src/` と `docs/` の差分が 0 であることを `diff` コマンドで確認
9. **既存ポップアップ・色適用・他レイアウトの破壊がないこと**: クリック → `KC.Popup.openEdit` が引き続き動作することを確認
10. **AC4.23〜4.24（ハンドルホバー可視性）**: バー外ではハンドルが見えず、ホバーで出現することを確認
11. **AC4.25（日跨ぎ角丸）**: 日跨ぎセグメントに `.kc-event--span-start` / `.kc-event--span-end` が付与され、下端・上端が直角寄りになっていることを DevTools で確認
12. **AC4.26（元バー薄表示）**: ドラッグ中に元バーが `opacity: 0.4` になり、終了後に元に戻ることを確認

---

## 10. 未確定事項 / リスク・前提

### 解決済み事項（2026-05-01 ユーザー回答により確定）

| # | 項目 | 確定内容 | 反映箇所 |
|---|---|---|---|
| 10.1 | ゴースト時刻ラベルのフォーマット | **A 案確定**: `HH:MM〜HH:MM`（全角チルダ・スペースなし）| §3.7、§3.6.1、§6.3、AC4.10 |
| 10.2 | 日跨ぎセグメントの視覚的連結スタイル | **当日下端・翌日上端を直角寄り**（`border-radius: 1px`）。クラス: `.kc-event--span-start` / `.kc-event--span-end` / `.kc-event--span-middle` | §3.11.2、§6.3、§6.5、AC4.25 |
| 10.3 | ドラッグ中の元バー opacity 値 | **B 案確定**: `0.4`（Google カレンダー標準）。クラス: `.kc-event--dragging` | §3.2.1、§6.3、AC4.26 |
| 10.4 | リサイズハンドルの可視性 | **B 案確定**: ホバー時のみ出現（`opacity: 0` → `:hover` で `1`）。ハンドル領域サイズ: 時間予定 上下 8px・終日予定 左右 6px | §3.3.1、§3.5、§6.3、AC4.23〜4.24 |

### 10.5 リサイズハンドルの ARIA 属性（未確定 — 保留）

- A11y 最低限対応として `role="separator"` + `aria-label="開始時刻を変更"` / `"終了時刻を変更"` を付与するかどうか
- **初版では ARIA 属性なしで実装し、A11y 対応は別タスクとする**
- **注記（2026-05-01 ユーザー指示）**: 後ほど定義（マウス専用フェーズ完了後に検討）。本要件定義書の次回更新時に反映する

---

*未確定事項 1 件（§10.5）はマウス専用フェーズ完了後に別タスクとして対応する。確定次第、本要件定義書を更新すること。*
