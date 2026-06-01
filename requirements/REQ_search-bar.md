# 要件定義書: カレンダー検索欄機能

**文書番号**: REQ_search-bar
**作成日**: 2026-05-20
**最終更新日**: 2026-06-01（v3: Phase 2 検索対象フィールド拡張 + 関連レコード対応を確定版として追加）
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 第 3 版（§12 未確定事項あり — 実装時判断）
**関連文書**: REQ_edit-permission-extension.md, plugin/src/js/desktop.js, plugin/src/css/desktop.css, plugin/src/js/config.js

---

## 改版履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| v1 | 2026-05-20 | 初版作成（検索欄基本機能） |
| v2 | 2026-05-20 | ハイライト/フォーカス遷移仕様を追加。キーボードショートカット（`/` キー）を削除（ユーザー判断で不採用確定）。マッチ候補 activeIndex 管理・Enter/上下キーナビゲーション仕様を追加 |
| v3 | 2026-06-01 | Phase 2 として検索対象フィールド拡張（SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT）+ 関連レコードのメモリ内検索を追加。プラグイン設定にテーブル型 UI（searchTargets）を追加。検索論理をフィールド間 OR 拡張。§5（関数・モジュール設計）・§6（エッジケース）・§7（スコープアウト）・§8-§10（受入基準・検証・未確定）を大幅改訂 |

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
2. 絞り込み結果をカレンダー上に即座に反映する（リアルタイム検索）
3. マッチした予定をハイライト・フォーカスインジケータで明示し、Enter/上下キーで候補間を移動できるようにする
4. 既存のフィルタ機能・権限色機能との非干渉を保証する

### 1.3 スコープ

- **Phase 1（実装済み）**: タイトルフィールドのみを対象としたクライアント側フィルタ。リアルタイム検索。マッチ候補のハイライト・フォーカス遷移。
- **Phase 2（本要件）**: 検索対象フィールドの拡張（文字列系 / REFERENCE_TABLE / USER_SELECT）。プラグイン設定で管理者が対象フィールドを追加設定。関連レコードの事前一括取得とメモリ内検索。
- **Phase 3（将来）**: ユーザー側 UI でのフィールド切替、kintone API クエリ投影（件数上限超え対応）。

### 1.4 v3 改訂（2026-06-01）

Phase 2 として検索対象フィールドの拡張と関連レコード対応を実装するにあたり、以下の方針を確定した。

**選択主体**: プラグイン設定で管理者が事前定義する（固定）。検索バー UI でユーザーが対象を切り替える機能は Phase 3 候補。

**対象フィールド型**: SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT。LOOKUP は元フィールド型（SINGLE_LINE_TEXT 等）として通常通り選択可能。DATE / NUMBER / DROP_DOWN / RADIO_BUTTON は今回スコープ外。

**REFERENCE_TABLE の扱い**: kintone のアプリ設定で「表示フィールドに指定されているもの」のみ検索対象に含める。`/k/v1/app/form/fields.json` で本アプリの REFERENCE_TABLE フィールド定義を取得し、`referenceTable.displayFields` を読み取る。

**関連レコード取得タイミング**: カレンダー表示時（ビュー切替・月送り含む）に関連先レコードを一括取得してメモリキャッシュする。メモリ内でテキストマッチ（高速・API コール最小化）。

**検索論理**: トークン間 AND、フィールド間 OR。例:「会議 A社」で検索 → タイトル / メモ / 関連レコードのいずれかに「会議」を含み、かつ同じくいずれかに「A社」を含むレコードがヒット。

**USER_SELECT の検索値**: `name`（表示名）と `code`（ログイン名）の両方を OR 検索対象とする。

---

## 2. 用語

| 用語 | 定義 |
|---|---|
| 検索クエリ | ユーザーが検索欄に入力したテキスト文字列 |
| 検索フィルタ | 検索クエリによる絞り込み処理。既存の eventFilter（mine/others/all）とは独立した第2のフィルタ層 |
| クライアント側フィルタ | kintone REST API への追加リクエストを発生させず、取得済みの `KC.State.events` をメモリ内で絞り込む方式 |
| 一致予定（マッチ予定） | 検索クエリにマッチする予定。カレンダー上にハイライト表示される |
| 非一致予定 | 検索クエリにマッチしない予定。半透明表示（opacity: 0.25）にする |
| アクティブ候補 | マッチ候補の中で現在フォーカス中の予定。フォーカスインジケータ（太枠）で示す |
| activeIndex | マッチ候補リスト内でアクティブ候補が何番目かを示す 0 始まりのインデックス |
| マッチ候補リスト | 現在のクエリにマッチする予定を表示順に並べた配列。フォーカス遷移の巡回に使用する |
| デバウンス | 連続入力時に最後の入力から一定時間待ってから処理を実行する仕組み |
| IME 確定 | 日本語入力時に変換キー（Enter / スペース）で文字を確定させる操作。`compositionend` イベントが発火する |
| KcEvent | desktop.js 内でレコードから変換した予定オブジェクト。`title` / `start` / `end` 等を持つ |
| searchTargets | プラグイン設定で管理者が追加する検索対象フィールドの配列（`[{ fieldCode: "memo" }, ...]` 形式） |
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
  - ⚙設定ボタン（既存）

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

### FR-3: 検索対象フィールド（Phase 2 更新）

Phase 2 では以下のフィールドを検索対象とする。

- **タイトルフィールド（`KC.Config.FIELD.title`）**: デフォルト固定。常に検索対象。プラグイン設定 UI 上は非表示（暗黙的に有効）
- **プラグイン設定で追加されたフィールド（`searchTargets`）**: 管理者が設定画面から追加した以下の型のフィールド
  - SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT（文字列フィールド）
  - REFERENCE_TABLE（関連レコード一覧）
  - USER_SELECT（ユーザー選択）
  - LOOKUP は元フィールド型（SINGLE_LINE_TEXT 等）として通常通り選択可能

