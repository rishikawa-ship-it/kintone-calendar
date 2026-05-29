# REQ_month-overflow-popup: 月ビュー +N more ポップオーバー

**文書番号**: REQ_month-overflow-popup
**作成日**: 2026-05-28
**最終更新日**: 2026-05-29（第 2 版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js`, `plugin/src/css/desktop.css`
**対象ファイル（従／同期対象）**: `src/kc-calendar.js`, `src/kc-calendar.css`
**ステータス**: 確定版 第 2 版

### 更新履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-28 | 確定版 第 1 版 | grill-me セッション結果を反映。初版作成 |
| 2026-05-29 | 確定版 第 2 版 | 実機検証で拡張機能による click ハンドラ消失を確認。イベント委譲方式（D 案）に変更（§1・§5.1・§5.2・§6・§8 更新） |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [スコープ](#2-スコープ)
3. [動作仕様](#3-動作仕様)
4. [DOM / CSS 設計](#4-dom--css-設計)
5. [関数・モジュール設計](#5-関数モジュール設計)
6. [エッジケース](#6-エッジケース)
7. [受入基準](#7-受入基準)
8. [検証項目・テストシナリオ](#8-検証項目テストシナリオ)
9. [想定 UX / シーケンス](#9-想定-ux--シーケンス)
10. [未確定事項・リスク・前提](#10-未確定事項リスク前提)
11. [関連資料](#11-関連資料)

---

## 1. 背景・目的

### 1.1 Phase 1 の未実装状態

月ビュー実装（`REQ_month-view.md`）の Phase 1 では、予定件数が表示上限を超えた日セルに `+N more` ラベルが描画されるが、クリックしても何も起きない状態（クリックハンドラ未接続）で完了した。

実装コメント `src/kc-calendar.js:4101` に「Phase 1: クリック挙動なし（Phase 2 でポップオーバー接続）」と明示されており、本要件が Phase 1 の宿題を消化する。

CSS の `.kc-month-more` に `cursor: default` が設定されていること（`src/kc-calendar.css:951`）も、Phase 1 でのクリック不可意図を裏付けている。

### 1.2 採用 UI: Google カレンダー方式のフローティングポップオーバー

ユーザーが Google カレンダーを日常的に使用しているため、`+N more` クリックで非表示予定をフローティングポップオーバーで一覧表示する Google カレンダー踏襲の UI を採用する。

ポップオーバーはセルに重なる形で表示し、viewport 端に達した場合は反転・クランプ・中央フォールバックの順で対応する。

### 1.3 v2 改訂（2026-05-29）

初版実装後の実機検証で、AssetView 等のブラウザ拡張機能による DOM mutation で `.kc-month-more` への click ハンドラが失われる事象が判明。対策として、要素直接登録方式（初版）→ document への capture phase イベント委譲方式に変更。シークレットモードでは動作する事実から拡張機能由来と切り分け済み。

### 1.4 HANDOVER.md の未着手項目消化

`HANDOVER.md §4` 未着手欄に「`+N more` 展開（Phase 11 候補: REQ_month-overflow-popup.md 起票推奨）」として記載されている。本要件定義書の起票でその計画が具体化される。また `REQ_overlap-rendering.md §1.3 / §6.3` においても、月ビュー `+N more` 展開は Phase 2 として別タスクで対応すると明記済みである。

---

## 2. スコープ

### 2.1 対象

- 月ビューの `+N more` ラベルへのクリックハンドラ接続
- フローティングポップオーバー UI の新規実装（DOM 生成・位置計算・表示制御）
- ポップオーバー内の予定一覧（終日バー・時間予定リスト行）
- 日付ヘッダのクリック → 日ビュー遷移
- 予定クリック → 既存 iframe モーダル起動 + ポップオーバー即閉じ
- 関連 CSS / フェードインアニメーション
- ARIA 最低限対応（`role="dialog"` / `aria-modal="false"` / `aria-labelledby`）
- ESC キーでのクローズ対応
- `src/` と `plugin/src/` の双方への同期実装

### 2.2 スコープ外

- モバイル / タッチ対応（別フェーズ）
- フル A11y 対応（フォーカストラップ・矢印キー移動・スクリーンリーダー読み上げ試験）
- 時間予定の日跨ぎ表現（Phase 2 実機未検証スコープ、`MEMORY.md: project_kintone_calendar_phase2_unverified`）
- ポップオーバー内からの新規予定作成ボタン（Google カレンダーにならい省略）
- ポップオーバー内での予定の削除・編集（クリックで iframe モーダルに委ねる）

---

## 3. 動作仕様

### 3.1 ポップオーバー位置決め

| 属性 | 仕様 |
|---|---|
| アンカー要素 | クリックされた `.kc-month-more` 要素 |
| デフォルト表示位置 | アンカー要素の直下（日セルに重なる方向）|
| 固定サイズ（幅） | 280〜320px（実装時に視認性で選択。§10.1 参照）|
| 固定サイズ（高さ） | `max-height: 400px`。超過時はポップオーバー内部をスクロール |
| viewport はみ出し検出 | ポップオーバーの `getBoundingClientRect()` で右端・下端が viewport を超えるか判定 |
| はみ出し対処: flip | 右端超過 → 左方向に反転。下端超過 → 上方向に反転 |
| はみ出し対処: clamp | flip 後もはみ出す場合、`top` / `left` を viewport 内に収まるようにクランプ |
| 中央フォールバック | flip + clamp を適用してもなお配置困難（セル高が極端に小さい等）な場合、`position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)` で画面中央に表示 |
| リサイズ時 | `window` の `resize` イベントで `_calcPosition()` を再実行。失敗時は中央フォールバック |

### 3.2 ポップオーバーコンテンツ

#### 3.2.1 表示形式

| 要素 | 表示形式 |
|---|---|
| 日付ヘッダ | 「水, 5月28日」形式（クリック可能、日ビュー遷移。§3.3 参照）|
| 終日予定 | 色付きバー（左辺に予定色、白背景・または予定色背景。`+N more` の元セルに表示されていたバーと同様のスタイル）|
| 時間予定 | 「● HH:MM タイトル」形式の 1 行リスト（● は予定色の塗りつぶし円ドット）|
| 並び順 | 終日予定グループ → 時間予定グループ（時間の昇順）|
| 件数表示 | なし |

#### 3.2.2 ASCII 表示イメージ

```
+----------------------------------+
| 水, 5月28日          [×]         |
+----------------------------------+
| [■■■ 会議室 A 予約 ■■■■■■■]  ← 終日バー |
| [■■■ 開発合宿 ■■■■■■■■■■■]  ← 終日バー |
| ● 09:00 朝会                     |
| ● 13:00 週次レビュー             |
| ● 15:30 1on1                     |
+----------------------------------+
  ↑ max-height: 400px 超過でスクロール
