# 要件定義書: 週/日ビュー 終日レーン more 開閉状態の維持

**文書番号**: REQ_weekday-more-state
**作成日**: 2026-06-24
**最終更新日**: 2026-06-24（初版）
**作成者**: designer（サブエージェント）
**ステータス**: 初版（未解決事項: §7 参照）
**関連文書**:
- `plugin/src/js/desktop.js` — 実装対象
- `plugin/src/css/desktop.css` — CSS（変更なし予定）
- `requirements/REQ_url-state-sync.md` — KC.UrlState 設計

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析](#2-現状分析)
3. [要件](#3-要件)
4. [保持方式の検討と推奨](#4-保持方式の検討と推奨)
5. [受入基準](#5-受入基準)
6. [検証項目・テストシナリオ](#6-検証項目テストシナリオ)
7. [未解決事項・リスク・前提](#7-未解決事項リスクと前提)
8. [builder への変更指示](#8-builder-への変更指示)

---

## 1. 背景・目的

### 1.1 背景

週ビュー・日ビューの上部には「終日/日跨ぎレーン」があり、終日イベントが4レーン以上重なる場合に **`▼ もっと表示 (+N)` / `▲ 折りたたむ` トグル**（以下「more トグル」）が表示される。

現状、 **`＜`（prev）・`＞`（next）ボタンで週/日を移動するたびに `S.alldayExpanded = false` が実行**され、more の展開状態がリセットされる。連続する週に終日イベントが多く展開して確認していたユーザーが、移動のたびに再展開する操作を強いられており、UX が悪い。

### 1.2 目的

週/日ナビゲーション（prev/next/today ボタン）後も more トグルの開閉状態を維持し、ユーザーが展開したまま週/日を移動できるようにする。

---

## 2. 現状分析

### 2.1 more トグルの実装場所

#### KC.RenderShared — 共通ロジック（`desktop.js:3945–4080`）

| 関数/シンボル | 行 | 役割 |
|---|---|---|
| `calcCollapsedLanes(maxLane)` | 3950 | 折りたたみ時の表示レーン数（最大3）を返す |
| `updateAlldayToggle(toggleEl, maxLane, expanded, hiddenCount)` | 4045 | トグル DOM の表示/非表示・テキストを更新。`maxLane < 3` のとき `display:none` |

`updateAlldayToggle` は `expanded === true` のとき `▲ 折りたたむ`、`false` のとき `▼ もっと表示 (+N)` を描画する。

#### KC.RenderWeek.placeEvents（`desktop.js:4255–4344`）

```
4303: KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount)
4306-4311: toggleEl.onclick → S.alldayExpanded = !S.alldayExpanded; KC.Render.renderGrid()
4329: displayLanes = S.alldayExpanded ? (maxLane+1) : collapsedLaneCount
4334: alldayWrap.style.height = totalH + 'px'
4342: eventsLayer.style.overflow = S.alldayExpanded ? 'visible' : 'hidden'
```

#### KC.RenderDay.placeEvents（`desktop.js:6418–6487`）

週ビューと同一パターン。

```
6453: KC.RenderShared.updateAlldayToggle(toggleEl, maxLane, S.alldayExpanded, hiddenCount)
6456-6460: toggleEl.onclick → S.alldayExpanded = !S.alldayExpanded; KC.Render.renderGrid()
6475: displayLanes = S.alldayExpanded ? (maxLane+1) : collapsedLaneCount
```

#### 状態の保持場所

開閉状態は `KC.State.alldayExpanded`（`desktop.js:733`）という**モジュールスコープのオブジェクトプロパティ**に保持される。初期値 `false`（折りたたみ）。

**週ビューと日ビューで状態は共有**（同一フィールドを参照）。

### 2.2 状態リセット箇所（根本原因）

prev/next/today ボタンのクリックハンドラ（`desktop.js:9854–9903`）の各ハンドラ先頭で以下が実行される:

| ボタン | 行 | コード | コメント |
|---|---|---|---|
| prev | 9858 | `S.alldayExpanded = false;` | `// 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）` |
| today | 9878 | `S.alldayExpanded = false;` | 同上 |
| next | 9890 | `S.alldayExpanded = false;` | 同上 |

これらの行が状態リセットの根本原因。

コメントに `AC 4.14 / §3.6` とあるが、この `AC 4.14` は `REQ_url-state-sync.md` とは別の旧要件番号であり、「ビュー切替時（月↔週↔日）にリセット」を意図した記述と推定される。しかし現在の実装では **＜＞ナビゲーション**でもリセットが発生しており、これが課題である。

### 2.3 ビュー切替時の挙動

`KC.ViewSwitcher.choose()`（`desktop.js:9439`）では `S.alldayExpanded = false` の記述がない。つまりビュー切替時は現状リセットされない（今回のスコープ外）。

### 2.4 KC.UrlState との関係

`KC.UrlState`（REQ_url-state-sync 実装済み）は `#kc:` ハッシュで `view/date/filter/q/scroll/fs/record/new/more` を管理している（`desktop.js:8640–9240`）。現時点で `alldayExpanded` は UrlState の管理パラメータには含まれていない。

### 2.5 月ビューとの差異

月ビューの `+N more` はセル単位のポップオーバー（`KC.MonthOverflowPopup`）であり、`S.alldayExpanded` とは全く別の実装。本要件とは無関係。

---

## 3. 要件

### 3.1 機能要件

| ID | 要件 |
|---|---|
| FR-1 | 週ビューで more を展開した状態で prev/next ボタンをクリックしても、終日レーンが展開状態で描画される |
| FR-2 | 日ビューで more を展開した状態で prev/next ボタンをクリックしても、終日レーンが展開状態で描画される |
| FR-3 | 展開状態で today ボタンをクリックしても、終日レーンが展開状態で描画される |
| FR-4 | 移動先の週/日に終日イベントが4レーン未満（more トグル非表示）の場合でも `alldayExpanded` の値は維持される（次に4レーン以上の週/日へ移動したとき再び展開状態になる） |
| FR-5 | ビュー切替（月↔週↔日）時は `alldayExpanded` をリセット（`false`）する（現状動作を維持） |
| FR-6 | フィルタ変更・検索クエリ変更時は `alldayExpanded` を変更しない（現状動作を維持） |

### 3.2 非機能要件

| ID | 要件 |
|---|---|
| NF-1 | ページリロード後は `alldayExpanded` を初期値 `false`（折りたたみ）に戻してよい（UrlState への追加は任意オプション扱い、詳細は §4） |
| NF-2 | 変更箇所は最小限にとどめる。追加するコードは prev/next/today の各ハンドラ3箇所の1行削除のみとする（推奨案採用時） |
| NF-3 | 月ビューの動作には一切影響しない |

---

## 4. 保持方式の検討と推奨

### 4.1 方式 A: prev/next/today のリセットを削除するのみ（JS変数維持）

**概要**: `desktop.js:9858`, `9878`, `9890` の `S.alldayExpanded = false;` を削除する。状態は既存の `KC.State.alldayExpanded`（モジュール変数）に保持され続ける。

**メリット**:
- 変更量が最小（3行削除のみ）
- 既存アーキテクチャを変更しない
- リロード時は `false` に戻るため、混乱するユーザーが少ない

**デメリット**:
- リロード・ブックマーク・URL 共有では状態が復元されない
- ビュー切替後に戻ってきたとき（月→週→月→週）は FR-5 によりリセットされる（これは仕様）

### 4.2 方式 B: KC.UrlState に `expanded` パラメータを追加

**概要**: `KC.UrlState` に `expanded=1` パラメータを追加し、`alldayExpanded` を URL ハッシュで管理する。

**メリット**:
- リロード・「戻る/進む」・URL 共有でも状態が復元される
- 状態の一貫性が高い

**デメリット**:
- 変更量が大きい（UrlState への追加、restore() への追加、prev/next/today/ビュー切替 各ハンドラへの syncViewDate 相当処理の追加）
- `more` ポップオーバー（月ビュー専用）と類似した名前でURL上紛らわしくなる可能性
- 週ビューと日ビューは `alldayExpanded` を共有しているため、ビュー間で状態が引き継がれる（これは FR-5 を考慮しても混乱を招く可能性がある）
- ユーザーが URL を手動コピーした場合に `expanded=1` が含まれるのが自然かどうか疑問

### 4.3 推奨: 方式 A（JS変数維持）

**推奨理由**:

1. ユーザー要望の主目的が「＜＞移動後も状態を維持する」であり、リロード後の復元は不要とされている
2. 変更箇所が3行削除のみで、レビュー・デバッグが容易
3. `KC.UrlState` への追加は将来の拡張として別要件で対応可能

**ビュー切替時のリセット（FR-5）の根拠**:
週ビューから日ビューに移動した際、「もともと週ビューで展開していた終日レーンを日ビューでも展開すべきか」は自明でないため、ビュー切替時はリセットとする現状動作を維持する。

---

## 5. 受入基準

### AC-1: prev ボタンで展開状態が維持される

- **Given**: 週ビューで終日イベントが4件以上あり、more トグルで展開した状態
- **When**: `＜`（prev）ボタンをクリックして前の週に移動したとき
- **Then**: 移動先の週でも終日レーンが展開状態（`▲ 折りたたむ`）で表示される（移動先にも4件以上の終日イベントがある場合）

### AC-2: next ボタンで展開状態が維持される

- **Given**: 日ビューで more を展開した状態
- **When**: `＞`（next）ボタンで翌日に移動したとき
- **Then**: 翌日にも4件以上の終日イベントがあれば、展開状態で表示される

### AC-3: today ボタンで展開状態が維持される

- **Given**: 週ビューで more を展開した状態
- **When**: `今日` ボタンをクリックしたとき
- **Then**: 今日の週でも終日レーンが展開状態で表示される（今日の週に4件以上あれば）

### AC-4: 移動先に more が出ない場合は非表示のまま状態保持

- **Given**: 週ビューで more を展開した状態（`S.alldayExpanded === true`）
- **When**: 終日イベントが3件以下の週に移動したとき
- **Then**: more トグルは非表示（`display:none`）になるが、`S.alldayExpanded` は `true` のまま保持される
- **And**: さらに次の週（終日イベント4件以上）に移動したとき、展開状態で表示される

### AC-5: 折りたたみ状態は維持される

- **Given**: 週ビューで more を折りたたんだ状態（`▼ もっと表示`）
- **When**: prev/next で移動したとき
- **Then**: 移動先でも折りたたみ状態（`▼ もっと表示 (+N)`）で表示される

### AC-6: ビュー切替でリセットされる

- **Given**: 週ビューで more を展開した状態
- **When**: ビュー切替ドロップダウンで「月」に切り替え、その後「週」に戻したとき
- **Then**: 週ビューに戻ったとき折りたたみ状態（`S.alldayExpanded === false`）になる

### AC-7: 月ビューの動作に影響しない

- **Given**: 月ビューで +N more ポップオーバーが開いている状態
- **When**: prev/next で月を移動したとき
- **Then**: 月ビューの動作は本改修前と変わらない（`KC.MonthOverflowPopup` は無影響）

---

## 6. 検証項目・テストシナリオ

### T-1: 週ビュー prev/next 連続移動

1. 週ビューに切り替える
2. 終日イベントが4件以上ある週を探す（または作成）
3. more トグル（`▼ もっと表示`）をクリックして展開する（`▲ 折りたたむ` になることを確認）
4. `＞`（next）ボタンをクリックして翌週に移動する
5. 検証: 翌週にも4件以上の終日イベントがある場合、`▲ 折りたたむ` で表示される（AC-1）
6. `＜`（prev）ボタンで元の週に戻る
7. 検証: `▲ 折りたたむ` のまま（展開維持）（AC-2）

### T-2: 日ビュー next 移動

1. 日ビューに切り替える
2. 終日イベントが4件以上ある日を探す
3. more を展開する
4. `＞` で翌日に移動する（翌日に4件以上あれば展開、なければ more 非表示）
5. 検証: `S.alldayExpanded` が `true` のまま（DevTools コンソールで `KC.State.alldayExpanded` 確認）

### T-3: 終日イベントが少ない週を経由した後の展開確認

1. 週ビューで more を展開（4件以上の週）
2. `＞` で終日イベント3件以下の週に移動する
3. 検証: more トグルが非表示（display:none）になる（AC-4）
4. さらに `＞` で終日イベント4件以上の週に移動する
5. 検証: more が展開状態で表示される（AC-4 後半）

### T-4: ビュー切替でのリセット確認

1. 週ビューで more を展開する
2. ビュー切替で「月」を選択する
3. ビュー切替で「週」を選択して戻る
4. 検証: more が折りたたみ（`▼ もっと表示 (+N)`）になる（AC-6）
5. 検証: DevTools で `KC.State.alldayExpanded === false` を確認

### T-5: 月ビュー影響確認

1. 月ビューでポップオーバーを開く
2. `＜`/`＞` で月を移動する
3. 検証: 月ビューの prev/next 動作が従来通りに動作している（AC-7）

### T-6: today ボタン

1. 週ビューで today 以外の週を表示し、more を展開する
2. today ボタンをクリックする
3. 検証: 今日の週に終日イベントが4件以上あれば展開状態で表示される（AC-3）

---

## 7. 未解決事項・リスク・前提

| ID | 内容 | 優先度 | 担当 |
|---|---|---|---|
| Q-1 | **`AC 4.14 / §3.6` の出典確認**: コメントに引用されている `AC 4.14` が何の要件書に由来するか不明。今回の変更でそのACを破ることにならないか確認が必要。builder は変更前に当該 AC の内容を特定し、今回の仕様と矛盾しないことを確認すること | 高 | builder |
| Q-2 | **ビュー切替（ViewSwitcher）でのリセット**: 現状 `KC.ViewSwitcher.choose()`（9439行）に `alldayExpanded = false` が**ない**ため、週→日→週のようなビュー切替でも展開が維持されてしまう。FR-5 では「ビュー切替時はリセット」を仕様とするが、現状実装と乖離がある。builder はビュー切替時のリセット追加も合わせて実施すること（`choose()` 内で `S.alldayExpanded = false` を追加）。ただしこれは現状バグか仕様かの判断をユーザーに確認するとよい | 中 | builder（ユーザー確認後） |
| Q-3 | **週/日間でのalldayExpanded 共有**: 週ビューで展開してから日ビューに切り替えても `alldayExpanded` は引き継がれる。Q-2 でビュー切替時リセットを追加すれば解消するが、Q-2 の判断次第 | Q-2に依存 | - |
| Q-4 | **リロード後の状態維持**: 現推奨（方式 A）ではリロード後は `false` にリセットされる。将来 UrlState への追加が必要になる場合のために、本要件書の §4.2 を参照すること | 低 | 将来タスク |
| Q-5 | **フィルタ変更時の alldayExpanded**: フィルタ変更後に終日イベント数が変化し、展開状態で4件未満になった場合の描画（バーが実際には存在しないのにレーンが広い状態）について確認が必要。ただし `updateAlldayToggle` が `maxLane < 3` のとき `display:none` にするため視覚的には問題ない | 低 | builder（実機確認） |

### 7.1 前提事項

- 正本は `plugin/src/js/desktop.js`（`src/kc-calendar.js` は対象外、未使用）
- 実機検証は plugin.zip を手動アップロードして行う
- CSS（`plugin/src/css/desktop.css`）の変更は不要

---

## 8. builder への変更指示

### 8.1 主変更箇所（必須）

**`plugin/src/js/desktop.js`** の以下3箇所を変更する。

#### 変更1: prevBtn ハンドラ（行 9858）

```javascript
// 変更前
S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）

// 変更後
// S.alldayExpanded = false; を削除（REQ_weekday-more-state: prev/next 移動時は状態を維持する）
```

#### 変更2: todayBtn ハンドラ（行 9878）

```javascript
// 変更前
S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）

// 変更後
// 削除（same as 変更1）
```

#### 変更3: nextBtn ハンドラ（行 9890）

```javascript
// 変更前
S.alldayExpanded = false;   // 切り替え時はトグル状態をリセット（AC 4.14 / §3.6）

// 変更後
// 削除（same as 変更1）
```

### 8.2 追加変更（Q-2 解決後に実施）

ユーザー確認の結果「ビュー切替時はリセット」を仕様とする場合、`KC.ViewSwitcher` の `choose()` 関数（行 9439 付近）に以下を追加する:

```javascript
KC.State.view = value;
KC.State.alldayExpanded = false;   // ビュー切替時はトグル状態をリセット（REQ_weekday-more-state FR-5）
KC.SearchFilter.activeIndex = -1;
```

### 8.3 変更不要

- `plugin/src/css/desktop.css`: 変更不要
- `KC.RenderShared.updateAlldayToggle`（行 4045）: 変更不要
- `KC.RenderWeek.placeEvents`・`KC.RenderDay.placeEvents` の toggleEl 処理: 変更不要
- `KC.UrlState`: 変更不要（方式 A 採用のため）

### 8.4 ビルド・デプロイ

変更後は plugin.zip を再ビルドし、kintone 管理画面でプラグインを更新してから実機検証を行うこと（`DEPLOY_GUIDE.md` 参照）。

---

*初版（2026-06-24）: designer が既存実装を調査し初版を作成。主変更は `desktop.js` 3箇所の1行削除のみ。未解決事項 Q-1〜Q-5 を §7 に整理。*