DATE / NUMBER / DROP_DOWN / RADIO_BUTTON / CHECKBOX 等の型は今回スコープ外。

### FR-4: 検索方式（Phase 2 拡張）

- **部分一致**: クエリがフィールド値の任意の位置に含まれれば一致と判定する
- **大文字小文字区別なし**: `query.toLowerCase()` と フィールド値の `.toLowerCase()` を比較する
- **トークン間 AND**: 検索クエリをスペース（全角・半角）で分割し、全トークンが条件を満たす予定のみ一致と判定する
- **フィールド間 OR（Phase 2 追加）**: 各トークンの判定において、全検索対象フィールドのうちいずれか 1 つ以上がそのトークンを含めばそのトークンはマッチ扱いとする
  - 例: 「会議 A社」で検索 → （タイトル / メモ / 関連レコードのいずれかに「会議」を含む）AND（タイトル / メモ / 関連レコードのいずれかに「A社」を含む）

### FR-5: リアルタイム検索とデバウンス

- `input` イベントを監視し、入力が変化するたびにフィルタを適用してカレンダーを再描画する
- デバウンス: 最後の `input` イベントから **300ms** 後にフィルタ処理を実行する
- IME 入力中（`compositionstart` 〜 `compositionend` の間）はデバウンスタイマーを起動しない。`compositionend` 発火後に 300ms デバウンスを開始する

### FR-6: 非一致予定の表示

検索クエリが非空のとき、非一致予定は**半透明（opacity: 0.25）**にする。

- 一致予定: 通常表示（opacity 変更なし）+ マッチハイライト（FR-12 参照）
- 非一致予定: `opacity: 0.25` のインラインスタイルを付与
- 検索クエリが空: 全予定を通常表示（opacity スタイルをリセット、ハイライト解除）

### FR-7: 検索状態のビュー間共有

検索クエリはビュー切替（月 / 週 / 日）をまたいで維持する。

- ユーザーが月ビューで「会議」と入力し、週ビューに切り替えた場合も「会議」での絞り込みが継続される
- 再描画時に `KC.SearchFilter.query` の値を参照してフィルタを適用する
- ビュー切替時は `activeIndex` を -1（未選択）にリセットする

### FR-8: 結果 0 件時のメッセージ

検索クエリが非空かつ一致する予定が 0 件の場合、カレンダーグリッド内（または直下）に「「{query}」に一致する予定はありません」というメッセージを表示する。

- メッセージ要素: `id="kc-search-empty"` の `<div>`
- 表示条件: 検索クエリ非空 かつ フィルタ適用後の表示件数が 0
- 非表示条件: 検索クエリが空 または 1 件以上表示される

### FR-9: 検索クエリの初期化

- ページロード時: 検索クエリは空（`''`）で初期化する
- sessionStorage への保存はしない（§12.5 参照）
- kintone ビュー再表示（`app.record.index.show` イベント再発火）時: 検索クエリをリセットし、入力欄を空にする

### FR-10: 既存 EventFilter との連携

検索フィルタと既存の `KC.EventFilter`（mine / others / all）は**独立した 2 層のフィルタ**として機能する。

- 適用順序: `KC.EventFilter.apply()` → `KC.SearchFilter.apply()`
- いずれのフィルタも通過した予定のみカレンダーに描画される
- 一方のフィルタを変更しても他方のフィルタはリセットされない

### FR-11: マッチ候補のハイライト表示（v2 追加）

検索クエリが非空のとき、一致予定（マッチ予定）は視覚的にハイライトして区別する。

- 一致予定の DOM 要素に `.kc-event--match` クラスを付与する
- アクティブ候補（`activeIndex` で指定された予定）には `.kc-event--match-active` クラスを追加付与する
- `.kc-event--match` の表示例: 通常マッチ = 細枠（`outline: 2px solid #2563eb`）
- `.kc-event--match-active` の表示例: アクティブ候補 = 太枠（`outline: 3px solid #1d4ed8`）+ 背景色強調（`box-shadow: 0 0 0 3px rgba(37,99,235,0.3)`）
- 実際のスタイル値は実装時に調整可。上記は参考値

### FR-12: マッチ候補へのフォーカス遷移（v2 追加）

検索欄フォーカス中に、キー操作でマッチ候補間を移動する。

#### FR-12-1: 検索入力後の初期フォーカス

- IME 確定後（`compositionend` 発火後）またはデバウンス 300ms 経過後にフィルタが適用され、マッチ候補リストが確定する
- マッチ候補リストが 1 件以上の場合、`activeIndex = 0`（先頭候補）を自動でアクティブにする
- マッチ候補リストが 0 件の場合、`activeIndex = -1`（未選択）のままにする

#### FR-12-2: Enter キーによる次候補への移動

- 検索欄フォーカス中に Enter キーが押されたとき（IME 確定中の Enter は除く）:
  - `activeIndex` を 1 加算する
  - `activeIndex` がマッチ候補リストの末尾を超えた場合は 0 に戻す（循環）
  - アクティブ候補が画面外にある場合は当該候補が見えるようにスクロールする（§4 NF-5 参照）

#### FR-12-3: 上下矢印キーによる候補移動

- 検索欄フォーカス中に ↓ キーが押されたとき: Enter キーと同じく次候補へ移動（循環あり）
- 検索欄フォーカス中に ↑ キーが押されたとき:
  - `activeIndex` を 1 減算する
  - `activeIndex` が -1 を下回った場合はリスト末尾（最後の候補）に戻る（循環）
  - アクティブ候補が画面外にある場合はスクロールして表示する

#### FR-12-4: IME 確定 Enter の誤動作防止

- `compositionstart` から `compositionend` の間に発火した `keydown` の Enter は FR-12-2 の処理を実行しない
- `compositionend` イベント後に発火した Enter のみ候補移動対象とする

### FR-13: REFERENCE_TABLE 検索ロジック（Phase 2 新規）

REFERENCE_TABLE フィールドが `searchTargets` に含まれる場合、以下のロジックで検索する。

