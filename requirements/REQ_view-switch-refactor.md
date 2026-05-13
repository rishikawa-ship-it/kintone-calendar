# 要件定義書: ビュー切替責務一元化リファクタリング

**文書番号**: REQ_view-switch-refactor
**作成日**: 2026-05-12
**最終更新日**: 2026-05-13（第 4 版: Step 2 実機検証リグレッションを受け §3.1・§3.2・§4.3 の setActiveView サンプルロジックを修正。共用 DOM 上書き対策を反映）
**作成者**: designer (サブエージェント)
**対象ファイル**: `src/kc-calendar.js`（および `docs/kc-calendar.js` ミラー）
**ステータス**: 確定版（未解決事項 0 件）

### 更新履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-13 | 第 4 版 | Step 2 実機検証でリグレッション発覚 (週ビューが消える) を受け、§3.1/§3.2/§4.3 の setActiveView サンプルロジックを修正。共用 DOM 上書き問題への対策を反映 |
| 2026-05-12 | 第 3 版 | §3.1・§3.2・§4.3 のサンプルコード `show` → `activeDisplay` に統一（reviewer 指摘の追跡可能性確保） |
| 2026-05-12 | 第 2 版 | §8.1・§8.2 確定済みに更新。§3.1・§3.2・§3.3・§4.3・§5.3・§6.2・§8.4 に確定内容を反映 |
| 2026-05-12 | 初版 | コミット `d6aa4d8` 後のレビュー観察事項を受けて新規作成 |

---

## 目次

