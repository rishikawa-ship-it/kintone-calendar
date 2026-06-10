# REQ_month-cell-fixed-height: 月ビュー セル高さ固定・表示件数動的算出

**文書番号**: REQ_month-cell-fixed-height
**作成日**: 2026-06-10
**最終更新日**: 2026-06-10（第 1 版）
**作成者**: designer (サブエージェント)
**対象ファイル（主）**: `src/kc-calendar.js`, `src/kc-calendar.css`
**対象ファイル（従／同期対象）**: `docs/kc-calendar.js`, `docs/kc-calendar.css`, `plugin/src/js/desktop.js`, `plugin/src/css/desktop.css`
**ステータス**: 確定版 第 1 版（2026-06-10 未確定事項 0 件・確定）

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
9. [影響範囲](#9-影響範囲)
10. [関連資料](#10-関連資料)

---

## 1. 背景・目的

### 1.1 問題

月ビューで予定（chip + 終日バー）が多い日のセルが縦に広がり、週行全体が他の週行よりも背が高くなってしまう。これにより月グリッドが均一な 6 行に見えなくなり、レイアウトが崩れる。

### 1.2 原因の要約（詳細は §2）

`.kc-month-cell` に `min-height: 90px` は設定されているが、**最大高・固定高の制約がない**。セルは `display: flex; flex-direction: column` の flex コンテナであり、子要素（chip・spacer・+N more）が増えると内容に応じて縦に伸びる。

一方で `+N more` オーバーフロー機能（`KC.MonthOverflowPopup`）は実機検証済みで正常動作しているため、オーバーフロー機能を破壊せず「セルを伸ばさない」形での修正が求められる。

### 1.3 目的

1. セルの高さを「予定 0 件時の自然高」に固定し、予定の増加によって伸びないようにする
2. セル高から表示可能件数を動的算出し、収まらない予定は既存の `+N more` 機能に委ねる
3. 既存の `+N more` ポップオーバー（`KC.MonthOverflowPopup`、実機検証済み）を壊さない

---

## 2. 現状分析（調査結果）

### 2.1 セルが広がるメカニズム

#### CSS の問題（`src/kc-calendar.css:825-836`）

```css
/* 現状 */
.kc-month-cell {
  min-height: var(--kc-month-cell-min-h, 90px);  /* 最小高のみ。最大高制約なし */
  overflow: hidden;                               /* ←後述の通りこれだけでは不十分 */
  display: flex;
  flex-direction: column;                         /* 子要素が縦積みで増えると高さが伸びる */
  ...
}
```

`overflow: hidden` が設定されているにもかかわらずセルが広がる理由:

- `.kc-month-week`（`src/kc-calendar.css:818-822`）には `height` も `overflow` も設定されていない
- `.kc-month-grid`（`src/kc-calendar.css:810-815`）は `grid-template-rows: repeat(6, 1fr)` を使用している
- CSS Grid の `1fr` は「空きスペース」を均等分割するが、**最小コンテンツサイズ（min-content size）** を下回ることはできない
- `.kc-month-week` の最小コンテンツサイズは子要素（`.kc-month-cell`）のコンテンツ高に依存する
- 結果として、コンテンツが増えた `.kc-month-cell` が `.kc-month-week` を押し広げ、その行の `1fr` が他の行より大きくなる

`overflow: hidden` はセルの**外側へのはみ出し**を隠すだけであり、セル自体の高さが内容に合わせて伸びることは防がない。

#### JS の問題（`src/kc-calendar.js:3789-3801`）

`_calcMaxItems()` は**現在のセル実高**（`getBoundingClientRect().height`）からレンダリング時の表示件数上限を計算する:

```javascript
// src/kc-calendar.js:3789-3801（plugin/src/js/desktop.js:4141-4153 も同内容）
function _calcMaxItems() {
  var firstCell = document.querySelector('.kc-month-cell');
  if (!firstCell) return MAX_CELL_ITEMS;
  var cellH = firstCell.getBoundingClientRect().height;   // ← 実高を取得
  if (!cellH || cellH <= 0) return MAX_CELL_ITEMS;
  var dateHeadH = 28;
  var padding   = 4;
  var moreH     = 16;
  var itemH     = BAR_H + BAR_GAP;  // BAR_H=24, BAR_GAP=3 → 27px
  var available = cellH - dateHeadH - padding - moreH;
  var max = Math.floor(available / itemH);
  return Math.max(1, Math.min(max, 10));
}
```

この計算は**正しい設計**だが、CSS 側でセル高が固定されていないため「セルが既に伸びた状態」で計算すると、伸びた分だけ maxItems が大きくなり、より多くの chip が配置されてさらにセルが広がるという循環が生じうる。

また `_calcMaxItems()` は `placeMonthEvents()` の冒頭（`src/kc-calendar.js:4142`）で**1回だけ**呼ばれ、全セル共通の値として使用される。終日バーの `usedSlots` 数は考慮されているが（`src/kc-calendar.js:4172`）、セル自体の高さ固定が担保されていないため根本解決にならない。

### 2.2 終日バー超過のカウント漏れ（既知問題）

`REQ_month-overflow-popup.md §3.5` に以下が明記されている:

> `+N more` の `N` は時間予定の非表示件数のみを対象とする。終日バー / 日跨ぎバーの超過は本要件のスコープ外（別フェーズで `placeMonthAlldayEvents` の件数制限と合わせて検討）。

`placeMonthAlldayEvents`（`src/kc-calendar.js:3989-4036`）は終日バーに上限を設けておらず、バーが `maxItems` を超えても全件描画する。終日バーが多いセルでは `usedSlots` が大きくなり、spacer（`src/kc-calendar.js:4058-4075`）の高さも増加してセルが広がる。

これは本要件（セル高固定）とも密接に関係するため、**本要件で同時に `placeMonthAlldayEvents` の件数制限を実施する**（FR-4。旧 §7.1 で確定）。

### 2.3 plugin/src 側の同一問題

`plugin/src/js/desktop.js:4128-4153` の `_calcMaxItems()` は `src/kc-calendar.js` と同一実装である。CSS も同様の構造を持つ（`plugin/src/css/` の `.kc-month-cell` に同一の `min-height` のみ設定）と推定される。同一の問題を抱えている。

### 2.4 `_calcMaxItems()` の本来の設計意図

`_calcMaxItems()` の設計は**正しい方向**であり、セル実高から表示可能件数を算出するアプローチは維持する。問題は CSS 側でセル高が固定されていないことだけである。CSS でセル高を固定すれば `_calcMaxItems()` が正しく機能するようになる。

---

## 3. 要件

### 3.1 機能要件

#### FR-1: セルの高さを固定する

- 月ビューの `.kc-month-cell` は予定の数にかかわらず高さが変動しないこと
- セルの高さは「予定 0 件時に `.kc-month-grid` が自然に均等分割する高さ」を基準とする
- 予定が多くてセルの高さを超えるコンテンツは `overflow: hidden` でクリップされること

#### FR-2: 表示可能件数を高さから動的算出する

- `_calcMaxItems()` は引き続き動作し、セル実高に基づいて表示件数上限を計算する
- セル高が固定されることで `_calcMaxItems()` の計算結果が毎回安定する
- 計算結果に基づいて chip + 終日 spacer が `overflow: hidden` の境界内に収まること

#### FR-3: 収まらない予定は `+N more` に委ねる

- 表示件数上限を超えた時間予定は既存の `applyOverflow()` / `KC.MonthOverflowPopup` 経由でポップオーバーに表示されること
- `+N more` の `N` は時間予定の非表示件数のみを対象とする（既存動作維持）

#### FR-4: 終日バーにも件数上限を設ける（2026-06-10 確定: 選択肢 A）

- `placeMonthAlldayEvents()` に表示件数上限を設け、`maxItems` の残余枠を終日バーが占有し尽くさないようにする
- セル高固定後に終日バーが多い日でも、時間予定 chip が表示可能な枠（最低 1 件）を確保すること
- 終日バーの表示上限を超えたバーは `+N more` のカウントに含める（`N` の計算を終日超過分も加算するよう拡張する）
- ポップオーバー（`KC.MonthOverflowPopup`）に表示する `hiddenEvents` リストにも終日超過分の予定を含める

#### FR-5: ウィンドウリサイズ・全画面切替時の再計算（2026-06-10 確定: 選択肢 A）

- ウィンドウリサイズ後に月ビューが表示されている場合、`placeMonthEvents()` を debounce 付きで再実行してセル高・表示件数を再計算すること
- debounce 待機時間: **200ms**（`window` の `resize` イベントに対して）
- kintone 全画面表示モード（`.kc-root.kc-expanded`）の切替（ON / OFF 両方向）後にも同様に `placeMonthEvents()` を再実行すること
- 再実行は `requestAnimationFrame` でラップしてセル高確定後に計算すること（既存の `src/kc-calendar.js:4224` のパターンに倣う）
- 月ビュー以外のビュー（週・日）が表示されている間はリサイズ・全画面切替のトリガーで `placeMonthEvents()` を実行しないこと

### 3.2 非機能要件

#### NFR-1: 既存機能を壊さない

- `KC.MonthOverflowPopup`（`+N more` ポップオーバー）の動作を変更しない
- 週ビュー・日ビューの表示に影響を与えない
- 月ビュー DnD（`REQ_month-dnd.md`）の動作に影響を与えない

#### NFR-2: src / docs / plugin の三者同期

- `src/kc-calendar.css`, `src/kc-calendar.js` の変更を `docs/` および `plugin/src/` に同期すること

---

## 4. 修正対象箇所一覧

### 4.1 CSS 修正

| ファイル | 行番号 | 変更内容 |
|---|---|---|
| `src/kc-calendar.css` | 818-822 | `.kc-month-week` に `overflow: hidden` を追加してセルのはみ出しを抑止 |
| `src/kc-calendar.css` | 825-836 | `.kc-month-cell` の高さ制御を変更。`min-height` 維持 + `height: 100%` または `align-self: stretch` によるグリッド行高への追従（§7.2 参照）|
| `docs/kc-calendar.css` | 同上 | `src/` と同期 |
| `plugin/src/css/desktop.css` | 対応箇所 | 同上（plugin 固有スタイルがある場合はそちらも） |

### 4.2 JS 修正

| ファイル | 行番号 | 対象関数 | 変更内容 |
|---|---|---|---|
| `src/kc-calendar.js` | 3789-3801 | `_calcMaxItems()` | 変更不要（CSS 側の修正後に正しく機能する）|
| `src/kc-calendar.js` | 3989-4036 | `placeMonthAlldayEvents()` | **変更あり**: `maxItems` を受け取り終日バーの表示を件数制限する。超過分の予定リストを返り値に含める（FR-4）|
| `src/kc-calendar.js` | 4046-4089 | `placeMonthTimedEvents()` | 変更不要（`maxItems` による上限制御は既実装）|
| `src/kc-calendar.js` | 4097-4106 | `applyOverflow()` | 変更不要（呼び出し元で `hiddenCount` 算出済み）|
| `src/kc-calendar.js` | 4112-4195 | `placeMonthEvents()` | **変更あり**: ① `placeMonthAlldayEvents()` に `maxItems` を渡す / ② 終日超過分を `hiddenCount` に加算 / ③ debounce リサイズハンドラを登録（FR-5）|
| `src/kc-calendar.js` | 4221-4226 付近 | `refresh()` 内 `requestAnimationFrame` | **変更あり**: kintone 全画面切替（`.kc-root.kc-expanded` の付け外し）検知を追加して `placeMonthEvents()` を再実行（FR-5）|
| `plugin/src/js/desktop.js` | 4141-4153 | `_calcMaxItems()` | `src/` と同期 |
| `plugin/src/js/desktop.js` | 4586-4738 | `placeMonthEvents()` 等 | `src/` と同期 |

---

## 5. 受入基準

Given / When / Then 形式で記述する。

### AC5.1 予定が多くてもセルの高さが変わらない

- **Given**: 月ビューで特定の日（例: A 日）に時間予定が 10 件以上登録されている
- **When**: 月ビューを表示する
- **Then**: A 日のセルの高さが他の予定 0 件の日と同じ高さである（週行の高さが均一）
- **And**: A 日のセルに `+N more` ラベルが表示されている

### AC5.2 表示件数がセル高から算出される

- **Given**: 月ビューのセルの高さが計算できる状態（DOM 構築後）
- **When**: `_calcMaxItems()` が実行される
- **Then**: 返り値がセルの実高・dateline 高・itemH に基づいて計算された値である（最低 1、最大 10）

### AC5.3 収まらない予定が `+N more` に表示される

- **Given**: 月ビューで A 日に時間予定が `_calcMaxItems()` の返り値を超える件数登録されている
- **When**: 月ビューを表示する
- **Then**: `_calcMaxItems()` の件数だけ chip が表示され、残りは `+N more` ラベルに集約される
- **And**: `+N more` をクリックするとポップオーバーに非表示予定が表示される（既存動作維持）

### AC5.4 ウィンドウリサイズ後に件数が再計算される

- **Given**: 月ビューが表示されている
- **When**: ブラウザウィンドウのサイズを変更する
- **Then**: リサイズ後のセル高に基づいて `_calcMaxItems()` が再計算され、chip の表示件数が更新される
- **And**: セルの高さは変わらず、件数のみが調整される

### AC5.5 全画面モード切替後に件数が再計算される

- **Given**: 月ビューが通常表示モードで表示されている
- **When**: 全画面ボタンをクリックして `.kc-root.kc-expanded` 状態にする
- **Then**: 全画面後のセル高に基づいて `_calcMaxItems()` が再計算される
- **And**: 全画面時のセルが 6 行均等分割のまま維持される

### AC5.6 週ビュー・日ビューに影響がない

- **Given**: 月ビューの CSS 修正が適用されている
- **When**: 週ビューまたは日ビューに切り替える
- **Then**: 週ビュー・日ビューのレイアウトが修正前と変わらない（`REQ_month-view.md §4` の関連 AC が合格）

### AC5.7 `+N more` ポップオーバーが引き続き動作する

- **Given**: 月ビューでセル高固定修正が適用されている
- **When**: `+N more` ラベルをクリックする
- **Then**: `KC.MonthOverflowPopup` のポップオーバーが表示され、非表示予定の一覧が確認できる（`REQ_month-overflow-popup.md §7` の全 AC が合格）

### AC5.8 終日バーが多い日でも chip 表示枠が確保される

- **Given**: 月ビューで特定の日（例: B 日）に終日バーが多数（`maxItems` を超える件数）登録されている
- **When**: 月ビューを表示する
- **Then**: B 日セルに表示される終日バーが件数制限内に収まる
- **And**: 終日バーの超過分が `+N more` のカウント `N` に加算されている
- **And**: `+N more` をクリックするとポップオーバーに終日超過分の予定も含まれて表示される

### AC5.9 kintone 全画面切替後に件数が再計算される

- **Given**: 月ビューが表示されており、通常表示と全画面表示でセル高が異なる
- **When**: 全画面ボタンをクリック（通常 → 全画面）またはその逆（全画面 → 通常）の切替を行う
- **Then**: 切替後に `placeMonthEvents()` が再実行され、新しいセル高に基づいて chip 数が更新される
- **And**: 切替前後でセルの高さは均一なままである

### AC5.10 月ビュー非表示中はリサイズトリガーが発火しない

- **Given**: 週ビューまたは日ビューが表示されている
- **When**: ブラウザウィンドウのサイズを変更する
- **Then**: `placeMonthEvents()` が実行されない（月ビューの不要な再描画が起きない）

### AC5.11 src / docs / plugin が同期されている

- **Given**: `src/kc-calendar.css` および `src/kc-calendar.js` の変更が完了している
- **When**: 3 ファイルセット（src / docs / plugin）の対応箇所を確認する
- **Then**: 同等の修正が各ファイルに存在する

---

## 6. 検証項目・テストシナリオ

### 6.1 セル高固定の確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 予定 0 件の日と 10 件の日を同月に並べる | 月ビューを表示して DevTools で高さを確認 | 両セルの `getBoundingClientRect().height` が同値 |
| 予定が多い行と少ない行の比較 | DevTools で `.kc-month-week` の高さを比較 | 全 6 行が同じ高さを持つ |
| セルに chip が収まりきらない状態 | DevTools で `.kc-month-cell` の overflow を確認 | `overflow: hidden` により chip がクリップされ、セルは伸びない |

### 6.2 `_calcMaxItems()` の動的算出確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| 通常ウィンドウサイズ | コンソールで `KC.RenderMonth._calcMaxItems()` を呼ぶ（※公開されている場合） | セル高に基づいた整数値が返る |
| ウィンドウを縦方向に縮める | リサイズ後に月ビューを再描画 | セル高が縮んだ分だけ maxItems が減少する |
| ウィンドウを縦方向に広げる | リサイズ後に月ビューを再描画 | セル高が増えた分だけ maxItems が増加する |

### 6.3 `+N more` との連携確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| セル高固定後の `+N more` 表示（時間予定のみ超過） | 時間予定が多い日の月ビューを確認 | `+N more` が表示され、ポップオーバーが開く |
| `N` の値の整合性（時間予定のみ） | `+N more` の数字を確認 | N = 時間予定の全件数 − 表示 chip 数 |
| 終日バーが多い日の `+N more` | 終日バーが `maxItems` を超える日の月ビューを確認 | `+N more` の `N` に終日超過分が加算されている |
| ポップオーバー内の終日超過分表示 | 上記の `+N more` クリック | ポップオーバーの一覧に終日超過予定が含まれ、終日バー形式で表示される |

### 6.4 リサイズ・全画面切替の再計算確認

| シナリオ | 操作 | 期待結果 |
|---|---|---|
| ウィンドウリサイズ後の再計算 | 月ビュー表示中にウィンドウを縦方向に縮め、200ms 待つ | chip 数が更新される（セル高が縮んだ分だけ `+N more` に集約される） |
| ウィンドウリサイズ後の再計算（拡大） | 月ビュー表示中にウィンドウを縦方向に広げ、200ms 待つ | chip 数が増加する（セル高が増えた分だけ表示可能件数が増える） |
| 全画面 ON → 月ビュー確認 | 全画面ボタンをクリックして確認 | 全画面セル高に合わせて chip 数が変わる |
| 全画面 OFF → 月ビュー確認 | 全画面を解除して確認 | 通常セル高に合わせて chip 数が戻る |
| 週ビュー中のリサイズ | 週ビュー表示中にウィンドウをリサイズ | `placeMonthEvents()` が実行されない（コンソールログ等で確認） |
| debounce の確認 | 200ms 以内に連続リサイズしてから停止 | 停止後 200ms 経過後に 1 回だけ再描画される（連続リサイズ中は再描画しない） |

### 6.5 リグレッションテスト

| 対象 | 確認項目 |
|---|---|
| 週ビュー | `REQ_month-view.md §4` 関連 AC および `REQ_allday-bar-redesign.md §4` の全 AC が合格 |
| 月ビュー基本機能 | `REQ_month-view.md §4` の AC4.1〜AC4.25 が合格 |
| `+N more` ポップオーバー | `REQ_month-overflow-popup.md §7` の AC7.1〜AC7.14 が合格 |
| 月ビュー DnD | `REQ_month-dnd.md` の全 AC が合格 |

### 6.6 実機確認（SAML 認証環境）

1. `plugin/dist/plugin.zip` を kintone（bushiroad-group.cybozu.com）に手動アップロードする
2. 検証アプリ（k/891/）の月ビューで予定が多い日（3 件以上）の行高を確認する
3. 予定が少ない行（0〜1 件）と多い行（5 件以上）の高さが均一であることを目視確認する
4. セル高固定修正後も `+N more` クリックでポップオーバーが表示されることを確認する
5. 終日バーが多い日の `+N more` をクリックし、終日超過分がポップオーバーに表示されることを確認する
6. ウィンドウリサイズ後（200ms 以上経過後）に chip 数が更新されることを確認する
7. 全画面切替（ON / OFF 両方向）後に chip 数が更新されることを確認する
8. 全画面切替後も `+N more` クリックでポップオーバーが表示されることを確認する（`REQ_month-overflow-popup.md §8.7` の確認事項を再確認）

---

## 7. 未確定事項・リスク・前提

> **本版（第 1 版 / 2026-06-10 更新）時点での未確定事項: 0 件**
>
> 2026-06-10 ユーザー確認により旧 §7.1〜§7.3 の 3 件すべてが解決済みとなった。以下に解決済み記録を残す。

### 解決済み事項（2026-06-10 確定）

| 旧番号 | 項目 | 確定内容 | 反映箇所 |
|---|---|---|---|
| §7.1 | 終日バーの件数制限 | **選択肢 A（今回同時対応）**: `placeMonthAlldayEvents()` に件数上限を設け、超過分を `+N more` にカウントしポップオーバーにも含める | FR-4、§4.2 `placeMonthAlldayEvents()` / `placeMonthEvents()` 行、AC5.8 |
| §7.2 | CSS 実装方式 | **builder の技術判断に委ねる**: 3 案を併記し、副作用（`.kc-month-ad-events` 絶対配置への影響・DnD ghost クリップ）が最も少ない案を選択する。判断基準は下記 §7.2 参照 | §4.1 CSS 修正表 |
| §7.3 | リサイズ時の再実行 | **選択肢 A（対応する）**: `window` の `resize` イベントに debounce 200ms で `placeMonthEvents()` を再実行。kintone 全画面切替時も再実行。月ビュー非表示時は発火しない | FR-5、§4.2 `placeMonthEvents()` / `refresh()` 行、AC5.4 / AC5.9 / AC5.10 |

### 7.2 [前提・builder への判断基準] CSS 実装方式

builder は以下の 3 案から実機・DevTools で副作用を確認し、最適な案を選択すること。選択した案と理由をコミットメッセージまたはレビュー担当への報告に記載すること。

**案 A: `.kc-month-week` に `overflow: hidden` のみ追加**

```css
.kc-month-week {
  overflow: hidden;  /* 追加 */
}
/* .kc-month-cell の変更なし（grid アイテムはデフォルト stretch） */
```

最小変更。ただし `.kc-month-ad-events` が `position: absolute` で `.kc-month-week` 基準のため、バーが週行の `overflow: hidden` でクリップされないか確認が必要。

**案 B: `.kc-month-cell` に `height: 0` を追加**

```css
.kc-month-cell {
  min-height: var(--kc-month-cell-min-h, 90px);  /* 既存のまま */
  height: 0;                                      /* 追加 */
  /* overflow: hidden は既存のまま */
}
```

grid 行の `1fr` 割り当て高さが `height: 0` より優先され、`min-height` が下限を保証する。セル単位で `overflow: hidden` が効く。

**案 C: `.kc-month-week` に `min-height: 0` + `overflow: hidden`、`.kc-month-cell` に `height: 100%` を追加**

```css
.kc-month-week {
  min-height: 0;     /* 追加 */
  overflow: hidden;  /* 追加 */
}
.kc-month-cell {
  height: 100%;      /* 追加 */
}
```

grid アイテムの最小サイズ制約を週行レベルで解除し、セルを週行高さに追従させる。

**判断基準（優先順）**:

1. 全 6 行の高さが均一になること（AC5.1）
2. `.kc-month-ad-events`（`position: absolute`）の終日バーが正しく表示されること
3. DnD ghost chip（`.kc-event--ghost`）がドラッグ中にクリップされないこと（§7.5 参照）
4. CSS の変更量が少ないこと

### 7.4 [前提] `overflow: hidden` はセル外クリックに影響しない

`.kc-month-cell` の `overflow: hidden` は表示クリップであり、クリックイベントのヒットテストには影響しない。クリップ領域外の要素はクリックできなくなるが、ポップオーバー（`document.body` に append される `position: fixed` 要素）は影響を受けない。

### 7.5 [リスク] DnD ゴーストのクリップ問題

月ビュー DnD では `.kc-event--ghost` クラスの chip がドラッグ中に表示される（`placeMonthEvents()` のクリア処理で `not(.kc-event--ghost)` が除外されている: `src/kc-calendar.js:4128`）。セル高固定により ghost chip が `overflow: hidden` でクリップされる可能性がある。

DnD 実機確認を修正後に必須とすること。クリップが問題になる場合、ghost は `position: absolute` に変更するか、ghost 要素を `.kc-month-ad-events` レイヤに配置する等の対応が必要になる可能性がある。

### 7.6 [リスク] `_calcMaxItems()` がリサイズ間に古い値を保持する

`_calcMaxItems()` は `placeMonthEvents()` 呼び出し時にその場でセル高を取得する設計（キャッシュなし）のため、`placeMonthEvents()` が再実行されるタイミング次第では古いセル高で計算される可能性がある。`requestAnimationFrame` ラップ（`src/kc-calendar.js:4224`）が既に1フレーム待機しているため、通常は問題が生じない見込み。

---

## 8. 想定 UX / シーケンス

### 8.1 修正後のセル描画フロー

```
[placeMonthEvents() 実行]
    ↓
[_calcMaxItems() でセル実高から maxItems を算出]
    ← CSS によりセル高はグリッド均等分割の値に固定されている
    ← よって maxItems の計算結果が毎回安定する
    ↓
[placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, maxItems)]  ← maxItems を渡す（FR-4）
    ← maxItems 件まで終日バーを描画
    ← 超過分を hiddenAllday リストとして返す
    ← alldayResult.colLaneCounts に反映（usedSlots の上限も maxItems で制限）
    ↓
[placeMonthTimedEvents(cellEl, timedEvents, usedSlots, maxItems)]
    ← usedSlots（終日バー占有分）を引いた残り件数だけ chip を追加
    ← chip が maxItems に達したら追加を打ち切る
    ↓
[hiddenCount = (dayTimedEvents.length - chipsAdded) + hiddenAlldayCount]  ← 終日超過も加算
[hiddenCount > 0 なら applyOverflow(cellEl, hiddenCount, [...hiddenTimed, ...hiddenAllday])]
    ← +N more ラベルを追加
    ← KC.MonthOverflowPopup に非表示予定（時間 + 終日超過）を登録
    ↓
[セル内表示が overflow: hidden でクリップされる]
    ← セル高は変動しない

[window 'resize' イベント（debounce 200ms）または全画面切替検知]  ← FR-5
    ↓
[KC.State.view === 'month' を確認]
    ← 月ビュー以外ならスキップ
    ↓
[requestAnimationFrame → placeMonthEvents() 再実行]
    ← 新しいセル高に基づいて maxItems が再計算される
```

### 8.2 修正後の見た目イメージ

```
月グリッド（6行均等）
+----------+----------+----------+
| 月 1     | 月 2     | 月 3     |
| ■■■会議  | ■■■開発  |          |
| 10:00 朝 | 09:00 週 | 14:00 ミ |
| +3 more  | +2 more  | ーティング|
+----------+----------+----------+  ← 全行同じ高さ
| 月 8     | 月 9     | 月 10    |
| （空）   | 13:00 1o |          |
|          |          |          |
+----------+----------+----------+
```

---

## 9. 影響範囲

### 9.1 影響あり

| 対象 | 影響内容 | 対応 |
|---|---|---|
| 月ビュー全般 | セル高固定により chip 数が変わりうる | `REQ_month-view.md §4` リグレッション確認 |
| `+N more` ポップオーバー | `N` の算出が終日超過分も加算されるよう拡張される | `REQ_month-overflow-popup.md §7` 全 AC の実機確認 |
| `placeMonthAlldayEvents()` の呼び出しシグネチャ | `maxItems` 引数を追加する | 呼び出し元（`placeMonthEvents()`）も合わせて修正 |
| 月ビュー DnD | ghost chip がクリップされる可能性 | `REQ_month-dnd.md` 実機確認（§7.5 参照）|
| `window` resize イベント | debounce ハンドラの追加で他のリスナーと競合しないか | 登録・解除のライフサイクルを `KC.RenderMonth` の init / destroy と合わせて管理 |

### 9.2 影響なし

| 対象 | 理由 |
|---|---|
| 週ビュー | `.kc-month-*` クラスのみ修正するため影響なし |
| 日ビュー | 同上 |
| `KC.MonthOverflowPopup` の内部ロジック | 呼び出し元（`applyOverflow()`）の変更なし |
| kintone REST API / cursor API | データ取得ロジックの変更なし |

---

## 10. 関連資料

| 資料 | 関連箇所 |
|---|---|
| `src/kc-calendar.css:818-836` | `.kc-month-week` / `.kc-month-cell` — 修正対象 CSS |
| `src/kc-calendar.css:810-815` | `.kc-month-grid` — `grid-template-rows: repeat(6, 1fr)` の定義 |
| `src/kc-calendar.js:3789-3801` | `_calcMaxItems()` — 表示件数動的算出 |
| `src/kc-calendar.js:3989-4036` | `placeMonthAlldayEvents()` — 終日バー配置（件数制限なし、§7.1 参照）|
| `src/kc-calendar.js:4046-4089` | `placeMonthTimedEvents()` — chip 配置と maxItems 上限 |
| `src/kc-calendar.js:4097-4106` | `applyOverflow()` — `+N more` 生成 |
| `src/kc-calendar.js:4112-4195` | `placeMonthEvents()` — 配置オーケストレーター |
| `src/kc-calendar.js:4221-4226` | `requestAnimationFrame` ラップ — セル高確定待ち |
| `plugin/src/js/desktop.js:4128-4153` | `_calcMaxItems()` — src と同内容 |
| `plugin/src/js/desktop.js:4586-4738` | `placeMonthEvents()` 等 — src と同内容 |
| `requirements/REQ_month-overflow-popup.md §3.5` | `+N more` N の算出方法・終日バー超過の後送り方針（本要件で解消）|
| `requirements/REQ_month-view.md §7.1` | `--kc-month-cell-min-h: 90px` の確定値と根拠 |
| `requirements/REQ_month-view.md §7.2` | 全画面モード時の月グリッド高 CSS |
| `requirements/REQ_month-dnd.md` | DnD リグレッション確認対象 |

---

*本要件定義書: 確定版 第 1 版（2026-06-10 確定）。未確定事項 0 件。builder は §3 の全要件（FR-1〜FR-5、NFR-1〜NFR-2）および §4 の修正対象箇所を入力として実装を開始すること。CSS 実装方式（§7.2 の 3 案）は builder が実機確認のうえ最適案を選択し、コミットメッセージに選択理由を記載すること。実装前に §7.5（DnD ghost クリップ）のリスクを把握し、DnD 実機確認を必須とすること。*