1. **フィールド定義取得**: プラグイン初期化時（または `app.record.index.show` 時）に `/k/v1/app/form/fields.json` を呼び出し、REFERENCE_TABLE フィールドの `referenceTable.appId`（関連先アプリ ID）と `referenceTable.displayFields`（表示フィールド一覧）を取得する
2. **displayFields が空の場合**: その REFERENCE_TABLE フィールドは検索対象から除外する
3. **関連先レコード取得**: カレンダー表示時に `/k/v1/records.json` で関連先アプリの全レコードを一括取得（件数上限については §12.1 参照）
4. **メモリキャッシュ**: 取得した関連先レコードを `_relatedRecordsCache[fieldCode]` に格納する
5. **マッチ判定**: 予定レコードが持つ REFERENCE_TABLE フィールドの各行の `referenceTable.id` 値をキーに、キャッシュから対応レコードを引いて `displayFields` のフィールド値を文字列として結合し、トークンで部分一致判定する

### FR-14: USER_SELECT 検索ロジック（Phase 2 新規）

USER_SELECT フィールドが `searchTargets` に含まれる場合、以下のロジックで検索する。

- USER_SELECT の値は `[{ code: "login_name", name: "表示名" }, ...]` 形式の配列
- 各エントリの `name`（表示名）と `code`（ログイン名）の**両方**を検索対象文字列として結合し、トークンで部分一致判定する
- 結合方法（例）: `entry.name + ' ' + entry.code` を各エントリについて生成し、いずれかにトークンが含まれれば一致

### FR-15: 関連レコードキャッシュの更新タイミング（Phase 2 新規）

- **カレンダー初期表示時**: `loadRelatedRecords()` を呼び出して全 REFERENCE_TABLE フィールドの関連先レコードを一括取得する
- **ビュー切替時**: `loadRelatedRecords()` を再呼び出してキャッシュを更新する
- **月送り・週送り時**: `loadRelatedRecords()` を再呼び出してキャッシュを更新する
- 手動リフレッシュボタンは今回スコープ外

### FR-16: 設定画面での検索対象フィールド追加（Phase 2 新規）

プラグイン設定画面（`config.html` / `config.js`）に「検索対象フィールド」設定セクションを追加する。

- **UI形式**: テーブル形式（既存の権限設定テーブルと統一感のある実装）
- **行操作**: 行追加ボタン / 行削除ボタン
- **各行の要素**: フィールドコード選択のドロップダウン
  - ドロップダウンの候補: 本アプリのフィールドのうち SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のみ表示
  - LOOKUP フィールドは元のフィールド型が上記に該当する場合に選択可能
- **タイトルフィールドは非表示**: タイトルフィールドは暗黙的に常に対象のため、ドロップダウン候補から除外する
- **保存形式**: 既存の設定 JSON に `searchTargets` 配列を追加する

```javascript
// 保存スキーマ（version 7 への移行を想定）
{
  version: 7,
  fieldMapping: { ... },
  permissionRules: [ ... ],
  fieldValueRules: [ ... ],
  searchTargets: [
    { fieldCode: "memo" },
    { fieldCode: "relatedMeetings" }
  ],
  views: { ... }
}
```

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
- 検索欄にラッパー要素 `role` は付与しない（`<input type="search">` の暗黙ロールで十分）
- 結果 0 件メッセージ要素（`#kc-search-empty`）に `aria-live="polite"` を付与し、スクリーンリーダーへの通知を行う
- キーボードショートカットによる検索欄への自動フォーカス機能は実装しない（v2 確定）
- アクティブ候補の `.kc-event--match-active` 要素に `tabindex="-1"` を付与することで、スクリーンリーダー向けのフォーカス可能性を確保することを検討する（未確定）

### NF-3: 後方互換性

- `KC.SearchFilter` モジュールを拡張するのみで、既存モジュールの動作を変更しない
- 検索クエリが空（初期状態）の場合は検索フィルタの効果がなく、既存の動作と完全に一致する
- `searchTargets` が設定されていない（旧バージョンの設定）場合は、タイトルフィールドのみで動作し Phase 1 と同等の挙動にする

### NF-4: モバイル / 狭幅対応

- ヘッダー右側のアイテム数が増えるため、狭幅時のレイアウト崩れを防ぐ
- 推奨案: 400px 以下では検索入力欄を折り畳み（アイコンボタン化）し、タップで展開する（§12.3 参照）

### NF-5: スクロール・ジャンプ動作（v2 追加）

フォーカス遷移（FR-12）によってアクティブ候補が変わった際のスクロール挙動を定義する。

- アクティブ候補が現在の表示領域外にある場合は、当該候補が視野内に入るよう自動スクロールする
- スクロールには `element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })` を利用することを推奨（各ビューのスクロールコンテナ構造に依存するため実装時に調整が必要な場合がある）
- 月ビューでアクティブ候補が現在表示中の月と異なる月に属する場合の挙動は §12.6 参照

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
</div>
```

### 5.3 検索欄のスタイル概要

| プロパティ | 値（案） |
|---|---|
| `.kc-search` | `display: flex; align-items: center; border: 1px solid #c1c5ca; border-radius: 10px; height: 38px; padding: 0 8px; background: #fff;` |
| `.kc-search-input` | `border: none; outline: none; font-size: 14px; width: 160px; background: transparent;` |
| `.kc-search-clear` | `border: none; background: transparent; cursor: pointer; font-size: 14px; color: #777;` |
| `.kc-search-icon` | `font-size: 14px; color: #777; margin-right: 4px;` |
| 狭幅時（max-width: 400px） | `.kc-search-input { width: 0; }` + アイコンクリックで幅を展開（§12.3） |

### 5.4 マッチ候補のハイライトスタイル（v2 追加）

