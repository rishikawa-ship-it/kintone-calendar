# 要件定義書: 月ビュー予定ドラッグ操作（移動・リサイズ）

**文書番号**: REQ_month-dnd  
**作成日**: 2026-05-08  
**更新日**: 2026-05-08（初版）  
**作成者**: designer (サブエージェント)  
**対象ファイル**: `src/kc-calendar.js`, `src/kc-calendar.css`（および `docs/` ミラー）  
**ステータス**: 確定版（未確定事項 4 件 — §10 参照）

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

### 1.1 月ビュー DnD の必要性

`REQ_month-view.md` で実装した月ビュー（Phase 1）では、終日バー・時間予定 chip のクリックによる編集ポップアップのみが動作する。しかし日付変更・期間変更を行うには毎回編集ポップアップを開く必要があり、複数の予定を素早く調整する業務用途では操作コストが高い。

Google カレンダーの月ビューが提供する「バーを掴んで別の日へドラッグするだけで日付が変わる」UX を実装することで、月単位での予定管理を直感的かつ効率的に行えるようにする。

### 1.2 確定済みスコープ（2026-05-08 意思決定）

以下の 8 項目が確定している。本要件書は全てこれを前提として記述する。

| # | 項目 | 決定 |
|---|---|---|
| 1 | スコープ A: 終日イベント移動（横ドラッグ） | **採用** |
| 2 | スコープ B: 終日イベントリサイズ（左右端） | **採用** |
| 3 | スコープ C: 時間予定 chip の日付変更（時刻維持） | **採用** |
| 4 | スコープ D: 時間予定リサイズ（時刻変更） | **対象外**（月ビュー時刻分解能なし、Google も非対応） |
| 5 | 別週またぎ DnD | **許可**（Google 準拠） |
| 6 | 当月外セルへの drop | **許可**（Google 準拠） |
| 7 | ゴースト戦略 | **`position: fixed` の body 直下方式**（週ビュー時間予定 DnD と同じ） |
| 8 | `+N more` クリック展開 | 別タスク（本要件外） |

### 1.3 週ビュー DnD との関係

週ビュー DnD は `REQ_event-drag-resize.md` で定義・実装済みであり、`KC.DnD` モジュール（`src/kc-calendar.js:682–1553`）に以下の共通基盤が存在する。

| 共通機能 | 実装箇所 |
|---|---|
| 5px 閾値判定 | `_onMouseMoveAllday` L876、`_onMouseMoveTime` L1257 |
| ESC キャンセル | `_onKeyDown` L784、`_cancel` L792 |
| `window.blur` キャンセル | `_cancel` L818 |
| 楽観的 UI 更新 | `_commitOptimistic` L830 |
| suppressClick（誤ポップアップ防止） | `_onMouseUpAllday` L971、`_onMouseUpTime` L1417 |
| `$revision` 楽観ロック | `_commitOptimistic` L848 |
| ゴースト body 直下 fixed 方式 | `_buildTimeGhost` L1187 |
| 終日ゴースト absolute 方式 | `_buildAlldayGhost` L717 |

月ビュー DnD はこれらの共通基盤を最大限流用し、DOM クエリの view 別分岐を追加する最小限の変更で実現する。

---

## 2. スコープ

### 2.1 対象（スコープ内）

| スコープ | 詳細 |
|---|---|
| **A: 終日イベント移動** | 月ビューの `.kc-month-ad-events` レイヤ上の終日バーを別のセルへドラッグ。同週内・別週またぎ・当月外セルへの drop を全て許可 |
| **B: 終日イベントリサイズ** | 終日バーの左端ハンドル（開始日変更）・右端ハンドル（終了日変更）。週をまたぐリサイズは対象外とし、週行内でクランプする |
| **C: 時間予定 chip の日付変更** | `.kc-month-chip` を横ドラッグして別のセルへ移動。時刻（時・分・秒）は変更せず日付部分のみ変更する |
| **共通: 5px 閾値** | mousedown から 5px 未満の移動は DnD を発動せずクリックとして通過する |
| **共通: ESC キャンセル** | ドラッグ中の ESC でキャンセル、元の状態に戻す |
| **共通: 楽観的 UI 更新** | API レスポンス前にインプレース更新 + `KC.Render.renderGrid()` で即時反映 |
| **共通: `$revision` 楽観ロック** | `KC.Api.updateEvent` に `revision: ev.rev` を送信 |
| **ゴースト: body 直下 fixed** | 別週またぎでも親付け替えなしにスムーズに動作する |

### 2.2 スコープ外

| 項目 | 理由 |
|---|---|
| D: 時間予定リサイズ（時刻変更） | 月ビューには時刻分解能がなく Google カレンダーも非対応 |
| `+N more` クリックの詳細展開 | `REQ_month-view.md §2.2` で Phase 2 指定済み。本タスクでは対象外 |
| 月ビューでの範囲選択による新規作成 | 別タスク |
| キーボード DnD / タッチ操作 | 別フェーズ（本要件はマウスのみ） |
| 終日 ⇄ 時間あり相互変換 | `allday` フィールド型固定、別タスク |
| スコープ A/B/C の週ビューへの影響 | 週ビュー DnD は `REQ_event-drag-resize.md` のまま維持。リグレッションなし |

---

## 3. 設計方針

### 3.1 全体アーキテクチャ

月ビュー DnD の処理フロー:

```
[mousedown on .kc-ad-event / .kc-resize-handle / .kc-month-chip]
  │
  ├─ 5px 閾値判定（mousemove で距離を計測）
  │    │ 5px 未満: DnD 不発動 → クリックとして通過（KC.Popup.openEdit）
  │    └ 5px 以上: DnD 開始
  │
  ├─ ghost 生成（position: fixed で document.body に append）
  │
  ├─ 元バー / chip に kc-ad-event--dragging / kc-event--dragging を付与（opacity: 0.4）
  │
  ├─ mousemove ループ
  │    ├─ [A] 終日移動:    clientX → _monthCellFromX() → 対象日の YYYY-MM-DD → newStart/End 算出
  │    ├─ [B] 終日リサイズ: clientX → _monthCellFromX() → 開始 or 終了日のみ更新
  │    └─ [C] chip 移動:   clientX → _monthCellFromX() → 日付部分のみ変更（時刻維持）
  │
  ├─ [ESC / window blur] → _cancel()（ghost 除去、状態クリア）
  │
  └─ mouseup
       ├─ ghost 除去
       ├─ delta === 0（元の日付と同じ）→ 何もしない
       └─ delta > 0:
            ├─ _commitOptimistic(origEv, newStart, newEnd)
            │    ├─ KC.State.events をインプレース更新
            │    ├─ KC.Render.renderGrid()（月ビュー再描画）
            │    └─ KC.Api.updateEvent 非同期送信
            │         ├─ 成功: revision を KC.State.events に反映
            │         └─ 失敗: alert(err.message) + KC.Render.refresh()（ロールバック）
            └─ suppressClick（DnD 発動後の誤ポップアップ防止）
```

