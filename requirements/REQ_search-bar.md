# 要件定義書: カレンダー検索欄機能

**文書番号**: REQ_search-bar
**作成日**: 2026-05-20
**最終更新日**: 2026-06-02（v4 確定版: Enter/クリック動作確定・opacity 制御廃止・searchTargets 空時の検索バー非表示追加）
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 第 4 版（確定）（§12 残存未確定事項: §12.1, §12.2, §12.3, §12.5, §12.6, §12.8, §12.11）
**関連文書**: REQ_edit-permission-extension.md, plugin/src/js/desktop.js, plugin/src/css/desktop.css, plugin/src/js/config.js

---

## 改版履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| v1 | 2026-05-20 | 初版作成（検索欄基本機能） |
| v2 | 2026-05-20 | ハイライト/フォーカス遷移仕様を追加。キーボードショートカット（`/` キー）を削除（ユーザー判断で不採用確定）。マッチ候補 activeIndex 管理・Enter/上下キーナビゲーション仕様を追加 |
| v3 | 2026-06-01 | Phase 2 として検索対象フィールド拡張（SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT）+ 関連レコードのメモリ内検索を追加。プラグイン設定にテーブル型 UI（searchTargets）を追加。検索論理をフィールド間 OR 拡張。§5（関数・モジュール設計）・§6（エッジケース）・§7（スコープアウト）・§8-§10（受入基準・検証・未確定）を大幅改訂 |
| v4 | 2026-06-01 | v3 実機検証で `+N more` 隠れ予定がカレンダーハイライトに含まれない問題が判明。フローティング一覧（`#kc-search-dropdown`）を主役とする方式に正式化。カレンダー上のハイライト・フォーカス遷移の廃止方針を明記。searchTargets の暗黙的タイトル特別扱い廃止（実装に合わせて仕様を修正）。§5 モジュール設計を実装実態に合わせて更新。§6 エッジケース・§8 受入基準・§9 検証項目にフローティング一覧関連を追加 |
| v4.1 | 2026-06-01 | §12 未確定事項を builder 最新実装に合わせて整理。§12.10（クリック時モーダル起動）・§12.12（`+N more` 掲載）・§12.13（searchTargets 空フォールバック）を解決済みとして本文へ統合。FR-3・FR-12・FR-13・§6.1・§6.6・§6.7・§8.6・§11.5・§11.8・§11.9 を実装実態に合わせて修正 |
| v4 確定 | 2026-06-02 | Enter キー動作を「次候補移動」から「アクティブ候補の予定詳細 iframe モーダル起動 + フローティング一覧 close」に確定。クリック動作を `KC.Popup.openEdit(evt.id)` 起動として確定。FR-6（opacity 0.25 制御）を削除（v4 ではカレンダー UI 中立・フローティング一覧のみで検索状態を表現）。FR-18 新規追加（searchTargets 空時に検索バー要素を非表示）。§1.5 に opacity 廃止背景を追記。§5.5 状態遷移・AC-V4-1・AC-V4-2 を更新。opacity 関連の T / §8 記述を削除 |

---

## 目次