```
カレンダー上の予定要素:

[通常表示（クエリ空）]
  .kc-event: 既存スタイルのみ。ハイライトなし

[マッチ候補（クエリ非空、activeIndex 以外）]
  .kc-event.kc-event--match
  → outline: 2px solid #2563eb;  /* 青細枠 */

[アクティブ候補（activeIndex が指す予定）]
  .kc-event.kc-event--match.kc-event--match-active
  → outline: 3px solid #1d4ed8;  /* 青太枠 */
  → box-shadow: 0 0 0 3px rgba(37,99,235,0.3);  /* 外周光彩 */

[非一致予定（クエリ非空、マッチしない）]
  .kc-event（クラス追加なし）
  → opacity: 0.25;  /* インラインスタイルで付与 */
```

ASCII モック（検索「会議」、アクティブ = 月次会議）:

```
+------------------+  +------------------+  +------------------+
|  月次会議        |  |  週次会議        |  |  プロジェクト報告 |
| ★アクティブ候補  |  | (通常マッチ)     |  | (非一致・半透明) |
| [太枠+外周光彩]  |  | [細枠]           |  | [opacity 0.25]   |
+------------------+  +------------------+  +------------------+
```

### 5.5 状態遷移（v2 更新）

```
[初期状態: クエリ空]
  入力欄: 空, プレースホルダー表示
  クリアボタン: hidden
  カレンダー: 通常表示（全予定）
  activeIndex: -1

  ↓ ユーザーが文字を入力 & 300ms 経過（または IME 確定）

[検索中: クエリ非空]
  入力欄: テキスト表示
  クリアボタン: 表示
  一致予定: .kc-event--match クラス付与（細枠ハイライト）
  非一致予定: opacity 0.25
  activeIndex: 0（先頭マッチ候補を自動アクティブ化）
  アクティブ候補: .kc-event--match-active クラス付与（太枠）

  ↓ Enter または ↓ キー
  activeIndex += 1（末尾超えで 0 に戻る）
  アクティブ候補が画面外 → スクロール

  ↓ ↑ キー
  activeIndex -= 1（-1 下回りで末尾インデックスに戻る）
  アクティブ候補が画面外 → スクロール

  ↓ クリアボタン or バックスペースで全削除

[初期状態に戻る]
  .kc-event--match / .kc-event--match-active クラスを全解除
  opacity スタイルをリセット
  activeIndex: -1

  ↓ 一致件数が 0 になった場合

[0件状態]
  カレンダーグリッド内に「「{query}」に一致する予定はありません」を表示
  activeIndex: -1
```

### 5.6 ビュー再描画時の検索フィルタ適用位置

```
R.refresh() が呼ばれる
  ↓
KC.EventFilter.apply(KC.State.events)   // 既存フィルタ（mine/others/all）
  ↓
KC.SearchFilter.apply(filteredEvents)  // 検索フィルタ（新規）
  ↓
描画対象イベント配列 → ビュー描画関数へ渡す
  ↓
KC.SearchFilter.applyHighlight()       // マッチ候補クラス付与・activeIndex 同期
```

### 5.7 プラグイン設定画面: 検索対象フィールド設定 UI（Phase 2 新規）

```
+-----------------------------------------------------------+
| 検索対象フィールド設定                                        |
|                                                           |
|  ※ タイトルフィールドは常に検索対象です                        |
|                                                           |
|  +------------------------------------------+  [行を追加] |
|  | フィールド  | 操作                        |            |
|  +------------------------------------------+            |
|  | [メモ ▾]   | [削除]                      |            |
|  +------------------------------------------+            |
|  | [担当者 ▾] | [削除]                      |            |
|  +------------------------------------------+            |
|                                                           |
+-----------------------------------------------------------+
```

- ドロップダウン候補: 本アプリの SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のフィールドのみ
- タイトルフィールドはドロップダウン候補から除外
- 「行を追加」クリックで空行を末尾に追加
- 「削除」クリックでその行を削除
- 行の並び替えは Phase 2 では任意（実装コストと相談して省略可）

---

## 6. データ構造・モジュール設計

### 6.1 KC.SearchFilter モジュール（Phase 2 拡張）

```javascript
KC.SearchFilter = {
  query: '',           // 現在の検索クエリ（空文字 = 無効）
  _timer: null,        // デバウンス用タイマーID
  _composing: false,   // IME 入力中フラグ
  activeIndex: -1,     // アクティブ候補の index（-1 = 未選択）
  _matchList: [],      // 現在のマッチ候補 DOM 要素リスト（表示順）

  // Phase 2 追加プロパティ
  _relatedRecordsCache: {},  // { [fieldCode]: { [recordId]: kintoneRecord } } 形式のキャッシュ
  _searchTargets: [],        // プラグイン設定から読み込んだ searchTargets 配列
  _refTableDefs: {},         // { [fieldCode]: { appId, displayFields: [...] } } REFERENCE_TABLE 定義

  /** 検索クエリを設定し、再描画をトリガーする */
  setQuery: function(q) { ... },

  /** events 配列をそのまま返す（フィルタしない。視覚化は applyHighlight で行う） */
  apply: function(events) { ... },

  /** クエリトークンを返す */
  _getTokens: function() { ... },

  /**
   * 1件の予定が全トークンにマッチするかを判定する（フィールド間 OR、トークン間 AND）
   * @param {Object} evt - KcEvent（元の kintone レコード情報を含む）
   * @param {string[]} tokens
   * @returns {boolean}
   */
  _matchesTokens: function(evt, tokens) { ... },

  /**
   * 特定フィールドコードの値から検索用文字列を取得する
   * フィールド型に応じて以下のように処理する:
   *   - SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT: value をそのまま返す
   *   - USER_SELECT: 各エントリの name + code を結合して返す
   *   - REFERENCE_TABLE: _relatedRecordsCache から該当レコードの displayFields 値を結合して返す
   * @param {Object} record - kintone 元レコード
   * @param {string} fieldCode - フィールドコード
   * @returns {string} 検索対象文字列
   */
  matchField: function(record, fieldCode) { ... },

  /**
   * 全 REFERENCE_TABLE フィールドの関連先レコードを一括取得してキャッシュする
   * - 権限のない関連先アプリは除外して警告ログを出力する
   * - ビュー切替・月送り時にも呼び出す
   * @returns {Promise<void>}
   */
  loadRelatedRecords: function() { ... },

  /**
   * /k/v1/app/form/fields.json から REFERENCE_TABLE フィールド定義を取得して _refTableDefs に格納する
   * @returns {Promise<void>}
   */
  _loadRefTableDefs: function() { ... },

  /** 描画後にマッチ候補 DOM 要素へクラスを付与し、activeIndex を適用する */
  applyHighlight: function() { ... },

  /** activeIndex に対応する候補をアクティブにし、必要に応じてスクロールする */
  _activateAt: function(newIndex) { ... },

  /** Enter または ↓ キー押下時: 次候補に移動 */
  focusNext: function() { ... },

  /** ↑ キー押下時: 前候補に移動 */
  focusPrev: function() { ... },

  /** UI 初期化（kc-head-right に追加） */
  buildDOM: function(headRight) { ... },

  /** クリアボタンの表示/非表示を同期する */
  _syncClearBtn: function() { ... }
};
```