### 3.2 KC.DnD の view 抽象化

既存の `_adcellFromX`（L700）は `.kc-adcell[data-date]`（週ビュー専用）を走査しているため、月ビューでは機能しない。以下の方針で view 別分岐を実装する。

#### 設計方針: シンプルな view 別分岐

`_drag` オブジェクトに `view` プロパティを追加し、内部ヘルパーが `_drag.view` を参照して処理を分岐する。DI（依存性注入）形式は overengineering であり採用しない。

```javascript
// _drag オブジェクトに view プロパティを追加
_drag = {
  view: 'month',   // 'week' | 'month'
  type: 'move-allday' | 'resize-left' | 'resize-right' | 'move-month-chip',
  ev: KcEvent,
  // ... 既存プロパティ
};
```

#### 追加ヘルパー関数

```javascript
/**
 * clientX から月ビューの .kc-month-cell[data-date] を走査し
 * 対応するセル情報を返す
 * @param {number} clientX
 * @returns {{ colIdx: number, dateYMD: string, cellEl: HTMLElement } | null}
 */
function _monthCellFromX(clientX) {
  var cells = document.querySelectorAll('.kc-month-cell[data-date]');
  for (var i = 0; i < cells.length; i++) {
    var r = cells[i].getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) {
      return {
        colIdx:  i % 7,
        dateYMD: cells[i].dataset.date,
        cellEl:  cells[i]
      };
    }
  }
  return null;
}

/**
 * clientY から月ビューの週行インデックス（0〜5）を返す
 * .kc-month-week[data-week] の verticalな位置で判定する
 * @param {number} clientY
 * @returns {number} 週行インデックス（-1 = グリッド外）
 */
function _monthWeekRowFromY(clientY) {
  var weeks = document.querySelectorAll('.kc-month-week[data-week]');
  for (var i = 0; i < weeks.length; i++) {
    var r = weeks[i].getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return i;
  }
  return -1;
}
```

#### 既存関数の view 別分岐

`_onMouseMoveAllday`（L871）内で呼ばれる `_adcellFromX` を view 別分岐に変更する。

```javascript
// 変更前
var info = _adcellFromX(e.clientX);

// 変更後
var info = (_drag.view === 'month')
  ? _monthCellFromX(e.clientX)
  : _adcellFromX(e.clientX);
```

同様に `_getWeekYMDs`（L1520）も月ビューでは別処理が必要である（§3.3・§3.4 参照）。

#### 月ビュー用週 YMD 取得

```javascript
/**
 * 月ビュー DnD 中に、カーソルが乗っている週行の 7 日分 YYYY-MM-DD 配列を返す
 * @param {number} clientY - mousemove の clientY
 * @returns {string[]} 7 要素の YYYY-MM-DD 配列（取得できない場合は空配列）
 */
function _getMonthWeekYMDs(clientY) {
  var weekIdx = _monthWeekRowFromY(clientY);
  if (weekIdx < 0) return [];
  var range = KC.RenderMonth.gridRange();
  var U = KC.Utils;
  var res = [];
  for (var i = 0; i < 7; i++) {
    res.push(U.fmtYMD(U.addDays(range.start, weekIdx * 7 + i)));
  }
  return res;
}
```

### 3.3 終日イベント移動（スコープ A）

#### 3.3.1 mousedown 配線

`buildMonthAlldayBar`（`src/kc-calendar.js:2563`）にリサイズハンドルと mousedown 配線を追加する。

```javascript
// 月ビュー終日バーへの mousedown 配線
el.addEventListener('mousedown', function (mdEvt) {
  if (mdEvt.button !== 0) return;
  mdEvt.stopPropagation();
  KC.DnD.startMoveAlldayMonth(ev, mdEvt, el);
});

// 左右リサイズハンドル DOM 追加
var leftHandle = document.createElement('div');
leftHandle.className = 'kc-resize-handle kc-resize-handle--left';
leftHandle.addEventListener('mousedown', function (mdEvt) {
  mdEvt.stopPropagation();
  KC.DnD.startResizeAlldayMonth(ev, 'left', mdEvt, el);
});

var rightHandle = document.createElement('div');
rightHandle.className = 'kc-resize-handle kc-resize-handle--right';
rightHandle.addEventListener('mousedown', function (mdEvt) {
  mdEvt.stopPropagation();
  KC.DnD.startResizeAlldayMonth(ev, 'right', mdEvt, el);
});

el.appendChild(leftHandle);
el.appendChild(rightHandle);
```

#### 3.3.2 移動の追従ロジック

```
mousemove:
  info = _monthCellFromX(clientX)
  weekYMDs = _getMonthWeekYMDs(clientY)
  newStartYMD = info.dateYMD
  spanDays = ceil((origEnd - origStart) / 86400000)   ← 元の日数差を維持
  newEndYMD = addDays(newStartDate, spanDays)
  _drag.newStart = newStartYMD + 'T00:00:00+09:00'
  _drag.newEnd   = newEndYMD   + 'T00:00:00+09:00'
  ゴースト位置更新（_positionMonthGhost）
  ゴーストラベル更新（_updateAlldayGhostLabel と同様）
```

#### 3.3.3 ゴースト位置計算（月ビュー用）

週ビューの `_positionAlldayGhost`（L754）は `.kc-allday` 内の絶対配置を前提とするため月ビューでは使えない。月ビューの終日ゴーストは `position: fixed` で body 直下に配置する。

```javascript
/**
 * 月ビュー終日ゴーストを body 直下 fixed で追従させる
 * @param {HTMLElement} ghost
 * @param {string} dateYMD - ゴーストが乗るセルの YYYY-MM-DD
 * @param {number} spanDays - 表示上の日数
 */
function _positionMonthGhost(ghost, dateYMD, spanDays) {
  // セル要素を dateYMD から引き当て
  var cell = document.querySelector('.kc-month-cell[data-date="' + dateYMD + '"]');
  if (!cell) return;
  var r = cell.getBoundingClientRect();

  // セルの横幅 × spanDays で幅を決定（週またぎは週末でクランプ）
  var cellW = r.width;
  var leftPx = r.left;
  var topPx  = r.top + 4;   // バーは dateline の下 4px から

  ghost.style.left   = leftPx + 'px';
  ghost.style.top    = topPx + 'px';
  ghost.style.width  = (cellW * Math.min(spanDays, 7)) + 'px';
  ghost.style.height = '22px';
}
```