```

#### 3.2.3 複数日 span 終日予定の表示

| 属性 | 仕様 |
|---|---|
| バー形状 | 通常バー（両端丸、span の連結形状は使わない）|
| 期間ラベル | 開始日と終了日が異なる場合、タイトル下に小さく「5/26 – 5/30」形式で表示 |
| 単日終日予定 | 開始日 = 終了日の場合は期間ラベルを省略（§10.3 参照）|
| 開始/終了マーカー | なし |

### 3.3 クリック挙動

| 操作対象 | 挙動 |
|---|---|
| 予定（終日バー / 時間予定行） | `KC.Popup.openEdit(ev.id)` を呼び出してレコード編集 iframe モーダルを開く。ポップオーバーを即閉じる |
| 日付ヘッダ | `KC.State.current = <該当日の Date>; KC.State.view = 'day'; KC.Render.refresh()` を呼び出して日ビューに遷移する。ポップオーバーを閉じる |
| `×` ボタン | ポップオーバーを閉じる |

### 3.4 クローズ挙動

| トリガー | 挙動 |
|---|---|
| ESC キー | ポップオーバーを閉じる |
| ポップオーバー外側クリック（backdrop / 背景）| ポップオーバーを閉じる |
| `×` ボタンクリック | ポップオーバーを閉じる |
| 予定クリック | ポップオーバーを即閉じた後、iframe モーダルを開く |
| 日付ヘッダクリック | ポップオーバーを閉じ、日ビューに遷移する |
| 別日の `+N more` クリック | 既存ポップオーバーを閉じてから新しい日のポップオーバーを開く（切替）|
| 同日の `+N more` 再クリック | ポップオーバーが開いていれば閉じる（トグル）|
| 月送り（prev / next）| ポップオーバーを閉じる |
| ビュー切替（週・日へ）| ポップオーバーを閉じる |
| レコード変更通知による月ビュー再描画 | ポップオーバーを閉じる（`placeMonthEvents` 呼び出し前に `KC.MonthOverflowPopup.close()` を呼ぶ）|
| `window` リサイズ | 位置を再計算（`_calcPosition` 再実行）。失敗時は中央フォールバック。閉じない |

### 3.5 閾値計算（既存流用）

ポップオーバーに表示する予定一覧は、当該セルに `+N more` が表示された時点の「非表示予定」全件を対象とする。具体的には `placeMonthEvents()` が `applyOverflow(cellEl, remaining)` を呼び出す際の引数 `remaining` 件分の予定を、ポップオーバー生成時に渡す。

閾値計算ロジック（`_calcMaxItems()`）は変更しない。既存の動的計算方式（セル高さ・日付ヘッダ高・moreH・itemH から算出、最低 1・最大 10）を流用する（`src/kc-calendar.js:3789-3801`）。

**補足（v2026-05-28 追記）**: `+N more` の `N` は時間予定の非表示件数のみを対象とする。具体的には `hiddenCount = dayTimedEvents.length - chipsAdded` で算出し、`N` とポップオーバーに表示される件数が完全一致する。終日バー / 日跨ぎバーの超過は本要件のスコープ外（別フェーズで `placeMonthAlldayEvents` の件数制限と合わせて検討）。

---

## 4. DOM / CSS 設計

### 4.1 DOM 構造

ポップオーバーは `document.body` に直接 `appendChild` し、`position: fixed` で配置する。月ビューの DOM ツリー外に置くことで z-index 管理を単純化する。

```html
<div class="kc-month-overflow-popup" role="dialog" aria-modal="false" aria-labelledby="kc-mop-header-label">
  <div class="kc-month-overflow-header">
    <span class="kc-month-overflow-header-label" id="kc-mop-header-label">水, 5月28日</span>
    <button class="kc-month-overflow-close" aria-label="閉じる">×</button>
  </div>
  <div class="kc-month-overflow-list">
    <!-- 終日バー -->
    <div class="kc-month-overflow-item kc-month-overflow-item--allday">
      <div class="kc-month-overflow-bar" style="background-color: #4285f4;">会議室 A 予約</div>
      <!-- span 終日予定の場合のみ -->
      <div class="kc-month-overflow-span-label">5/26 – 5/30</div>
    </div>
    <!-- 時間予定 -->
    <div class="kc-month-overflow-item kc-month-overflow-item--timed">
      <span class="kc-month-overflow-dot" style="background-color: #0f9d58;"></span>
      <span class="kc-month-overflow-time">09:00</span>
      <span class="kc-month-overflow-title">朝会</span>
    </div>
  </div>