### 6.2 apply() の動作仕様（Phase 2: フィルタしない方針は維持）

Phase 1 同様、`apply()` は events をそのまま返す。非マッチ予定の視覚化は `applyHighlight()` の opacity 制御で行う。

```
KC.SearchFilter.apply(events):
  return events  // 全件返す（DOM フィルタは applyHighlight で行う）
```

### 6.3 _matchesTokens() の動作仕様（Phase 2 更新: フィールド間 OR）

```
KC.SearchFilter._matchesTokens(evt, tokens):
  // 検索対象フィールドの値を収集する
  searchTargets = ['title'] + this._searchTargets.map(t => t.fieldCode)

  // 各ターゲットの検索用文字列を生成
  fieldTexts = searchTargets.map(fieldCode =>
    this.matchField(evt.record, fieldCode).toLowerCase()
  )

  // トークン間 AND、フィールド間 OR
  return tokens.every(token =>
    fieldTexts.some(text => text.includes(token))
  )
```

### 6.4 matchField() の動作仕様（Phase 2 新規）

```
KC.SearchFilter.matchField(record, fieldCode):
  field = record[fieldCode]
  if !field: return ''

  if field.type === 'USER_SELECT':
    return field.value.map(u => u.name + ' ' + u.code).join(' ')

  if field.type === 'REFERENCE_TABLE':
    def = this._refTableDefs[fieldCode]
    if !def or !def.displayFields.length: return ''
    relatedRows = field.value  // REFERENCE_TABLE の行配列
    return relatedRows.map(row => {
      relRecord = this._relatedRecordsCache[fieldCode][row.record.$id.value]
      if !relRecord: return ''
      return def.displayFields.map(df => relRecord[df.fieldCode].value || '').join(' ')
    }).join(' ')

  // SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT など文字列系
  return field.value || ''
```

### 6.5 関連レコードキャッシュ構造

```javascript
// _relatedRecordsCache の構造
{
  "relatedMeetings": {          // REFERENCE_TABLE フィールドコード
    "1": { ...kintoneRecord },  // レコード ID → kintone レコードオブジェクト
    "2": { ...kintoneRecord },
    ...
  },
  "anotherRefField": { ... }
}
```

### 6.6 applyHighlight() の動作仕様（Phase 2 更新）

```
KC.SearchFilter.applyHighlight():
  allEls = querySelectorAll('.kc-event, .kc-ad-event, .kc-month-chip, .kc-month-chip--span')

  // 既存クラス・スタイルをリセット
  allEls.forEach(el => {
    el.classList.remove('kc-event--match', 'kc-event--match-active')
    el.style.opacity = ''
  })

  if !this.query:
    this._matchList = []
    this.activeIndex = -1
    return

  tokens = this._getTokens()
  if tokens.length === 0: return

  this._matchList = []

  allEls.forEach(el => {
    if el.classList.contains('kc-event--ghost'): return
    if el.classList.contains('kc-event--dragging'): return

    // KcEvent オブジェクトを DOM から逆引きする（実装時要確認）
    evt = resolveEventFromEl(el)
    if !evt: return

    if this._matchesTokens(evt, tokens):
      el.classList.add('kc-event--match')
      this._matchList.push(el)
    else:
      el.style.opacity = '0.25'
  })

  // activeIndex の調整
  if this._matchList.length === 0:
    this.activeIndex = -1
  else if this.activeIndex < 0 or this.activeIndex >= this._matchList.length:
    this.activeIndex = 0

  if this.activeIndex >= 0:
    this._matchList[this.activeIndex].classList.add('kc-event--match-active')
```

Phase 1 では DOM の `el.title` / テキストノードからタイトルを取得していたが、Phase 2 では追加フィールドの値参照が必要なため、DOM から KcEvent オブジェクトへの逆引き手段（`data-record-id` 属性等）を実装時に確立する必要がある（§12.4 参照）。

### 6.7 マッチ候補リストの順序

`_matchList` の要素順は **DOM 上の表示順**（`querySelectorAll` の返却順）とする。これはカレンダー上での視覚的な表示順に近い。

### 6.8 sessionStorage への保存（保存しない）

Phase 2 でも sessionStorage への保存は行わない。ページリロードや kintone ビュー再表示時に空にリセットされる。

---

## 7. 既存実装への変更点

> 注意: 本セクションはコードの静的調査に基づく推測を含む。「未確認」と記載した箇所は実機確認を要する。

### 7.1 desktop.js の変更（見込み）