> **注記**: 別週またぎ時はゴーストが週行境界を跨いで表示されるため、視覚的には連続して見えないが、newStart / newEnd は正しく算出する。span 表示のクランプは週末（土曜）で行う。

### 3.4 終日イベントリサイズ（スコープ B）

#### 3.4.1 左端リサイズ

```
mousemove:
  info = _monthCellFromX(clientX)
  newStartYMD = info.dateYMD
  newEndDate = origEndDate（固定）
  if newStartDate >= newEndDate: newStartDate = addDays(newEndDate, -1)  ← 最小 1 日
  _drag.newStart = newStartYMD + 'T00:00:00+09:00'
  _drag.newEnd   = fmtYMD(origEndDate) + 'T00:00:00+09:00'
```

#### 3.4.2 右端リサイズ

```
mousemove:
  info = _monthCellFromX(clientX)
  newEndYMD（表示終了日）= info.dateYMD
  実際の newEnd = addDays(newEndDate, 1) + 'T00:00:00+09:00'  ← kintone の end は翌日0時
  newStartDate = origStartDate（固定）
  if newEndDate <= newStartDate: newEndDate = addDays(newStartDate, 1)  ← 最小 1 日
```

#### 3.4.3 ゴースト

リサイズ中は `_positionMonthGhost` を呼び、開始セルから幅を更新する。

### 3.5 時間予定 chip の DnD（スコープ C）

#### 3.5.1 概要

月ビューの時間予定 chip（`.kc-month-chip`）は時刻分解能がないため、横方向のみの日付変更とする。縦方向ドラッグは無視する。別の日のセルへ drop した場合、ISO 8601 文字列の日付部分（`YYYY-MM-DD`）のみを新しい日付に置き換え、時刻部分（`THH:MM:SS+09:00`）は元のまま維持する。

#### 3.5.2 新規関数 `startMoveMonthChip`

```javascript
/**
 * 月ビュー時間予定 chip の移動 DnD を開始する（スコープ C）
 * @param {Object} ev - KcEvent
 * @param {MouseEvent} mousedown
 * @param {HTMLElement} chipEl - クリックされた .kc-month-chip 要素
 */
function startMoveMonthChip(ev, mousedown, chipEl) {
  mousedown.preventDefault();

  var ghost = _buildMonthChipGhost(ev);

  _drag = {
    view:     'month',
    type:     'move-month-chip',
    ev:       ev,
    ghost:    ghost,
    origBar:  chipEl,
    startX:   mousedown.clientX,
    startY:   mousedown.clientY,
    started:  false,
    newStart: null,
    newEnd:   null
  };

  document.addEventListener('mousemove', _onMouseMoveMonthChip);
  document.addEventListener('mouseup', _onMouseUpMonthChip);
}
```

#### 3.5.3 mousemove ハンドラ（chip 移動）

```javascript
function _onMouseMoveMonthChip(e) {
  if (!_drag) return;

  // 5px 閾値判定
  if (!_drag.started) {
    var dist = Math.hypot(e.clientX - _drag.startX, e.clientY - _drag.startY);
    if (dist < DND_THRESHOLD) return;

    _drag.started = true;
    document.body.classList.add('kc-dnd-active');
    document.body.style.userSelect = 'none';
    _drag.origBar.classList.add('kc-event--dragging');
    document.body.appendChild(_drag.ghost);
    document.addEventListener('keydown', _onKeyDown);
    window.addEventListener('blur', _cancel);
  }

  var info = _monthCellFromX(e.clientX);
  if (!info) return;

  var ev = _drag.ev;

  // ISO 文字列から日付部分のみを新しい日付に置き換える
  // 元の時刻部分（THH:MM:SS+09:00）は維持する
  var origStart = ev.start;  // "YYYY-MM-DDTHH:MM:SS+09:00"
  var origEnd   = ev.end;

  var origStartTimePart = origStart.substring(10);  // "THH:MM:SS+09:00"
  var origEndTimePart   = origEnd.substring(10);

  // 元の開始日と新しい開始日の差分（日数）
  var origStartDate = new Date(origStart.substring(0, 10) + 'T00:00:00');
  var origEndDate   = new Date(origEnd.substring(0, 10) + 'T00:00:00');
  var dateDiffMs    = origEndDate.getTime() - origStartDate.getTime();

  var newStartDate  = new Date(info.dateYMD + 'T00:00:00');
  var newEndDate    = new Date(newStartDate.getTime() + dateDiffMs);

  _drag.newStart = KC.Utils.fmtYMD(newStartDate) + origStartTimePart;
  _drag.newEnd   = KC.Utils.fmtYMD(newEndDate)   + origEndTimePart;

  // ゴーストをカーソル位置に追従（縦方向も追従させて視覚的に自然にする）
  _drag.ghost.style.left = (e.clientX - 20) + 'px';
  _drag.ghost.style.top  = (e.clientY - 8)  + 'px';
}
```

#### 3.5.4 時刻維持の ISO 文字列構築

元の `ev.start` が `"2026-05-08T14:00:00+09:00"` の場合:
- 日付部分: `"2026-05-08"` → 新しい日付（例: `"2026-05-15"`）に置換
- 時刻部分: `"T14:00:00+09:00"` → そのまま維持
- 結果: `"2026-05-15T14:00:00+09:00"`

#### 3.5.5 chip への mousedown 配線

`buildMonthChip`（`src/kc-calendar.js:2608`）に mousedown 配線を追加する。

```javascript
chip.addEventListener('mousedown', function (mdEvt) {
  if (mdEvt.button !== 0) return;
  mdEvt.stopPropagation();
  KC.DnD.startMoveMonthChip(evt, mdEvt, chip);
});
```

#### 3.5.6 chip ゴースト生成