</div>
```

- ポップオーバーが開いていない間は DOM に存在しない（`open()` 時に生成、`close()` 時に削除）
- `id="kc-mop-header-label"` は `aria-labelledby` の参照先として使用する

### 4.2 CSS クラス命名（kebab-case、既存命名規則準拠）

| クラス名 | 役割 |
|---|---|
| `.kc-month-overflow-popup` | ポップオーバールート。`position: fixed`、白背景、角丸、シャドウ |
| `.kc-month-overflow-header` | 日付ヘッダ行（ラベル + × ボタンの flex 行）|
| `.kc-month-overflow-header-label` | 日付テキスト（クリッカブル、日ビュー遷移）|
| `.kc-month-overflow-close` | × 閉じるボタン |
| `.kc-month-overflow-list` | 予定一覧コンテナ（`overflow-y: auto`、`max-height` 制約）|
| `.kc-month-overflow-item` | 1 予定分の行ラッパー |
| `.kc-month-overflow-item--allday` | 終日予定行の修飾子クラス |
| `.kc-month-overflow-item--timed` | 時間予定行の修飾子クラス |
| `.kc-month-overflow-bar` | 終日予定の色付きバー本体 |
| `.kc-month-overflow-span-label` | 複数日 span 終日予定の期間ラベル（「5/26 – 5/30」）|
| `.kc-month-overflow-dot` | 時間予定の色付き円ドット |
| `.kc-month-overflow-time` | 時間予定の開始時刻（HH:MM）|
| `.kc-month-overflow-title` | 予定タイトル |

### 4.3 z-index

ポップオーバーの `z-index` は **800** とする。

| 要素 | z-index | 根拠 |
|---|---|---|
| `.kc-month-chip` / `.kc-month-more` | 2 | 既存 |
| 新ポップオーバー `.kc-month-overflow-popup` | **800** | 月セル要素より高く、iframe モーダルより低い値 |
| iframe モーダル backdrop | 10000 | 既存 |
| iframe モーダル本体 | 10001 | 既存 |

800 は `kc-time-col` (z-index: 30) / `kc-overlay` (z-index: 20) より高く、iframe モーダル (10000) より低いため競合が生じない。

### 4.4 アニメーション

```css
@keyframes kc-mop-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.kc-month-overflow-popup {
  animation: kc-mop-fadein 150ms ease;
}
```

scale アニメーションは現時点では採用しない（§10.2 参照）。

### 4.5 視覚スタイル（Google カレンダー踏襲）

| プロパティ | 値 |
|---|---|
| 背景 | `#ffffff`（白）|
| `box-shadow` | `0 2px 8px rgba(0,0,0,0.15)` |
| `border-radius` | `8px` |
| `padding`（ポップオーバー全体） | `12px` |
| `padding`（ヘッダ行）| `0 0 8px 0` |
| フォント | `font-size: 13px`（終日バー）、`font-size: 12px`（時間予定）|
| カーソル（予定行）| `pointer` |
| カーソル（日付ヘッダラベル）| `pointer` |

`.kc-month-more` の `cursor: default` は `cursor: pointer` に変更する（ポップオーバー接続に伴い変更が必要）。