| 箇所 | 変更内容 | 確認状況 |
|---|---|---|
| `KC.SearchFilter` モジュール全体 | Phase 2 の新規メソッド（`matchField`, `loadRelatedRecords`, `_loadRefTableDefs`, `_matchesTokens` の拡張）を追加 | 新規追加 |
| `KC.SearchFilter._matchesTokens()` | タイトル単独判定からフィールド間 OR 判定に拡張 | 要変更 |
| `KC.SearchFilter.applyHighlight()` | DOM からの KcEvent 逆引き手段を確立した上で `_matchesTokens()` を呼ぶよう変更 | 要変更 |
| `KC.Boot.init()` または `app.record.index.show` | `KC.SearchFilter._loadRefTableDefs()` を呼ぶ処理を追加（プラグイン設定読み込み後） | 未確認 |
| `R.refresh()` または各ビュー描画の呼び出し元 | 描画完了後に `KC.SearchFilter.loadRelatedRecords()` を呼ぶよう変更（ビュー切替・月送り含む） | 未確認 |
| `KC.MonthView.render()` 等 | `KC.EventFilter.apply()` → `KC.SearchFilter.apply()` → 描画 → `KC.SearchFilter.applyHighlight()` のフローは維持 | 調査済 |
| イベント DOM への属性付与 | `applyHighlight()` でフィールド値参照を可能にするため、各予定 DOM に `data-record-id` 等の属性を付与する（実装判断） | 未確認 |

### 7.2 desktop.css の変更（見込み）

Phase 1 で追加済みのクラス（`.kc-event--match`, `.kc-event--match-active` 等）は変更なし。Phase 2 固有の CSS 変更はなし。

### 7.3 config.html / config.js の変更（Phase 2 新規）

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
| 検索クエリ非空、かつ一致予定に権限色あり | 権限色（`bgColor` / `textColor`）は維持したまま、`opacity` は変更しない |
| 検索クエリ非空、かつ非一致予定に権限色あり | 権限色を維持したまま `opacity: 0.25` を適用する |
| マッチ候補（権限色あり） | 権限色を維持したまま `.kc-event--match` / `.kc-event--match-active` の `outline` を付与する |

- `opacity` は要素全体に作用するため、`bgColor` / `textColor` のインラインスタイルとは独立して適用できる
- `outline` も `bgColor` / `textColor` と干渉しない（未確認 — 実機での重ね合わせ動作を要確認）

### 8.2 FilterDropdown（mine/others/all）との干渉

- 検索フィルタと eventFilter は独立した 2 層のフィルタとして設計（FR-10）
- `KC.EventFilter.apply()` の後に `KC.SearchFilter.apply()` を適用するため、eventFilter で除外された予定は検索対象から除外される（仕様どおり）
- eventFilter 変更時は `R.refresh()` が呼ばれ、検索フィルタも自動的に再適用される（未確認 — refresh フロー確認要）

### 8.3 ビュー個別設定との干渉

- ビュー切替は `R.refresh()` で再描画されるため、検索クエリが `KC.SearchFilter.query` に保持されていれば再描画時にも自動適用される
- ビュー切替時は `activeIndex` をリセットする（FR-7）
- ビュー切替時に `loadRelatedRecords()` を呼ぶため、関連レコードキャッシュも更新される
- 干渉なし（予定）

### 8.4 全画面表示機能との干渉

- 全画面時もヘッダーは表示されるため、検索欄は全画面時でも利用可能
- `kc-expanded` クラスの CSS が検索欄の表示に干渉しないことを確認すること（未確認）

### 8.5 REFERENCE_TABLE フィールドへのアクセス権限

- 関連先アプリへの閲覧権限がないユーザーがログインしている場合、`/k/v1/records.json` の呼び出しが 403 または 500 を返す可能性がある
- この場合、当該 REFERENCE_TABLE フィールドをキャッシュ対象から除外し、コンソールに警告ログを出力する
- ユーザーへのエラー通知はしない（検索対象から静かに除外する）
- kintone のレコード閲覧権限で自動フィルタされる関連レコードは、kintone 側の挙動として透過的に動く

---

## 9. 受入基準

### AC-1〜AC-16（Phase 1 継続）

Phase 1（v2）で定義済みの AC-1〜AC-16 は引き続き有効。以下、Phase 2 追加分。

### AC-P2-1: プラグイン設定で追加したフィールドが検索対象になる

- **Given**: プラグイン設定の「検索対象フィールド設定」に MULTI_LINE_TEXT 型の「メモ」フィールドを追加して保存した
- **When**: 「メモ」フィールドにのみ「会議」というキーワードが含まれる予定を対象に、検索欄に「会議」と入力する
- **Then**: 当該予定が `.kc-event--match` クラスでハイライトされる

### AC-P2-2: REFERENCE_TABLE フィールドの displayFields が検索対象になる

- **Given**: プラグイン設定に REFERENCE_TABLE 型の「関連商談」フィールドを追加した。関連先アプリの displayFields に「商談名」フィールドが設定されている
- **When**: 関連先の「商談名」にのみ「A社」が含まれる予定を対象に、検索欄に「A社」と入力する
- **Then**: 当該予定が `.kc-event--match` クラスでハイライトされる

### AC-P2-3: USER_SELECT の name と code 両方で検索できる

- **Given**: プラグイン設定に USER_SELECT 型の「担当者」フィールドを追加した。担当者として `{ code: "tanaka.taro", name: "田中 太郎" }` が設定されている予定がある
- **When**: 検索欄に「田中」と入力する
- **Then**: 当該予定が `.kc-event--match` クラスでハイライトされる
- **When**: 検索欄に「tanaka.taro」と入力する
- **Then**: 当該予定が `.kc-event--match` クラスでハイライトされる

### AC-P2-4: フィールド間 OR が機能する

- **Given**: タイトル「定例会」、メモ「A社向け」の予定が存在する。searchTargets に「メモ」を設定済み
- **When**: 検索欄に「定例 A社」と入力する（スペース区切り AND 検索）
- **Then**: 「定例会」はタイトルで「定例」にマッチし、メモで「A社」にマッチするため `.kc-event--match` でハイライトされる
- **When**: 検索欄に「定例 未登録キーワード」と入力する
- **Then**: どのフィールドにも「未登録キーワード」がないため当該予定はハイライトされない

### AC-P2-5: 関連先レコードがメモリキャッシュされる