```javascript
/**
 * 月ビュー chip ゴースト要素を生成する（position: fixed、body 直下方式）
 * @param {Object} ev - KcEvent
 * @returns {HTMLElement}
 */
function _buildMonthChipGhost(ev) {
  var color = ev.color || '#3b82f6';
  var ghost = document.createElement('div');
  ghost.className = 'kc-month-chip kc-event--ghost';
  ghost.style.position = 'fixed';
  ghost.style.zIndex = '9999';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.85';

  var dot = document.createElement('span');
  dot.className = 'kc-month-chip-dot';
  dot.style.background = color;

  var evStart = new Date(ev.start);
  var timeSpan = document.createElement('span');
  timeSpan.className = 'kc-month-chip-time';
  timeSpan.textContent = KC.Utils.pad2(evStart.getHours()) + ':' + KC.Utils.pad2(evStart.getMinutes());

  var titleSpan = document.createElement('span');
  titleSpan.className = 'kc-month-chip-title';
  titleSpan.textContent = ev.title || '(無題)';

  ghost.appendChild(dot);
  ghost.appendChild(timeSpan);
  ghost.appendChild(titleSpan);
  return ghost;
}
```

### 3.6 ゴースト戦略

#### 3.6.1 終日イベントゴースト（スコープ A・B）

月ビューの終日ゴーストは `position: fixed` で `document.body` 直下に append する。週ビューの終日ゴーストが `.kc-ad-events` 内に配置されるのと異なり、月ビューでは別週またぎが発生するため body 直下方式を採用する。

```html
<div class="kc-ad-event kc-event--ghost" style="position: fixed; z-index: 9999; pointer-events: none; ...">
  <span class="dot"></span>
  <span class="kc-ad-evt-title">予定タイトル</span>
  <span class="kc-evt-ghost-time">M/D ~ M/D</span>
</div>
```

#### 3.6.2 chip ゴースト（スコープ C）

```html
<div class="kc-month-chip kc-event--ghost" style="position: fixed; z-index: 9999; pointer-events: none; ...">
  <span class="kc-month-chip-dot"></span>
  <span class="kc-month-chip-time">HH:MM</span>
  <span class="kc-month-chip-title">予定タイトル</span>
</div>
```

#### 3.6.3 ゴーストの共通特性

- `position: fixed` で `document.body` 直下に append
- `pointer-events: none` でグリッドへのイベントを透過
- `z-index: 9999`
- `opacity: 0.85`
- `border: 2px dashed var(--kc-border)` または `box-shadow` でゴーストらしさを演出（既存 `.kc-event--ghost` スタイル流用）

### 3.7 当月外セルへの drop

`.kc-month-cell--other-month` クラスを持つセル（前月末・翌月頭）も drop ターゲットとして機能させる。`_monthCellFromX` はクラスを問わず全ての `.kc-month-cell[data-date]` を走査するため、追加の実装は不要。

drop 後の挙動:
- kintone API に新しい日付で保存する
- 現在の月ビュー（当月表示）ではそのイベントが non表示になる（当月外セルへ移動したため）
- 月ナビゲーションで対象月に移動すると再表示される

### 3.8 楽観的 UI 更新（月ビューでの再描画）

既存の `_commitOptimistic`（L830）は `KC.Render.renderGrid()` を呼ぶ。月ビュー表示中は `KC.Render.renderGrid()` が `KC.RenderMonth.renderGrid()` を呼ぶフローになっている必要がある。

`KC.Render.renderGrid` の実装を確認し、月ビュー時に `KC.RenderMonth.renderGrid()` → `placeMonthEvents`（終日バー配置 + chip 配置）の追加呼び出しが行われるか確認する。現状の `KC.RenderMonth.renderGrid()` は DOM 構造の再生成のみであり、`placeMonthEvents`（終日バーの絶対配置 + chip 描画）は別途 `refresh()` 内で呼ばれる実装になっている場合は、`renderGrid()` 内に組み込む必要がある。

> **要確認（§10.1 参照）**: `_commitOptimistic` が呼ぶ `KC.Render.renderGrid()` の内部で `placeMonthAlldayEvents` + chip 描画が連鎖するか、builder が実装前に確認すること。

### 3.9 新規関数 `startMoveAlldayMonth` / `startResizeAlldayMonth`

週ビューの `startMoveAllday`（L990）と `startResizeAllday`（L1083）は `_getWeekYMDs()` を呼ぶが、月ビューでは週 YMD の取得元が異なる。月ビュー専用の関数を追加するか、既存関数に `view` 分岐を入れるかを選択する。

**推奨**: 既存関数に `view: 'month'` を持った `_drag` オブジェクトを生成し、内部ヘルパーが `_drag.view` を参照して分岐する方式。これにより関数のシグネチャ変更を最小限にできる。

ただし mouseup / mousemove の登録先は週ビューと同じ `_onMouseMoveAllday` / `_onMouseUpAllday` を使用し、内部で view 別分岐を行う。

### 3.10 suppressClick / ESC / 5px 閾値 / `$revision` の流用

これらは全て既存の `KC.DnD` 共通基盤に実装済みであり、月ビュー DnD の配線を `_onMouseMoveAllday` / `_onMouseUpAllday` / `_onMouseMoveMonthChip` / `_onMouseUpMonthChip` 経由で行えば自動的に機能する。

---

## 4. 受け入れ条件（Done の定義）

各条件は Given / When / Then 形式で記述する。

### AC4.1 月ビュー終日バー移動（同週内）

- **Given**: 月ビューで「5月6日（月）〜5月8日（水）」の終日イベントが表示されている
- **When**: バーを「5月8日（水）」セルへドラッグして放す
- **Then**: API が `start: 2026-05-08, end: 2026-05-10（3日間を維持）` で更新呼び出しされる
- **And**: バーが「5月8日〜5月10日」の位置に再描画される
- **And**: ドラッグ中はゴーストバーが追従する

### AC4.2 月ビュー終日バー移動（別週またぎ）

- **Given**: 月ビューで第 1 週（5月3日）に終日イベントが表示されている
- **When**: バーを第 3 週（5月17日）セルへドラッグして放す
- **Then**: API が 5月17日を開始日とする新しい日付で更新呼び出しされる
- **And**: 月グリッドが再描画され、バーが第 3 週の正しい位置に表示される
- **And**: ドラッグ中もゴーストが週行境界を越えてスムーズに追従する

### AC4.3 月ビュー終日バーリサイズ（右端）

- **Given**: 月ビューで「5月6日（月）〜5月8日（水）」の終日イベントが表示されている
- **When**: バー右端ハンドルを「5月10日（金）」セルへドラッグして放す
- **Then**: API が `start: 2026-05-06（変更なし）, end: 2026-05-11（+3日）` で更新呼び出しされる
- **And**: バーが月曜〜金曜の 5 列に伸びて再描画される

### AC4.4 月ビュー終日バーリサイズ（左端）