---

## 5. 関数・モジュール設計

### 5.1 新規追加: `KC.MonthOverflowPopup` モジュール

既存モジュール（`KC.Popup`、`KC.DnD` 等）と同一階層の名前空間に追加する。

#### 公開 API

| メソッド | シグネチャ | 説明 |
|---|---|---|
| `open` | `open(anchorEl, dateYMD, eventsList)` | ポップオーバーを開く。`anchorEl` は `.kc-month-more` 要素。`dateYMD` は `'YYYY-MM-DD'` 文字列。`eventsList` は当日の非表示予定オブジェクト配列（終日・時間予定混在）|
| `close` | `close()` | ポップオーバーを閉じる（DOM 削除、イベントリスナー解除）|
| `registerHiddenEvents` | `registerHiddenEvents(moreEl, hiddenEvents)` | `.kc-month-more` 要素と非表示予定リストを WeakMap に登録し、document への capture phase 委譲リスナーを初期化する（初回のみ登録）。`moreEl: HTMLElement`、`hiddenEvents: Array<EventObject>`。戻り値: なし |

#### 内部関数（プライベート）

| 関数 | 説明 |
|---|---|
| `_buildDOM(dateYMD, eventsList)` | ポップオーバーの DOM ツリーを生成して返す |
| `_calcPosition(anchorEl)` | アンカー要素の `getBoundingClientRect()` を元に `top` / `left` を計算し、flip + clamp を適用。失敗時は中央フォールバック位置を返す |
| `_bindEvents(popupEl, anchorEl)` | `×` ボタン・背景クリック・ESC・リサイズの各イベントリスナーを設定 |
| `_formatDateHeader(dateYMD)` | `'YYYY-MM-DD'` を「水, 5月28日」形式の文字列に変換 |
| `_formatTime(dateObj)` | Date オブジェクトを「HH:MM」形式に変換 |
| `_formatSpanLabel(startYMD, endYMD)` | 「5/26 – 5/30」形式の期間ラベル文字列を生成（年省略）|

#### 状態変数（モジュールスコープ）

| 変数 | 型 | 説明 |
|---|---|---|
| `_popupEl` | `HTMLElement \| null` | 現在表示中のポップオーバー要素。`null` は非表示状態 |
| `_anchorYMD` | `string \| null` | 現在表示中の日付（`'YYYY-MM-DD'`）。同日トグル判定に使用 |
| `_onResize` | `Function \| null` | リサイズリスナーの参照（`close()` 時に `removeEventListener` で解除）|
| `_onDocClick` | `Function \| null` | 外側クリックリスナーの参照（同上）|
| `_onKeydown` | `Function \| null` | ESC キーリスナーの参照（同上）|

### 5.2 既存コードへの変更

#### `applyOverflow()` へのクリックハンドラ登録（v2: イベント委譲方式 D 案）

対象: `src/kc-calendar.js:4096-4103`（`plugin/src/js/desktop.js` も同様）

初版（b3614be）では `more.addEventListener('click', ...)` による要素直接登録方式を採用していたが、AssetView 等のブラウザ拡張機能による DOM mutation でハンドラが消失する事象が判明（シークレットモードでは動作確認済み）。v2 では document への capture phase イベント委譲方式（D 案）に変更する。

```javascript
// applyOverflow 内
function applyOverflow(cellEl, remaining, hiddenEvents) {
  if (remaining <= 0) return;
  var more = document.createElement('div');
  more.className = 'kc-month-more';
  more.textContent = '+' + remaining + ' more';
  cellEl.appendChild(more);
  KC.MonthOverflowPopup.registerHiddenEvents(more, hiddenEvents || []);
}

// KC.MonthOverflowPopup モジュール内 (D 案: イベント委譲)
var _hiddenEventsMap = new WeakMap();
var _docDelegateBound = false;

function registerHiddenEvents(moreEl, hiddenEvents) {
  _hiddenEventsMap.set(moreEl, hiddenEvents);
  _bindDocDelegateOnce();
}

function _bindDocDelegateOnce() {
  if (_docDelegateBound) return;
  _docDelegateBound = true;
  document.addEventListener('click', _onDocClickDelegate, true); // capture phase
}

function _onDocClickDelegate(e) {
  var moreEl = e.target.closest && e.target.closest('.kc-month-more');
  if (!moreEl) return;
  e.stopPropagation();
  e.preventDefault();
  var cellEl = moreEl.parentElement;
  var ymd = cellEl ? cellEl.dataset.date : null;
  var hiddenEvents = _hiddenEventsMap.get(moreEl) || [];
  if (ymd) open(moreEl, ymd, hiddenEvents);
}
```

> **注意**: `cellEl.dataset.date` は commit 219d720 で付与済みのため流用可能（`HANDOVER.md §4` 参照）。イベント委譲方式により、DOM mutation 後も document 側のリスナーは残存するため拡張機能耐性が確保される。