- **Given**: REFERENCE_TABLE フィールドが searchTargets に含まれている
- **When**: カレンダービューが初期表示される
- **Then**: `KC.SearchFilter._relatedRecordsCache` に関連先アプリのレコードが格納されている（ブラウザの開発者ツールで確認可能）

### AC-P2-6: ビュー切替・月送り後にキャッシュが更新される

- **Given**: カレンダービューが表示されており関連レコードキャッシュが存在する
- **When**: 月送りボタンを押す
- **Then**: `loadRelatedRecords()` が再呼び出しされ、キャッシュが更新される（ネットワークログで確認可能）

### AC-P2-7: searchTargets 未設定時は Phase 1 と同等の動作になる

- **Given**: プラグイン設定の「検索対象フィールド設定」が空（または設定バージョンが v6 以前）
- **When**: 検索欄にキーワードを入力する
- **Then**: タイトルフィールドのみを対象として検索が行われ、Phase 1 と同等の動作になる

### AC-P2-8: 権限のない関連先アプリは除外されてもエラーにならない

- **Given**: searchTargets に含まれる REFERENCE_TABLE の関連先アプリに、ログインユーザーが閲覧権限を持たない
- **When**: カレンダービューを表示する
- **Then**: コンソールに警告ログが出力されるが、ユーザー向けのエラーメッセージは表示されない
- **And**: 他の検索対象フィールドでの検索は正常に機能する

### AC-P2-9: 設定 UI のドロップダウンに対象型のみ表示される

- **Given**: プラグイン設定画面を開く
- **When**: 「検索対象フィールド設定」の行追加ボタンを押し、フィールドコードのドロップダウンを開く
- **Then**: ドロップダウンには SINGLE_LINE_TEXT / MULTI_LINE_TEXT / RICH_TEXT / REFERENCE_TABLE / USER_SELECT 型のフィールドのみ表示される
- **And**: タイトルフィールド・DATE 型・DROP_DOWN 型等は表示されない

---

## 10. 検証項目

### T-1〜T-12（Phase 1 継続）

Phase 1（v2）で定義済みの T-1〜T-12 は引き続き有効。以下、Phase 2 追加分。

### T-P2-1: 正常系 — 追加フィールドの検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-1-1 | searchTargets に「メモ」を設定し、メモフィールドに「重要」を持つ予定を対象に「重要」で検索 | 当該予定が `.kc-event--match` でハイライト |
| T-P2-1-2 | タイトルにもメモにもマッチしない予定 | `opacity: 0.25` で半透明 |
| T-P2-1-3 | searchTargets が空の状態で追加フィールドのみにマッチするキーワードで検索 | 当該予定はハイライトされない（タイトルのみ対象） |

### T-P2-2: 正常系 — REFERENCE_TABLE 検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-2-1 | REFERENCE_TABLE の displayFields にある「商談名」で「B社」を持つ関連レコードを参照する予定を「B社」で検索 | 当該予定がハイライト |
| T-P2-2-2 | displayFields が空に設定されている REFERENCE_TABLE フィールドで検索 | 当該フィールドは無視され、他フィールドのみで判定 |
| T-P2-2-3 | 関連先レコードが存在しない REFERENCE_TABLE（空の参照）を持つ予定 | マッチしない（エラーなし） |

### T-P2-3: 正常系 — USER_SELECT 検索

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-3-1 | 担当者フィールドの表示名「田中 太郎」を対象に「田中」で検索 | 当該予定がハイライト |
| T-P2-3-2 | 同フィールドのログイン名「tanaka.taro」を対象に「tanaka」で検索 | 当該予定がハイライト |
| T-P2-3-3 | USER_SELECT が空（未設定）の予定 | マッチしない（エラーなし） |

### T-P2-4: 正常系 — フィールド間 OR の組み合わせ

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-4-1 | 「会議 A社」で検索。タイトルに「会議」、メモに「A社」がある予定 | ハイライト（トークン間 AND かつフィールド間 OR） |
| T-P2-4-2 | 「会議 A社」で検索。タイトルに「会議」だけあり「A社」はどこにもない予定 | ハイライトされない |
| T-P2-4-3 | 「会議 A社」で検索。タイトルに「会議」「A社」両方を含む予定 | ハイライト |

### T-P2-5: 正常系 — キャッシュ更新

| # | 操作 | 期待結果 |
|---|---|---|
| T-P2-5-1 | カレンダー初期表示時にネットワークログを確認 | 関連先アプリの `/k/v1/records.json` が呼ばれる |
| T-P2-5-2 | 月送りボタン押下後にネットワークログを確認 | `/k/v1/records.json` が再度呼ばれる |
| T-P2-5-3 | ビュー切替後にネットワークログを確認 | `/k/v1/records.json` が再度呼ばれる |

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
| T-P2-8-2 | 設定に存在しないフィールドコードが searchTargets に含まれている | 警告ログ出力。当該フィールドは無視して検索続行 |
| T-P2-8-3 | REFERENCE_TABLE の displayFields が空配列 | 当該フィールドは検索対象外。エラーなし |

---

## 11. エッジケース・リスク

### 11.1 関連先アプリへのアクセス権限なし

- **挙動**: `/k/v1/records.json` が 403 等のエラーを返す
- **対処**: `loadRelatedRecords()` 内で try-catch し、失敗した REFERENCE_TABLE フィールドコードをキャッシュ対象から除外する。コンソールに `[KC SearchFilter] REFERENCE_TABLE "<fieldCode>" のキャッシュ取得失敗: <error>` を出力する

### 11.2 関連先レコード数が多い場合

- **状況**: 関連先アプリに 1000 件超のレコードがある場合、`/k/v1/records.json` 単発では取得できない（kintone の 1 リクエスト上限は 500 件）
- **対処方針**: 実装時にカーソル API（`/k/v1/records/cursor.json`）で全件取得するか、500 件を上限として打ち切るかを判断する（§12.1 参照）

### 11.3 REFERENCE_TABLE の displayFields が空

