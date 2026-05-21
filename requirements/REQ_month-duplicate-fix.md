# 要件定義書: 月ビュー chip 二重表示バグ修正

**文書番号**: REQ_month-duplicate-fix
**作成日**: 2026-05-21
**最終更新日**: 2026-05-21（確定版 第 1 版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `plugin/src/js/desktop.js`
**対象ファイル（従／同期対象）**: `src/kc-calendar.js`
**ステータス**: 確定版 第 1 版（修正方針 A 案採用・確定）

### 更新履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-21 | 確定版 第 1 版 | 修正方針 A 案採用を確定。§3 機能要件に DnD ゴースト副作用対策セレクタを明示。§6 推奨案・§7 未確定事項を確定済みに更新。B 案・C 案を将来の検討候補として §7 に記録 |
| 2026-05-21 | ドラフト 第 1 版 | 初版作成。コード調査完了。修正方針 3 案を提示。未確定事項として修正方針の選択を残す |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（既存実装の調査結果）](#2-現状分析既存実装の調査結果)
3. [要件](#3-要件)
4. [受入基準](#4-受入基準)
5. [検証項目・テストシナリオ](#5-検証項目テストシナリオ)
6. [想定 UX / シーケンス](#6-想定-ux--シーケンス)
7. [未確定事項・リスク・前提](#7-未確定事項リスク前提)

---

## 1. 背景・目的

### 1.1 報告された現象

検証用アプリ k/891/ の月ビューで 5/25 セルに「00:00 タイトル」chip が 2 行並んで表示される。

**対象レコード（id=1）:**
- タイトル: タイトル
- start: `2026-05-24T15:00:00Z`（JST 2026-05-25 00:00:00）
- end: `2026-05-25T15:00:00Z`（JST 2026-05-26 00:00:00）
- allday: false（時間予定）

**再現条件:**
- リロード直後に再現性が高い
- 月→週→月とビュー切替後は 1 行表示に戻ることが多い（タイミング依存）

### 1.2 目的

`placeMonthEvents()` の重複呼び出しによって chip が二重に DOM に挿入される根本原因を特定し、1 件の予定が常に 1 個の chip として描画されるよう修正する。

### 1.3 関連要件定義書

| 文書 | 関係 |
|---|---|
| `requirements/REQ_month-view.md` | 月ビュー実装仕様（chip 描画ロジックの原設計） |
| `requirements/REQ_overlap-rendering.md` | 週/日ビューの重なり描画改善（月ビュー chip は対象外） |

---

## 2. 現状分析（既存実装の調査結果）

### 2.1 「タイトル」予定の分類判定

**調査ファイル**: `plugin/src/js/desktop.js`

`KC.Lanes.timedEventToBarPosition`（`desktop.js:2613–2653`）は時間予定が「日跨ぎバー」か「単日 chip」かを判定する。

```
対象予定: start=2026-05-25T00:00:00+09:00, end=2026-05-26T00:00:00+09:00
e.getHours()===0 && e.getMinutes()===0 && e.getSeconds()===0 → true
  → endDate を -86400000ms（前日）に補正: 2026-05-25
evStartYMD = '2026-05-25'
evEndYMD   = '2026-05-25'（補正後）
evStartYMD === evEndYMD → true → null を返す（単日 chip 扱い）
```

**結論**: 「タイトル」予定は `timedEventToBarPosition` が `null` を返すため、**単日 chip（`placeMonthTimedEvents`）ルートで描画**される。日跨ぎバーとしては描画されない。

### 2.2 `placeMonthEvents()` の呼び出し経路

**調査ファイル**: `plugin/src/js/desktop.js:4086–4158`（`placeMonthEvents`）

`placeMonthEvents()` はセルの chip・spacer を `appendChild` で追記するのみで、**呼び出し前に chip 要素をクリアする処理を持たない**。

`renderGrid()` は `gridEl.innerHTML = ''` でセル全体を再構築するため、通常は前回の chip は消去される（`desktop.js:3510`）。ただし **`placeMonthEvents()` が `renderGrid()` を伴わずに単独で呼ばれた場合**、既存 chip の上に新たな chip が追記される。

`placeMonthEvents()` の呼び出し箇所:

| 場所 | 行番号 | 呼び出し方 | renderGrid 直後か |
|---|---|---|---|
| `KC.RenderMonth.refresh()` 内 | 4186–4188 | `requestAnimationFrame(placeMonthEvents)` | はい（`renderGrid()` 後に RAF） |
| `KC.Render.renderGrid()` ファサード | 4774–4775 | `requestAnimationFrame(KC.RenderMonth.placeMonthEvents)` | はい（ファサード内の `renderGrid()` 後に RAF） |
| resize ハンドラ | 6287–6288 | `requestAnimationFrame(KC.RenderMonth.placeMonthEvents)` | はい（`KC.RenderMonth.renderGrid()` 後に RAF） |

### 2.3 初回リロード時の実行シーケンス（二重呼び出しの発生パス）

`KC.Boot.init()` の末尾で `R.refresh()`（= `KC.Render.refresh()`）が呼ばれる（`desktop.js:6344`）。

```
KC.Render.refresh()                      ← 月ビュー時のエントリポイント
  └─ setActiveView('month')
  └─ await KC.RenderMonth.refresh()      ← 内部実装を追う
        ├─ renderGrid()  ←内部直接呼出し（仮描画）
        │    ※ KC.Render.renderGrid() ファサードは通過しない
        ├─ await loadEvents()
        ├─ renderGrid()  ←内部直接呼出し（2 回目・データあり）
        │    ※ KC.Render.renderGrid() ファサードは通過しない
        └─ requestAnimationFrame(placeMonthEvents)  ← キュー A
  └─ refreshTitle()
```

上記シーケンス単独では二重呼び出しは発生しない（`KC.Render.renderGrid()` ファサードは通過していないため）。

**しかし**、`KC.RenderMonth.refresh()` は内部で `renderGrid()` を直接呼ぶため、`KC.Render.renderGrid()` ファサードが登録する「RAF で `placeMonthEvents()` を呼ぶ」ロジックが**走らない**。これは正常動作である。

### 2.4 二重呼び出しが発生する具体的な条件（タイミング依存の根拠）

リロード直後に二重表示が発生するケースとして、以下の **2 段階 RAF 競合**が最有力:

**シナリオ: `KC.Boot.init()` の非同期完了前後でファサードが呼ばれた場合**

`KC.Boot.init()` は `async` であるが、`kintone.events.on('app.record.index.show', ...)` のコールバックは `KC.Boot.init()` を `await` せずに return する（`desktop.js:6387`）。kintone の view 初期化処理が完了した後、**kintone 内部のイベントが再発火するタイミングによっては `KC.Render.refresh()` が複数回呼ばれる**可能性がある。

また `KC.Boot.init()` 末尾の `R.refresh()` は async の Promise が pending 中に呼ばれる `KC.Render.refresh()` と並走する場合がある。

**より確実な競合パス（コード証拠あり）:**

`KC.Render.renderGrid()` ファサード（`desktop.js:4764–4784`）は、月ビューのとき必ず `requestAnimationFrame(KC.RenderMonth.placeMonthEvents)` を登録する。このファサードは `KC.SearchFilter.setQuery`（`desktop.js:5081`）、`KC.FilterDropdown`（`desktop.js:5442`）、`KC.EventFilter` など複数箇所から呼ばれる。

`KC.Boot.init()` 内での `KC.SearchFilter.buildDOM` / `KC.FilterDropdown.init` 初期化時に内部的に renderGrid が呼ばれるパスが存在した場合、またはリサイズ観測の `ResizeObserver`（`desktop.js:6293–6297`）がページロード直後に発火した場合、`placeMonthEvents()` が 2 回 RAF キューに積まれうる。

### 2.5 クリア処理の不在（設計上の脆弱性）

`placeMonthEvents()` は前回の描画を前提として追記するため、**`renderGrid()` による完全な DOM 再構築が保証されていない状況で呼ばれると chip が重複する**。

現実装では `placeMonthTimedEvents`（`desktop.js:4023–4065`）が `spacer` のみ `querySelector` で再利用チェックするが、`.kc-month-chip` の重複については一切チェックしていない。

### 2.6 仮説の評価まとめ

| 仮説 | コード根拠 | 評価 |
|---|---|---|
| 境界時刻の二重カウント（end=翌0:00 が 2 日に重なる） | `timedEventToBarPosition` が 0:00 補正で evEndYMD=5/25 にするため 5/26 には重ならない | **否定** |
| span 判定と chip 判定の競合（両方発火） | `timedEventToBarPosition` が null を返すため、span パスには入らない | **否定** |
| 描画キャッシュ・再描画問題（placeMonthEvents の重複呼び出し） | `placeMonthEvents` に chip クリア処理がなく、RAF 二重登録が発生しうる | **最有力** |
| タイムゾーン境界の処理ミス | 0:00 補正ロジックが正しく動作し単日扱いになる | **否定**（分類は正しい。二重呼び出しが本質） |

---

## 3. 要件

### 3.1 機能要件

#### FR-1: chip の重複描画を防止する（A 案: `placeMonthEvents()` 冒頭でのクリアによる冪等化）

月ビューの任意のセルに対して `placeMonthEvents()` を複数回呼び出しても、1 件の予定が 1 個の chip として描画されること。

**実装方針（確定）**: `placeMonthEvents()` の冒頭で、各セル内の chip 系要素を事前クリアしてから再描画する。これにより `placeMonthEvents()` が何回呼ばれても冪等になる。

| 属性 | 内容 |
|---|---|
| 対象 | 月ビューのすべての予定（時間予定 chip、終日バー、日跨ぎバーを含む） |
| 対象ビュー | 月ビューのみ |
| トリガー条件 | リロード直後・ビュー切替・リサイズ・フィルタ操作など、あらゆる `placeMonthEvents()` 呼び出し |

#### FR-1a: DnD ゴースト要素を誤って除去しない

クリア処理のセレクタは DnD 操作中のゴースト要素（`.kc-event--ghost` クラスが付加された chip）を除外すること。

**確定セレクタ仕様**:

- クリア対象（時間予定 chip）: `.kc-month-chip:not(.kc-event--ghost)`
- クリア対象（終日バー chip）: `.kc-ad-event--month:not(.kc-event--ghost)`
- クリア対象（spacer / more）: `.kc-month-chip-spacer`、`.kc-month-more`（ゴーストクラスが付与されないため除外不要）

**根拠**: DnD 操作中に `placeMonthEvents()` が呼ばれた場合、`.kc-event--ghost` クラスを持つ要素はドラッグ中のビジュアルフィードバックであるため除去してはならない。

#### FR-2: タイミング依存の挙動を排除する

「リロード直後に再現し、ビュー切替後は解消する」という挙動がなくなること。すなわち初回描画と再描画で同一の chip 数が表示される。

#### FR-3: 既存の chip ロジックへの影響を最小化する

chip のクリック（`KC.Popup.openEdit`）、DnD（`KC.DnD`）、`+N more` 表示、`applyHighlight` の各機能が修正後も正常動作すること。

### 3.2 非機能要件

| ID | 要件 | 補足 |
|---|---|---|
| NFR-1 | パフォーマンス | `placeMonthEvents()` のループ処理に追加の DOM 走査が生じる場合は最小限に留める |
| NFR-2 | プラグイン実機確認 | `plugin/dist/plugin.zip` を kintone にアップロードし、k/891/ 5/25 セルで chip が 1 個のみ表示されることを確認する（SAML 認証のため手動） |
| NFR-3 | 従ファイル同期 | `plugin/src/js/desktop.js` 修正後、`src/kc-calendar.js` にも同等の変更を同期する（CLAUDE.md 編集ルール準拠） |

---

## 4. 受入基準

Given / When / Then 形式で記述する。

### AC4.1 リロード直後に chip が 1 個のみ表示される

- **Given**: 検証アプリ k/891/ の月ビューに「タイトル」予定（JST 5/25 00:00〜5/26 00:00）が登録されている
- **When**: ページをリロードし、月ビューの 5/25 セルを確認する
- **Then**: 「00:00 タイトル」chip が **1 個のみ**表示される（2 個並ばない）

### AC4.2 ビュー切替後も chip が 1 個のみ表示される

- **Given**: AC4.1 と同じ環境
- **When**: 月→週→月とビュー切替を行い、5/25 セルを確認する
- **Then**: 「00:00 タイトル」chip が **1 個のみ**表示される（リロード直後と同数）

### AC4.3 複数回リロードして再現しない

- **Given**: AC4.1 と同じ環境
- **When**: ページを 5 回連続でリロードする
- **Then**: いずれの場合も 5/25 セルに chip が 1 個のみ表示され、2 個以上にならない

### AC4.4 chip クリックで編集ポップアップが開く（既存挙動維持）

- **Given**: 月ビューで時間予定 chip が表示されている
- **When**: chip をクリックする
- **Then**: `KC.Popup.openEdit(ev.id)` が呼ばれ、編集ポップアップが開く
- **And**: セルへの click イベントが伝播せず、新規作成ポップアップは開かない

### AC4.5 終日バー・日跨ぎバーが二重描画されない

- **Given**: 月ビューに終日予定・日跨ぎ時間予定が存在する
- **When**: リロード直後に月ビューを確認する
- **Then**: 終日バー・日跨ぎバーが各 1 本ずつ描画される（重複なし）

### AC4.9 DnD 操作中にゴースト chip が消えない

- **Given**: 月ビューで時間予定 chip を DnD 操作中（`.kc-event--ghost` クラスが付与された状態）
- **When**: DnD 操作中に `placeMonthEvents()` が呼ばれる（リサイズ等のトリガー）
- **Then**: `.kc-event--ghost` クラスを持つ chip は除去されず、DnD のビジュアルフィードバックが継続して表示される

### AC4.6 `+N more` が正しい件数を表示する

- **Given**: 同一日に表示上限を超える予定がある（例: 終日 3 件 + 時間予定 4 件）
- **When**: リロード直後に月ビューを確認する
- **Then**: 表示可能な件数分の chip/バーが表示され、超過分が `+N more` に正しく集計される（二重カウントが起きない）

### AC4.7 リサイズ後も chip が 1 個のみ表示される

- **Given**: AC4.1 と同じ環境
- **When**: ブラウザウィンドウをリサイズして月ビューを確認する
- **Then**: 5/25 セルに chip が 1 個のみ表示される

### AC4.8 月 REQ_month-view.md の全 AC が合格

- **Given**: 修正後のコードがデプロイされている
- **When**: `REQ_month-view.md §4` の AC4.1〜AC4.25 を確認する
- **Then**: 全ての受入基準が合格する（リグレッションなし）

---

## 5. 検証項目・テストシナリオ

### 5.1 二重表示の境界値テスト

| シナリオ | 確認対象 | 期待結果 |
|---|---|---|
| start=5/24T15:00Z, end=5/25T15:00Z（JST 5/25 0:00〜5/26 0:00） | 5/25 セルの chip 数 | 1 個 |
| start=5/25T00:00+09:00, end=5/25T15:00+09:00（JST 5/25 0:00〜24:00） | 5/25 セルの chip 数 | 1 個 |
| start=5/25T01:00+09:00, end=5/26T01:00+09:00（日跨ぎ） | 5/25〜5/26 のバー数 | 各 1 本（日跨ぎバーで表示） |
| 通常の時間予定（start と end が同日） | 当日セルの chip 数 | 1 個 |
| 終日予定（allday=true） | 当日のバー数 | 1 本 |

### 5.2 placeMonthEvents 呼び出し回数テスト

修正後、ブラウザの DevTools の Console で `placeMonthEvents` の呼び出しタイミングをログ追加して確認する（builder が一時的なデバッグログを挿入し、確認後に削除すること）。

| 操作 | 期待呼び出し回数 |
|---|---|
| 初回リロード後の月ビュー表示 | 1 回（RAF 経由で 1 回のみ） |
| ビュー切替（週→月）後 | 1 回 |
| prev/next ボタン操作後 | 1 回 |
| リサイズ後（debounce 200ms 経過後） | 1 回 |

### 5.3 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| 月ビュー全般 | `REQ_month-view.md §4` AC4.1〜AC4.25 が全合格 |
| 月ビュー DnD | `REQ_month-dnd.md` の全 AC が合格 |
| 週ビュー全般 | `REQ_allday-bar-redesign.md §4` 全 AC が合格 |
| 日ビュー全般 | `REQ_day-view.md §4` AC4.1〜AC4.19 が合格 |
| 重なり描画 | `REQ_overlap-rendering.md §4` AC4.1〜AC4.11 が合格 |

### 5.4 実機確認（SAML 認証環境）

1. `plugin/dist/plugin.zip` を kintone（bushiroad-group.cybozu.com）にアップロードする（手動）
2. k/891/ の月ビューで 2026 年 5 月を表示する
3. 5/25 セルに「00:00 タイトル」chip が 1 個のみ表示されることを目視確認する
4. リロードを 3 回繰り返し、いずれも 1 個のみであることを確認する

---

## 6. 想定 UX / シーケンス

### 6.1 修正方針 A: `placeMonthEvents()` 冒頭でセル内 chip をクリアする【採用・確定】

**概要**: `placeMonthEvents()` が呼ばれるたびに、まず各セルから chip 系要素を除去してから再描画する。DnD ゴースト要素（`.kc-event--ghost`）は除外対象セレクタで保護する（FR-1a 参照）。

**実装イメージ（`plugin/src/js/desktop.js:4086` 付近を変更）:**

```
function placeMonthEvents() {
  if (!_monthRoot) return;
  var gridEl = _monthRoot.querySelector('.kc-month-grid');
  if (!gridEl) return;

  // 追加: chip 系要素を事前クリア（DnD ゴーストは除外）
  var cellEls = Array.from(gridEl.querySelectorAll('.kc-month-cell'));
  cellEls.forEach(function (cellEl) {
    var chips = Array.from(cellEl.querySelectorAll(
      '.kc-month-chip:not(.kc-event--ghost), .kc-ad-event--month:not(.kc-event--ghost), .kc-month-chip-spacer, .kc-month-more'
    ));
    chips.forEach(function (el) { el.parentNode.removeChild(el); });
  });

  // adLayer 内の日跨ぎバー・終日バーもクリアして再描画（ゴーストなし前提）
  var adLayers = Array.from(gridEl.querySelectorAll('.kc-month-ad-events'));
  adLayers.forEach(function (layer) { layer.innerHTML = ''; });

  // 既存の配置ロジック（変更なし）
  ...
}
```

**利点**:
- 実装がシンプル。`placeMonthEvents()` が何回呼ばれても冪等になる
- RAF の二重登録を解消しなくても安全（呼び出し回数に依存しない）

**欠点**:
- 毎回 `querySelector` で全 chip を検索・除去するため、イベント件数が多い場合に DOM 走査コストが増加する

**実装難易度**: 低
**副作用リスク**: 低（DnD ゴースト保護セレクタにより `.kc-event--ghost` 要素は除去されない）

### 6.2 修正方針 B: RAF の二重登録を防ぐ（キャンセル機構の導入）【不採用・将来検討候補】

**概要**: `requestAnimationFrame` で `placeMonthEvents()` をキューに積む前に、前の RAF をキャンセルする。`_placeMonthEventsRafId` などの変数で RAF ID を管理し、新しい RAF 登録時に古い RAF を `cancelAnimationFrame` する。

**実装イメージ（`KC.Render.renderGrid()` ファサード `desktop.js:4764` 付近を変更）:**

```
var _placeRafId = null;

KC.Render.renderGrid = function () {
  ...
  if (KC.State.view === 'month' && KC.RenderMonth) {
    if (_placeRafId) cancelAnimationFrame(_placeRafId);  // 追加
    _placeRafId = requestAnimationFrame(function () {
      _placeRafId = null;  // 追加
      KC.RenderMonth.placeMonthEvents();
      KC.SearchFilter.applyHighlight();
    });
  }
  ...
};
```

同様に `KC.RenderMonth.refresh()` 内の RAF も同じキャンセル変数でガードする。

**利点**:
- RAF の重複登録そのものを解消するため、副作用の根本を断つ
- `placeMonthEvents()` の冪等性に依存しない（chip の重複追記ロジックは変更しない）

**欠点**:
- 変数 `_placeRafId` の管理箇所が分散するため、`KC.RenderMonth.refresh()` と `KC.Render.renderGrid()` ファサードの両方を修正する必要がある
- RAF のキャンセルが正しく機能するには、同一スコープで変数を管理しなければならない（モジュール境界をまたぐ場合は共有変数が必要）
- resize ハンドラ（`desktop.js:6285–6288`）の RAF も同じ変数でガードする必要がある

**実装難易度**: 中
**副作用リスク**: 低〜中（RAF の順序制御を誤ると描画が欠落するリスクあり）

### 6.3 修正方針 C: `placeMonthEvents()` の重複呼び出しを上流で防ぐ（単一エントリポイント化）【不採用・将来検討候補】

**概要**: `KC.RenderMonth.refresh()` が内部で `renderGrid()` を呼ぶパスと `KC.Render.renderGrid()` ファサードが `placeMonthEvents()` を呼ぶパスが並存していることが根本原因である。`KC.RenderMonth.refresh()` の内部呼び出しを `KC.Render.renderGrid()` ファサード経由に統一し、ファサード内の RAF 登録箇所を 1 か所に集約する。

**実装イメージ（`KC.RenderMonth.refresh()` `desktop.js:4163` 付近を変更）:**

```
async function refresh() {
  _ensureMonthDOM();
  _showMonthDOM();

  // 変更: 内部 renderGrid() を KC.Render.renderGrid() 経由に変更（ファサードを通過させる）
  KC.Render.renderGrid();   // 仮描画（データなし）

  var range = gridRange();
  ...
  try {
    S.events = await KC.Api.loadEvents(isoStart, isoEnd);
    KC.Render.renderGrid();  // 本描画（ファサード経由で RAF + placeMonthEvents を 1 回だけ呼ぶ）
    // ← requestAnimationFrame(placeMonthEvents) は削除
  } catch (err) {
    ...
  }
}
```

**利点**:
- `placeMonthEvents()` の呼び出し経路を 1 本化できる
- `KC.Render.renderGrid()` ファサードの RAF 管理のみ修正すれば済む（修正方針 B と組み合わせて完全に解消できる）

**欠点**:
- `KC.RenderMonth.refresh()` が `KC.Render.renderGrid()` に依存することになるため、モジュール間の結合度が高まる
- `KC.TimeSlots.patchRenderGrid()` が `KC.Render.renderGrid` を上書きしているため、仮描画時も `buildTimeSlots` 等が走ろうとするが、月ビュー時は `if (KC.State.view === 'month') return result;` でスキップされるため副作用なし（要確認）
- 仮描画（データなし）と本描画（データあり）の両方でファサードを経由すると、仮描画の RAF が本描画の renderGrid より後に実行される可能性がある（RAF のタイミング制御が複雑化する）

**実装難易度**: 中〜高（タイミング制御の影響範囲が広い）
**副作用リスク**: 中（既存の週ビュー・日ビューのリフレッシュシーケンスへの影響を要確認）

### 6.4 採用案（確定）

**修正方針 A（chip クリア追加による冪等化）のみを採用する。**

- A 採用理由: `placeMonthEvents()` が何回呼ばれても冪等になるため、二重表示バグは確実に解消する。RAF の重複登録そのものは残るが実害がなくなる。実装難易度が低くリスクも低い
- B 不採用理由: A 単独で十分に問題が解消されるため、現時点では実装しない。二重表示バグが再発した場合や RAF の呼び出し回数削減が必要になった際に将来検討する（§7.1 参照）
- C 不採用理由: 修正範囲が広く既存のリフレッシュシーケンスへの影響確認が必要なためリスクが高い。将来的なリファクタリング時に検討する（§7.1 参照）

---

## 7. 未解決事項・リスク・前提

### 7.1 [確定] 修正方針の選択（A 案採用）

**確定内容**: 修正方針 A（`placeMonthEvents()` 冒頭でのクリア追加による冪等化）を採用する。B 案・C 案は不採用。

**確定日**: 2026-05-21

**将来の検討候補（B 案・C 案）**:

| 案 | 再検討トリガー |
|---|---|
| B 案（RAF キャンセル機構） | A 案修正後も二重表示が再発する場合、または RAF の重複呼び出しによるパフォーマンス問題が顕在化した場合 |
| C 案（単一エントリポイント化） | 大規模リファクタリングや月ビューのアーキテクチャ見直しを行う際 |

### 7.2 [前提] 実機検証が必要

kintone は SAML 認証（`MEMORY.md: project_kintone_saml_auth`）のため自動テストが困難。修正後は手動で実機確認が必須（NFR-2）。

### 7.3 [リスク] RAF タイミングの環境依存性

`requestAnimationFrame` の実行タイミングはブラウザ・マシン性能・kintone の画面初期化速度に依存する。今回の二重表示バグが修正方針 A で再現しなくなったとしても、別環境（別 PC / 別ブラウザ）でのリグレッション確認が推奨される。

### 7.4 [対処済] 月ビュー DnD との干渉

A 案のクリア処理で DnD ゴースト要素（`.kc-event--ghost`）が誤って除去されないよう、FR-1a でセレクタを `:not(.kc-event--ghost)` で限定する仕様を確定した。builder は `REQ_month-dnd.md` のゴースト実装（`desktop.js:2103–2130`）を参照してクラス名の衝突がないことを実装時に確認すること。

### 7.5 [前提] UTC/JST 変換は問題なし

仮説 4（タイムゾーン境界の処理ミス）は現状分析（§2.1）でコードを確認した結果、否定される。`timedEventToBarPosition` の 0:00 補正ロジックは正しく動作しており、「タイトル」予定は単日 chip として正しく分類される。修正対象はタイムゾーン処理ではない。

### 7.6 [前提] 調査上の制約

本調査はコードの静的解析のみで行った。`placeMonthEvents()` が実際に何回呼ばれているかは実機での動的計測（§5.2）で確認する必要がある。RAF の二重登録が実際に発生するタイミングはブラウザの Event Loop の実行順序に依存するため、最終的な確認は実機必須である。

---

*本要件定義書は確定版 第 1 版（2026-05-21）。修正方針 A 案採用確定。builder はこの要件定義書を入力として実装を開始すること。*