#### `placeMonthEvents()` でのポップオーバー自動クローズ

`placeMonthEvents()` の冒頭（既存の chip クリア処理の前後）に以下を追加する。

```
// 月ビュー再描画時にポップオーバーを閉じる
if (KC.MonthOverflowPopup) KC.MonthOverflowPopup.close();
```

#### iframe モーダルクローズ時の整合確認

`KC.Popup` の `_close()` 内（`src/kc-calendar.js:1183-1190`）では `KC.Render.refresh()` を呼ぶため、`placeMonthEvents()` が再実行され、上記のクローズ処理が走る。ポップオーバーが既に閉じている状態で `close()` を呼んでも問題が起きないよう、`close()` 実装で冪等性を保証すること（`_popupEl` が `null` のとき何もしない）。

### 5.3 既存ロジック流用

| 既存ロジック | 流用箇所 | 変更要否 |
|---|---|---|
| `_calcMaxItems()` | 閾値計算（表示件数上限）。ポップオーバーに渡す `remaining` 件数の基準 | 変更なし |
| `KC.Popup.openEdit(id)` | ポップオーバー内の予定クリック時に呼び出す | 変更なし |
| `KC.Render.setActiveView('day')` | 日付ヘッダクリック時の日ビュー切替 | 変更なし |
| `KC.State.current` / `KC.State.view` | 日ビュー遷移時の状態設定 | 変更なし |
| `KC.Render.refresh()` | 日ビュー遷移後の再描画 | 変更なし |

---

## 6. エッジケース

| ケース | 対処方針 |
|---|---|
| viewport 右下端のセルで `+N more` クリック | flip（右 → 左、下 → 上）→ clamp で viewport 内に収める。収まらない場合は中央フォールバック |
| セル高さが極端に小さい（ウィンドウ縦幅が非常に小さい）場合 | `_calcPosition()` が中央フォールバックを返す。ポップオーバーは画面中央 `position: fixed` で表示 |
| 月ビュー再描画中（`placeMonthEvents` 実行中）にポップオーバーが開いていた場合 | `placeMonthEvents` 冒頭で `KC.MonthOverflowPopup.close()` を呼び、自動クローズ |
| 複数日 span 終日予定がポップオーバーの日に含まれる場合 | 単体バー（通常バー形状）＋期間ラベル「5/26 – 5/30」を表示。§3.2.3 参照 |
| レコード変更通知でカレンダーが再描画される場合 | 上記「再描画中」と同じパスで自動クローズ |
| 同一日の `+N more` を再クリック | `KC.MonthOverflowPopup._anchorYMD` が同一 YMD であればトグル（閉じる） |
| 別日の `+N more` をクリック | 現在のポップオーバーを `close()` してから新しい日のポップオーバーを `open()` |
| 同日の予定が 0 件になる場合 | `+N more` ラベル自体が `applyOverflow()` で生成されない（`remaining <= 0` チェック）ためポップオーバーは開けない。対処不要 |
| `KC.Popup.openEdit()` 呼び出し後の再描画 | `_close()` → `KC.Render.refresh()` → `placeMonthEvents()` → `KC.MonthOverflowPopup.close()`（冪等） の順で自動クローズ済み |
| リサイズ中に位置計算が失敗する場合 | `_calcPosition()` が例外を起こさないよう `try-catch` で保護し、例外時は中央フォールバック位置を返す |
| ブラウザ拡張機能（AssetView 等）が DOM 監視を行うケース | イベント委譲方式（D 案）により耐性を確保。`.kc-month-more` 要素が再生成・mutation されてもリスナーは document 側に残存するため click 検知は維持される |

---

## 7. 受入基準

Given / When / Then 形式で記述する。

### AC7.1 `+N more` クリックでポップオーバーが表示される

- **Given**: 月ビューで特定の日セルに `+N more` ラベルが表示されている
- **When**: `+N more` ラベルをクリックする
- **Then**: フローティングポップオーバーが当該セル付近に表示される
- **And**: ポップオーバーに日付ヘッダ（「水, 5月28日」形式）が表示される

### AC7.2 終日予定が色付きバーで表示される

- **Given**: ポップオーバーを開いた日に終日予定が含まれている
- **When**: ポップオーバーの一覧を確認する
- **Then**: 終日予定が左辺 / 背景に予定色を持つバー形式で表示される

### AC7.3 時間予定が「● HH:MM タイトル」形式でリスト表示される

- **Given**: ポップオーバーを開いた日に時間予定が含まれている
- **When**: ポップオーバーの一覧を確認する
- **Then**: 時間予定が「● 09:00 朝会」のような予定色ドット + 時刻 + タイトル形式で表示される

### AC7.4 並び順が終日 → 時間順になっている