- **Given**: 月ビューで「5月6日（月）〜5月8日（水）」の終日イベントが表示されている
- **When**: バー左端ハンドルを「5月7日（火）」セルへドラッグして放す
- **Then**: API が `start: 2026-05-07（+1日）, end: 2026-05-09（変更なし）` で更新呼び出しされる
- **And**: バーが火曜〜水曜の 2 列に縮んで再描画される

### AC4.5 月ビュー当月外セルへの drop

- **Given**: 月ビューで5月が表示されており、当月外セル（4月30日）が左上に薄表示されている
- **When**: 終日バーを「4月30日（当月外）」セルへドラッグして放す
- **Then**: API が `start: 2026-04-30` で更新呼び出しされる
- **And**: 現在の5月表示ではそのイベントが非表示になる（当月外へ移動したため）
- **And**: 4月表示に切り替えると当該イベントが表示される

### AC4.6 月ビュー時間予定 chip 移動（日付変更）

- **Given**: 月ビューで5月8日（水）の「14:00〜15:00」時間予定 chip が表示されている
- **When**: chip を「5月15日（水）」セルへドラッグして放す
- **Then**: API が `start: 2026-05-15T14:00:00+09:00, end: 2026-05-15T15:00:00+09:00` で更新呼び出しされる
- **And**: 時刻（14:00〜15:00）は変更されていない
- **And**: chip が5月15日のセルに再描画される

### AC4.7 月ビュー chip 移動（別週またぎ）

- **Given**: 月ビューで5月1日の chip が表示されている
- **When**: chip を5月20日（別の週行）セルへドラッグして放す
- **Then**: API が5月20日を開始日とする（時刻維持）内容で更新呼び出しされる
- **And**: 月グリッドが再描画され、chip が5月20日のセルに表示される

### AC4.8 5px 閾値（クリック判定）

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーをマウスダウンして 3px 以内で放す
- **Then**: DnD が発動せず `KC.Popup.openEdit(ev.id)` が呼ばれる（クリックとして扱われる）
- **And**: ゴーストは表示されない

### AC4.9 5px 閾値（DnD 発動）

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーをマウスダウンして 6px 以上動かす
- **Then**: DnD が発動し、ゴーストバーが表示される
- **And**: 元バーに `kc-ad-event--dragging` クラスが付与され opacity: 0.4 になる

### AC4.10 5px 閾値（chip クリック判定）

- **Given**: 月ビューで時間予定 chip が表示されている
- **When**: chip をマウスダウンして 3px 以内で放す
- **Then**: DnD が発動せず `KC.Popup.openEdit(ev.id)` が呼ばれる
- **And**: ゴーストは表示されない

### AC4.11 ESC キャンセル（終日バー）

- **Given**: 月ビューで終日バーをドラッグ中（ゴーストバーが表示されている）
- **When**: ESC キーを押す
- **Then**: ゴーストバーが除去される
- **And**: 元バーが元の opacity（1.0）に戻る
- **And**: API は呼び出されない
- **And**: その後のマウスアップで DnD が再発動しない

### AC4.12 ESC キャンセル（chip）

- **Given**: 月ビューで chip をドラッグ中（chip ゴーストが表示されている）
- **When**: ESC キーを押す
- **Then**: chip ゴーストが除去され、元 chip が元の opacity に戻る
- **And**: API は呼び出されない

### AC4.13 楽観的 UI 更新（月ビュー）

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーを別の日へドラッグして放す
- **Then**: API レスポンスを待たずに即座に月グリッドが再描画される（バーが新しい位置に移動する）
- **And**: API 成功後は再描画しない（ちらつきがない）

### AC4.14 楽観ロック（`$revision` 送信）

- **Given**: 月ビューで任意の予定をドラッグ移動して放す
- **When**: `KC.Api.updateEvent` が呼ばれる
- **Then**: PUT リクエストのペイロードに `revision: ev.rev` が含まれる

### AC4.15 API 失敗時のロールバック

- **Given**: 他のユーザーが同時に同じ予定を更新しており `$revision` 競合が発生する状況
- **When**: 月ビューでドラッグして放す
- **Then**: API が 409 エラーを返し `alert(err.message)` が表示される
- **And**: `KC.Render.refresh()` が呼ばれ、サーバー側の最新状態で月カレンダーが再描画される

### AC4.16 連続ドラッグ時の revision 整合

- **Given**: 月ビューで終日バーをドラッグして API 更新が成功した直後
- **When**: 続けて同じバーを別の日へドラッグして放す
- **Then**: 2 回目のドラッグでも API が成功する（最新 revision が State に反映されているため 409 が発生しない）

### AC4.17 ゴーストの body 直下 fixed 配置

- **Given**: 月ビューで終日バーをドラッグ中
- **When**: DevTools でゴーストバー要素を確認する
- **Then**: ゴースト要素が `document.body` の直下に存在する
- **And**: `position: fixed` が設定されている
- **And**: ゴーストが週行をまたいで移動してもスムーズに追従する

### AC4.18 リサイズハンドルのホバー時出現

- **Given**: 月ビューで終日バーが表示されている（カーソルはバーの外）
- **When**: カーソルがバー外にある状態を確認する
- **Then**: ハンドル要素（`.kc-resize-handle--left` / `.kc-resize-handle--right`）は `opacity: 0` で不可視
- **When**: カーソルをバー上にホバーする
- **Then**: ハンドル要素が `opacity: 1` になり可視化される（transition を伴う）

### AC4.19 リサイズで終了日 < 開始日の防止

- **Given**: 月ビューで「5月6日〜5月8日」の終日バーが表示されている
- **When**: 左端ハンドルを「5月8日」以降へドラッグして放す
- **Then**: 最小 1 日スパン（開始日 = 終了日-1日）でクリップされ、開始日が終了日以後になることがない
- **And**: API は最小スパン（1日）で更新呼び出しされる

### AC4.20 chip 移動での時刻維持

- **Given**: 月ビューで「5月8日 22:30〜23:45」の時間予定 chip が表示されている
- **When**: chip を「5月20日」へドラッグして放す
- **Then**: API が `start: 2026-05-20T22:30:00+09:00, end: 2026-05-20T23:45:00+09:00` で更新呼び出しされる（時刻は変わらない）

### AC4.21 ドラッグ中の元バー薄表示

- **Given**: 月ビューで終日バーが表示されている
- **When**: バーをドラッグ開始し 5px 閾値を超える
- **Then**: 元バーに `kc-ad-event--dragging` クラスが付与され `opacity: 0.4` で薄く表示される
- **When**: ドラッグを放す（mouseup）または ESC キャンセルする
- **Then**: `kc-ad-event--dragging` クラスが除去され元の opacity に戻る