1. [目的・背景](#1-目的背景)
2. [現状の問題](#2-現状の問題)
3. [設計方針](#3-設計方針)
4. [命名規則](#4-命名規則)
5. [影響範囲](#5-影響範囲)
6. [受け入れ条件（AC）](#6-受け入れ条件ac)
7. [制約・スコープ外](#7-制約スコープ外)
8. [解決済み事項・リスク・前提](#8-解決済み事項リスク前提)

---

## 1. 目的・背景

### 1.1 背景

コミット `d6aa4d8`（日ビュー終日バー描画バグ修正）のレビューで、以下の構造的問題が観察事項として残った。

- `KC.RenderMonth._showWeekDOM` の命名と実際の責務が乖離している
- ビュー切替時に「他ビューの DOM を隠す」処理が複数箇所に散在している
- 直近の修正は対症療法的な防御コードの追加に留まっており、設計の本質的修正になっていない

### 1.2 目的

本リファクタリングの目的は以下の 2 点に集約される。

1. **ビュー切替時の DOM 表示制御責務を 1 関数に一元化する**
2. **`_showWeekDOM` の命名違和感を解消し、将来のビュー追加コストを最小化する**

---

## 2. 現状の問題

### 2.1 問題 1: `_showWeekDOM` の命名と機能の乖離

**所在**: `src/kc-calendar.js:2979–2986`（`KC.RenderMonth` IIFE 内）

```
function _showWeekDOM() {
  var gridWrap = document.querySelector('.kc-grid-wrap');
  if (gridWrap) gridWrap.style.display = '';

  var monthRootEl = _monthRoot || document.getElementById('kc-month-root');
  if (monthRootEl) monthRootEl.style.display = 'none';
}
```

- 関数名は「**週**ビュー DOM を表示」だが、内部で「**月**ビュー DOM を非表示」という別の責務を含んでいる
- `KC.RenderDay.renderGrid`（`src/kc-calendar.js:3789–3791`）からも呼ばれており、命名と呼出元の文脈が不一致
- `KC.RenderMonth` モジュール（月ビュー専用）が「週ビュー DOM を表示する」処理を抱えるのは責務の逸脱
- `REQ_day-view.md §3.1`「月ビューから日ビューへの切替時は `KC.RenderMonth._showWeekDOM()` を呼んで `.kc-grid-wrap` を再表示する」と仕様書にも命名違和感が波及済み

### 2.2 問題 2: ビュー切替クリーンアップの分散

ビュー切替時に「他ビューの DOM を隠す」処理が 3 箇所に分散している。

| 箇所 | ファイル:行番号 | 内容 |
|---|---|---|
| `KC.Render.refresh` | `src/kc-calendar.js:3851–3853` | `view !== 'month'` なら `_showWeekDOM()` を呼ぶ |
| `KC.RenderDay.renderGrid` | `src/kc-calendar.js:3789–3791` | 月ビュー残留への防御として `_showWeekDOM()` を再呼出 |
| `KC.RenderMonth._showWeekDOM` | `src/kc-calendar.js:2983–2985` | `_monthRoot` が null の場合に `getElementById` でフォールバック |

将来に 4 つ目のビュー（例: 年ビュー）を追加する場合、上記 3 箇所それぞれに対応する修正が必要になり、修正漏れによるリグレッションリスクが高い。

### 2.3 現状の DOM ルート構造（参考）

| ビュー | DOM ルート要素 | セレクタ / ID | 管理モジュール |
|---|---|---|---|
| 週ビュー | `.kc-grid-wrap` | `document.querySelector('.kc-grid-wrap')` | `KC.RenderWeek` |
| 月ビュー | `#kc-month-root` | `document.getElementById('kc-month-root')` | `KC.RenderMonth`（`_monthRoot` 変数でキャッシュ）|
| 日ビュー | `.kc-grid-wrap`（週ビューと共用）| `--kc-col-count: 1` で 1 列化 | `KC.RenderDay` |

日ビューは週ビューと同じ `.kc-grid-wrap` を共用するため、切替時に「月ビューだけ隠す」処理で済む。

### 2.4 現状のビュー切替フロー

```
[ユーザー操作]
  KC.ViewDropdown の <li> クリック
    → choose(value, label) で KC.State.view = value
    → KC.Render.refresh()

[KC.Render.refresh — src/kc-calendar.js:3846–3866]
  1. (view !== 'month') なら KC.RenderMonth._showWeekDOM()  ← 問題箇所①
  2. _pickModule() でモジュール選択
  3. m.refresh() を await

[KC.RenderMonth.refresh — src/kc-calendar.js:3390–3419]
  1. _ensureMonthDOM()
  2. _showMonthDOM()  ← .kc-grid-wrap を非表示・_monthRoot を表示

[KC.RenderDay.renderGrid — src/kc-calendar.js:3784–3796]
  1. --kc-col-count を 1 にセット
  2. KC.RenderMonth._showWeekDOM()  ← 問題箇所②（防御的再呼出）
  3. renderDayHeaders() / renderAlldayRow() / renderRows() / placeEvents()
```

---

## 3. 設計方針

### 3.1 一元化エントリポイントの設計

**新規関数 `KC.Render.setActiveView(viewName)` を導入する**。

この関数が「現在のビューのみ表示、他はすべて `display:none`」を責任を持って実行する。呼出元は `KC.Render.refresh` の冒頭 1 箇所のみとする。

**§8.1 確定判定の反映**: `#kc-month-root` の CSS 初期値は `display: none`（`src/kc-calendar.css:775–784`）のため、月ビュー表示時は `display: ''`（CSS 規定値に戻す）では再び `none` に戻ってしまう。そのため `setActiveView` では `display` の具体値を各 View ごとに明示する設計を採用する。

**§8.2 確定判定の反映**: `KC.Render` の IIFE 化は行わない（C 案採用）。`VIEW_ROOTS` は `setActiveView` 関数内のローカル定数として定義する。

```javascript
/**
 * 指定ビューの DOM ルートを表示状態にし、他ビューの DOM ルートを非表示にする。
 * ビュー切替に伴う DOM 表示制御の唯一のエントリポイント。
 * 同一 DOM を共用するビュー (week/day は .kc-grid-wrap 共用) を考慮し、
 * active view の el を識別したうえで、それ以外の el のみ display:'none' を適用する。
 * @param {string} viewName - 'week' | 'month' | 'day'
 */
setActiveView: function (viewName) {
  // VIEW_ROOTS: ビュー名 → { el取得関数, 表示時のdisplay値 } のレジストリ
  // KC.Render はオブジェクトリテラルのため IIFE 化せず、ローカル定数で定義する（C 案）
  // activeDisplay: 表示時に適用する display 値（month は CSS 初期値 none を上書きするため 'flex' を明示）
  var VIEW_ROOTS = {
    week:  { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' },
    month: { el: function () { return document.getElementById('kc-month-root'); }, activeDisplay: 'flex' },
    day:   { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' }
    // 将来ビューを追加する場合はここに 1 エントリ追加するだけで済む
  };
  var activeEntry = VIEW_ROOTS[viewName];
  var activeEl = activeEntry ? activeEntry.el() : null;
  // 非表示ループ: active と同じ要素は触らない (共用 DOM の上書き回避)
  Object.keys(VIEW_ROOTS).forEach(function (v) {
    var el = VIEW_ROOTS[v].el();
    if (!el || el === activeEl) return;
    el.style.display = 'none';
  });
  // 表示設定: active view の el を最後に activeDisplay で明示
  if (activeEl) {
    activeEl.style.display = activeEntry.activeDisplay;
  }
},
```

### 3.2 View ルート DOM レジストリの設計

`VIEW_ROOTS` は `setActiveView` 関数内のローカル定数として定義する（§8.2 C 案確定）。各エントリは DOM 取得関数と「表示時の `display` 値」をペアで持つ。

```javascript
// setActiveView 内のローカル定数（KC.Render はオブジェクトリテラルを維持）
// activeDisplay: 表示時に適用する display 値（実装では activeDisplay プロパティ名を使用）
var VIEW_ROOTS = {
  week:  { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' },
  month: { el: function () { return document.getElementById('kc-month-root'); }, activeDisplay: 'flex' },
  day:   { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' }
  // 将来ビューを追加する場合はここに 1 エントリ追加するだけで済む
};
```

**設計意図**:
- `week` と `day` が同じ `.kc-grid-wrap` を返すため、両者のうち一方が active のときは `.kc-grid-wrap` が表示状態になる
- `month` が active のときは `#kc-month-root` が `display: 'flex'` で表示、`.kc-grid-wrap` が `display: 'none'` で非表示になる
- `month` の `activeDisplay: 'flex'` を明示する理由: `src/kc-calendar.css:775–784` で `.kc-month-root { display: none; }` が定義されており、`display: ''` では CSS の `none` に戻ってしまうため（§8.1 確定判定）
- `week` / `day` の `activeDisplay: ''`（空文字）: `.kc-grid-wrap` の CSS 初期値は `none` ではないため、空文字で CSS 規定値に戻す方式で問題ない
- **week と day が同じ要素を返すため、forEach 単純ループでは day 反復が week を上書きしてしまう問題がある。よって setActiveView は active view の el を識別したうえで非表示ループを実行する設計とする**（§3.1 サンプル参照。2026-05-13 第 4 版で修正済み）

### 3.3 `KC.RenderMonth._showMonthDOM` との整合

現状の `_showMonthDOM`（`src/kc-calendar.js:2965–2972`）は `KC.RenderMonth.refresh` から呼ばれ、`.kc-grid-wrap` を隠す処理と `_monthRoot.style.display = 'flex'` の 2 つの責務を持つ。

**§8.1 確定判定の反映**:

`setActiveView('month')` が `#kc-month-root` を `display: 'flex'` で表示するため、`_showMonthDOM` の `flex` 明示処理との二重適用になる。これは問題ないが、`_showMonthDOM` 内の `.kc-grid-wrap` 非表示処理（`gridWrap.style.display = 'none'`）は `setActiveView` が担うことになり冗長になる。

Step 5 で `_showMonthDOM` を以下のように簡素化する（`.kc-grid-wrap` 非表示処理を削除）:

```javascript
// Step 5 適用後の _showMonthDOM（簡素化版）
function _showMonthDOM() {
  // setActiveView('month') が .kc-grid-wrap の非表示と #kc-month-root の表示を担う。
  // ここでは _monthRoot の flex 明示のみ行う（CSS 初期値 none への安全弁として残す）。
  if (_monthRoot) _monthRoot.style.display = 'flex';
}
```

`_showMonthDOM` の完全廃止（return 節からの除去）は、呼出元がないことを確認したうえで将来タスクとして検討する。

### 3.4 `KC.Render.refresh` の変更

```javascript
// 変更前（src/kc-calendar.js:3846–3853）
refresh: async function () {
  var root = document.getElementById('kc-root');
  if (!root) return;

  // 週ビューに戻った場合は月ビュー DOM を非表示にして週ビューを復帰させる
  if (KC.State.view !== 'month' && KC.RenderMonth && KC.RenderMonth._showWeekDOM) {
    KC.RenderMonth._showWeekDOM();
  }
  // ...

// 変更後
refresh: async function () {
  var root = document.getElementById('kc-root');
  if (!root) return;

  // ビュー切替: 現在の view のみ表示、他を非表示にする（唯一のエントリポイント）
  this.setActiveView(KC.State.view);
  // ...
```

### 3.5 防御コードの削除条件

以下の防御コードは `KC.Render.setActiveView` が確実に動作することが確認された後に削除する。

| 削除対象 | 所在 | 削除条件 |
|---|---|---|
| `KC.RenderDay.renderGrid` 内の `_showWeekDOM()` 再呼出 | `src/kc-calendar.js:3789–3791` | `KC.Render.refresh` → `setActiveView` の動作確認後 |
| `KC.RenderMonth._showWeekDOM` 内の `getElementById` フォールバック | `src/kc-calendar.js:2983–2985` | `_showWeekDOM` 自体の廃止後 |
| `_monthRoot` null フォールバック（`_showWeekDOM` 内） | `src/kc-calendar.js:2984` | `_showWeekDOM` 自体の廃止後 |

### 3.6 段階的リファクタリング計画

リグレッションリスクを最小化するため、以下の順序で実施する。

```
Step 1: KC.Render に VIEW_ROOTS レジストリと setActiveView を追加
         → 既存の _showWeekDOM / _showMonthDOM はそのまま残す（二重処理だが安全）
         → 月 ⇆ 週 ⇆ 日の往復切替で全 view が正常動作することを確認

Step 2: KC.Render.refresh の冒頭の _showWeekDOM() 呼出を setActiveView に置き換える
         → 改めて往復切替の動作確認

Step 3: KC.RenderDay.renderGrid 内の _showWeekDOM() 防御コードを削除する
         → 日ビューへの直接切替でリグレッションがないことを確認

Step 4: _showWeekDOM 関数の廃止
         → KC.RenderMonth の return から _showWeekDOM を除去
         → REQ_day-view.md §3.1 の記述を新 API 名に更新（§5.2 参照）
         → DESIGN.md §4.8 の記述を確認・更新

Step 5: _showMonthDOM の簡素化（オプション）
         → KC.Render.setActiveView が確実に動作しているため、
           _showMonthDOM の .kc-grid-wrap 非表示処理は冗長になる
         → 削除または簡素化を判断（§8.1 参照）
```

---

## 4. 命名規則

### 4.1 `_showWeekDOM` の廃止と代替案

| 候補 | 配置 | 評価 |
|---|---|---|
| `KC.Render.setActiveView(viewName)` | `KC.Render` | **推奨**。「アクティブにするビューを設定する」という責務が明確。`KC.Render` 配置により全ビューへのアクセス権が自然に確保できる |
| `KC.Render._toggleViewVisibility(viewName)` | `KC.Render` | 許容。`toggle` は「切り替える」の意味で適切だが、`set` より能動的でやや命名が弱い |
| `KC.ViewSwitcher.activate(viewName)` | 新モジュール `KC.ViewSwitcher` | モジュール分割が明確になるが、新モジュール追加のオーバーヘッドが発生する。現時点では過剰 |

**採用**: `KC.Render.setActiveView(viewName)` — 既存の `KC.Render` ファサードに追加する形で、モジュール追加なしに責務を集約できる。

### 4.2 `_showMonthDOM` の扱い

`_showMonthDOM` は `KC.RenderMonth.refresh` の内部から呼ばれており、月ビューの DOM 確保後に表示を切り替えるという文脈では命名は妥当。ただし、`KC.Render.setActiveView` が導入された後は内部で `.kc-grid-wrap` を隠す責務が重複する。

- **短期方針**: `_showMonthDOM` は `_monthRoot.style.display = 'flex'` のみに簡素化し、`.kc-grid-wrap` 非表示処理を削除
- **長期方針**: `_ensureMonthDOM` と統合し、DOM 生成と表示状態を分離した設計に整理（将来タスク）

### 4.3 VIEW_ROOTS レジストリの配置（確定: C 案）

**§8.2 確定判定**: `KC.Render` の IIFE 化は行わない。`VIEW_ROOTS` は `setActiveView` 関数内のローカル定数として定義する（C 案採用）。

```javascript
// KC.Render はオブジェクトリテラルのまま維持
KC.Render = {
  setActiveView: function (viewName) {
    // ローカル定数として VIEW_ROOTS を定義（IIFE 化不要）
    // activeDisplay: 表示時に適用する display 値（実装では activeDisplay プロパティ名を使用）
    var VIEW_ROOTS = {
      week:  { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' },
      month: { el: function () { return document.getElementById('kc-month-root'); }, activeDisplay: 'flex' },
      day:   { el: function () { return document.querySelector('.kc-grid-wrap'); },  activeDisplay: '' }
    };
    var activeEntry = VIEW_ROOTS[viewName];
    var activeEl = activeEntry ? activeEntry.el() : null;
    // 非表示ループ: active と同じ要素は触らない (共用 DOM の上書き回避)
    Object.keys(VIEW_ROOTS).forEach(function (v) {
      var el = VIEW_ROOTS[v].el();
      if (!el || el === activeEl) return;
      el.style.display = 'none';
    });
    // 表示設定: active view の el を最後に activeDisplay で明示
    if (activeEl) {
      activeEl.style.display = activeEntry.activeDisplay;
    }
  },
  // ... 既存のプロパティをそのまま維持
};
```

**C 案採用の理由**（§8.2 確定判定より）:
- KISS / YAGNI 原則。`KC.Render` を IIFE 化するグローバル露出ユースケースが現プロジェクトにない
- 変更量が最小で既存コードへの影響が局所的
- 将来 B 案（`KC.Render._viewRoots` プロパティ化）へ昇格する場合も差分は小さく容易

---

## 5. 影響範囲

### 5.1 修正対象ファイル

| ファイル | 変更理由 |
|---|---|
| `src/kc-calendar.js` | 本リファクタリングの実装正本 |
| `docs/kc-calendar.js` | `src/` の同期ミラー（CLAUDE.md ルール） |

### 5.2 既存ドキュメントへの波及

| ファイル | 該当箇所 | 必要な更新内容 |
|---|---|---|
| `requirements/REQ_day-view.md` | §3.1「月ビューから日ビューへの切替時は `KC.RenderMonth._showWeekDOM()` を呼んで `.kc-grid-wrap` を再表示する」 | `KC.Render.setActiveView('day')` を `KC.Render.refresh` が呼ぶという記述に変更 |
| `DESIGN.md` | §4.8「`KC.Render` ファサード」の `refresh()` 説明 | ビュー切替時の DOM 表示制御フローを更新。`_showWeekDOM` への言及を削除 |
| `requirements/REQ_day-view.md` | §9 次タスクへの引き継ぎ | `_showWeekDOM` 呼出のコメントを `setActiveView` に更新 |

> **注意**: 既存ドキュメントの更新は本タスクのスコープ外。`Step 4`（`_showWeekDOM` 廃止）完了後に別タスクとして実施する。

### 5.3 既存テスト・実機検証観点

リグレッションが出やすい操作パターンと確認観点を以下に整理する。

| 操作パターン | 確認観点 |
|---|---|
| 月 → 週 切替 | `.kc-grid-wrap` が表示（`display: ''`）、`#kc-month-root` が `display: 'none'` になること |
| 週 → 月 切替 | `#kc-month-root` が `display: 'flex'` で表示、`.kc-grid-wrap` が `display: 'none'` になること |
| 月 → 日 切替 | `.kc-grid-wrap` が表示（`display: ''`）、`--kc-col-count` が `1`、`#kc-month-root` が `display: 'none'` になること |
| 日 → 月 切替 | `#kc-month-root` が `display: 'flex'` で表示、`.kc-grid-wrap` が `display: 'none'` になること |
| 週 → 日 切替 | `.kc-grid-wrap` が引き続き表示（`display: ''`）、`--kc-col-count` が `1` になること |
| 日 → 週 切替 | `.kc-grid-wrap` が引き続き表示、`--kc-col-count` が `7` に戻ること |
| 月 → 日 → 月（往復）| 2 回目の月ビューで `#kc-month-root` が `display: 'flex'` になりグリッドが正常描画されること |
| 連続高速切替（4 回以上）| DOM 表示状態が最終 view と一致していること |
| 初回ロード（月ビュー初期状態）| `#kc-month-root` 未生成状態（`getElementById` が null を返す）で週・日への切替が正常動作すること |

---

## 6. 受け入れ条件（AC）

### AC6.1 ビュー切替の DOM 表示制御が `setActiveView` に一元化されている

- **Given**: `KC.Render.refresh` が呼ばれる
- **When**: `KC.State.view` が `'week'`, `'month'`, `'day'` のいずれかである
- **Then**: `KC.Render.setActiveView(KC.State.view)` が必ず呼ばれる
- **And**: `setActiveView` 以外の箇所で `style.display` によるビュー DOM の表示切替が行われていない
- **And**: setActiveView 自体のループが共用 DOM を上書きしないこと (週/日切替時に `.kc-grid-wrap` が `display:''` のまま保たれること)

### AC6.2 月ビューへの切替で週ビュー DOM が必ず非表示になる

- **Given**: 週ビューが表示されている
- **When**: ViewDropdown で「月」を選択する
- **Then**: `.kc-grid-wrap` の `display` が `'none'` になる
- **And**: `#kc-month-root` の `display` が `'flex'` に明示される（CSS 初期値 `none` を上書きする形で表示状態になること）
- **And**: 月グリッドが正常に描画される

### AC6.3 週ビューへの切替で月ビュー DOM が必ず非表示になる

- **Given**: 月ビューが表示されている
- **When**: ViewDropdown で「週」を選択する
- **Then**: `#kc-month-root` の `display` が `'none'` になる
- **And**: `.kc-grid-wrap` が表示状態（`display !== 'none'`）になる
- **And**: 週グリッドが正常に描画される

### AC6.4 日ビューへの切替で月ビュー DOM が必ず非表示になる

- **Given**: 月ビューが表示されている（`#kc-month-root` が `display: flex` の状態）
- **When**: ViewDropdown で「日」を選択する
- **Then**: `#kc-month-root` の `display` が `'none'` になる
- **And**: `.kc-grid-wrap` が表示状態（`display: ''`）で `--kc-col-count` が `1` になる
- **And**: 日グリッドが正常に描画される

### AC6.5 `KC.RenderDay.renderGrid` 内に `_showWeekDOM` の防御コードが残っていない

- **Given**: Step 3 のリファクタリングが完了している
- **When**: `src/kc-calendar.js` の `KC.RenderDay.renderGrid` を確認する
- **Then**: `_showWeekDOM()` の呼出が存在しない
- **And**: 日ビューへの切替で月ビュー DOM が正しく非表示になること（AC6.4 を引き続き満たすこと）

### AC6.6 `_showWeekDOM` 関数が廃止されている

- **Given**: Step 4 のリファクタリングが完了している
- **When**: `src/kc-calendar.js` を検索する
- **Then**: `_showWeekDOM` の定義も呼出も存在しない
- **And**: `KC.RenderMonth` の公開 API（return 節）に `_showWeekDOM` が含まれていない

### AC6.7 将来ビュー追加時の修正箇所が `VIEW_ROOTS` の 1 行のみで済む

- **Given**: `KC.Render` に `VIEW_ROOTS` レジストリが実装されている
- **When**: 4 つ目のビュー（例: `'year'`）を追加することを想定する
- **Then**: `VIEW_ROOTS` への 1 行追加（`year: function () { ... }`）以外に、ビュー切替の DOM 表示制御に関するコードの変更が不要である

### AC6.8 月 ⇆ 週 ⇆ 日 の往復切替でリグレッションがない

- **Given**: リファクタリングが完了している
- **When**: ViewDropdown で月 → 週 → 日 → 月 → 日 → 週 の順に切替操作を行う
- **Then**: 各切替後に正しいビューが描画される
- **And**: 終日イベントバー・時刻スロット・祝日表示が各ビューで正常に表示される
- **And**: `REQ_month-view.md §4` の全 AC および `REQ_day-view.md §4` の全 AC が引き続き合格する

### AC6.9 src / docs 同期

- **Given**: `src/kc-calendar.js` を変更した
- **When**: 変更をコミットする前
- **Then**: `docs/kc-calendar.js` が同一内容に同期されている（CLAUDE.md ルール準拠）

---

## 7. 制約・スコープ外

### 7.1 絶対に触らないスコープ

| 対象 | 理由 |
|---|---|
| 時間レーン関連（`.kc-rows` / `.kc-time-col` / 時間グリッドのレンダリングロジック） | Phase 2（時間予定 DnD）に依存する領域であり、本リファクタとは完全に独立している |
| イベント描画ロジック（`buildAlldayBar` / `placeEvents` / `placeMonthEvents` / DnD 系） | ビュー切替の DOM 表示制御とは無関係 |
| フィールド型・DATE / DATETIME 判定 | ビュー切替とは無関係 |
| `KC.Api` / `KC.Dialog` / `KC.TimeSlots` | 本リファクタの影響範囲外 |
| CSS ファイル（`kc-calendar.css`） | DOM の `display` 属性を JS で制御する本リファクタでは CSS 変更不要 |

### 7.2 本リファクタのスコープ

本リファクタリングは **ビュー切替時の DOM 表示制御の責務一元化** に限定する。具体的には以下のみ。

- `KC.Render.setActiveView(viewName)` の新規追加と `VIEW_ROOTS` レジストリの定義
- `KC.Render.refresh` の冒頭処理の置き換え（`_showWeekDOM()` → `setActiveView()`）
- `KC.RenderDay.renderGrid` 内の防御コード削除（Step 3）
- `KC.RenderMonth._showWeekDOM` 関数の廃止（Step 4）
- `KC.RenderMonth._showMonthDOM` の簡素化（Step 5、オプション）

---

## 8. 解決済み事項・リスク・前提

### 8.1 `#kc-month-root` の CSS 初期 display 値と `setActiveView` の表示指定（解決済み）

**確定判定（2026-05-12 PM・ユーザー合意）**:

`src/kc-calendar.css:775–784` にて `.kc-month-root { display: none; }` が定義されている。同ブロックに `flex-direction: column` 等の flex サブプロパティも記述されているが、`display: none` 状態では機能しない。

この結果、以下が確定した。

- `setActiveView('month')` では `_monthRoot.style.display = 'flex'` を **明示する必要あり**
  - `display: ''` だと CSS の `none` に戻ってしまうため使用不可
- 非表示時（`setActiveView('week')` / `setActiveView('day')`）は `_monthRoot.style.display = 'none'` を明示
- 既存の `_showMonthDOM` の `flex` 明示ロジックは `setActiveView` 内に統合する
- Step 5 での `_showMonthDOM` 簡素化: `.kc-grid-wrap` 非表示処理を削除し、`_monthRoot.style.display = 'flex'` のみを残す安全弁として維持する（§3.3 参照）

**反映箇所**: §3.1（コードサンプル）、§3.2（VIEW_ROOTS の `activeDisplay` 値）、§3.3（`_showMonthDOM` 簡素化方針）、§5.3（検証観点表）、§6.2（AC の `display` 値指定）

### 8.2 `KC.Render` のオブジェクト構造の変更可否（解決済み）

**確定判定（2026-05-12 PM・ユーザー合意）**: **C 案採用**。`KC.Render` の IIFE 化は行わない。`VIEW_ROOTS` は `setActiveView` 関数内のローカル定数として定義する。

| 選択肢 | 内容 | 判定 |
|---|---|---|
| A 案 | `KC.Render` を IIFE にリファクタ（構造変更あり） | 不採用 |
| B 案 | `VIEW_ROOTS` を `KC.Render._viewRoots` プロパティとして定義（グローバル露出） | 不採用 |
| **C 案** | `VIEW_ROOTS` を `setActiveView` 内のローカル定数として定義（IIFE 不要） | **採用** |

**採用理由**: KISS / YAGNI 原則。現プロジェクトにグローバル露出の具体的なユースケースがなく、変更量が最小で既存コードへの影響が局所的。将来 B 案へ昇格する場合も差分は小さく容易。

**反映箇所**: §3.1（コードサンプル）、§3.2（VIEW_ROOTS 定義の注記）、§4.3（確定版コードサンプル）

### 8.3 前提条件

- コミット `d6aa4d8` 以降の状態を実装ベースラインとする
- `KC.RenderDay` の実装は完了済み（`REQ_day-view.md` の AC が合格している状態）
- `KC.RenderMonth` の実装は完了済み（`REQ_month-view.md` の AC が合格している状態）
- 実機検証環境（kintone アプリ）が利用可能であること

### 8.4 リスク

| リスク | 対策 |
|---|---|
| `VIEW_ROOTS` の `.kc-grid-wrap` を week/day が共有することで、forEach 単純ループでは day 反復が week を上書きし、`.kc-grid-wrap` が常に `display:'none'` になる問題 | setActiveView を `active view の el 識別 → 非表示ループ (active と同じ el はスキップ) → 表示設定` の 3 段階で実装。§3.1 サンプル参照。2026-05-13 第 4 版で対応済 (Step 2 実機検証リグレッションを契機に発覚) |
| Step ごとの段階リファクタ中の中間状態でリグレッションが発生する | 各 Step 完了後に AC6.8 の往復切替テストを実施してから次 Step に進む |

> **Note**: 「`display: ''` で意図しない表示状態になる（CSS 初期値が `none` の場合）」のリスクは §8.1 の確定判定により解決済み。`month` の表示には `display: 'flex'` を明示する設計で対処する。

---

## 参照した既存実装行番号（サマリ）

| 内容 | ファイル:行番号 |
|---|---|
| `KC.RenderMonth._showWeekDOM` 定義 | `src/kc-calendar.js:2979–2986` |
| `KC.RenderMonth._showMonthDOM` 定義 | `src/kc-calendar.js:2965–2972` |
| `KC.RenderMonth._monthRoot` 変数宣言 | `src/kc-calendar.js:2782` |
| `KC.RenderMonth._ensureMonthDOM` 定義 | `src/kc-calendar.js:2807–2837` |
| `KC.RenderMonth.refresh` の `_showMonthDOM` 呼出 | `src/kc-calendar.js:3390–3392` |
| `KC.Render.refresh` の `_showWeekDOM` 呼出（問題箇所①） | `src/kc-calendar.js:3851–3853` |
| `KC.RenderDay.renderGrid` の `_showWeekDOM` 呼出（問題箇所②） | `src/kc-calendar.js:3789–3791` |
| `KC.Render._pickModule` | `src/kc-calendar.js:3837–3843` |
| `KC.Render.refresh` | `src/kc-calendar.js:3846–3866` |
| `KC.Render.renderGrid` | `src/kc-calendar.js:3868–3883` |
| `KC.ViewDropdown.choose` の `KC.State.view = value` | `src/kc-calendar.js:4327–4328` |
| `KC.RenderMonth` の公開 API（return 節） | `src/kc-calendar.js:3421–3433` |

---

*本要件定義書: 章数 8、受け入れ条件 9 件（AC6.1〜AC6.9）、未解決事項 0 件、段階的リファクタ計画 5 Step。2026-05-12 初版 → 第 2 版（§8.1・§8.2 確定済み）→ 第 3 版（サンプルコード `show` → `activeDisplay` 統一）→ **第 4 版（setActiveView 共用 DOM 上書き対策）**。*