- **Given**: ポップオーバーを開いた日に終日予定と時間予定が混在している
- **When**: ポップオーバーの一覧を確認する
- **Then**: 終日予定グループが先頭に並び、その後に時間予定が開始時刻の昇順で続く

### AC7.5 日付ヘッダクリックで日ビューに遷移する

- **Given**: ポップオーバーが表示されている
- **When**: ポップオーバー内の日付ヘッダラベルをクリックする
- **Then**: 月ビューから日ビューに遷移し、当該日の日ビューが表示される
- **And**: ポップオーバーが閉じている

### AC7.6 予定クリックで iframe モーダルが開きポップオーバーが閉じる

- **Given**: ポップオーバーが表示されている
- **When**: ポップオーバー内の任意の予定行をクリックする
- **Then**: `KC.Popup.openEdit(ev.id)` が呼ばれ、kintone レコード編集の iframe モーダルが開く
- **And**: ポップオーバーが即座に閉じている

### AC7.7 `×` ボタン / ESC / 外側クリックでポップオーバーが閉じる

- **Given**: ポップオーバーが表示されている
- **When**: `×` ボタンをクリックする / ESC キーを押す / ポップオーバー外側をクリックする
- **Then**: ポップオーバーが閉じている（DOM から削除されている）

### AC7.8 別日の `+N more` クリックで切替が起きる

- **Given**: 日付 A のポップオーバーが表示されている
- **When**: 別の日付 B の `+N more` をクリックする
- **Then**: 日付 A のポップオーバーが閉じ、日付 B のポップオーバーが開く

### AC7.9 同日の `+N more` 再クリックでトグルが起きる

- **Given**: 日付 A のポップオーバーが表示されている
- **When**: 日付 A の `+N more` を再度クリックする
- **Then**: ポップオーバーが閉じる（トグル）

### AC7.10 月送り / ビュー切替でポップオーバーが自動クローズされる

- **Given**: ポップオーバーが表示されている
- **When**: 月送り（prev / next）またはビュー切替（週・日）を操作する
- **Then**: ポップオーバーが閉じる

### AC7.11 viewport 端でもポップオーバーが画面外にはみ出さない

- **Given**: 月ビューの右端または下端のセルに `+N more` がある
- **When**: `+N more` をクリックする
- **Then**: ポップオーバーが viewport 内に収まって表示される（flip / clamp / 中央フォールバックのいずれかが機能する）

### AC7.12 iframe モーダルがポップオーバーより前面に表示される

- **Given**: ポップオーバーが表示されている状態で予定をクリックし、iframe モーダルが開く
- **When**: iframe モーダルを目視確認する
- **Then**: iframe モーダルがポップオーバーの前面に表示される（z-index 競合なし）

### AC7.13 `src` / `docs` / `plugin/src` で同期実装されている

- **Given**: `src/kc-calendar.js` の変更が完了している
- **When**: `docs/kc-calendar.js` と `plugin/src/js/desktop.js` の対応箇所を確認する
- **Then**: 3 ファイルに同等の実装が存在する

### AC7.14 複数日 span 終日予定に期間ラベルが表示される

- **Given**: ポップオーバーを開いた日に複数日 span の終日予定が含まれている
- **When**: ポップオーバーの一覧を確認する
- **Then**: 終日バーのタイトル下に「5/26 – 5/30」形式の期間ラベルが表示される
- **And**: 単日終日予定（開始 = 終了）には期間ラベルが表示されない

---

## 8. 検証項目・テストシナリオ

### 8.1 基本動作シナリオ

| シナリオ | 確認操作 | 期待結果 |
|---|---|---|
| +N more 表示 → クリック | 複数予定がある日の `+N more` をクリック | ポップオーバーが表示され、非表示だった予定一覧が確認できる |
| 終日バー表示 | 終日予定が含まれる日のポップオーバー | 予定色のバーが表示され、タイトルが読める |
| 時間予定リスト | 時間予定が含まれる日のポップオーバー | ドット + 時刻 + タイトルの行が表示される |
| 日付ヘッダクリック | ポップオーバーのヘッダラベルをクリック | 日ビューに遷移し、正しい日が表示される |
| 予定クリック | ポップオーバー内の予定行をクリック | iframe モーダルが開き、ポップオーバーが閉じる |

### 8.2 クローズトリガーのテスト

| トリガー | 操作 | 期待結果 |
|---|---|---|
| × ボタン | ポップオーバーの × ボタンをクリック | ポップオーバーが閉じる |
| ESC キー | ポップオーバーが開いている状態で ESC を押す | ポップオーバーが閉じる |
| 外側クリック | ポップオーバー外の任意の場所をクリック | ポップオーバーが閉じる |
| 別日クリック | 別の日付の `+N more` をクリック | 旧ポップオーバーが閉じ、新しいポップオーバーが開く |
| 同日再クリック | 同じ日の `+N more` を再クリック | ポップオーバーが閉じる（トグル） |
| 月送り | prev / next ボタンをクリック | ポップオーバーが閉じる |
| ビュー切替 | 週・日ビューに切り替える | ポップオーバーが閉じる |