1. [概要・背景・目的](#1-概要背景目的)
2. [用語](#2-用語)
3. [機能要件](#3-機能要件)
4. [非機能要件](#4-非機能要件)
5. [UI 仕様](#5-ui-仕様)
6. [データ構造・モジュール設計](#6-データ構造モジュール設計)
7. [既存実装への変更点](#7-既存実装への変更点)
8. [影響範囲 / 非干渉確認](#8-影響範囲--非干渉確認)
9. [受入基準](#9-受入基準)
10. [検証項目](#10-検証項目)
11. [エッジケース・リスク](#11-エッジケースリスク)
12. [未確定事項・前提条件](#12-未確定事項前提条件)

---

## 1. 概要・背景・目的

### 1.1 背景

KC Calendar プラグインは現状、カレンダー上に表示される予定を「全て / 自分のみ / 他人のみ」のフィルタドロップダウン（`KC.FilterDropdown`）で絞り込む機能を持つ。しかしこのフィルタはユーザー属性ベースであり、「キーワードで特定の予定を素早く見つける」用途には対応していない。

予定数が増加するにつれ、目的の予定を目視で探すコストが増大する。検索欄を追加することで、タイトル等のキーワードを入力するだけで目的の予定を即座に絞り込めるようにする。

### 1.2 目的

1. カレンダーヘッダーバーに検索入力欄を追加し、ユーザーがキーワードで予定を絞り込めるようにする
2. 絞り込み結果を検索バー直下のフローティング一覧にリスト表示し、隠れた予定も含めて全件可視化する
3. フローティング一覧内でキーボード（↑↓ / Enter / ESC）操作によるナビゲーションを提供する
4. 既存のフィルタ機能・権限色機能との非干渉を保証する

### 1.3 スコープ

- **Phase 1（実装済み）**: タイトルフィールドのみを対象としたクライアント側フィルタ。リアルタイム検索。マッチ候補のハイライト・フォーカス遷移（v4 で廃止方針）。
- **Phase 2（本要件）**: 検索対象フィールドの拡張（文字列系 / REFERENCE_TABLE / USER_SELECT）。プラグイン設定で管理者が対象フィールドを追加設定。関連レコードの事前一括取得とメモリ内検索。フローティング一覧による全マッチ予定の可視化。
- **Phase 3（将来）**: ユーザー側 UI でのフィールド切替、kintone API クエリ投影（件数上限超え対応）。

### 1.4 v3 改訂（2026-06-01）

Phase 2 として検索対象フィールドの拡張と関連レコード対応を実装するにあたり、以下の方針を確定した。

**選択主体**: プラグイン設定で管理者が事前定義する（固定）。検索バー UI でユーザーが対象を切り替える機能は Phase 3 候補。

**対象フィールド型**: SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT。LOOKUP は元フィールド型（SINGLE_LINE_TEXT 等）として通常通り選択可能。DATE / NUMBER / DROP_DOWN / RADIO_BUTTON は今回スコープ外。

**REFERENCE_TABLE の扱い**: kintone のアプリ設定で「表示フィールドに指定されているもの」のみ検索対象に含める。`/k/v1/app/form/fields.json` で本アプリの REFERENCE_TABLE フィールド定義を取得し、`referenceTable.displayFields` を読み取る。

**関連レコード取得タイミング**: カレンダー表示時（ビュー切替・月送り含む）に関連先レコードを一括取得してメモリキャッシュする。メモリ内でテキストマッチ（高速・API コール最小化）。

**検索論理**: トークン間 AND、フィールド間 OR。例:「会議 A社」で検索 → タイトル / メモ / 関連レコードのいずれかに「会議」を含み、かつ同じくいずれかに「A社」を含むレコードがヒット。

**USER_SELECT の検索値**: `name`（表示名）と `code`（ログイン名）の両方を OR 検索対象とする。

### 1.5 v4 改訂（2026-06-01）

v3 実装の実機検証で、月ビュー `+N more` ポップオーバーで非表示の予定がカレンダー上ハイライトに含まれない問題が判明した。DOM に描画されていない予定要素は `querySelectorAll` で取得できないため、カレンダー上のハイライト方式では構造的に全マッチ予定を網羅できない。

解決として、検索バー下の **フローティング一覧**（`#kc-search-dropdown`）で全マッチ予定をリスト表示する方式を正式採用する。フローティング一覧は `KC.State.events` を直接参照してマッチ判定を行うため、`+N more` で隠れている予定も含めて可視化できる。ユーザーはフローティング一覧から直接クリックで予定の詳細確認やアクティブ遷移が行える。

**カレンダー上のハイライト（`.kc-event--match` / `.kc-event--match-active`）とフォーカス遷移（カレンダーセルへのスクロール）は v4 で廃止する。**

また、v3 仕様書に「タイトルフィールドは常に検索対象・暗黙的に有効」と記載していたが、実装では `searchTargets` に含まれるフィールドのみを対象とする設計に変更された（タイトルの暗黙的な特別扱いの廃止）。v4 でこの実装実態に合わせて仕様書を修正する。タイトルを検索対象にするには `searchTargets` にタイトルフィールドを追加設定する必要がある。

**非一致予定の opacity 制御（FR-6: `opacity: 0.25`）も v4 確定版で廃止する。** v4 では検索状態の表現はフローティング一覧のみで行い、カレンダー UI 自体は検索クエリの有無にかかわらず中立（通常表示）を維持する。これにより、カレンダー DOM を直接操作する複雑さを排除し、`_computeMatchList()` によるフローティング一覧更新のみで検索結果を提示するシンプルな設計とする。

---

## 2. 用語

| 用語 | 定義 |
|---|---|
| 検索クエリ | ユーザーが検索欄に入力したテキスト文字列 |
| 検索フィルタ | 検索クエリによる絞り込み処理。既存の eventFilter（mine/others/all）とは独立した第2のフィルタ層 |
| クライアント側フィルタ | kintone REST API への追加リクエストを発生させず、取得済みの `KC.State.events` をメモリ内で絞り込む方式 |
| フローティング一覧 | 検索バー直下に表示されるドロップダウン形式のマッチ予定リスト（`#kc-search-dropdown`）。v4 で検索結果の主要表示手段として正式採用 |
| マッチ予定 | 検索クエリにマッチする予定。フローティング一覧にリスト表示される |
| 非一致予定 | 検索クエリにマッチしない予定。v4 確定版ではカレンダー上の表示変更なし（opacity 制御廃止）。フローティング一覧に表示されないことで非マッチを表現する |
| アクティブ候補 | フローティング一覧内で現在選択中の予定。`kc-search-dropdown-item--active` クラスで示す |
| activeIndex | マッチ候補リスト内でアクティブ候補が何番目かを示す 0 始まりのインデックス |
| _matchList | 現在のクエリにマッチする KcEvent オブジェクトの配列（開始日時昇順）。`_computeMatchList()` が `KC.State.events` を直接スキャンして構築する。フローティング一覧描画の元データ |
| デバウンス | 連続入力時に最後の入力から一定時間待ってから処理を実行する仕組み |
| IME 確定 | 日本語入力時に変換キー（Enter / スペース）で文字を確定させる操作。`compositionend` イベントが発火する |
| KcEvent | desktop.js 内でレコードから変換した予定オブジェクト。`title` / `start` / `end` / `record` 等を持つ |
| searchTargets | プラグイン設定で管理者が設定する検索対象フィールドの配列（`[{ fieldCode: "memo" }, ...]` 形式）。タイトルフィールドも含め全検索対象フィールドをここで指定する |
| REFERENCE_TABLE | kintone の関連レコード一覧フィールド。別アプリのレコードを参照して一覧表示する |
| displayFields | REFERENCE_TABLE の表示フィールド設定。`/k/v1/app/form/fields.json` の `referenceTable.displayFields` で取得できる |
| 関連レコードキャッシュ | 関連先アプリから事前一括取得した関連レコードのメモリ内保持。`_relatedRecordsCache` で管理する |
| トークン間 AND | スペース区切りで分割した各トークンがすべてマッチする場合に一致と判定する方式 |
| フィールド間 OR | 複数の検索対象フィールドのうち、いずれか 1 つ以上がマッチすれば一致と判定する方式 |

---

## 3. 機能要件

### FR-1: 検索欄の配置

カレンダーヘッダーの `.kc-head-right` 内に検索欄（`id="kc-search"` のラッパー要素）を追加する。

- 配置位置: FilterDropdown（`#kc-filter`）の左側
- ヘッダー右側の要素順序（左→右）:
  - 検索欄（新規）
  - フィルタドロップダウン（既存）
  - ビュードロップダウン（既存）
  - 全画面ボタン（既存）
  - 設定ボタン（既存）

### FR-2: 検索欄の UI 構成

検索欄は以下の 3 要素で構成する。

1. 検索アイコン（`🔍` または SVG、ボタンではなく装飾）
2. テキスト入力欄（`<input type="search" id="kc-search-input">`）
  - `placeholder`: 「予定を検索」
  - `aria-label`: 「予定を検索」
3. クリアボタン（`<button id="kc-search-clear">` / `×`）
  - 検索クエリが空のときは非表示
  - 検索クエリが 1 文字以上あるときに表示

フォーカスはユーザーが検索欄をクリックして当てる。キーボードショートカットによるフォーカス移動は実装しない（v2 確定）。

### FR-3: 検索対象フィールド（v4 更新）

検索対象フィールドは `searchTargets`（プラグイン設定）に含まれるフィールドのみとする。タイトルフィールドを含む全フィールドを `searchTargets` で明示的に設定する必要がある（v3 仕様の「タイトルフィールドは常に検索対象」という暗黙の特別扱いは廃止）。

`searchTargets` に追加可能なフィールド型:
- SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT（文字列フィールド）
- REFERENCE_TABLE（関連レコード一覧）
- USER_SELECT（ユーザー選択）
- LOOKUP は元フィールド型（SINGLE_LINE_TEXT 等）として通常通り選択可能

DATE / NUMBER / DROP_DOWN / RADIO_BUTTON / CHECKBOX 等の型は今回スコープ外。

`searchTargets` が空の場合: **何もマッチしない**（検索機能が事実上無効化された状態）。これは確定仕様であり、フォールバックは行わない（v4.1 で Q3 確定）。管理者は必ずタイトルフィールドを含む検索対象フィールドを設定すること。

プラグイン設定 UI 上は「タイトルフィールドも含めて設定してください」という注記を表示する（§5.7 参照）。

### FR-4: 検索方式

- **部分一致**: クエリがフィールド値の任意の位置に含まれれば一致と判定する
- **大文字小文字区別なし**: `query.toLowerCase()` と フィールド値の `.toLowerCase()` を比較する
- **トークン間 AND**: 検索クエリをスペース（全角・半角）で分割し、全トークンが条件を満たす予定のみ一致と判定する
- **フィールド間 OR**: 各トークンの判定において、全検索対象フィールドのうちいずれか 1 つ以上がそのトークンを含めばそのトークンはマッチ扱いとする
  - 例: 「会議 A社」で検索 → （タイトル / メモ / 関連レコードのいずれかに「会議」を含む）AND（タイトル / メモ / 関連レコードのいずれかに「A社」を含む）

### FR-5: リアルタイム検索とデバウンス

- `input` イベントを監視し、入力が変化するたびにフィルタを適用してカレンダーを再描画する
- デバウンス: 最後の `input` イベントから **300ms** 後にフィルタ処理を実行する
- IME 入力中（`compositionstart` 〜 `compositionend` の間）はデバウンスタイマーを起動しない。`compositionend` 発火後に 300ms デバウンスを開始する

### ~~FR-6~~: 非一致予定の opacity 制御（v4 確定版で廃止）

> **v4 確定版で削除。** カレンダー UI は検索状態にかかわらず中立表示を維持する。検索結果の表現はフローティング一覧のみで行う（§1.5 参照）。

### FR-7: 検索状態のビュー間共有

検索クエリはビュー切替（月 / 週 / 日）をまたいで維持する。

- ユーザーが月ビューで「会議」と入力し、週ビューに切り替えた場合も「会議」での絞り込みが継続される
- 再描画時に `KC.SearchFilter.query` の値を参照してフィルタを適用する
- ビュー切替時は `activeIndex` を -1（未選択）にリセットする

### FR-8: 結果 0 件時のメッセージ

検索クエリが非空かつ一致する予定が 0 件の場合、以下の 2 箇所にメッセージを表示する。

- **カレンダーグリッド内**: `id="kc-search-empty"` の `<div>` に「「{query}」に一致する予定はありません」を表示する
- **フローティング一覧内**: `class="kc-search-dropdown-empty"` の `<div>` に「該当する予定がありません」を表示する（フローティング一覧は開いた状態を維持）

表示条件: 検索クエリ非空 かつ フィルタ適用後のマッチ件数が 0
非表示条件: 検索クエリが空 または 1 件以上マッチ

### FR-9: 検索クエリの初期化

- ページロード時: 検索クエリは空（`''`）で初期化する
- sessionStorage への保存はしない（§12.5 参照）
- kintone ビュー再表示（`app.record.index.show` イベント再発火）時: 検索クエリをリセットし、入力欄を空にする

### FR-10: 既存 EventFilter との連携

検索フィルタと既存の `KC.EventFilter`（mine / others / all）は**独立した 2 層のフィルタ**として機能する。

- 適用順序: `KC.EventFilter.apply()` → `KC.SearchFilter.apply()`
- いずれのフィルタも通過した予定のみカレンダーに描画される
- 一方のフィルタを変更しても他方のフィルタはリセットされない

### FR-11: フローティング一覧の表示（v4 正式採用）

検索クエリが非空のとき、検索バー直下にフローティング一覧（`#kc-search-dropdown`）を表示する。

- **表示データの源泉**: `_computeMatchList()` が `KC.State.events` を直接スキャンしてマッチした KcEvent を収集する。カレンダー DOM の描画状態に依存しないため、`+N more` で非表示の予定も含めて全マッチ予定をリスト表示できる
- **表示形式**: 各アイテムは「左端カラーマーカー + 日付/時刻 + タイトル」の 1 行構成
  - 日付表示: `M/D(曜) HH:MM`（終日の場合は `M/D(曜) 終日`）
  - 曜日カラー: 日曜・祝日は赤系（`kc-dd-day--sun`）、土曜は青系（`kc-dd-day--sat`）
  - カラーマーカー: 権限色（`permissionRules`）> evt.color > デフォルト色 の優先順
- **表示順**: `_matchList`（KcEvent の開始日時昇順）に基づく
- **0件時**: 「該当する予定がありません」メッセージを一覧内に表示
- **フローティング一覧の開閉**:
  - 検索入力フォーカス時にクエリが存在し matchList が空でない場合: 表示
  - 検索欄・フローティング一覧の外側クリック: 非表示
  - ESC キー: 非表示（クエリもクリア）
  - クエリが空: 非表示

### FR-12: フローティング一覧内のキーボードナビゲーション（v4 更新）

検索欄フォーカス中に、キー操作でフローティング一覧内のマッチ候補間を移動する。

#### FR-12-1: 検索入力後の初期フォーカス

- デバウンス 300ms 経過後（または IME 確定後）にマッチ候補リストが確定する
- マッチ候補リストが 1 件以上の場合、`activeIndex = 0`（先頭候補）を自動でアクティブにする
- マッチ候補リストが 0 件の場合、`activeIndex = -1`（未選択）のままにする

#### FR-12-2: Enter キーによるアクティブ候補の予定詳細モーダル起動

- 検索欄フォーカス中に Enter キーが押されたとき（IME 確定中の Enter は除く）:
  - `_openActive()` を呼び出す
  - `activeIndex` が有効な場合: フローティング一覧を閉じ、`KC.Popup.openEdit(evt.id)` で予定詳細 iframe モーダルを起動する
  - `activeIndex` が -1（未選択）の場合: 何もしない

#### FR-12-2b: ↓ キーによる次候補への移動

- 検索欄フォーカス中に ↓ キーが押されたとき:
  - `activeIndex` を 1 加算する
  - `activeIndex` がマッチ候補リストの末尾を超えた場合は 0 に戻す（循環）
  - フローティング一覧内のアクティブ行が見えるよう自動スクロールする

#### FR-12-3: ↑ キーによる前候補への移動

- 検索欄フォーカス中に ↑ キーが押されたとき:
  - `activeIndex` を 1 減算する
  - `activeIndex` が -1 を下回った場合はリスト末尾（最後の候補）に戻る（循環）
  - フローティング一覧内のアクティブ行が見えるよう自動スクロールする

#### FR-12-4: IME 確定 Enter の誤動作防止

- `compositionstart` から `compositionend` の間に発火した `keydown` の Enter は FR-12-2 の処理を実行しない
- `compositionend` イベント後に発火した Enter のみ候補移動対象とする

#### FR-12-5: ESC キーによる一覧クローズ

- 検索欄フォーカス中に ESC キーが押されたとき:
  - クエリをクリア（`setQuery('')`）
  - フローティング一覧を非表示
  - 検索欄のフォーカスを外す（`input.blur()`）

### FR-13: フローティング一覧アイテムのクリック操作（v4.1 更新）

フローティング一覧のアイテムをクリックすると以下の動作を行う。

1. クリックされたアイテムのインデックスを `activeIndex` に設定（`_activateAt(idx)` 呼び出し）
2. フローティング一覧を非表示にする（`_hideDropdown()` 呼び出し）
3. `KC.Popup.openEdit(evt.id)` を呼び出し、予定詳細 iframe モーダルを起動する

カレンダー上のハイライト（`.kc-event--match-active`）・スクロール遷移は廃止（v4）。

> 実装済み: desktop.js の `_buildDropdownItem()` 内クリックハンドラで `_activateAt(idx)` → `_hideDropdown()` → `KC.Popup.openEdit(evt.id)` の順に実行される（desktop.js:6842-6847）。

### FR-14: REFERENCE_TABLE 検索ロジック

REFERENCE_TABLE フィールドが `searchTargets` に含まれる場合、以下のロジックで検索する。

1. **フィールド定義取得**: プラグイン初期化時に `/k/v1/app/form/fields.json` を呼び出し、REFERENCE_TABLE フィールドの `referenceTable.relatedApp.app`（関連先アプリ ID）と `referenceTable.displayFields`（表示フィールド一覧）を取得する
2. **displayFields が空の場合**: その REFERENCE_TABLE フィールドは検索対象から除外する
3. **関連先レコード取得**: カレンダー表示時にカーソル API（`/k/v1/records/cursor.json`）で関連先アプリの全レコードを一括取得（カーソルによるページング対応）
4. **メモリキャッシュ**: 取得した関連先レコードを `_relatedRecordsCache[fieldCode]` に格納する（レコード ID をキーとしたマップ形式）
5. **マッチ判定**: 予定レコードの REFERENCE_TABLE フィールドの各行の `row.record.$id.value` をキーにキャッシュから対応レコードを引き、`displayFields` のフィールド値を文字列として結合してトークンで部分一致判定する

### FR-15: USER_SELECT 検索ロジック

USER_SELECT フィールドが `searchTargets` に含まれる場合、以下のロジックで検索する。

- USER_SELECT の値は `[{ code: "login_name", name: "表示名" }, ...]` 形式の配列
- 各エントリの `name`（表示名）と `code`（ログイン名）の**両方**を結合し、トークンで部分一致判定する
- 結合方法: `entry.name + ' ' + entry.code` を各エントリについて生成し、スペース区切りで結合
- USER_SELECT が空配列の場合: 空文字列を返す（マッチしない・エラーなし）

### FR-16: 関連レコードキャッシュの更新タイミング

- **カレンダー初期表示時**: `loadRelatedRecords()` を呼び出して全 REFERENCE_TABLE フィールドの関連先レコードを一括取得する
- **ビュー切替時**: `loadRelatedRecords()` を再呼び出してキャッシュを更新する
- **月送り・週送り時**: `loadRelatedRecords()` を再呼び出してキャッシュを更新する
- 手動リフレッシュボタンは今回スコープ外

### FR-17: 設定画面での検索対象フィールド追加

プラグイン設定画面（`config.html` / `config.js`）に「検索対象フィールド」設定セクションを追加する。

- **UI形式**: テーブル形式（既存の権限設定テーブルと統一感のある実装）
- **行操作**: 行追加ボタン / 行削除ボタン
- **各行の要素**: フィールドコード選択のドロップダウン
  - ドロップダウンの候補: 本アプリのフィールドのうち SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のみ表示
  - LOOKUP フィールドは元のフィールド型が上記に該当する場合に選択可能
- **タイトルフィールドの扱い**: v4 の実装ではタイトルフィールドを searchTargets に追加することで検索対象になる。設定 UI ではタイトルフィールドをドロップダウン候補に含め、選択可能にする（v3 の「タイトルフィールドは非表示・暗黙的に有効」の方針を変更）
- **保存形式**: 既存の設定 JSON に `searchTargets` 配列を追加する

```javascript
// 保存スキーマ（version 7）
{
  version: 7,
  fieldMapping: { ... },
  permissionRules: [ ... ],
  fieldValueRules: [ ... ],
  searchTargets: [
    { fieldCode: "title" },
    { fieldCode: "memo" },
    { fieldCode: "relatedMeetings" }
  ],
  views: { ... }
}
```

### FR-18: searchTargets 空時の検索バー非表示（v4 確定版新規追加）

`searchTargets` が空（タイトルを含めて何も設定なし）の場合、検索バー要素（`.kc-search`）自体を非表示にする。

**理由**: `searchTargets` が空の状態では何もマッチしない（FR-3 確定仕様）。検索バーが表示されていてもユーザーが入力しても結果が得られないため、UI 上から検索バーを取り除いて混乱を防ぐ。

**実装方針**:

- `KC.SearchFilter.init()` または `buildDOM()` 内で `_searchTargets.length === 0` を判定する
- 条件を満たす場合、検索バー要素（`#kc-search` / `.kc-search`）に `display: none` を設定する（または `hidden` 属性を付与する）
- 判定は初期化時の 1 回のみ。ビュー切替・月送り時の再評価は不要（プラグイン設定変更はページリロード前提のため）

**判定タイミング**: `KC.Boot.init()` で `KC.SearchFilter._searchTargets` が確定した直後（`buildDOM()` 呼び出し前または呼び出し時）。

**再表示条件なし**: ページリロードなしに `searchTargets` が変化することはないため、一度非表示にした検索バーをランタイムで再表示する処理は不要。

---

## 4. 非機能要件

### NF-1: パフォーマンス

- クライアント側フィルタのみ使用し、検索ごとの追加 API コールは発生させない
- デバウンス 300ms により、高速タイピング時の過剰な再描画を防ぐ
- `KC.State.events` の最大件数は `KC.Config.QUERY_LIMIT = 500` 件。この規模においてクライアント側フィルタのメモリ処理は実用的
- 関連先レコードの件数が多い場合（1000 件超など）のパフォーマンス影響は実装時に計測・判断する（§12.1 参照）

### NF-2: アクセシビリティ

- `<input>` に `aria-label="予定を検索"` を付与する
- クリアボタンに `aria-label="検索をクリア"` を付与する
- 検索欄ラッパーに `role="search"` を付与する
- フローティング一覧（`#kc-search-dropdown`）に `role="listbox"` を付与する
- 各アイテムに `role="option"` を付与する
- 結果 0 件メッセージ要素（`#kc-search-empty`）に `aria-live="polite"` を付与し、スクリーンリーダーへの通知を行う
- キーボードショートカットによる検索欄への自動フォーカス機能は実装しない（v2 確定）

### NF-3: 後方互換性

- `KC.SearchFilter` モジュールを拡張するのみで、既存モジュールの動作を変更しない
- 検索クエリが空（初期状態）の場合は検索フィルタの効果がなく、既存の動作と完全に一致する
- `searchTargets` が設定されていない（旧バージョンの設定）場合は、何もマッチしない（検索機能が無効化された状態になる）。管理者による searchTargets の設定が必須

### NF-4: モバイル / 狭幅対応

- ヘッダー右側のアイテム数が増えるため、狭幅時のレイアウト崩れを防ぐ
- 推奨案: 400px 以下では検索入力欄を折り畳み（アイコンボタン化）し、タップで展開する（§12.3 参照）

### NF-5: フローティング一覧の高さ制限（v4 追加）

フローティング一覧はマッチ件数が多い場合（目安: 100 件以上）でもレイアウトが破綻しないよう、高さに上限を設けてスクロール可能にする。

- CSS: `max-height` を設定（実装時に調整。目安: 320px〜400px）
- `overflow-y: auto` でスクロール可能にする
- アクティブ行が一覧の表示領域外になった場合は自動スクロールする（§6.9 参照）

---

## 5. UI 仕様

### 5.1 ヘッダーバーレイアウト（ASCII モック）

```
+----------------------------------------------------------------------+
| [kc-head-left]                    [kc-head-right]                    |
|                                                                      |
| タイトル [今日] [<] [>] 2026年5月  [🔍 予定を検索 ×] [すべて ▾] [月 ▾] [⛶] [⚙]|
+----------------------------------------------------------------------+
```

- `[🔍 予定を検索 ×]` が検索欄（FR-2）
- `×` はクリアボタン。クエリ空時は非表示

### 5.2 検索欄の HTML 構造

```html
<div id="kc-search" class="kc-search" role="search">
  <span class="kc-search-icon" aria-hidden="true">🔍</span>
  <input
    type="search"
    id="kc-search-input"
    class="kc-search-input"
    placeholder="予定を検索"
    aria-label="予定を検索"
    autocomplete="off"
  />
  <button
    type="button"
    id="kc-search-clear"
    class="kc-search-clear"
    aria-label="検索をクリア"
    hidden
  >×</button>
  <!-- フローティング一覧: position: relative の #kc-search を基準に absolute 配置 -->
  <div id="kc-search-dropdown" class="kc-search-dropdown" role="listbox" hidden></div>
</div>
```

### 5.3 検索欄のスタイル概要

| プロパティ | 値（案） |
|---|---|
| `.kc-search` | `display: flex; align-items: center; border: 1px solid #c1c5ca; border-radius: 10px; height: 38px; padding: 0 8px; background: #fff; position: relative;` |
| `.kc-search-input` | `border: none; outline: none; font-size: 14px; width: 160px; background: transparent;` |
| `.kc-search-clear` | `border: none; background: transparent; cursor: pointer; font-size: 14px; color: #777;` |
| `.kc-search-icon` | `font-size: 14px; color: #777; margin-right: 4px;` |
| 狭幅時（max-width: 400px） | `.kc-search-input { width: 0; }` + アイコンクリックで幅を展開（§12.3） |

### 5.4 フローティング一覧のスタイル概要（v4 追加）

| プロパティ | 値（案） |
|---|---|
| `.kc-search-dropdown` | `position: absolute; top: 100%; left: 0; min-width: 300px; max-height: 360px; overflow-y: auto; background: #fff; border: 1px solid #c1c5ca; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000;` |
| `.kc-search-dropdown-item` | `display: flex; align-items: center; padding: 6px 8px; cursor: pointer; gap: 8px;` |
| `.kc-search-dropdown-item:hover` | `background: #f3f4f6;` |
| `.kc-search-dropdown-item--active` | `background: #eff6ff;` |
| `.kc-search-dropdown-item-marker` | `width: 4px; height: 32px; border-radius: 2px; flex-shrink: 0;` |
| `.kc-search-dropdown-item-body` | `display: flex; flex-direction: column; gap: 2px;` |
| `.kc-search-dropdown-item-date` | `font-size: 11px; color: #6b7280;` |
| `.kc-search-dropdown-item-title` | `font-size: 13px; color: #111827;` |
| `.kc-search-dropdown-empty` | `padding: 12px; text-align: center; color: #6b7280; font-size: 13px;` |
| `.kc-dd-day--sun` | `color: #ef4444;` |
| `.kc-dd-day--sat` | `color: #3b82f6;` |

### 5.5 フローティング一覧の状態遷移（v4 更新）

```
[初期状態: クエリ空]
  入力欄: 空, プレースホルダー表示
  クリアボタン: hidden
  カレンダー: 通常表示（全予定）
  フローティング一覧: hidden
  activeIndex: -1

  ↓ ユーザーが文字を入力 & 300ms 経過（または IME 確定）

[検索中: クエリ非空、マッチあり]
  入力欄: テキスト表示
  クリアボタン: 表示
  カレンダー: 通常表示（全予定を opacity 変更なく表示。検索状態はフローティング一覧のみで表現）
  フローティング一覧: 表示（マッチ予定を全件リスト）
  activeIndex: 0（先頭マッチ候補を自動アクティブ化）
  アクティブ行: .kc-search-dropdown-item--active クラス付与

  ↓ Enter キー（IME 確定中を除く）
  _openActive(): フローティング一覧を閉じ、KC.Popup.openEdit(evt.id) でモーダル起動

  ↓ ↓ キー
  activeIndex += 1（末尾超えで 0 に戻る）
  フローティング一覧内をスクロール

  ↓ ↑ キー
  activeIndex -= 1（-1 下回りで末尾インデックスに戻る）
  フローティング一覧内をスクロール

  ↓ アイテムクリック
  activeIndex = クリックされたアイテムのインデックス
  フローティング一覧: hidden
  KC.Popup.openEdit(evt.id) → 予定詳細 iframe モーダルを起動

  ↓ 検索欄外をクリック
  フローティング一覧: hidden（クエリ・activeIndex は維持）

  ↓ 検索欄にフォーカスが戻る
  フローティング一覧: 再表示（matchList が空でない場合）

  ↓ クリアボタン or バックスペースで全削除

[初期状態に戻る]
  カレンダー: 通常表示（変更なし）
  フローティング一覧: hidden
  activeIndex: -1

  ↓ 一致件数が 0 になった場合

[0件状態]
  カレンダーグリッド内に「「{query}」に一致する予定はありません」を表示
  フローティング一覧: 表示（「該当する予定がありません」メッセージを表示）
  activeIndex: -1
```

### 5.6 ビュー再描画時の検索フィルタ適用位置（v4.1 更新）

```
R.refresh() が呼ばれる
  ↓
KC.EventFilter.apply(KC.State.events)   // 既存フィルタ（mine/others/all）
  ↓
KC.SearchFilter.apply(filteredEvents)  // 検索フィルタ（配列をそのまま返すのみ）
  ↓
描画対象イベント配列 → ビュー描画関数へ渡す
  ↓
（REFERENCE_TABLE キャッシュ更新: loadRelatedRecords()）
  ↓
KC.SearchFilter._computeMatchList()    // KC.State.events 直接スキャン
                                       // → _matchList（KcEvent 配列）構築
                                       // → フローティング一覧（#kc-search-dropdown）更新
                                       // ※ カレンダー DOM への opacity 付与は別処理
```

### 5.7 プラグイン設定画面: 検索対象フィールド設定 UI（v4 更新）

```
+-----------------------------------------------------------+
| 検索対象フィールド設定                                        |
|                                                           |
|  ※ タイトルフィールドも含めて設定してください                   |
|                                                           |
|  +------------------------------------------+  [行を追加] |
|  | フィールド  | 操作                        |            |
|  +------------------------------------------+            |
|  | [タイトル ▾]| [削除]                      |            |
|  +------------------------------------------+            |
|  | [メモ ▾]   | [削除]                      |            |
|  +------------------------------------------+            |
|  | [担当者 ▾] | [削除]                      |            |
|  +------------------------------------------+            |
|                                                           |
+-----------------------------------------------------------+
```

- ドロップダウン候補: 本アプリの SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のフィールドを全て表示（タイトルフィールドも含む）
- 「行を追加」クリックで空行を末尾に追加
- 「削除」クリックでその行を削除
- 行の並び替えは Phase 2 では任意（実装コストと相談して省略可）

---

## 6. データ構造・モジュール設計

### 6.1 KC.SearchFilter モジュール（v4 更新）

```javascript
KC.SearchFilter = {
  query: '',           // 現在の検索クエリ（空文字 = 無効）
  _timer: null,        // デバウンス用タイマーID
  _composing: false,   // IME 入力中フラグ
  activeIndex: -1,     // アクティブ候補の index（-1 = 未選択）
  _matchList: [],      // 現在のマッチ候補 KcEvent オブジェクト配列（開始日時昇順）

  // Phase 2 追加プロパティ
  _relatedRecordsCache: {},  // { [fieldCode]: { [recordId]: kintoneRecord } }
  _searchTargets: [],        // プラグイン設定から読み込んだ searchTargets 配列
  _refTableDefs: {},         // { [fieldCode]: { appId, displayFields: [...] } }
  _refTableDefsLoaded: false, // _loadRefTableDefs 完了フラグ（二重取得防止）
  _warnedFields: new Set(),  // matchField で一度 warn 済みのフィールドコード（コンソール汚染防止）

  // v4 追加: フローティング一覧外側クリックのバインド済みフラグ
  _outsideClickBound: false,

  /** 検索クエリを設定し、再描画をトリガーする */
  setQuery: function(q) { ... },

  /** events 配列をそのまま返す（フィルタしない。視覚化は _computeMatchList + opacity 付与で行う） */
  apply: function(events) { ... },

  /** クエリトークンを返す */
  _getTokens: function() { ... },

  /**
   * 1件の予定が全トークンにマッチするかを判定する（フィールド間 OR、トークン間 AND）
   * searchTargets が空の場合は何もマッチしない
   * @param {Object} evt - KcEvent
   * @param {string[]} tokens
   * @returns {boolean}
   */
  _matchesTokens: function(evt, tokens) { ... },

  /**
   * クエリが空または該当予定かどうかを判定する（単体チェック用）
   * @param {Object} evt - KcEvent
   * @returns {boolean}
   */
  _matches: function(evt) { ... },

  /**
   * 特定フィールドコードの値から検索用文字列を取得する
   * @param {Object} record - kintone 元レコード
   * @param {string} fieldCode - フィールドコード
   * @returns {string}
   */
  matchField: function(record, fieldCode) { ... },

  /** REFERENCE_TABLE フィールド定義を取得して _refTableDefs に格納する */
  _loadRefTableDefs: async function() { ... },

  /** 全 REFERENCE_TABLE フィールドの関連先レコードをカーソル API で一括取得してキャッシュする */
  loadRelatedRecords: async function() { ... },

  /** 指定 REFERENCE_TABLE フィールドの関連先アプリの全レコードを取得する */
  _fetchAllRelatedRecords: async function(fieldCode) { ... },

  /**
   * KC.State.events をスキャンしてマッチ候補 KcEvent 配列（_matchList）を構築し、
   * フローティング一覧を更新する。DOM には一切手を加えない（v4.1 追加）
   */
  _computeMatchList: function() { ... },

  /**
   * Enter キー押下時: アクティブ候補の予定詳細モーダルを開く（v4.1 追加）
   * _matchList[activeIndex].id を KC.Popup.openEdit() に渡してモーダル起動
   */
  _openActive: function() { ... },

  /** activeIndex を変更してアクティブ候補を切り替え、フローティング一覧を同期する */
  _activateAt: function(newIndex) { ... },

  /** ↓ キー押下時: フローティング一覧内で次候補に移動（循環あり） */
  focusNext: function() { ... },

  /** ↑ キー押下時: フローティング一覧内で前候補に移動（循環あり） */
  focusPrev: function() { ... },

  /** 0件メッセージの表示/非表示を制御する */
  _updateEmptyMsg: function(show, query) { ... },

  /** クリアボタンの表示/非表示を同期する */
  _syncClearBtn: function() { ... },

  /**
   * 検索欄 DOM を生成して headRight の先頭に挿入する
   * searchTargets が空の場合は生成した要素を非表示にする（FR-18）
   */
  buildDOM: function(headRight) { ... },

  /** 0件メッセージ DOM を生成する */
  _buildEmptyMsg: function() { ... },

  /** 外側クリックリスナーを登録する（多重登録防止） */
  _bindOutsideClick: function() { ... },

  /** input と clearBtn にイベントリスナーを設定する */
  _bindEvents: function(input, clearBtn) { ... },

  /** デバウンスタイマーをセットして検索を実行する */
  _scheduleSearch: function(val) { ... },

  /** KC.State.events から id でイベントオブジェクトを逆引きする */
  _evtFromId: function(id) { ... },

  /** evt.start から M/D(曜) HH:MM または M/D(曜) 終日 を返す（§6.8 参照） */
  _fmtEvtDate: function(evt) { ... },

  /** フローティング一覧の内容を _matchList から再構築して表示/非表示を切り替える */
  _renderDropdown: function() { ... },

  /** フローティング一覧の 1 行 DOM を生成する */
  _buildDropdownItem: function(el, idx) { ... },

  /** 日時表示 div に土日祝色付き span を挿入する */
  _buildDateContent: function(container, evt) { ... },

  /** フローティング一覧内のアクティブ行を activeIndex に同期する */
  _updateDropdownActive: function() { ... },

  /** フローティング一覧を非表示にする */
  _hideDropdown: function() { ... },

  /** フローティング一覧を表示する（matchList が空でなくクエリが存在する場合のみ） */
  _showDropdown: function() { ... }
};
```

### 6.2 apply() の動作仕様

`apply()` は events をそのまま返す。検索結果の表示は `_computeMatchList()` によるフローティング一覧更新のみで行う（v4 確定版: opacity 制御は廃止）。

```
KC.SearchFilter.apply(events):
  return events  // 全件返す
```

### 6.3 _matchesTokens() の動作仕様（v4 更新）

```
KC.SearchFilter._matchesTokens(evt, tokens):
  // searchTargets が空の場合は何もマッチしない
  if searchTargets.length === 0: return false

  // searchTargets の各フィールドテキストを収集する
  fieldTexts = searchTargets.map(target =>
    matchField(evt.record, target.fieldCode).toLowerCase()
  )

  // トークン間 AND、フィールド間 OR
  return tokens.every(token =>
    fieldTexts.some(text => text.includes(token))
  )
```

タイトルフィールドも searchTargets に含める必要がある（v3 の暗黙的な固定対象の扱いは廃止）。

### 6.4 matchField() の動作仕様

```
KC.SearchFilter.matchField(record, fieldCode):
  field = record[fieldCode]
  if !field:
    // 初回のみ warn を出力（_warnedFields で重複防止）
    return ''

  if field.type === 'USER_SELECT':
    return field.value.map(u => u.name + ' ' + u.code).join(' ')

  if field.type === 'REFERENCE_TABLE':
    def = _refTableDefs[fieldCode]
    if !def or !def.displayFields.length: return ''
    cache = _relatedRecordsCache[fieldCode]
    if !cache: return ''
    return field.value.map(row => {
      relRecord = cache[row.record.$id.value]
      if !relRecord: return ''
      return def.displayFields.map(df => relRecord[df.fieldCode].value || '').join(' ')
    }).join(' ')

  // SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / LOOKUP 等
  return field.value || ''
```

### 6.5 関連レコードキャッシュ構造

```javascript
// _relatedRecordsCache の構造
{
  "relatedMeetings": {          // REFERENCE_TABLE フィールドコード
    "1": { ...kintoneRecord },  // レコード ID（文字列） → kintone レコードオブジェクト
    "2": { ...kintoneRecord },
    ...
  },
  "anotherRefField": { ... }
}
```

### 6.6 _computeMatchList() の動作仕様（v4.1: applyHighlight から置換）

`applyHighlight()` は削除済み。代わりに `_computeMatchList()` が `KC.State.events` を直接スキャンしてフローティング一覧を更新する。カレンダー DOM には一切手を加えない。

```
KC.SearchFilter._computeMatchList():
  if !query:
    _matchList = []
    activeIndex = -1
    _updateEmptyMsg(false, '')
    _renderDropdown()
    return

  tokens = _getTokens()
  if tokens.length === 0:
    _matchList = []
    _updateEmptyMsg(false, '')
    _renderDropdown()
    return

  events = KC.State.events || []

  // マッチする KcEvent を収集（+N more 隠れ予定も含む全件スキャン）
  matched = events.filter(evt => _matchesTokens(evt, tokens))

  // 開始日時昇順ソート
  matched.sort((a, b) => new Date(a.start) - new Date(b.start))

  _matchList = matched  // KcEvent オブジェクト配列（DOM 要素リストではない）

  _updateEmptyMsg(matched.length === 0, query)

  if matched.length === 0:
    activeIndex = -1
  else if activeIndex < 0 or activeIndex >= matched.length:
    activeIndex = 0

  _renderDropdown()       // _matchList から各行の DOM を生成
  _updateDropdownActive() // activeIndex の行に --active クラスを付与
```

`_computeMatchList()` はカレンダー DOM には一切手を加えない。フローティング一覧の更新のみが責務（v4 確定版: opacity 制御は廃止）。

> `.kc-event--match` / `.kc-event--match-active` クラスの付与は廃止済み。廃止のタイミングは §12.11 を参照。

### 6.7 _matchList の順序と _renderDropdown() との関係（v4.1 更新）

`_matchList` の要素は **KcEvent オブジェクト**であり、`KC.State.events` をスキャンして `_matchesTokens()` でマッチしたものを開始日時昇順にソートしたもの。`_renderDropdown()` はこの `_matchList` を元にフローティング一覧の行を構築するため、一覧の表示順も開始日時昇順になる。

`_matchList` は DOM の描画状態に依存しない。`+N more` で非表示の予定も `KC.State.events` に存在する限り `_matchList` に含まれ、フローティング一覧に表示される（§12.12 解決済み）。

### 6.8 _fmtEvtDate() の動作仕様

```
KC.SearchFilter._fmtEvtDate(evt):
  d = new Date(evt.start)
  prefix = (d.getMonth()+1) + '/' + d.getDate() + '(' + DAY_NAMES[d.getDay()] + ')'
  if evt.allday: return prefix + ' 終日'
  return prefix + ' ' + HH + ':' + MM
```

_buildDateContent() は同等の出力を DOM ノードとして生成し、土日祝に色クラスを付与する。

### 6.9 フローティング一覧の自動スクロール

`_updateDropdownActive()` はアクティブ行がドロップダウンのスクロール領域外の場合に自動スクロールする。

```
_updateDropdownActive():
  items = dd.querySelectorAll('.kc-search-dropdown-item')
  // 全アイテムから --active クラスを除去
  // activeIndex の行に --active クラスを追加
  // アクティブ行の offsetTop / offsetHeight と dd.scrollTop / clientHeight を比較
  // 上にはみ出ている場合: dd.scrollTop = itemTop
  // 下にはみ出ている場合: dd.scrollTop = itemBottom - dd.clientHeight
```

### 6.10 sessionStorage への保存（保存しない）

v4 でも sessionStorage への保存は行わない。ページリロードや kintone ビュー再表示時に空にリセットされる。

---

## 7. 既存実装への変更点

> 注意: 本セクションはコードの静的調査に基づく推測を含む。「未確認」と記載した箇所は実機確認を要する。

### 7.1 desktop.js の変更（見込み）

| 箇所 | 変更内容 | 確認状況 |
|---|---|---|
| `KC.SearchFilter` モジュール全体 | v4 の新規メソッド群（`_computeMatchList`, `_openActive`, `_renderDropdown`, `_buildDropdownItem`, `_buildDateContent`, `_updateDropdownActive`, `_hideDropdown`, `_showDropdown`, `_fmtEvtDate`, `_buildEmptyMsg`, `_bindOutsideClick`, `_evtFromId`, `_fetchAllRelatedRecords` 等）を実装済み | 実装済み |
| `KC.SearchFilter._computeMatchList()` | `KC.State.events` 直接スキャンでマッチ候補収集 → フローティング一覧更新（`_renderDropdown` / `_updateDropdownActive`）。`applyHighlight()` は削除済み | 実装済み |
| `.kc-event--match` / `.kc-event--match-active` クラス付与 | v4 で廃止予定。現時点は互換のため残存 | 廃止未完 |
| `focusNext` / `focusPrev` | フローティング一覧内の activeIndex を更新。カレンダーセルへのスクロールは廃止予定 | 実装済み（廃止未完） |
| `KC.Boot.init()` | `KC.SearchFilter._searchTargets` を `KC.Config.SEARCH_TARGETS` から初期化 | 実装済み |
| イベント DOM への属性付与 | 各予定 DOM に `data-event-id` を付与し、`_evtFromId()` で逆引き | 実装済み（desktop.js:3184, 4168, 4256, 4315 参照） |

### 7.2 desktop.css の変更（見込み）

| 変更内容 | 確認状況 |
|---|---|
| `.kc-search-dropdown` 関連スタイル（§5.4）の追加 | 実装済みか要確認 |
| `.kc-event--match` / `.kc-event--match-active` スタイル | v4 廃止予定。CSS も合わせて削除する |
| `.kc-dd-day--sun` / `.kc-dd-day--sat` | 実装済みか要確認 |

### 7.3 config.html / config.js の変更

| 箇所 | 変更内容 |
|---|---|
| `config.html` | 「検索対象フィールド設定」セクションの HTML を追加（テーブル形式） |
| `config.js` の `SEARCH_TARGET_TYPES` 定数 | `['SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT', 'REFERENCE_TABLE', 'USER_SELECT']` を定義 |
| `config.js` の `loadFields()` | `searchTargets` ドロップダウンの候補フィールドを `SEARCH_TARGET_TYPES` でフィルタして生成する処理を追加 |
| `config.js` の `collectSearchTargets()` | テーブルの各行からフィールドコードを収集して配列を返す関数を新規追加 |
| `config.js` の `applySearchTargets()` | 保存済み `searchTargets` をフォームに反映する関数を新規追加 |
| `config.js` の `saveConfig()` | `currentConfig.searchTargets = collectSearchTargets()` を追加 |
| `config.js` の保存スキーマ | `version: 7` へ移行。`searchTargets: []` を追加（`v6→v7` マイグレーション: searchTargets が未定義なら空配列をセット） |

### 7.4 プラグイン設定 JSON スキーマへの変更

```javascript
// version 7 スキーマ
{
  version: 7,
  fieldMapping: { fieldTitle, fieldStart, fieldEnd, fieldAllday, ... },
  permissionRules: [ ... ],
  fieldValueRules: [ ... ],
  searchTargets: [
    { fieldCode: "title" },   // タイトルも明示的に追加が必要（v4 で仕様変更）
    { fieldCode: "memo" },
    { fieldCode: "relatedMeetings" }
  ],
  views: { "<viewId>": { calendarTitle, defaultView } }
}
```

v6 → v7 マイグレーション: `searchTargets` が未定義の場合は `[]` をセットする。

---

## 8. 影響範囲 / 非干渉確認

### 8.1 権限色（v6.1）との干渉

`REQ_edit-permission-extension.md` の v5/v6 で実装された権限色（`bgColor` / `textColor` のインラインスタイル）と検索フィルタの相互作用を確認する。

| 状況 | 期待動作 |
|---|---|
| 検索クエリ非空、かつ一致予定に権限色あり | 権限色（`bgColor` / `textColor`）を維持。カレンダー上の表示は変更しない |
| 検索クエリ非空、かつ非一致予定に権限色あり | 権限色を維持。カレンダー上の表示は変更しない（v4 確定版: opacity 制御廃止）|
| フローティング一覧のカラーマーカー | `permissionRules` の `bgColor` > `evt.color` > デフォルト色の優先順で決定する |

### 8.2 FilterDropdown（mine/others/all）との干渉

- 検索フィルタと eventFilter は独立した 2 層のフィルタとして設計（FR-10）
- `KC.EventFilter.apply()` の後に `KC.SearchFilter.apply()` を適用するため、eventFilter で除外された予定は検索対象から除外される（仕様どおり）
- eventFilter 変更時は `R.refresh()` が呼ばれ、検索フィルタも自動的に再適用される（未確認）

### 8.3 ビュー個別設定との干渉

- ビュー切替は `R.refresh()` で再描画されるため、検索クエリが `KC.SearchFilter.query` に保持されていれば再描画時にも自動適用される
- ビュー切替時は `activeIndex` をリセットする（FR-7）
- ビュー切替時に `loadRelatedRecords()` を呼ぶため、関連レコードキャッシュも更新される
- 干渉なし（予定）

### 8.4 全画面表示機能との干渉

- 全画面時もヘッダーは表示されるため、検索欄は全画面時でも利用可能
- `kc-expanded` クラスの CSS が検索欄の表示に干渉しないことを確認すること（未確認）

### 8.5 REFERENCE_TABLE フィールドへのアクセス権限

- 関連先アプリへの閲覧権限がないユーザーがログインしている場合、`/k/v1/records/cursor.json` の呼び出しが 403 等を返す可能性がある
- この場合、当該 REFERENCE_TABLE フィールドのキャッシュを空（`{}`）にし、コンソールに警告ログを出力する
- ユーザーへのエラー通知はしない（検索対象から静かに除外する）

### 8.6 `+N more` 非表示予定とフローティング一覧（v4.1 解決済み）

`_computeMatchList()` は `KC.State.events` を直接スキャンするため、月ビューで `+N more` に隠れている予定も含めてフローティング一覧に表示される。DOM の描画状態に依存しない（§12.12 参照）。

---

## 9. 受入基準

### AC-1〜AC-16（Phase 1 継続）

Phase 1（v2）で定義済みの AC-1〜AC-16 は引き続き有効（ただし AC-5〜AC-8 のカレンダーハイライト関連は v4 廃止後に削除予定）。以下、Phase 2 / v4 追加分。

### AC-P2-1: プラグイン設定で追加したフィールドが検索対象になる

- **Given**: プラグイン設定の「検索対象フィールド設定」にタイトルフィールドと MULTI_LINE_TEXT 型の「メモ」フィールドを追加して保存した
- **When**: 「メモ」フィールドにのみ「会議」というキーワードが含まれる予定を対象に、検索欄に「会議」と入力する
- **Then**: フローティング一覧に当該予定が表示される

### AC-P2-2: REFERENCE_TABLE フィールドの displayFields が検索対象になる

- **Given**: プラグイン設定に REFERENCE_TABLE 型の「関連商談」フィールドを追加した。関連先アプリの displayFields に「商談名」フィールドが設定されている
- **When**: 関連先の「商談名」にのみ「A社」が含まれる予定を対象に、検索欄に「A社」と入力する
- **Then**: フローティング一覧に当該予定が表示される

### AC-P2-3: USER_SELECT の name と code 両方で検索できる

- **Given**: プラグイン設定に USER_SELECT 型の「担当者」フィールドを追加した。担当者として `{ code: "tanaka.taro", name: "田中 太郎" }` が設定されている予定がある
- **When**: 検索欄に「田中」と入力する
- **Then**: フローティング一覧に当該予定が表示される
- **When**: 検索欄に「tanaka.taro」と入力する
- **Then**: フローティング一覧に当該予定が表示される

### AC-P2-4: フィールド間 OR が機能する

- **Given**: タイトル「定例会」、メモ「A社向け」の予定が存在する。searchTargets にタイトルフィールドと「メモ」を設定済み
- **When**: 検索欄に「定例 A社」と入力する（スペース区切り AND 検索）
- **Then**: 「定例会」はタイトルで「定例」にマッチし、メモで「A社」にマッチするためフローティング一覧に表示される
- **When**: 検索欄に「定例 未登録キーワード」と入力する
- **Then**: どのフィールドにも「未登録キーワード」がないため当該予定はフローティング一覧に表示されない

### AC-P2-5: 関連先レコードがメモリキャッシュされる

- **Given**: REFERENCE_TABLE フィールドが searchTargets に含まれている
- **When**: カレンダービューが初期表示される
- **Then**: `KC.SearchFilter._relatedRecordsCache` に関連先アプリのレコードが格納されている（ブラウザの開発者ツールで確認可能）

### AC-P2-6: ビュー切替・月送り後にキャッシュが更新される

- **Given**: カレンダービューが表示されており関連レコードキャッシュが存在する
- **When**: 月送りボタンを押す
- **Then**: `loadRelatedRecords()` が再呼び出しされ、キャッシュが更新される（ネットワークログで確認可能）

### AC-P2-7: searchTargets 未設定時は検索が無効化される（v4 更新）

- **Given**: プラグイン設定の「検索対象フィールド設定」が空（または設定バージョンが v6 以前）
- **When**: 検索欄にキーワードを入力する
- **Then**: フローティング一覧に何も表示されない（マッチなし・0件状態）

### AC-P2-8: 権限のない関連先アプリは除外されてもエラーにならない

- **Given**: searchTargets に含まれる REFERENCE_TABLE の関連先アプリに、ログインユーザーが閲覧権限を持たない
- **When**: カレンダービューを表示する
- **Then**: コンソールに警告ログが出力されるが、ユーザー向けのエラーメッセージは表示されない
- **And**: 他の検索対象フィールドでの検索は正常に機能する

### AC-P2-9: 設定 UI のドロップダウンに対象型のみ表示される

- **Given**: プラグイン設定画面を開く
- **When**: 「検索対象フィールド設定」の行追加ボタンを押し、フィールドコードのドロップダウンを開く
- **Then**: ドロップダウンには SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のフィールドのみ表示される
- **And**: DATE 型・DROP_DOWN 型等は表示されない

### AC-V4-1: フローティング一覧のキーボードナビゲーション（v4 新規・v4.1 Enter 動作修正）

- **Given**: 検索欄にキーワードを入力してフローティング一覧が表示されている
- **When**: ↓ キーを押す
- **Then**: 次の候補が `.kc-search-dropdown-item--active` クラスでハイライトされ、フローティング一覧内で見えるようスクロールする
- **When**: ↑ キーを押す
- **Then**: 前の候補がアクティブになる（末尾から先頭への循環を含む）
- **When**: Enter キーを押す（IME 確定中を除く）かつ activeIndex が有効な値の場合
- **Then**: フローティング一覧が閉じられ、アクティブ候補の予定詳細 iframe モーダルが起動する

### AC-V4-2: フローティング一覧アイテムのクリック操作（v4 新規・v4.1 モーダル起動を明記）

- **Given**: フローティング一覧が表示されている
- **When**: 一覧内のアイテムをクリックする
- **Then**: クリックされたアイテムが `activeIndex` に設定され、フローティング一覧が非表示になる
- **And**: `KC.Popup.openEdit(evt.id)` が呼び出され、予定詳細 iframe モーダルが起動する

### AC-V4-3: ESC キーでクエリクリア（v4 新規）

- **Given**: 検索欄にキーワードが入力されてフローティング一覧が表示されている
- **When**: ESC キーを押す
- **Then**: 検索欄が空になり、フローティング一覧が非表示になり、カレンダーが通常表示に戻る

### AC-V4-4: フローティング一覧の 0 件メッセージ（v4 新規）

- **Given**: 検索欄にキーワードを入力した
- **When**: どの予定もマッチしない
- **Then**: フローティング一覧に「該当する予定がありません」というメッセージが表示される（フローティング一覧は開いた状態）
- **And**: カレンダーグリッド内に「「{query}」に一致する予定はありません」が表示される

### AC-V4-5: 大量マッチ時のフローティング一覧スクロール（v4 新規）

- **Given**: 100 件以上の予定がマッチする検索クエリを入力した
- **When**: フローティング一覧が表示される
- **Then**: 一覧に `max-height` の上限が設定されており、スクロール操作で全件閲覧できる（レイアウト崩れなし）

### AC-V4-6: 外側クリックでフローティング一覧を閉じる（v4 新規）

- **Given**: フローティング一覧が表示されている
- **When**: 検索欄とフローティング一覧の外側をクリックする
- **Then**: フローティング一覧が非表示になる
- **And**: 検索クエリは維持され、カレンダーの表示状態は変わらない

### AC-V4-7: 検索欄にフォーカスが戻るとフローティング一覧が再表示される（v4 新規）

- **Given**: クエリが入力されておりフローティング一覧が外側クリックで閉じられた状態
- **When**: 検索欄をクリックしてフォーカスする
- **Then**: フローティング一覧が再表示される（matchList が空でない場合）

### AC-V4-8: searchTargets 空時に検索バーが非表示になる（v4 確定版新規）

- **Given**: プラグイン設定の「検索対象フィールド設定」が空（searchTargets = []）の状態でページをロードする
- **When**: カレンダービューが表示される
- **Then**: ヘッダーバーに検索バー（`.kc-search`）が表示されない
- **And**: 検索バーが非表示であっても他の機能（フィルタドロップダウン・ビュー切替・全画面ボタン等）は正常に動作する

---

## 10. 検証項目

### T-1〜T-12（Phase 1 継続）

Phase 1（v2）で定義済みの T-1〜T-12 は引き続き有効。以下、Phase 2 / v4 追加分。

### T-P2-1: 正常系 — 追加フィールドの検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-1-1 | searchTargets にタイトルと「メモ」を設定し、メモフィールドに「重要」を持つ予定を「重要」で検索 | フローティング一覧に当該予定が表示される |
| T-P2-1-2 | タイトルにもメモにもマッチしない予定 | フローティング一覧に表示されない（カレンダー上の表示変更なし） |
| T-P2-1-3 | searchTargets が空の状態でキーワードを入力 | フローティング一覧に何も表示されない（0件状態） |

### T-P2-2: 正常系 — REFERENCE_TABLE 検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-2-1 | REFERENCE_TABLE の displayFields にある「商談名」で「B社」を持つ関連レコードを参照する予定を「B社」で検索 | フローティング一覧に当該予定が表示される |
| T-P2-2-2 | displayFields が空に設定されている REFERENCE_TABLE フィールドで検索 | 当該フィールドは無視され、他フィールドのみで判定 |
| T-P2-2-3 | 関連先レコードが存在しない REFERENCE_TABLE（空の参照）を持つ予定 | マッチしない（エラーなし） |

### T-P2-3: 正常系 — USER_SELECT 検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-3-1 | 担当者フィールドの表示名「田中 太郎」を対象に「田中」で検索 | フローティング一覧に当該予定が表示される |
| T-P2-3-2 | 同フィールドのログイン名「tanaka.taro」を対象に「tanaka」で検索 | フローティング一覧に当該予定が表示される |
| T-P2-3-3 | USER_SELECT が空（未設定）の予定 | マッチしない（エラーなし） |

### T-P2-4: 正常系 — フィールド間 OR の組み合わせ

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-4-1 | 「会議 A社」で検索。タイトルに「会議」、メモに「A社」がある予定 | フローティング一覧に表示（トークン間 AND かつフィールド間 OR） |
| T-P2-4-2 | 「会議 A社」で検索。タイトルに「会議」だけあり「A社」はどこにもない予定 | フローティング一覧に表示されない |
| T-P2-4-3 | 「会議 A社」で検索。タイトルに「会議」「A社」両方を含む予定 | フローティング一覧に表示される |

### T-P2-5: 正常系 — キャッシュ更新

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-5-1 | カレンダー初期表示時にネットワークログを確認 | 関連先アプリの `/k/v1/records/cursor.json` が呼ばれる |
| T-P2-5-2 | 月送りボタン押下後にネットワークログを確認 | `/k/v1/records/cursor.json` が再度呼ばれる |
| T-P2-5-3 | ビュー切替後にネットワークログを確認 | `/k/v1/records/cursor.json` が再度呼ばれる |

### T-P2-6: パフォーマンス — 関連先レコード件数

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-6-1 | 関連先アプリに 100 件のレコードがある状態でカレンダーを表示 | 初期表示の遅延が許容範囲内（目安: 2 秒以内） |
| T-P2-6-2 | 関連先アプリに 500 件のレコードがある状態でカレンダーを表示 | 初期表示の遅延を計測・記録する |
| T-P2-6-3 | 関連先アプリに 1000 件のレコードがある状態でカレンダーを表示 | 初期表示の遅延を計測し、閾値（§12.1）の判断材料にする |

### T-P2-7: 文字エンコード

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-7-1 | 全角スペースを含むクエリで検索（「会議　A社」） | T-P2-4-1 と同等の結果 |
| T-P2-7-2 | 全角英数字を含むフィールド値に対して半角で検索 | 大文字小文字区別なし（toLowerCase による正規化）で一致する |

### T-P2-8: 異常系・エッジケース

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-8-1 | 権限のない関連先アプリが REFERENCE_TABLE に設定されている | コンソール警告のみ。ユーザーエラー表示なし。他フィールドで検索続行 |
| T-P2-8-2 | 設定に存在しないフィールドコードが searchTargets に含まれている | 警告ログ出力（初回のみ）。当該フィールドは無視して検索続行 |
| T-P2-8-3 | REFERENCE_TABLE の displayFields が空配列 | 当該フィールドは検索対象外。エラーなし |

### T-V4-1: フローティング一覧の表示確認（v4 新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-1-1 | 検索欄にキーワードを入力 | 検索バー直下にフローティング一覧が表示される |
| T-V4-1-2 | フローティング一覧の各行に日付/時刻とタイトルが表示されている | 表示形式が「M/D(曜) HH:MM タイトル」になっている |
| T-V4-1-3 | 終日予定のフローティング一覧行 | 「M/D(曜) 終日 タイトル」の形式で表示される |
| T-V4-1-4 | 土曜日の予定 | 曜日部分が青系（`.kc-dd-day--sat`）で表示される |
| T-V4-1-5 | 日曜日・祝日の予定 | 曜日部分が赤系（`.kc-dd-day--sun`）で表示される |
| T-V4-1-6 | 権限色が設定されている予定 | フローティング一覧の左端カラーマーカーに権限色が反映される |

### T-V4-2: フローティング一覧のキーボード操作（v4 新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-2-1 | ↓ キー押下 | 次のアイテムが `--active` クラスでハイライト、一覧内スクロール |
| T-V4-2-2 | ↑ キー押下 | 前のアイテムがアクティブ（末尾からの循環を含む） |
| T-V4-2-3 | Enter キー押下（IME 確定中を除く、activeIndex が有効な場合） | フローティング一覧が閉じられ、アクティブ候補の予定詳細 iframe モーダルが起動する |
| T-V4-2-4 | ESC キー押下 | クエリクリア、一覧非表示、カレンダー通常表示 |
| T-V4-2-5 | 末尾アイテムで ↓ キー | 先頭アイテムに戻る（循環） |
| T-V4-2-6 | 先頭アイテムで ↑ キー | 末尾アイテムに移動（循環） |

### T-V4-3: フローティング一覧のクリック操作（v4 新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-3-1 | アイテムをクリック | クリックしたアイテムが `activeIndex` に設定され、一覧が閉じ、予定詳細 iframe モーダルが起動する |
| T-V4-3-2 | クリック後にクエリが維持されているか確認（モーダルを閉じてから確認） | 検索欄のテキストが維持される（カレンダーは通常表示のまま） |
| T-V4-3-3 | 外側クリック | 一覧が非表示になり、クエリが維持される |
| T-V4-3-4 | 外側クリック後に検索欄をクリック | 一覧が再表示される（matchList が空でない場合） |

### T-V4-4: 大量マッチ時のスクロール確認（v4 新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-4-1 | 50 件以上がマッチするクエリで検索 | フローティング一覧に `max-height` の制限がかかりスクロール可能 |
| T-V4-4-2 | 大量マッチ時に ↓ キーで末尾方向へナビゲート | アクティブ行が一覧内でスクロールして見えるようになる |

### T-V4-5: 月送り時のフローティング一覧の挙動（v4 新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-5-1 | 検索中に月送りボタンを押す | フローティング一覧が月送り後の予定で再描画される |
| T-V4-5-2 | 月送り後に `activeIndex` が -1 にリセットされているか確認 | リセットされてアクティブ行なしの状態になる |

### T-V4-6: searchTargets 空時の検索バー非表示（v4 確定版新規）

| # | 操作 | 期待結果 |
|---|---|---|
| T-V4-6-1 | searchTargets が空のプラグイン設定でページをロードする | ヘッダーバーに検索バーが表示されない |
| T-V4-6-2 | searchTargets が空の状態でフィルタドロップダウンを操作する | 正常に動作する（検索バー非表示は他機能に影響しない） |
| T-V4-6-3 | searchTargets に 1 件以上設定したプラグイン設定でページをロードする | ヘッダーバーに検索バーが表示される |

---

## 11. エッジケース・リスク

### 11.1 関連先アプリへのアクセス権限なし

- **挙動**: `/k/v1/records/cursor.json` が 403 等のエラーを返す
- **対処**: `_fetchAllRelatedRecords()` 内で try-catch し、失敗した REFERENCE_TABLE フィールドのキャッシュを空（`{}`）にする。コンソールに `[KC SearchFilter] REFERENCE_TABLE "<fieldCode>" のキャッシュ取得失敗: <error>` を出力する

### 11.2 関連先レコード数が多い場合（カーソル API で対応済み）

- **状況**: 実装でカーソル API（`/k/v1/records/cursor.json`）による全件ページング取得が実装済み（desktop.js:6369〜6434）
- **対処方針**: 大量レコード時のパフォーマンス影響は T-P2-6 で計測する

### 11.3 REFERENCE_TABLE の displayFields が空

- **挙動**: `matchField()` で空文字列を返す
- **対処**: 検索対象外として無視する（エラーなし）

### 11.4 設定でフィールドコード指定済みだが該当フィールドが削除済み

- **状況**: searchTargets に `{ fieldCode: "deletedField" }` が残っているが、フィールドは削除済み
- **対処**: `matchField()` で `record[fieldCode]` が undefined → 初回のみ `console.warn` を出力（`_warnedFields` による重複防止）→ 空文字列を返す

### 11.5 フローティング一覧と `+N more` 隠れ予定の関係（v4.1 解決済み）

- **状況（解決済み）**: `_computeMatchList()` が `KC.State.events` を直接スキャンする方式に変更されたため、月ビューで `+N more` に隠れている予定も `_matchList` に含まれ、フローティング一覧に表示される（§8.6 参照）
- **対処**: 解決済み。§12.12 から削除

### 11.6 USER_SELECT が空配列

- **挙動**: `field.value = []` の場合、`matchField()` は空文字列を返す
- **対処**: 正常動作（エラーなし、マッチしない）

### 11.7 ビュー切替時のキャッシュ更新タイミング

- **状況**: `loadRelatedRecords()` は非同期処理。ビュー切替の描画が完了する前にキャッシュ更新が終わらない可能性がある
- **対処方針**: `loadRelatedRecords()` の完了後に `_computeMatchList()` を呼ぶ順序で実装する（desktop.js:5409〜5446 で実装済み）

### 11.8 searchTargets が空のときの動作（v4.1 確定仕様）

- **状況**: v3 仕様ではタイトルフィールドが暗黙的に検索対象だったため、searchTargets が空でもタイトルのみで検索が機能していた。v4 以降では searchTargets が空だと何もマッチしない（確定仕様）
- **対処**: フォールバックは行わない。管理者は必ずタイトルフィールドを searchTargets に追加設定すること。設定 UI に「タイトルフィールドも含めて設定してください」という注記を表示する（§12.13 削除済み）

### 11.9 リスク一覧

| リスク | 対策 |
|---|---|
| ~~`+N more` 隠れ予定がフローティング一覧に表示されない~~ | v4.1 で解決済み（`_computeMatchList()` が `KC.State.events` 直接スキャン） |
| 関連先レコード取得に時間がかかり初期表示が遅延する | カーソル API 実装済み。パフォーマンス計測で閾値を設定（T-P2-6） |
| searchTargets が空のままプラグインをデプロイする | 設定 UI に「タイトルフィールドも含めて設定してください」注記を表示（仕様確定: 何もマッチしない） |
| ~~`opacity: 0.25` が権限色の視認性に影響する~~ | v4 確定版で opacity 制御を廃止したため、このリスクは解消 |
| 設定スキーマ v6→v7 マイグレーション漏れ | `loadInitialConfig()` でバージョン確認と `searchTargets: []` の補完を明示的に実装する |

---

## 12. 未確定事項・前提条件

> v4.1 更新: 以下の項目は builder 最新実装（desktop.js）との照合により解決済みとして本文へ移管した。
> - §12.10（クリック時モーダル起動）→ FR-13 / §5.5 に反映済み
> - §12.12（`+N more` 掲載問題）→ §6.6・§6.7・§8.6・§11.5 に反映済み（`_computeMatchList()` で解決）
> - §12.13（searchTargets 空フォールバック）→ FR-3・§6.3・§11.8 に反映済み（「何もマッチしない」が確定仕様）
> - §12.4（DOM 逆引き手段）→ 実装済みとして §12.4 に注記のみ残存（以下）

### 12.1 関連先レコード件数の上限閾値

カーソル API で全件取得するため、件数上限の制限はない。ただし大量レコード時のパフォーマンス影響が未測定。T-P2-6 の計測結果を元に、必要に応じてキャッシュ件数の上限やタイムアウト処理を追加する。

### 12.2 関連レコードキャッシュの TTL

現在の設計では「ビュー切替・月送り時に再取得」であり、明示的な TTL は設けない。長時間操作しない場合のキャッシュ鮮度は実装時に判断する。

### 12.3 狭幅時（モバイル）レイアウト

ヘッダー右側に要素が増えるため、狭幅時にヘッダーが折り返しまたは溢れる可能性がある。

**推奨**: 400px 以下で検索入力欄を幅 0 に折り畳み、虫眼鏡アイコンをタップで展開する。主要利用デバイスがデスクトップのみであれば狭幅対応は Phase 3 送りでもよい。

### 12.4 DOM から KcEvent への逆引き手段（実装済み・参照用）

各イベント DOM 要素に `data-event-id` 属性を付与し（desktop.js:3184, 4168, 4256, 4315）、`_evtFromId()` で `KC.State.events` から逆引きする方式で実装済み。カレンダー DOM への opacity 付与処理で引き続き使用する。`_matchByDomText()` は削除済みのため、`data-event-id` がない要素は opacity 制御でスキップされる（フローティング一覧には影響しない）。

### 12.5 sessionStorage への保存

v4 でも保存しない方針。将来ユーザーニーズが確認されれば Phase 3 で検討する。

### 12.6 フォーカス候補が月跨ぎの場合の挙動

月ビューでアクティブ候補が現在表示中の月と異なる月に属する場合、月切替を行うかどうかが未確定。フローティング一覧は月に関係なく全マッチ予定を表示するが、一覧アイテムのクリック時（モーダル起動）に月切替を伴わない点は FR-13 のとおり。

**推奨**: 月切替は行わない（モーダル起動のみ）。月跨ぎナビゲーションが必要なユースケースがある場合に Phase 3 で再検討する。

### 12.7 USER_SELECT の code と name の検索方針（確定済み）

「code と name 両方を検索対象にする」を確定（FR-15 参照）。実装時に見直す場合は管理者へ報告の上、本書を改訂すること。

### 12.8 マッチ候補リストの順序定義（v4.1 更新）

開始日時昇順（`_computeMatchList()` 内の `.sort()` で適用済み）を採用する。この順序がフローティング一覧の表示順になる。DOM 順への依存は解消済み。

### 12.9 前提条件

- `KC.Config.SEARCH_TARGETS` が `KC.SearchFilter._searchTargets` に正しく反映されていること
- カレンダーが `desktop.js` の `KC.Boot.init()` から初期化されていること
- `KC.State.events` が `KcEvent` 配列として管理されていること
- KcEvent オブジェクトが `record` プロパティで元の kintone レコードを参照できること
- プラグイン設定の `searchTargets` に設定されたフィールドが、kintone アプリに実際に存在すること
- REFERENCE_TABLE フィールドの関連先アプリに対して、ログインユーザーが閲覧権限を持っていること（権限なしの場合は §11.1 の対処に従う）
- kintone REST API `/k/v1/app/form/fields.json` および `/k/v1/records/cursor.json` が利用可能であること

### 12.11 カレンダー上ハイライトクラスの廃止タイミング

v4 の方針として `.kc-event--match` / `.kc-event--match-active` クラスの付与を廃止するが、現時点の実装では互換のために残存している。完全廃止のタイミング（コード削除・CSS 削除）は実機検証でフローティング一覧の動作確認後に決定する。

---

*本要件定義書は 2026-06-02 時点の確定版（第 4 版）として改訂。Enter/クリック動作の確定・FR-6 opacity 制御の廃止・FR-18（searchTargets 空時の検索バー非表示）追加を反映。§12 の残存未確定事項（§12.1 件数閾値 / §12.2 キャッシュ TTL / §12.3 狭幅対応 / §12.5 sessionStorage / §12.6 月跨ぎ / §12.8 順序 / §12.11 ハイライト廃止タイミング）はそのまま継続。*