### AC4.22 ドラッグ中の元 chip 薄表示

- **Given**: 月ビューで時間予定 chip が表示されている
- **When**: chip をドラッグ開始し 5px 閾値を超える
- **Then**: 元 chip に `kc-event--dragging` クラスが付与され `opacity: 0.4` で薄く表示される
- **When**: ドラッグを放す（mouseup）または ESC キャンセルする
- **Then**: `kc-event--dragging` クラスが除去され元の opacity に戻る

### AC4.23 週ビュー DnD のリグレッションなし

- **Given**: 月ビュー DnD が実装された状態で週ビューに切り替える
- **When**: 週ビューで終日バー・時間予定バーをドラッグ操作する
- **Then**: `REQ_event-drag-resize.md §4` の全 AC（AC4.1〜AC4.26）が引き続き合格する
- **And**: `_adcellFromX` の動作が変わっていない（週ビューの列判定が正常）

### AC4.24 src / docs 同期

- **Given**: `src/kc-calendar.js` および `src/kc-calendar.css` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` および `docs/kc-calendar.css` が同一内容に同期されている（CLAUDE.md ルール準拠）

---

## 5. データモデル / 状態

### 5.1 KcEvent（変更なし）

`KcEvent` オブジェクトへの追加フィールドは不要。既存フィールドをそのまま流用する。

| フィールド | DnD での利用 |
|---|---|
| `id` | API 更新時の識別子 |
| `rev` | `revision` パラメータとして送信（楽観ロック） |
| `start` | 移動・リサイズで更新（ISO 8601） |
| `end` | 移動・リサイズで更新（ISO 8601） |
| `allday` | 終日 / 時間予定の分岐 |
| `title` | ゴーストバーのラベル表示 |
| `color` | ゴーストバーの背景色 |
| `colStart` | 週内開始列（週ごとに再計算されるため月 DnD 中は参照しない） |
| `span` | 週内スパン（同上） |
| `lane` | レーン番号（同上） |

### 5.2 `KC.DnD._drag`（月ビュー時の追加プロパティ）

既存 `_drag` オブジェクトに以下を追加する。

```javascript
KC.DnD._drag = {
  // 既存プロパティ（変更なし）
  type:     'move-allday' | 'resize-left' | 'resize-right' | 'move-month-chip',
  ev:       KcEvent,
  ghost:    HTMLElement,
  origBar:  HTMLElement,
  startX:   number,
  startY:   number,
  started:  boolean,
  newStart: string | null,
  newEnd:   string | null,

  // 月ビュー DnD で追加するプロパティ
  view: 'week' | 'month',   // NEW: view 別分岐に使用
};
```

`view` プロパティは週ビュー DnD でも `'week'` として設定することで、既存の週ビューコードへの影響を最小化する。

### 5.3 `KC.Api.updateEvent`（変更なし）

月ビュー DnD も既存の `KC.Api.updateEvent`（`src/kc-calendar.js:452–490`）をそのまま使用する。`revision: ev.rev` は既に実装済みであり追加変更不要。

---

## 6. 既存コードからの差分

### 6.1 変更する JS（KC.DnD モジュール）

| 対象 | 変更内容 | 所在 |
|---|---|---|
| `_adcellFromX` の呼び出し箇所 | `_drag.view === 'month'` 時に `_monthCellFromX` へ分岐 | `_onMoveAlldayMove` L909、`_onResizeAlldayMove` L1019 |
| `_getWeekYMDs` の呼び出し箇所 | `_drag.view === 'month'` 時に `_getMonthWeekYMDs(clientY)` へ分岐 | `_onMoveAlldayMove` L925、`_onResizeAlldayMove` L1032 |
| `_onMouseMoveAllday` | DnD 開始時のゴースト親要素を `_drag.view` で分岐（month は body 直下、week は `.kc-ad-events`） | L889–L893 |
| `startMoveAllday` | `view: 'week'` を `_drag` に追加 | L990 |
| `startResizeAllday` | `view: 'week'` を `_drag` に追加 | L1083 |

### 6.2 追加する JS（KC.DnD モジュール）

| 追加関数 | 責務 |
|---|---|
| `_monthCellFromX(clientX)` | 月ビューセル（`.kc-month-cell[data-date]`）を走査して列情報を返す |
| `_monthWeekRowFromY(clientY)` | clientY から週行インデックスを返す |
| `_getMonthWeekYMDs(clientY)` | 月ビュー用の週 YMD 配列を返す |
| `_positionMonthGhost(ghost, dateYMD, spanDays)` | 月ビュー終日ゴーストの fixed 配置を更新する |
| `_buildMonthChipGhost(ev)` | chip ゴースト要素を生成する（position: fixed） |
| `startMoveAlldayMonth(ev, mousedown, barEl)` | 月ビュー終日バー移動 DnD を開始する |
| `startResizeAlldayMonth(ev, side, mousedown, barEl)` | 月ビュー終日バーリサイズ DnD を開始する |
| `startMoveMonthChip(ev, mousedown, chipEl)` | 月ビュー chip 移動 DnD を開始する |
| `_onMouseMoveMonthChip(e)` | chip 移動 mousemove ハンドラ |
| `_onMouseUpMonthChip(e)` | chip 移動 mouseup ハンドラ |

### 6.3 変更する JS（KC.RenderMonth モジュール）

| 対象 | 変更内容 | 所在 |
|---|---|---|
| `buildMonthAlldayBar` | mousedown 配線 + リサイズハンドル DOM 追加 | `src/kc-calendar.js:2563` |
| `buildMonthChip` | mousedown 配線追加（`KC.DnD.startMoveMonthChip` へ） | `src/kc-calendar.js:2608` |

### 6.4 確認・修正する JS（KC.Render / KC.RenderMonth）

`_commitOptimistic`（L830）が呼ぶ `KC.Render.renderGrid()` が月ビュー時に `placeMonthAlldayEvents` + chip 描画を含む完全な再描画を行うかを確認する。現状の `KC.RenderMonth.renderGrid()`（L2457）は DOM 構造の再生成のみ行っている可能性があり、`placeMonthAlldayEvents` / `placeMonthTimedEvents` が別途 `refresh()` 内でのみ呼ばれているなら、`renderGrid()` に組み込む必要がある。

### 6.5 追加する CSS

```css
/* 月ビュー終日バーホバー時のリサイズハンドル表示（既存パターン流用） */
/* 既存の .kc-ad-event:hover .kc-resize-handle--left/--right は週ビュー用に定義済み */
/* 月ビューでも同クラスを使用するため既存 CSS がそのまま適用される */