### 8.3 位置計算の境界値テスト

| シナリオ | 確認内容 |
|---|---|
| 右端セル（最終列） | ポップオーバーが右方向に flip して viewport 内に表示される |
| 下端セル（最終行） | ポップオーバーが上方向に flip して viewport 内に表示される |
| 右下端セル | flip + clamp が機能し viewport 内に収まる。収まらない場合は中央フォールバック |
| 小さいウィンドウ | 中央フォールバックが適用される |
| リサイズ後 | ポップオーバーが新しい viewport サイズに合わせて位置を再計算する |

### 8.4 z-index テスト

| シナリオ | 確認内容 |
|---|---|
| ポップオーバー vs 月セル要素 | ポップオーバーが月セル・chip・終日バーより前面に表示される |
| ポップオーバー vs iframe モーダル | iframe モーダルが開くとポップオーバーより前面に表示される |

### 8.5 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| 月ビュー全般 | `REQ_month-view.md §4` の AC4.1〜AC4.25 が全合格 |
| 月ビュー DnD | `REQ_month-dnd.md` の全 AC が合格 |
| 月ビュー二重表示修正 | `REQ_month-duplicate-fix.md §4` の全 AC が合格 |
| iframe モーダル | `REQ_popup-behavior-fix.md §4` の全 AC が合格 |

### 8.6 実機確認（SAML 認証環境）

1. `plugin/dist/plugin.zip` を kintone（bushiroad-group.cybozu.com）に手動アップロードする（SAML 認証のため自動化不可、`MEMORY.md: project_kintone_saml_auth`）
2. 検証アプリ（k/891/）の月ビューで予定が多い日（`+N more` が表示される日）を開く
3. `+N more` をクリックしてポップオーバーが正しく表示されることを確認する
4. 終日予定・時間予定がそれぞれ正しいスタイルで表示されることを目視確認する
5. 日付ヘッダクリックで日ビューに遷移することを確認する
6. 予定クリックで iframe モーダルが開き、ポップオーバーが閉じることを確認する
7. ESC キー・外側クリック・× ボタンでポップオーバーが閉じることを確認する
8. **拡張機能オン状態（通常モード）と拡張機能オフ状態（シークレットモード）の両方で `+N more` クリック → ポップオーバー表示が動作することを確認する**（v2 対応の検証。シークレットモードでは初版でも動作を確認済み。通常モードはイベント委譲方式に改修後のアップロード版で確認すること）

---

## 9. 想定 UX / シーケンス

### 9.1 `+N more` クリックから閉じるまでの基本フロー

```
[ユーザー] +N more クリック
    ↓
[KC.MonthOverflowPopup.open(anchorEl, dateYMD, hiddenEvents)]
    ├─ _anchorYMD === dateYMD の場合: close() してトグル終了
    ├─ _popupEl が存在する場合: close() して旧ポップオーバーを除去
    ├─ _buildDOM(dateYMD, hiddenEvents) でポップオーバー DOM を生成
    ├─ document.body.appendChild(popupEl)
    ├─ _calcPosition(anchorEl) で top / left を計算
    │     └─ flip + clamp → 失敗時は中央フォールバック
    ├─ popupEl.style.top / left を設定
    ├─ _bindEvents(popupEl, anchorEl) でリスナーを登録
    │     ├─ × ボタン: close()
    │     ├─ document click（外側）: close()
    │     ├─ document keydown（ESC）: close()
    │     └─ window resize: _calcPosition() 再実行
    └─ フェードインアニメーション（150ms）

[ユーザー] 予定をクリック
    ├─ KC.MonthOverflowPopup.close()（ポップオーバー即閉じ）
    └─ KC.Popup.openEdit(ev.id)（iframe モーダルを開く）

[ユーザー] 日付ヘッダをクリック
    ├─ KC.MonthOverflowPopup.close()
    ├─ KC.State.current = <該当日の Date>
    ├─ KC.State.view = 'day'
    └─ KC.Render.refresh()

[ユーザー] 月送り / ビュー切替
    └─ placeMonthEvents() 冒頭の KC.MonthOverflowPopup.close() が走る
```

### 9.2 月ビュー再描画とポップオーバーの整合

```
[何らかのトリガー] → placeMonthEvents() 呼び出し
    ├─ KC.MonthOverflowPopup.close()（ポップオーバー自動クローズ）
    ├─ 既存 chip クリア処理（REQ_month-duplicate-fix.md より）
    └─ 予定の再配置 → 新しい +N more ラベルを生成・ハンドラ登録
```

---

## 10. 未確定事項・リスク・前提