- **挙動**: `matchField()` で空文字列を返す
- **対処**: 検索対象外として無視する（エラーなし）

### 11.4 設定でフィールドコード指定済みだが該当フィールドが削除済み

- **状況**: searchTargets に `{ fieldCode: "deletedField" }` が残っているが、フィールドは削除済み
- **対処**: `matchField()` で `record[fieldCode]` が undefined → 空文字列を返す。コンソールに警告ログを出力する

### 11.5 KcEvent から元レコードへの逆引き

- **状況**: Phase 1 の `applyHighlight()` は DOM の `el.title` 属性からタイトルを取得していた。Phase 2 ではフィールド値を参照するため、DOM から KcEvent または kintone 元レコードへの逆引き手段が必要
- **対処方針**: 実装時に `data-record-id` 属性を各イベント DOM に付与し、`KC.State.events` から `recordId` でレコードを引く方式を検討する（§12.4 参照）

### 11.6 USER_SELECT が空配列

- **挙動**: `field.value = []` の場合、`matchField()` は空文字列を返す
- **対処**: 正常動作（エラーなし、マッチしない）

### 11.7 ビュー切替時のキャッシュ更新タイミング

- **状況**: `loadRelatedRecords()` は非同期処理。ビュー切替の描画が完了する前にキャッシュ更新が終わらない可能性がある
- **対処方針**: `loadRelatedRecords()` の完了後に `applyHighlight()` を呼ぶ順序で実装する。または描画時点のキャッシュで暫定的に動作し、更新完了後に再度 `applyHighlight()` を呼ぶ

### 11.8 リスク一覧

| リスク | 対策 |
|---|---|
| 関連先レコード取得に時間がかかり初期表示が遅延する | カーソル API で並列取得、件数上限の設定、キャッシュ TTL の設定（§12.1 / §12.2） |
| `applyHighlight()` での DOM 操作が KcEvent 逆引きにより重くなる | 実装時に計測。問題があれば `Map` による高速引きへの変更を検討 |
| `opacity: 0.25` が権限色の視認性に影響する | 実機確認。問題があれば `opacity: 0.35` 等に調整 |
| 設定スキーマ v6→v7 マイグレーション漏れ | `loadInitialConfig()` でバージョン確認と `searchTargets: []` の補完を明示的に実装する |

---

## 12. 未確定事項・前提条件

### 12.1 関連先レコード件数の上限閾値

関連先アプリのレコードが 500 件を超える場合の挙動が未確定。

**選択肢**:
- **案 A**: カーソル API で全件取得する（取得完了まで時間がかかる）
- **案 B**: 500 件を上限として打ち切り、超過分は検索対象外とする（警告ログのみ）

実装時に T-P2-6 のパフォーマンス計測結果を元に判断する。

### 12.2 関連レコードキャッシュの TTL

現在の設計では「ビュー切替・月送り時に再取得」であり、明示的な TTL は設けない。長時間操作しない場合のキャッシュ鮮度は実装時に判断する。

### 12.3 狭幅時（モバイル）レイアウト

ヘッダー右側に要素が増えるため、狭幅時にヘッダーが折り返しまたは溢れる可能性がある。

**推奨**: 400px 以下で検索入力欄を幅 0 に折り畳み、虫眼鏡アイコンをタップで展開する。主要利用デバイスがデスクトップのみであれば狭幅対応は Phase 3 送りでもよい。

### 12.4 DOM から KcEvent / 元レコードへの逆引き手段

Phase 1 では DOM の `el.title` 属性からタイトル文字列を取得していた。Phase 2 では追加フィールドの値を参照するため、DOM から KcEvent（または kintone 元レコード）を引く仕組みが必要。

**有力案**: 各イベント DOM 要素に `data-record-id="<recordId>"` 属性を付与し、`applyHighlight()` 内で `KC.State.events.find(e => e.id === recordId)` で引く。実装時に確立する。

### 12.5 sessionStorage への保存

Phase 2 でも保存しない方針。将来ユーザーニーズが確認されれば Phase 3 で検討する。

### 12.6 フォーカス候補が月跨ぎの場合の挙動

月ビューでアクティブ候補が現在表示中の月と異なる月に属する場合、月切替を行うかどうかが未確定。

**推奨**: 切り替えない（現在表示中の月内のマッチ候補のみで巡回する）。月跨ぎ検索が必要なユースケースがある場合に Phase 3 で再検討する。

### 12.7 USER_SELECT の code と name の検索方針（確定済み）

grill-me にて「code と name 両方を検索対象にする」を確定。実装時に見直す場合は管理者へ報告の上、本書を改訂すること。

### 12.8 マッチ候補リストの順序定義

DOM 上の表示順（`querySelectorAll` の返却順）を採用する（案 A）。各ビューで `querySelectorAll` の返却順が概ね時系列順になるかは実機確認を要する。問題があれば開始時刻順（案 B）への変更を検討する。

### 12.9 前提条件

- `KC.Config.FIELD.title` が有効なフィールドコードにマッピングされていること（プラグイン設定済み）
- カレンダーが `desktop.js` の `KC.Boot.init()` から初期化されていること
- `KC.State.events` が `KcEvent` 配列として管理されていること
- プラグイン設定の `searchTargets` に設定されたフィールドが、kintone アプリに実際に存在すること
- REFERENCE_TABLE フィールドの関連先アプリに対して、ログインユーザーが閲覧権限を持っていること（権限なしの場合は §11.1 の対処に従う）
- kintone REST API `/k/v1/app/form/fields.json` および `/k/v1/records.json` が利用可能であること

---

*本要件定義書は 2026-06-01 時点の実装調査・grill-me 確定事項に基づき v3 として改訂。Phase 1（v1/v2）の内容は維持しつつ、Phase 2 の検索対象フィールド拡張・関連レコード対応を追加。残る未確定事項は §12 に整理済み。実装前に §12.1（件数上限）・§12.4（DOM 逆引き）を重点確認すること。*