/* 月ビュー chip の grab カーソル（chip ドラッグ対応） */
.kc-month-chip {
  cursor: grab;
}

/* chip ドラッグ中の薄表示（終日バーの .kc-ad-event--dragging に相当） */
.kc-month-chip.kc-event--dragging {
  opacity: 0.4;
}
```

---

## 7. CSS 変数 / レイアウト

### 7.1 流用する既存 CSS

| CSS | 流用元 | 月ビューでの利用 |
|---|---|---|
| `.kc-event--ghost` | `REQ_event-drag-resize.md §6.3` | 終日ゴーストと chip ゴースト共通 |
| `.kc-ad-event--dragging` | 既存（週ビュー） | 月ビュー終日バーの薄表示 |
| `.kc-event--dragging` | 既存（週ビュー） | 月ビュー chip の薄表示 |
| `.kc-resize-handle--left` / `.kc-resize-handle--right` | `REQ_event-drag-resize.md §6.3` | 月ビュー終日バーのリサイズハンドル |
| `.kc-ad-event:hover .kc-resize-handle--left/--right { opacity: 1 }` | 既存 CSS | 月ビュー終日バーのホバー時ハンドル表示 |
| `body.kc-dnd-active * { cursor: grabbing }` | 既存 CSS | 月ビュー DnD 中のカーソル |

### 7.2 カーソル仕様（月ビュー）

| 状態 | カーソル | 対象 |
|---|---|---|
| 終日バー本体（通常） | `grab` | `.kc-ad-event`（既存 CSS 流用） |
| chip（通常） | `grab` | `.kc-month-chip`（新規追加） |
| DnD 中 | `grabbing` | `body.kc-dnd-active *`（既存 CSS 流用） |
| 左右端ハンドル | `ew-resize` | `.kc-resize-handle--left/--right`（既存 CSS 流用） |

### 7.3 JS 定数

月ビュー DnD 専用の新規 JS 定数は不要。既存 `DND_THRESHOLD = 5`（px）をそのまま使用する。

---

## 8. エッジケース / 検証ケース

| ケース | 期待動作 | 対応 AC |
|---|---|---|
| 月またぎ終日イベント（前月から続く）の DnD | 前月から続くバーも `buildMonthAlldayBar` が生成しているなら mousedown が配線される。drop 後は新しい日付で保存。表示は月またぎ処理（`placeMonthAlldayEvents`）に依存 | AC4.1 |
| 別週への終日バー移動 | ゴーストが週行をまたぎ追従。newStart/newEnd は正しく算出される | AC4.2 |
| 当月外セルへの drop | `.kc-month-cell--other-month` も走査対象。保存成功後は当月ビューで非表示になる | AC4.5 |
| リサイズで終了日 < 開始日 | 最小 1 日でクリップ | AC4.19 |
| 連続ドラッグ（2回目以降）| `_commitOptimistic` が State を live reference で更新するため、2回目のドラッグ時も最新 revision が使われる（`_commitOptimistic` L834–L864 の既存ロジック流用） | AC4.16 |
| ドラッグ中に月切替ボタンクリック | 月切替は `KC.Render.refresh()` を呼ぶため、DnD 中の ghost が残る可能性がある。`window.blur` / `_cancel` が呼ばれるタイミングを確認する（§10.2 参照） | — |
| chip 移動先で `+N more` 化 | chip が `+N more` に折り畳まれると非表示になる。これは正常動作（表示ルールによる） | — |
| ドラッグ中に月切替キャンセル | `_cancel()` が呼ばれ ghost が除去・状態クリアされる | AC4.11 |
| ESC キャンセル後の mouseup | `_drag === null` のため mouseup で何も起きない | AC4.11、AC4.12 |
| 純クリック判定（5px 未満）| `KC.Popup.openEdit` が呼ばれる。suppressClick は不要（DnD が started でないため） | AC4.8、AC4.10 |
| `+N more` 上でのドラッグ | `+N more` はイベント要素ではないため DnD は発動しない。クリック時は何もしない（Phase 1 仕様） | — |
| DnD コミット後の祝日 API 再 fetch | 不要（祝日キャッシュは `KC.Api.loadHolidays` で管理、DnD では変化しない） | — |
| 同日に複数の終日バーが重なる場合 | それぞれの mousedown ハンドラが独立して機能する。最上位のバー（z-index 上位）のみが mousedown を受け取る | — |
| 極端に短い終日バー（1 列幅）| リサイズハンドルが左右端で重なる可能性がある。最小幅として `min-width: 20px` 程度の CSS 対応を検討する（§10.3 参照） | — |
| chip の日付が終日イベントに変わる | allday フラグは変更しない（スコープ外）。時間予定のまま日付のみ変更する | — |

---

## 9. 次タスクへの引き継ぎ

### 9.1 builder への指示

- **ブランチ**: `feature/month-dnd` で作業すること（`isolation: "worktree"` 推奨）
- **前提**: `REQ_month-view.md` の実装（月ビュー基本機能）が完了していること
- **編集対象**: `src/kc-calendar.js` と `src/kc-calendar.css` を同時に変更する。`docs/` への同期も忘れずに（CLAUDE.md ルール: AC4.24）
- **実装順序（依存順）**:
  1. `KC.DnD` に `_monthCellFromX` / `_monthWeekRowFromY` / `_getMonthWeekYMDs` / `_positionMonthGhost` ヘルパーを追加する
  2. 既存の `_onMoveAlldayMove` / `_onResizeAlldayMove` に `_drag.view === 'month'` 分岐を追加する
  3. `startMoveAlldayMonth` / `startResizeAlldayMonth` を追加し、`KC.DnD` の公開 API に加える
  4. `buildMonthAlldayBar` にリサイズハンドル DOM と mousedown 配線を追加する
  5. 終日移動 (A) と終日リサイズ (B) の動作確認
  6. `_buildMonthChipGhost` / `startMoveMonthChip` / `_onMouseMoveMonthChip` / `_onMouseUpMonthChip` を追加する
  7. `buildMonthChip` に mousedown 配線を追加する
  8. chip 移動 (C) の動作確認
  9. `KC.Render.renderGrid()` が月ビュー時に `placeMonthAlldayEvents` + chip 描画を含む完全再描画を行うか確認し、必要なら修正する（§3.8・§6.4 参照）
  10. 月 CSS（chip cursor、dragging クラス）を `kc-calendar.css` に追加する
- **週ビュー DnD のリグレッション確認必須**: `KC.DnD` の共通コードに手を入れるため、週ビューで `REQ_event-drag-resize.md §4` の全 AC が引き続き合格することを確認する
- **XSS 対策**: ゴーストバーのタイトルは `textContent` を使用し `innerHTML` にユーザー入力を直接代入しない（`DESIGN.md §9.3`）
- **1 関数 1 責務**: 追加する各関数は 30 行以内を目安とし、責務を分割する（`coding-rules.md` 準拠）
- **`view: 'week'` の後方追加**: 既存の `startMoveAllday`（L990）・`startResizeAllday`（L1083）の `_drag` 生成箇所に `view: 'week'` を追加する。既存動作への影響はないが分岐判定のため必須
- **`_cancel` の動作確認**: `_cancel`（L792）は終日・時間予定両方のリスナを除去する。chip DnD 用の `_onMouseMoveMonthChip` / `_onMouseUpMonthChip` も `_cancel` で除去されるよう、L813–L818 に追加する

### 9.2 reviewer への指示

§4「受け入れ条件」の各項目（AC4.1〜AC4.24）を 1 件ずつ順に確認すること。

特に以下に重点を置く:

1. **AC4.1〜4.4（終日移動・リサイズ）**: 日数差が正しく維持されることを確認。API の `start` / `end` をネットワークタブで確認する
2. **AC4.8〜4.10（5px 閾値）**: 微小移動でポップアップが開き、大きな移動で DnD が発動することを確認
3. **AC4.11〜4.12（ESC キャンセル）**: ESC 後のマウスアップで API が呼ばれないことをネットワークタブで確認
4. **AC4.13〜4.15（楽観更新・ロック）**: ちらつきの有無、409 時のロールバックを確認
5. **AC4.17（ゴースト body 直下 fixed）**: DevTools でゴーストが `body` の直下に存在することを確認
6. **AC4.18（ハンドルホバー）**: バー外ではハンドルが見えず、ホバーで出現することを確認
7. **AC4.20（chip 時刻維持）**: ネットワークタブで ISO 文字列の時刻部分が変わっていないことを確認
8. **AC4.23（週ビューリグレッション）**: 週ビューで終日バー・時間予定バーの DnD が正常動作することを確認
9. **AC4.24（sync）**: `diff src/kc-calendar.js docs/kc-calendar.js` が空出力であることを確認

---

## 10. 未確定事項 / リスク・前提

### 10.1 `KC.Render.renderGrid()` と月ビュー完全再描画の確認（要確認）

`_commitOptimistic`（L830）は `KC.Render.renderGrid()` を呼ぶが、この呼び出しが月ビュー時に `KC.RenderMonth.renderGrid()` → `placeMonthAlldayEvents` + chip 描画まで連鎖するかは現在確認できていない。

`KC.RenderMonth.renderGrid()`（L2457）は `renderMonthDayHeaders()` + `renderMonthGrid()` を呼ぶが、これは DOM グリッドの再生成のみ。`placeMonthAlldayEvents` / `placeMonthTimedEvents` が別途 `refresh()` 内でのみ呼ばれているなら、`renderGrid()` に組み込む必要がある。

**builder が実装前に確認して対応すること。確認後、本欄を更新すること。**

### 10.2 ドラッグ中の月切替ボタンクリック時の挙動（未確定）

ドラッグ中にユーザーが prev / next ボタンをクリックして月を切り替えた場合の挙動が未定義である。

**選択肢**:
- A: DnD をキャンセル（`_cancel()` を呼ぶ）してから月切替を行う
- B: 月切替を禁止（ドラッグ中は prev/next ボタンを無効化）
- C: そのまま月切替を行う（ghost は残るが DOM から切り離され孤立する）

**推奨**: A（DnD をキャンセル）。現在 `window.blur` でキャンセルが発火する実装があるため、月切替ボタンのクリックで `_cancel()` を明示的に呼ぶか、または prev/next ハンドラ内で `if (KC.DnD._drag) KC.DnD._cancel()` を追加する。

**管理者承認待ち。確定後、本要件書を更新すること。**

### 10.3 短い終日バー（1 列幅）での左右ハンドルの重なり（未確定）

1 列幅（最小スパン）の終日バーでは左端ハンドルと右端ハンドルが横方向に重なる可能性がある。

**選択肢**:
- A: `min-width: 24px` を設定し両ハンドルが重ならない最小幅を保証する
- B: 重なりを許容する（機能的には動作する）

**推奨**: A。CSS で `.kc-ad-event { min-width: 24px; }` を追加する。

**管理者承認待ち。確定後、本要件書を更新すること。**

### 10.4 chip の cursor スタイル（未確定）

chip に `cursor: grab` を追加する際、既存の `cursor: pointer`（クリック用）との優先順位が問題になる可能性がある。

**選択肢**:
- A: `cursor: grab` を chip の通常スタイルとし、DnD 対応の意図を明示する
- B: `cursor: pointer` のまま維持（DnD も動作するが視覚的な示唆がない）

**推奨**: A（`cursor: grab` で一貫性を保つ）。

**管理者承認待ち。確定後、本要件書を更新すること。**

---

## 参照した既存実装行番号（サマリ）

| 内容 | ファイル:行番号 |
|---|---|
| `KC.DnD` モジュール全体 | `src/kc-calendar.js:682–1553` |
| `_adcellFromX`（週ビュー列判定） | `src/kc-calendar.js:700–708` |
| `_buildAlldayGhost` / `_positionAlldayGhost` | `src/kc-calendar.js:717 / 754` |
| `_cancel`（共通キャンセル） | `src/kc-calendar.js:792–822` |
| `_commitOptimistic`（楽観的 UI 更新） | `src/kc-calendar.js:830–864` |
| `startMoveAllday` / `startResizeAllday` | `src/kc-calendar.js:990 / 1083` |
| `_buildTimeGhost`（position: fixed 方式の参考） | `src/kc-calendar.js:1187–1210` |
| `_getWeekYMDs`（週 YMD 取得） | `src/kc-calendar.js:1520–1531` |
| `KC.RenderMonth.renderGrid` | `src/kc-calendar.js:2457–2460` |
| `buildMonthAlldayBar`（月ビュー終日バー生成） | `src/kc-calendar.js:2563–2601` |
| `buildMonthChip`（月ビュー chip 生成） | `src/kc-calendar.js:2608–2639` |

---

*本要件定義書: 章数 10、受け入れ条件 24 件、未確定事項 4 件（§10.1〜§10.4）。2026-05-08 初版。*