### 10.1 [未確定] ポップオーバー幅（280px / 320px）

grill-me セッションでは「280〜320px」の範囲が示されたが、具体値は実装時の視認性確認で決定する。

**判断基準案**: タイトルが最も長い予定が 1 行に収まるかどうかを実機確認し、280px で収まれば 280px を採用、収まらなければ 320px を採用する。

### 10.2 [未確定] フェードイン以外のアニメーション（scale 等）の要否

現時点はフェードイン（`opacity: 0 → 1`、150ms）のみ。scale アニメーション（transform: scale(0.95) → 1 等）の要否は実装後に目視で検討する。

### 10.3 [未確定] 期間ラベルのフォーマット（年の表示 / 省略）

「5/26 – 5/30」のように年を省略する形式を基本とするが、年をまたぐ予定（例: 12/28 – 1/4）での表示が不明確。

**方針案**: 開始日・終了日が今年中であれば年を省略（`M/D` 形式）。年をまたぐ場合は `YYYY/M/D` 形式で表示する。実装担当が判断し、実機確認で妥当性を検証すること。

### 10.4 [リスク] `hiddenEvents` の渡し方

`applyOverflow()` は現在 `remaining`（件数の数値）のみを受け取る。ポップオーバーに表示するためには予定オブジェクトのリストが必要になる。

**方針案 A**: `applyOverflow()` の引数を `(cellEl, remaining, hiddenEventsArray)` に拡張する。呼び出し元の `placeMonthTimedEvents()` / `placeMonthAlldayEvents()` 等でリストを組み立てて渡す。

**方針案 B**: `cellEl` に `data-overflow-ids` 等の data 属性で予定 ID リストを保持し、クリック時に `KC.State.events` から ID でフィルタする。

実装担当は両案の実装コストを比較し、シンプルな方を選択すること。管理者への報告が必要な場合は差し戻し提案を行うこと。

### 10.5 [リスク] 実機未検証

本要件定義書の全受入基準は静的な仕様分析に基づく。位置計算・フェードイン・z-index 競合は実機での目視確認が必要。kintone は SAML 認証（`MEMORY.md: project_kintone_saml_auth`）のため自動テストが困難であり、§8.6 の手順による手動確認が必須である。

### 10.6 [前提] `data-date` 属性は既に付与済み

`.kc-month-cell` への `data-date` 付与は commit 219d720 で実装済み（`HANDOVER.md §4` バグ A 対応）。`applyOverflow()` 内で `cellEl.dataset.date` を参照可能であることを前提とする。

### 10.7 [前提] `+N more` ラベルが `placeMonthEvents` 再実行で毎回再生成される

`REQ_month-duplicate-fix.md` で採用された「chip クリア追加による冪等化」により、`placeMonthEvents()` は毎回 `.kc-month-more` 要素をクリアして再生成する。クリックハンドラも毎回 `applyOverflow()` 内で登録されるため、イベントリスナーの重複登録は発生しない。

---

## 11. 関連資料

| 資料 | 関連箇所 |
|---|---|
| `src/kc-calendar.js:4096-4103` | `applyOverflow()` — `+N more` 生成関数（クリックハンドラ追加対象）|
| `src/kc-calendar.js:3789-3801` | `_calcMaxItems()` — 表示上限計算（流用）|
| `src/kc-calendar.js:3960-3963` | 時間予定 chip のクリックハンドラ（`KC.Popup.openEdit` の呼び出し方参考）|
| `src/kc-calendar.js:1183-1190` | `KC.Popup._close()` — iframe モーダルクローズと再描画のシーケンス |
| `src/kc-calendar.js:4843-4865` | `KC.Render.setActiveView()` — 日ビュー遷移（流用）|
| `src/kc-calendar.css:947-956` | `.kc-month-more` CSS — `cursor: default` を `pointer` に変更する対象 |
| `requirements/REQ_month-view.md` | 月ビュー Phase 1 要件（`+N more` 描画ロジックの原設計）|
| `requirements/REQ_month-dnd.md` | 月ビュー DnD 要件（chip クリックとの競合に注意）|
| `requirements/REQ_month-duplicate-fix.md` | chip 冪等化（`placeMonthEvents` 冒頭クリアの設計）|
| `requirements/REQ_popup-behavior-fix.md` | iframe モーダル化要件（`KC.Popup.openEdit` の現行仕様）|
| `HANDOVER.md §4` | 未着手項目としての `+N more` 展開の記録 |
| `REQ_overlap-rendering.md §1.3 / §6.3` | 月ビュー `+N more` 展開を Phase 2 として後送りした記録 |

---

*本要件定義書: 確定版 第 1 版（2026-05-28）。grill-me セッションで決定した全仕様を網羅。builder はこの要件定義書を入力として実装を開始すること。実装前に §10 の未確定事項を確認し、必要に応じて管理者に差し戻し提案を行うこと。*
