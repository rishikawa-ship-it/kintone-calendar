# 要件定義書: チェックボックス式フィルタ UI 再設計

**文書番号**: REQ_checkbox-filter
**作成日**: 2026-07-02
**最終更新日**: 2026-07-02（確定版: ユーザー確認済み方針を反映。builder 実装可能な粒度）
**作成者**: designer（サブエージェント）
**ステータス**: 確定版 第 2 版（残存未確定事項: §13 Q-9 のみ。実装時に原文確認）
**対象ファイル（正本）**:
- `plugin/src/js/desktop.js`（フィルタ UI・適用ロジック・URL 同期）
- `plugin/src/html/config.html`（設定画面 HTML）
- `plugin/src/js/config.js`（設定画面ロジック）
- `plugin/src/css/config.css`（設定画面スタイル）
- `plugin/src/css/desktop.css`（本体スタイル）
**関連文書**:
- `requirements/REQ_url-state-sync.md`（`filter` パラメータの URL 同期。本要件で置換）
- `requirements/REQ_search-bar.md`（検索バー・フローティング一覧の実装パターン、UI 部品の参考）
- `requirements/REQ_edit-permission-extension.md`（`permissionRules` / `fieldValueRules` スキーマの原典。未取得のため本書は desktop.js / config.js の実装から逆引きした内容のみ記載。§15 Q-9）
- `requirements/REQ_default-permission.md`（`defaultPermission` の追加経緯）
- `FIELD_REFERENCE.md`

---

## 改版履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| 第1版（ドラフト） | 2026-07-02 | 調査＋複数案併記のドラフト。§13 に Q-1〜Q-9 の未確定事項を列挙 |
| 第2版（確定版） | 2026-07-02 | ユーザー確認結果を反映し全編を確定仕様として書き換え。Q-1（汎用フィルタ）・Q-2（全解除=全表示）・Q-3（ハイブリッド設定方式）・Q-4（既存ドロップダウン廃止・統合）・Q-5（config v11 マイグレーション）・Q-6（localStorage/URL 状態保持を実施）・Q-7（即時反映）を確定。Q-9（`REQ_edit-permission-extension.md` 原文未確認）のみ実装時対応事項として残存 |

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析（ファイル:行番号付き）](#2-現状分析ファイル行番号付き)
3. [確定方針サマリ](#3-確定方針サマリ)
4. [機能要件](#4-機能要件)
5. [UI 仕様（desktop.js / desktop.css）](#5-ui-仕様desktopjs--desktopcss)
6. [設定画面仕様（config.html / config.js）](#6-設定画面仕様confightml--configjs)
7. [config 保存形式（filterConfig, version 11）](#7-config-保存形式filterconfig-version-11)
8. [desktop.js 適用ロジック](#8-desktopjs-適用ロジック)
9. [状態保持（localStorage / URL）](#9-状態保持localstorage--url)
10. [変更対象ファイル・関数一覧（builder 向けサマリ）](#10-変更対象ファイル関数一覧builder-向けサマリ)
11. [非機能要件](#11-非機能要件)
12. [受入基準](#12-受入基準)
13. [検証項目・実機検証手順](#13-検証項目実機検証手順)
14. [想定 UX / シーケンス](#14-想定-ux--シーケンス)
15. [未解決事項・リスク・前提](#15-未解決事項リスク前提)

---

## 1. 背景・目的

### 1.1 背景

KC Calendar プラグインには現在「すべて / 自分のみ / 他人のみ」の3択フィルタ（`KC.FilterDropdown`）がヘッダー右側に配置されている。ユーザーから「ステータスによる絞り込みも追加したいが、ボタンを並べると幅を取りすぎる」という課題が提起された。

検討の結果、**チェックボックス式のフィルタパネル（ボタン1つ→開閉式パネル）に全面刷新し、フィルタ対象・選択肢を設定画面から自由に追加できる汎用方式**を採用することが決定した。

### 1.2 目的

1. 既存の「自分のみ/他人のみ」相当の絞り込みと、新規の「ステータス」等の絞り込みを、**ヘッダー幅を増やさず**両立できる UI に刷新する
2. フィルタ対象・グループ・選択肢を**設定画面（config.html/js）から管理者が自由に追加編集可能**にする（担当・ステータスに限らない汎用フィルタ）
3. 複数フィルタグループの組合せ条件（グループ内 OR・グループ間 AND、全解除=絞り込みなし）を明確化する
4. 状態（チェック内容）を localStorage・URL の両方に保持し、ページリロード・共有リンクで復元できるようにする

### 1.3 スコープ

- 実装対象は `plugin/` 配下のみ（`src/kc-calendar.js` は対象外。MEMORY.md 記載どおり src 版は未使用）
- 本書は builder がそのまま実装に着手できる確定仕様である
- 唯一の残存未確定事項は §15 Q-9（`REQ_edit-permission-extension.md` 原文未確認）で、実装着手時に builder が当該文書を読み合わせることで解消する

---

## 2. 現状分析（ファイル:行番号付き）

### 2.1 既存フィルタ UI: `KC.FilterDropdown`（廃止対象）

`plugin/src/js/desktop.js:9296-9454`

- ヘッダー右側（`.kc-head-right`）に `#kc-filter` という `.kc-dropdown` 要素を生成する（`buildDOM`, `desktop.js:9353-9446`）
- ボタン（`#kc-filter-select`）クリックで `<ul class="kc-dropdown-menu">` が開き、`<li class="kc-option">` を3件（すべて/自分のみ/他人のみ）表示する単一選択方式
- 選択で `choose(value, label)` → `_saveAndRefresh(value)`（`desktop.js:9325-9336`）が呼ばれ `KC.State.eventFilter` を更新し即時再描画
- **本改修で `KC.FilterDropdown` は廃止し、新設 `KC.CheckFilter`（仮称、§10 で命名確定）に置換する**。DOM 生成先（`.kc-head-right` の先頭挿入、`headRight.insertBefore(wrap, headRight.firstChild)` パターン）とドロップダウン開閉パターン（`.kc-dropdown` / `.kc-dropdown-menu` の CSS クラス）は流用する

### 2.2 フィルタ状態の現状の保持方法

- `KC.State.eventFilter`: `'all' | 'mine' | 'others'`。デフォルト `'all'`（`desktop.js:734`）。**本改修で廃止し `KC.State.filterChecks` に置換**（§9.1）
- 永続化: `localStorage` キー `kc-event-filter`（`KC.FilterDropdown.STORAGE_KEY`, `desktop.js:9303`）。**本改修で新キーに置換**（§9.1）
- URL 同期: `desktop.js:9333` で `KC.UrlState.update('filter', value)`。復元は `desktop.js:9072-9095`（`KC.UrlState.restore()` 内）と `desktop.js:10136-10142`（`popstate` ハンドラ内の差分更新）。**本改修でパラメータ形式を変更**（§9.2）

### 2.3 適用ロジック: `KC.EventFilter.apply()`（拡張対象）

`plugin/src/js/desktop.js:7760-7785`

```javascript
KC.EventFilter = {
  apply: function (events) {
    var filter = KC.State.eventFilter || 'all';
    if (filter === 'mine') {
      return events.filter(function (e) { return KC.LoginContext.getPermission(e).bgColor !== null; });
    }
    if (filter === 'others') {
      return events.filter(function (e) { return KC.LoginContext.getPermission(e).bgColor === null; });
    }
    return events;  // 'all'
  }
};
```

呼び出し箇所: `KC.SearchFilter.apply(KC.EventFilter.apply(S.events || []))` の形で週ビュー（`desktop.js:4284`）・月ビュー（`desktop.js:6111`、警告ログに `eventFilter` 参照あり `desktop.js:6115`）・別箇所（`desktop.js:6490`）の描画直前に適用。API 再取得なし（クライアント側フィルタ）。**本改修でグループ判定ロジックに置換**（§8.1）。`desktop.js:6115` の警告ログ文言も修正対象。

### 2.4 「自分/他人」の判定方法（既存ロジックを流用確定）

`KC.LoginContext.getPermission(evt)`（`desktop.js:3706-3750`）:

1. `KC.Config.FIELDVALUE_RULES`（DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS の値マッチ）を先に評価
2. マッチしなければ `KC.Config.PERMISSION_RULES`（USER_SELECT フィールドの `value[].code` にログインユーザーコードが含まれるか、`_evalEntry`, `desktop.js:3616-3623`）を評価
3. いずれもマッチしなければ `DEFAULT_PERMISSION` またはハードコードフォールバック（全員 edit 扱い）

既存 `'mine'/'others'` 判定は `getPermission(evt).bgColor` が **null かどうか**で行っている。**本改修では「担当」グループの2チェック項目（`mine`/`others`）の判定にこの `bgColor !== null` / `bgColor === null` ロジックをそのまま流用する**（確定。§4.3, §8.1）。

### 2.5 ステータスの持ち方・値取得の仕組み（流用確定）

plugin 版は固定フィールドコードを持たない汎用設計。`config.js` に既に以下の仕組みがある。

- `loadStatuses()`（`config.js:2428-2456`）: `/k/v1/app/status.json` を呼び出しプロセス管理ステータス一覧を `statusOptions` に格納。`statusEnabled` フラグで有効/無効を判定
- `getFieldValueOptions(fieldCode, fieldType)`（`config.js:1333-1344`）: `fieldType === 'STATUS'` なら `statusOptions`、それ以外は `fieldValueFieldOptions[].options`（DROP_DOWN/RADIO_BUTTON/CHECK_BOX の選択肢）を返す
- `fieldCode === '$status'` は STATUS 型として扱う特殊フィールドコード（`config.js:1479-1485, 1581-1582`）
- `desktop.js` 側の `_recordToEvent`（`desktop.js:773-810`）は `valueFields[fvCode]` に `FIELDVALUE_RULES` の各 `fieldCode` の値を格納済み。$status も含む

**これらの値取得の仕組みをフィルタのチェック項目の値ソースとしてそのまま流用する**（§6.2, §8.1）。

### 2.6 設定画面の既存テーブル型 UI 部品（流用確定）

`plugin/src/js/config.js`:

| 部品 | 関数 | 行番号 | 流用方法 |
|---|---|---|---|
| 権限フィールド設定行（フィールド＋値＋権限＋色×2＋削除） | `buildFieldValueRow` | `config.js:1387-` | 構造をそのまま踏襲し「フィルタ項目行」を新設（値・ラベルのみ、権限・色列は不要） |
| 値ドロップダウンの動的再構築 | `rebuildValueSelect` | `config.js:1354-1378` | そのまま呼び出して値選択肢を再構築 |
| フィールドコード→選択肢一覧取得 | `getFieldValueOptions` | `config.js:1333-1344` | そのまま呼び出し |
| フィールド選択ドロップダウン生成パターン | `buildPermissionFieldSelect` | `config.js:1206-1236` | 欠損フィールド警告表示パターンを踏襲 |
| 行のドラッグ並び替え | `buildDragHandle` / `attachRowDragEvents` | （`buildPermissionRow` 内使用） | フィルタ項目の並び替えに流用 |
| フィールド型フィルタ定数群 | `TITLE_FIELD_TYPES` 等 | `config.js:88-113` | 同パターンで `FILTER_TARGET_FIELD_TYPES` を新設 |

### 2.7 config JSON バージョニング（現行 version 10）

`config.js:1-63`（コメント）、`config.js:151`。v5〜v10 は「新キー追加＋マイグレーションで空配列/デフォルト値を補う」パターンで一貫。**本改修は version 11 として同パターンを踏襲する**（§7.3）。

### 2.8 ヘッダー幅制約（変更なしで両立確認済み）

`plugin/src/css/desktop.css:100-129`

- `.kc-header`（`flex-wrap: nowrap`）・`.kc-head-right`（`flex-wrap: nowrap`）は現状維持
- `.kc-dropdown-menu`（`desktop.css:206-220`, `position: absolute; right: 0;`）の絶対配置パターンにより、パネルは開いたときのみ展開されヘッダー幅に影響しない。**新パネルもこのパターンを踏襲し、ヘッダーに新規ボタンを追加しない**（既存 `#kc-filter` 枠を置換）

### 2.9 KC.Config のロードパターン（新設 `FILTER_CONFIG` の参考実装）

`desktop.js:286-345`（`loadFromPluginConfig` 内）と `desktop.js:357-389`（初期値定義）に以下の一貫パターンがある。

```javascript
// 読み込み時（loadFromPluginConfig 内、例: SEARCH_TARGETS のパターン）
KC.Config.SEARCH_TARGETS = Array.isArray(config.searchTargets) ? config.searchTargets : [];

// 初期値（IIFE 直下、loadFromPluginConfig 呼び出し前のデフォルト）
KC.Config.SEARCH_TARGETS = [];
```

**`KC.Config.FILTER_CONFIG` もこのパターンに倣って実装する**（§8.2）。

---

## 3. 確定方針サマリ

| 論点 | 確定内容 |
|---|---|
| フィルタ対象 | **汎用**。「担当（自分/他人）」「ステータス」を標準グループとして提供しつつ、管理者が設定画面で任意フィールド（DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS/USER_SELECT 等）をフィルタグループとして追加できる |
| 設定方式 | **ハイブリッド**。グループ（フィルタ軸）は手動で列挙・追加（対象フィールドを選ぶ）。各グループのチェック項目（値）は `getFieldValueOptions` で選択肢を自動取得。既存の「フィールド選択→値選択」2段テーブル部品を流用 |
| 既存ドロップダウンの扱い | **廃止（統合）**。`KC.FilterDropdown` は廃止し、ボタン1つ→チェックボックスパネルに統合。「担当」を標準グループとし、内部に「自分/他人」チェック項目を持つ（判定は `getPermission().bgColor` ロジック流用）。ヘッダーに新規ボタンは増やさない |
| グループ内/グループ間の組合せ | グループ内 **OR**、グループ間 **AND** |
| 全解除の意味 | **全解除＝その軸で絞り込まない（全表示扱い）**。全グループ未選択＝全件表示 |
| 反映方式 | **即時反映**（「適用」ボタンなし）。`KC.EventFilter.apply()` 拡張、API 再取得なし・クライアント側フィルタ |
| 状態保持 | **localStorage と URL の両方に保持**。既存 `filter` パラメータ・`kc-event-filter` キーを新形式に置換（後方互換マイグレーションあり） |
| config バージョン | **version 11** に繰り上げ。旧設定（`filterConfig` なし）は「担当グループ（自分/他人）のみ」の既定 `filterConfig` に変換 |

---

## 4. 機能要件

### FR-1: フィルタボタンの統合

ヘッダーの `#kc-filter` ボタン（既存）を、新しいチェックボックスパネル方式のトリガーボタンとして置換する。新規ボタンは追加しない。

### FR-2: チェックボックスパネルの表示

ボタンクリックでグループ分けされたチェックボックス一覧パネルを開閉する。パネルは絶対配置のポップオーバーとし、開いていない間はヘッダー幅に影響しない。

### FR-3: グループ構成（標準 + 汎用）

- 標準グループ「担当」（`type: 'assignee'`）: 固定チェック項目「自分の予定」（`mine`）「他人の予定」（`others`）の2つ
- 管理者が追加した汎用グループ（`type: 'fieldValue'`）: 対象フィールド（DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS/USER_SELECT）の選択肢がチェック項目になる
- グループの追加・削除・順序（表示順）は設定画面で管理者が編集する

### FR-4: チェックの組合せ意味

- グループ内: **OR**（同一グループの複数項目をチェック → いずれかに該当する予定を表示）
- グループ間: **AND**（複数グループでチェックがある場合 → 全グループの条件を満たす予定のみ表示）
- **グループ内の全項目が未チェック（0件）の場合、そのグループは絞り込み条件から除外**（そのグループでは絞り込まない＝全件通過扱い）
- 全グループが未チェック状態＝全件表示（初期状態相当）

### FR-5: 即時反映

チェックボックスの ON/OFF 操作のたびに `KC.EventFilter.apply()` の結果を即座に再計算し、`KC.Render.renderGrid()` で再描画する。「適用」ボタンは設けない。API 再取得は発生させない。

### FR-6: 設定画面での編集

- 設定画面にフィルタ設定セクションを新設する
- グループの追加・削除・並び替え（ドラッグ）ができる
- 各グループについて、種別（「担当（固定）」または「フィールド値（汎用）」）を選択する
- 「フィールド値」グループの場合、対象フィールド（DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS/USER_SELECT）を選択する
- 対象フィールド選択後、そのフィールドの選択肢（`getFieldValueOptions` で自動取得）から**チェック項目として含める値**を選ぶ（複数選択・全選択も可能。詳細は §6.2）
- グループ・チェック項目にラベルを設定できる（フィールド値そのままでも、カスタムラベルでも可）

### FR-7: 状態保持

- チェック状態（グループごとの選択項目）は `localStorage` に保存する
- チェック状態は URL ハッシュ（`#kc:` プレフィクス）にも同期する（`KC.UrlState` 経由、`replaceState`）
- ページリロード時は URL 優先、URL になければ `localStorage` の値を使用する（既存 `REQ_url-state-sync.md` FR-2 の優先順位ルールを踏襲）

### FR-8: 後方互換（旧設定・旧状態からの移行）

- 旧 config（`filterConfig` キーなし、version ≤ 10）を読み込んだ場合、「担当」グループ（自分/他人の2択）のみを持つ `filterConfig` を自動生成し、現状と同等の絞り込みができる状態にする
- 旧 `localStorage`（`kc-event-filter` キー、値 `'all'/'mine'/'others'`）が存在する場合、可能であれば「担当」グループの選択状態に変換する。変換不能な場合は既定＝全表示とする（詳細は §7.3, §9.3）
- 旧 URL パラメータ（`#kc:filter=all/mine/others`）が存在する場合、同様に「担当」グループの選択状態に変換を試みる。変換できない場合は無視して全表示とする（詳細は §9.2）

### FR-9: USER_SELECT フィールドをフィルタ対象にする場合の扱い

USER_SELECT フィールドを汎用グループの対象フィールドに選んだ場合、チェック項目の選択肢は「そのフィールドの値として実際に使われているユーザー」ではなく、**kintone のフィールド設定で許可されているユーザー/組織/グループの選択肢一覧を取得する手段がないため、値の自動生成は行わない**。USER_SELECT を対象フィールドにした場合は、管理者が値（ユーザーコード）を手動入力する方式とする（詳細は §6.2 のフィールド型別の分岐）。

---

## 5. UI 仕様（desktop.js / desktop.css）

### 5.1 ヘッダー DOM 構造（案）

```html
<div class="kc-dropdown kc-filter-panel" id="kc-filter">
  <button class="kc-dropdown-btn" id="kc-filter-select" aria-haspopup="true" aria-expanded="false">
    フィルタ <span class="kc-caret">▾</span>
  </button>
  <div class="kc-filter-panel-menu" role="group" aria-label="フィルタ">
    <!-- グループごとに繰り返し -->
    <div class="kc-filter-group" data-group-id="assignee">
      <div class="kc-filter-group-title">担当</div>
      <label class="kc-filter-item">
        <input type="checkbox" data-group-id="assignee" data-item-id="mine" checked>
        自分の予定
      </label>
      <label class="kc-filter-item">
        <input type="checkbox" data-group-id="assignee" data-item-id="others" checked>
        他人の予定
      </label>
    </div>
    <div class="kc-filter-group" data-group-id="status">
      <div class="kc-filter-group-title">ステータス</div>
      <label class="kc-filter-item">
        <input type="checkbox" data-group-id="status" data-item-id="item-1" checked>
        予約済
      </label>
      <!-- ... -->
    </div>
  </div>
</div>
```

- ルート要素 `#kc-filter` の ID・`.kc-dropdown` クラスは既存を維持（CSS 流用・他コードからの参照箇所を壊さないため）
- `.kc-filter-panel-menu` は既存 `.kc-dropdown-menu` の絶対配置スタイル（`position: absolute; right: 0; top: calc(100% + 8px);` 等）を継承しつつ、`<ul>` ではなく `<div>` ベースにする（チェックボックスの `<label>` 構造に合わせるため。CSS セレクタで `.kc-dropdown-menu` と同等のスタイルを適用するか、新クラスに同等のプロパティを複製する）

### 5.2 ボタンのラベル表示

- デフォルト表示: `フィルタ ▾`（固定ラベル。既存の `_labelFor(value)` のような動的ラベルは廃止し、選択状態が複雑になるため固定文言にする）
- 何らかの絞り込みが有効な場合（いずれかのグループで一部項目のみチェック）、ボタンに視覚的なバッジ（例: `フィルタ ● ▾` または件数バッジ）を表示することを推奨する（必須ではない。builder 判断でよい。UI 差分は軽微なため本書では強制しない）

### 5.3 開閉制御

- 既存 `KC.FilterDropdown` / `KC.ViewDropdown` と同じ開閉パターン（`open()` / `close()` / `toggle()`、外側クリックで閉じる、`desktop.js:9394-9442` 相当）を踏襲する
- チェックボックスクリック時は**パネルを閉じない**（複数項目を続けて操作できるようにする。既存の単一選択ドロップダウンとの重要な差分）
- ESC キーでパネルを閉じる（既存 `KC.ViewDropdown` にはない機能だが、`REQ_search-bar.md` FR-12-5 のパターンを参考に追加を推奨）

### 5.4 チェック変更時の処理フロー

```
checkbox change イベント
  → KC.State.filterChecks[groupId] を更新（配列への追加/削除）
  → KC.CheckFilter._persist()  … localStorage 保存
  → KC.UrlState.update(...)    … URL 同期（§9.2）
  → KC.Render.renderGrid()     … 即時再描画（API 再取得なし）
```

### 5.5 CSS（desktop.css 追加案）

```css
.kc-filter-panel-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 220px;
  max-height: 400px;
  overflow-y: auto;
  background: #f5f6f7;
  border: 1px solid #d6dadd;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  padding: 10px;
  display: none;
  z-index: 100;
}
.kc-filter-panel.open .kc-filter-panel-menu { display: block; }

.kc-filter-group { margin-bottom: 12px; }
.kc-filter-group:last-child { margin-bottom: 0; }
.kc-filter-group-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 6px;
  padding: 0 4px;
}
.kc-filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: var(--kc-font-size-ui);
  cursor: pointer;
}
.kc-filter-item:hover { background: #e9ecef; }
```

`max-height: 400px; overflow-y: auto;` によりステータス等の選択肢が多い場合でもレイアウトが破綻しない（`REQ_search-bar.md` NF-5 のフローティング一覧パターンを踏襲）。

---

## 6. 設定画面仕様（config.html / config.js）

### 6.1 セクション構成

config.html に新セクション「フィルタ設定」（`#kc-filter-config-section`）を追加する。既存の「権限フィールド設定」セクション（`buildFieldValueRow` を使うセクション）の直後に配置することを推奨する（関連性が高いため）。

```
+-----------------------------------------------------------+
| フィルタ設定                                                |
|  ※ カレンダーのフィルタボタンに表示するグループと選択肢を設定します  |
|                                                             |
|  [グループを追加]                                            |
|                                                             |
|  +-------------------------------------------------------+ |
|  | ⠿ [担当（固定） ▾]                          [削除不可*] | |
|  |    ラベル: [担当______]                                 | |
|  |    項目: 自分の予定 / 他人の予定（固定・編集不可）          | |
|  +-------------------------------------------------------+ |
|  | ⠿ [フィールド値 ▾]  対象: [ステータス($status) ▾]  [削除] | |
|  |    ラベル: [ステータス___]                               | |
|  |    項目一覧:                                            | |
|  |      [x] 予約済   ラベル:[予約済____]  [削除]            | |
|  |      [x] 貸出中   ラベル:[貸出中____]  [削除]            | |
|  |      [ ] 返却済   ラベル:[返却済____]  [削除]            | |
|  |      [項目を追加]（対象フィールドの未追加選択肢から選ぶ）    | |
|  +-------------------------------------------------------+ |
|                                                             |
+-----------------------------------------------------------+
```

*「担当」グループは既定で1つ常設し、削除不可（廃止する既存ドロップダウン相当の機能を欠落させないため）。ラベルの変更は可能。

### 6.2 グループ種別とフィールド型ごとの値取得方式

| グループ種別 | 対象フィールド型 | 値（チェック項目）の取得方法 |
|---|---|---|
| `assignee`（担当・固定） | — | 項目固定（`mine` / `others`）。値選択 UI なし |
| `fieldValue`（汎用） | DROP_DOWN / RADIO_BUTTON / CHECK_BOX | `getFieldValueOptions(fieldCode, fieldType)`（`config.js:1333-1344`）で選択肢一覧を取得し、チェックボックスで「フィルタ項目として含める値」を選ばせる（複数選択可） |
| `fieldValue`（汎用） | STATUS（`$status`） | 同上。`getFieldValueOptions('$status', 'STATUS')` が `statusOptions` を返す（`config.js:1334-1336`）。`statusEnabled === false`（プロセス管理未設定）の場合はこの選択肢を設定 UI 上で非表示にする（既存 `buildFieldValueFieldSelect` の `1479-1485` と同じガード条件を流用） |
| `fieldValue`（汎用） | USER_SELECT | 選択肢の自動取得手段がないため、**値は管理者が手動でユーザーコード（`code`）とラベルを入力**する簡易 UI とする（FR-9）。テキスト入力 `code` + ラベル入力の1行フォームを「項目を追加」で複数追加できるようにする |

### 6.3 具体的な UI 構築フロー（`fieldValue` グループ）

1. 管理者が「グループを追加」→ 種別「フィールド値」を選択
2. 対象フィールド選択ドロップダウン（`FILTER_TARGET_FIELD_TYPES = ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'STATUS', 'USER_SELECT']` で絞り込んだフィールド一覧。`fieldValueFieldOptions` ＋ `$status`（`statusEnabled` 時のみ）と同じ一覧生成ロジックを流用可能）
3. フィールド選択変更時、`rebuildValueSelect` 相当のロジックで**候補チェック項目リスト**（未追加の選択肢）を再構築する
4. 「項目を追加」ボタンで、候補リストから選んだ値をチェック項目テーブルに1行追加する（ラベルは値そのままを初期値とし、手動で編集可能）
5. 各チェック項目行に「デフォルトでチェック済みにするか」のトグル（既定は `checked: true`。§7.2 の `defaultChecked` に対応）
6. チェック項目の並び替え（ドラッグ）・削除が可能

### 6.4 実装関数マッピング（builder 向け）

| 新設/流用 | 関数名（案） | 参考にする既存関数 |
|---|---|---|
| 新設 | `buildFilterGroupRow(group)` | `buildFieldValueRow`（`config.js:1387-`）の構造踏襲 |
| 新設 | `buildFilterGroupTypeSelect(group)` | `buildPermissionPermSelect`（`config.js:1243-1268`）のシンプルな select 生成パターン |
| 新設 | `buildFilterTargetFieldSelect(group)` | `buildPermissionFieldSelect`（`config.js:1206-1236`）の欠損フィールド警告パターン流用 |
| 新設 | `buildFilterItemRow(group, item)` | `buildFieldValueRow` 内の値セル部分を抽出・簡略化（権限・色列は不要） |
| 流用（そのまま呼び出し） | `getFieldValueOptions(fieldCode, fieldType)` | `config.js:1333-1344` |
| 流用（そのまま呼び出し） | `rebuildValueSelect(valueSel, fieldCode, fieldType, selectedValue)` | `config.js:1354-1378` |
| 新設 | `collectFilterConfig()` | `collectPermissionRules`（`config.js:1277-1300`）の DOM→配列収集パターン踏襲 |
| 新設 | `applyFilterConfig(filterConfig)` | `applyPermissionRules`（`config.js:1308-1319`）の配列→DOM 反映パターン踏襲 |
| 流用 | `buildDragHandle` / `attachRowDragEvents` | グループ行・項目行両方の並び替えに使用 |

### 6.5 マイグレーション処理（config.js 側）

`config.js` の設定読み込み処理（`loadInitialConfig` 相当、バージョン判定を行う箇所）に、v10 以前の設定を v11 に変換する処理を追加する。

```javascript
// v10 → v11 マイグレーション（filterConfig 新設）
if (!config.filterConfig) {
  config.filterConfig = {
    groups: [
      {
        id: 'assignee',
        label: '担当',
        type: 'assignee',
        items: [
          { id: 'mine',   label: '自分の予定', defaultChecked: true },
          { id: 'others', label: '他人の予定', defaultChecked: true }
        ]
      }
    ]
  };
}
config.version = 11;
```

既存の `version: 5, 10` 等のマイグレーション処理群（`config.js:2120, 2170, 2269, 2900` 付近）と同じ箇所・同じスタイルで追記する。

---

## 7. config 保存形式（filterConfig, version 11）

### 7.1 スキーマ

```javascript
// 保存スキーマ（version 11）
{
  version: 11,
  fieldMapping: { ... },        // 既存
  permissionRules: [ ... ],     // 既存
  fieldValueRules: [ ... ],     // 既存
  searchTargets: [ ... ],       // 既存
  defaultPermission: { ... },   // 既存
  views: { ... },               // 既存
  filterConfig: {                              // 新規（version 11）
    groups: [
      {
        id: "assignee",                        // グループ識別子（内部キー。URL/localStorage のキーにも使用）
        label: "担当",                          // 表示ラベル（編集可能）
        type: "assignee",                       // 'assignee'（固定・削除不可）| 'fieldValue'（汎用）
        items: [
          { id: "mine",   label: "自分の予定", defaultChecked: true },
          { id: "others", label: "他人の予定", defaultChecked: true }
        ]
      },
      {
        id: "status",
        label: "ステータス",
        type: "fieldValue",
        fieldCode: "$status",                   // 'fieldValue' 型のみ必須
        fieldType: "STATUS",                    // DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS/USER_SELECT
        items: [
          { id: "item-1", label: "予約済", value: "予約済", defaultChecked: true },
          { id: "item-2", label: "貸出中", value: "貸出中", defaultChecked: true },
          { id: "item-3", label: "返却済", value: "返却済", defaultChecked: false }
        ]
      }
    ]
  }
}
```

### 7.2 各フィールドの意味

| キー | 型 | 説明 |
|---|---|---|
| `filterConfig.groups[].id` | string | グループ識別子。半角英数字。URL パラメータ・localStorage のキーに使用するため一意である必要がある |
| `filterConfig.groups[].label` | string | 設定画面・カレンダー UI に表示するグループ見出し |
| `filterConfig.groups[].type` | `'assignee'` \| `'fieldValue'` | `assignee` は固定の担当グループ（1つのみ、削除不可、items は固定2件）。`fieldValue` は汎用グループ |
| `filterConfig.groups[].fieldCode` | string（`fieldValue` 型のみ） | 対象フィールドコード（`$status` 含む） |
| `filterConfig.groups[].fieldType` | string（`fieldValue` 型のみ） | `DROP_DOWN` / `RADIO_BUTTON` / `CHECK_BOX` / `STATUS` / `USER_SELECT` |
| `filterConfig.groups[].items[].id` | string | 項目識別子。グループ内で一意 |
| `filterConfig.groups[].items[].label` | string | 表示ラベル（編集可能） |
| `filterConfig.groups[].items[].value` | string（`fieldValue` 型のみ） | フィールドの実値。`assignee` 型では不要（`id` が `mine`/`others` で判定に使われる） |
| `filterConfig.groups[].items[].defaultChecked` | boolean | 初回起動時（localStorage・URL に状態がない場合）のチェック初期値。全項目 `true` を既定推奨（初期状態＝全件表示、FR-4 と整合） |

### 7.3 バージョン繰り上げ・マイグレーション（確定）

- `version: 10 → 11`
- v10 以前の設定（`filterConfig` キーなし）を読み込んだ場合、§6.5 のとおり「担当グループ（自分/他人の2択、`defaultChecked: true`）のみ」を持つ `filterConfig` を自動生成する。これにより、旧バージョンで「すべて」を選択していたのと同等（絞り込みなし＝全件表示）の初期状態になる
- 旧 `localStorage`（`kc-event-filter`）・旧 URL（`#kc:filter=`）の値の移行は config マイグレーションとは別に **desktop.js 起動時処理**で行う（§9.3 参照。config はあくまで「フィルタの枠組み定義」であり、ユーザーごとのチェック状態は config の管轄外のため）

---

## 8. desktop.js 適用ロジック

### 8.1 `KC.EventFilter.apply()` の置換実装

```javascript
KC.EventFilter = {
  /**
   * KC.State.filterChecks に基づいてイベント配列を絞り込む
   * グループ内 OR・グループ間 AND。グループ内が全未チェックの場合はそのグループを無視（絞り込みなし）
   * @param {Array} events - KcEvent 配列
   * @returns {Array} フィルタ済み配列
   */
  apply: function (events) {
    var groups = (KC.Config.FILTER_CONFIG && KC.Config.FILTER_CONFIG.groups) || [];
    if (groups.length === 0) return events; // フィルタ未設定 = 全件表示

    return events.filter(function (evt) {
      return groups.every(function (group) {
        var checked = (KC.State.filterChecks && KC.State.filterChecks[group.id]) || [];
        if (checked.length === 0) return true; // 全解除 = このグループでは絞り込まない（FR-4 確定仕様）

        return checked.some(function (itemId) {
          return KC.EventFilter._matchGroupItem(group, itemId, evt);
        });
      });
    });
  },

  /**
   * 1グループ内の1チェック項目に対するマッチ判定
   * @param {Object} group - filterConfig.groups[] の1要素
   * @param {string} itemId - チェック済み項目 ID
   * @param {Object} evt - KcEvent
   * @returns {boolean}
   */
  _matchGroupItem: function (group, itemId, evt) {
    if (group.type === 'assignee') {
      var bgColor = KC.LoginContext.getPermission(evt).bgColor;
      if (itemId === 'mine')   return bgColor !== null;
      if (itemId === 'others') return bgColor === null;
      return false;
    }
    // fieldValue 型
    var item = (group.items || []).filter(function (i) { return i.id === itemId; })[0];
    if (!item) return false;
    var fieldVal = evt.valueFields ? evt.valueFields[group.fieldCode] : undefined;
    if (fieldVal === undefined) return false;
    return KC.EventFilter._matchFieldValue(fieldVal, item.value, group.fieldType);
  },

  /**
   * フィールド値マッチ判定（KC.LoginContext._matchFieldValue と同等ロジック。共有関数化を推奨）
   * CHECK_BOX は配列内包含、その他は完全一致
   */
  _matchFieldValue: function (fieldValue, ruleValue, fieldType) {
    if (fieldType === 'CHECK_BOX') {
      return Array.isArray(fieldValue) && fieldValue.indexOf(ruleValue) !== -1;
    }
    return fieldValue === ruleValue;
  }
};
```

**実装メモ（builder 向け）**: `_matchFieldValue` は `KC.LoginContext` 内の同名ロジック（`desktop.js:3665-3670`）と完全に重複する。DRY のため `KC.Utils.matchFieldValue` 等の共有関数に切り出し、両モジュールから参照する形にリファクタリングすることを推奨する（必須ではないが望ましい）。

### 8.2 `KC.Config.FILTER_CONFIG` の新設

`desktop.js:286-345`（`loadFromPluginConfig` 内）に以下を追加する。

```javascript
// フィルタ設定 (version 11 以降) を適用
// v10 以前の設定は config.js 側のマイグレーションで filterConfig が補完されているため、
// ここでの追加フォールバックは基本的に発生しない想定だが、念のため空配列で防御する
KC.Config.FILTER_CONFIG = (config.filterConfig && Array.isArray(config.filterConfig.groups))
  ? config.filterConfig
  : { groups: [] };
```

`desktop.js:357-389` 付近（IIFE 直下のデフォルト値群）に以下を追加する。

```javascript
/**
 * フィルタ設定 (REQ_checkbox-filter)
 * loadFromPluginConfig で上書きされる。初期値は空グループ = フィルタ機能なし（全件表示相当）
 * @type {{ groups: Array }}
 */
KC.Config.FILTER_CONFIG = { groups: [] };
```

### 8.3 `KC.State.filterChecks` の新設

`desktop.js:734` 付近（`KC.State.eventFilter` 定義箇所）を置換する。

```javascript
// 旧: eventFilter: 'all',
filterChecks: {},   /* { [groupId]: string[] }。グループ ID → チェック済み項目 ID 配列。localStorage/URL 永続化（REQ_checkbox-filter） */
```

初期化ロジック（`KC.CheckFilter.init()` 相当、新設）で `KC.Config.FILTER_CONFIG.groups` を走査し、各グループの `defaultChecked: true` の項目 ID を初期値として `KC.State.filterChecks[group.id]` にセットする（localStorage/URL 復元より前に実行し、後から上書きされる順序にする）。

### 8.4 影響を受ける既存呼び出し箇所

| 箇所 | 変更内容 |
|---|---|
| `desktop.js:4284` | `KC.EventFilter.apply(S.events \|\| [])` の呼び出し自体は変更不要（シグネチャ維持） |
| `desktop.js:6111, 6115` | 同上。ただし `desktop.js:6115` の警告ログ `'eventFilter=' + (KC.State.eventFilter || 'all')` は `filterChecks` を参照するよう修正（例: `JSON.stringify(KC.State.filterChecks)`） |
| `desktop.js:6490` | 呼び出し自体は変更不要 |
| `desktop.js:9296-9454`（`KC.FilterDropdown`） | モジュール全体を新設 `KC.CheckFilter` に置換（DOM 生成・開閉・保存処理をチェックボックス対応に書き換え） |
| `desktop.js:9829`（`KC.FilterDropdown.loadFilter()` 呼び出し） | `KC.CheckFilter.loadChecks()`（仮称）呼び出しに置換 |
| `desktop.js:10007-10008`（`KC.FilterDropdown.init()` 呼び出し） | `KC.CheckFilter.init()` 呼び出しに置換 |
| `desktop.js:9072-9095`（URL 復元、フィルタ部分） | §9.2 の新パラメータ形式のパースに置換 |
| `desktop.js:10136-10142`（`popstate` ハンドラのフィルタ差分更新） | 同上 |

---

## 9. 状態保持（localStorage / URL）

### 9.1 localStorage

- 新キー: `kc-filter-checks`
- 値: JSON 文字列化した `{ [groupId]: string[] }`（`KC.State.filterChecks` と同一構造）

```javascript
localStorage.setItem('kc-filter-checks', JSON.stringify(KC.State.filterChecks));
```

- 読み込み時（`KC.CheckFilter.loadChecks()`）: `localStorage.getItem('kc-filter-checks')` を `JSON.parse`。パース失敗・存在しない場合は §8.3 の `defaultChecked` 初期値を使用
- **旧キー `kc-event-filter` の移行処理**（§9.3）: 新キーが存在しない場合のみ、旧キーの値をチェック、変換ロジックを実行

### 9.2 URL（`KC.UrlState`）

既存 `filter=all/mine/others`（単一値）パラメータを、グループ別のパラメータに置換する。

**形式（確定）**: グループ ID をキー、選択項目 ID をカンマ区切りで連結した値とする、シンプルな複数パラメータ方式。

```
#kc:view=month&date=2026-07&fassignee=mine&fstatus=item-1,item-2
```

| パラメータ名 | 形式 | 説明 |
|---|---|---|
| `f<groupId>`（例: `fassignee`, `fstatus`） | チェック済み項目 ID をカンマ区切り | グループごとに1パラメータ。`groupId` に URL 安全な文字（英数字・ハイフン）のみ使うことを設定画面側でバリデーションする（§15 リスク参照） |

- 全項目チェック済み（絞り込みなし）の場合、そのグループのパラメータは**省略**する（URL を短く保つ。`defaultChecked` 全 true 相当なら書き込み不要）
- 空配列（全解除）の場合は `f<groupId>=`（空文字）として明示的に書き込む（省略すると「全選択」と区別できないため）
- 実装は `KC.UrlState.update('f' + groupId, checkedIds.join(','))` の形でグループごとに呼び出す
- 復元処理（`KC.UrlState.restore()` 内、`desktop.js:9072-9095` 相当箇所を置換）:

```javascript
// フィルタの復元（グループごとの f<groupId> パラメータを走査）
var groups = (KC.Config.FILTER_CONFIG && KC.Config.FILTER_CONFIG.groups) || [];
groups.forEach(function (group) {
  var key = 'f' + group.id;
  if (Object.prototype.hasOwnProperty.call(params, key)) {
    var raw = params[key];
    KC.State.filterChecks[group.id] = raw === '' ? [] : raw.split(',');
  }
  // key が URL に存在しない場合は localStorage 由来の値（または defaultChecked 初期値）を維持
});
KC.Render.renderGrid();
```

- **旧 `filter=` パラメータの移行処理**は §9.3 で扱う

### 9.3 旧状態からの移行ロジック（FR-8 詳細）

`KC.CheckFilter.init()` または起動シーケンスの早い段階（`KC.UrlState.restore()` 実行前）で以下を実行する。

```
1. 新キー（localStorage: kc-filter-checks、URL: f<groupId> のいずれか）が
   1つでも存在する場合 → 新形式を優先し、旧値の変換は行わない（新形式が既に確立している）

2. 新キーが一切存在せず、旧キーが存在する場合のみ変換を試みる:
   a. URL に #kc:filter=mine または #kc:filter=others がある場合:
      - assignee グループが存在すれば、
        filterChecks.assignee = filter === 'mine' ? ['mine'] : ['others']
      - assignee グループが存在しない（管理者が削除した等の異常系）場合は変換せず無視
   b. URL に #kc:filter=all がある、または filter パラメータがない場合:
      - 変換不要（全解除 = 全表示、または defaultChecked 初期値をそのまま使用）
   c. URL に値がなく localStorage の kc-event-filter のみ存在する場合:
      - 同様に 'mine'/'others' を assignee グループへ変換。'all' は変換不要

3. 変換結果は新キー（kc-filter-checks）へ保存し直す。旧キーは削除しない（他バージョンとの共存を考慮し、当面は残す。実害はない）
```

**変換できないケース（明記・FR-8 記載どおり）**: 管理者が「担当」グループ自体を設定から削除していた場合、旧 `mine`/`others` 値は変換先がないため無視し、**既定＝全表示**とする。

---

## 10. 変更対象ファイル・関数一覧（builder 向けサマリ）

### 10.1 `plugin/src/js/desktop.js`

| 種別 | 対象 | 内容 |
|---|---|---|
| 廃止 | `KC.FilterDropdown`（`9296-9454`） | モジュール全体を削除 |
| 新設 | `KC.CheckFilter` | `loadChecks()` / `init()` / `buildDOM(headRight)` / `_persist()` / `_updateUrl()` / `_migrateLegacy()` / `_toggleItem(groupId, itemId)` を持つモジュール。§5, §9 の仕様を実装 |
| 変更 | `KC.State`（`734`） | `eventFilter` → `filterChecks: {}` に置換 |
| 変更 | `KC.EventFilter.apply`（`7760-7785`） | §8.1 のグループ判定ロジックに置換。`_matchGroupItem` / `_matchFieldValue` を追加 |
| 変更 | `KC.Config.loadFromPluginConfig`（`286-345`付近） | `KC.Config.FILTER_CONFIG` の読み込みを追加（§8.2） |
| 変更 | `KC.Config` 初期値群（`357-389`付近） | `KC.Config.FILTER_CONFIG = { groups: [] }` を追加 |
| 変更 | `9829`（`loadFilter()` 呼び出し） | `KC.CheckFilter.loadChecks()` に置換 |
| 変更 | `10007-10008`（`init()` 呼び出し） | `KC.CheckFilter.init()` に置換 |
| 変更 | `9072-9095`（URL 復元のフィルタ部分） | §9.2 のグループ別パラメータ復元ロジックに置換 |
| 変更 | `10136-10142`（`popstate` ハンドラのフィルタ差分更新） | 同上のグループ別パラメータに対応 |
| 変更 | `6115`（警告ログ） | `eventFilter` 参照を `filterChecks` に修正 |
| 修正（軽微） | `4284, 6111, 6490` | `KC.EventFilter.apply()` の呼び出しコード自体は変更不要（シグネチャ維持のため） |

### 10.2 `plugin/src/css/desktop.css`

| 種別 | 内容 |
|---|---|
| 追加 | `.kc-filter-panel-menu` / `.kc-filter-group` / `.kc-filter-group-title` / `.kc-filter-item` 等（§5.5） |
| 確認 | 既存 `.kc-dropdown` / `.kc-dropdown-btn` はそのまま流用（変更不要） |

### 10.3 `plugin/src/js/config.js`

| 種別 | 対象 | 内容 |
|---|---|---|
| 追加 | `FILTER_TARGET_FIELD_TYPES` 定数（`88-113`付近に追加） | `['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'STATUS', 'USER_SELECT']` |
| 追加 | `currentConfig.filterConfig`（`150-163`付近） | 初期値 `{ groups: [{ id: 'assignee', label: '担当', type: 'assignee', items: [...] }] }` |
| 追加 | `buildFilterGroupRow` / `buildFilterGroupTypeSelect` / `buildFilterTargetFieldSelect` / `buildFilterItemRow` | 新設（§6.4） |
| 追加 | `collectFilterConfig()` / `applyFilterConfig(filterConfig)` | 新設（§6.4） |
| 追加 | マイグレーション処理（`2120, 2170, 2269, 2900`付近の既存パターンに追記） | v10→v11、`filterConfig` 補完（§6.5） |
| 変更 | `currentConfig.version`（`151`） | `10 → 11` |
| 変更 | 保存処理（`setConfig` 呼び出し箇所） | `filterConfig` を含めて送信 |

### 10.4 `plugin/src/html/config.html`

| 種別 | 内容 |
|---|---|
| 追加 | 「フィルタ設定」セクション（`#kc-filter-config-section`）。§6.1 の HTML 構造 |

### 10.5 `plugin/src/css/config.css`

| 種別 | 内容 |
|---|---|
| 追加 | フィルタ設定セクション用のグループ行・項目行スタイル（既存 `.kc-permission-row` / `.kc-fieldvalue-row` 系スタイルの流用・拡張） |

---

## 11. 非機能要件

- **NF-1**: ヘッダー幅は現状から増加しない（新規ボタン追加なし、既存 `#kc-filter` 枠を置換）
- **NF-2**: フィルタ変更は API 再取得を発生させない（クライアント側フィルタのみ、既存方針の継続）
- **NF-3**: 選択肢が多い場合（10件超）でもパネルがレイアウト崩れしない（`max-height` + `overflow-y: auto`）
- **NF-4**: 旧バージョンのプラグイン設定・localStorage・URL を読み込んでもエラーにならず、可能な範囲で既存動作と同等の初期状態に復元する（§7.3, §9.3）
- **NF-5**: アクセシビリティ: チェックボックスパネルに `role="group"` 相当のグルーピング、各グループ見出しと項目の関連付け（`aria-labelledby` 等）

---

## 12. 受入基準

### AC-1: ヘッダー幅が増加しない

- **Given**: 現状のヘッダー（検索欄・フィルタ・ビュー切替・全画面・設定ボタン）が表示されている状態で
- **When**: チェックボックス式フィルタを導入したとき
- **Then**: ヘッダーの要素数は変わらない（`#kc-filter` ボタン1個のまま）

### AC-2: グループ内 OR / グループ間 AND

- **Given**: 「担当」グループで「自分の予定」のみチェック、「ステータス」グループで「予約済」「貸出中」をチェックしている状態で
- **When**: カレンダーを表示したとき
- **Then**: 自分の予定 かつ （予約済 または 貸出中）の予定のみが表示される

### AC-3: 全解除＝そのグループでは絞り込まない

- **Given**: 「ステータス」グループの全チェックを外し、「担当」グループは「自分の予定」のみチェックしている状態で
- **When**: カレンダーを表示したとき
- **Then**: ステータスに関わらず、自分の予定がすべて表示される（ステータスグループは絞り込み条件から除外される）

### AC-4: 全グループ未選択＝全件表示

- **Given**: 全グループの全項目チェックを外した状態で
- **When**: カレンダーを表示したとき
- **Then**: 全件表示される（フィルタなし相当）

### AC-5: 即時反映

- **Given**: フィルタパネルが開いている状態で
- **When**: チェックボックスを1つクリックしたとき
- **Then**: 「適用」ボタン等を押すことなく、即座にカレンダーの表示が更新される
- **And**: kintone REST API への追加リクエストは発生しない

### AC-6: 設定画面での項目追加が反映される

- **Given**: 管理者が設定画面で「ステータス」グループに新しい選択肢（例: 「延長中」）を追加して保存したとき
- **When**: カレンダーでフィルタボタンを開いたとき
- **Then**: 「延長中」のチェックボックスが一覧に表示される

### AC-7: 汎用グループの追加

- **Given**: 管理者が設定画面で新しいグループ（対象フィールド: 任意の DROP_DOWN フィールド）を追加して保存したとき
- **When**: カレンダーでフィルタボタンを開いたとき
- **Then**: 新しいグループが標準グループ（担当）と並んで表示される

### AC-8: 既存ドロップダウンの廃止確認

- **Given**: 本改修適用後のカレンダー画面で
- **When**: ヘッダーを確認したとき
- **Then**: 「すべて/自分のみ/他人のみ」の単一選択ドロップダウンは存在せず、チェックボックスパネル方式のフィルタボタンのみが表示される

### AC-9: localStorage 永続化

- **Given**: フィルタでいくつかのチェックを変更した状態で
- **When**: ページをリロードしたとき
- **Then**: チェック状態が復元される（URL にフィルタパラメータがない場合は localStorage の値が使われる）

### AC-10: URL 同期・共有

- **Given**: 「担当」グループを「自分の予定」のみ、「ステータス」グループを「予約済,貸出中」にチェックしている状態で
- **When**: URL を確認したとき
- **Then**: `#kc:...&fassignee=mine&fstatus=item-1,item-2` のようなパラメータが含まれている
- **And**: この URL を別タブで開くと同じチェック状態が復元される

### AC-11: 旧バージョン config の後方互換

- **Given**: `filterConfig` キーを持たない旧バージョンの config（version 10 以前）が保存されている状態で
- **When**: プラグインを起動したとき
- **Then**: エラーにならず、「担当」グループ（自分/他人の2択、初期状態は両方チェック済み＝全件表示）が自動生成されて表示される

### AC-12: 旧 localStorage/URL フィルタ値の変換

- **Given**: 旧 `localStorage`（`kc-event-filter=mine`）が存在し、新キー（`kc-filter-checks`）が存在しない状態で
- **When**: プラグインを起動したとき
- **Then**: 「担当」グループが `mine`（自分の予定のみ）の状態で復元される

### AC-13: 変換不能ケースのフォールバック

- **Given**: 旧 `kc-event-filter=mine` が存在するが、管理者が「担当」グループを設定から削除している状態で
- **When**: プラグインを起動したとき
- **Then**: エラーにならず、全件表示（フィルタなし）の状態で起動する

---

## 13. 検証項目・実機検証手順

> MEMORY.md 記載のとおり、plugin 版の検証は **plugin.zip の実機手動アップロードが必須**。ローカル dev（`plugin/dev/index.html` のモック環境）で UI 構造・基本ロジックの一次検証は可能だが、kintone REST API・プロセス管理ステータス取得・実際のプラグイン設定保存は実機でのみ確認できる。

### 13.1 基本動作（一次検証: dev モックまたは実機）

1. カレンダーを開き、ヘッダーにフィルタボタンが1つだけ表示されることを確認（AC-1, AC-8）
2. フィルタボタンをクリックし、パネルが開くことを確認。「担当」グループが表示され「自分の予定」「他人の予定」が初期状態でチェック済みであることを確認
3. 「他人の予定」のチェックを外す → 即座にカレンダーから他人の予定が消えることを確認（AC-5）
4. パネルの外側をクリックしてパネルが閉じることを確認。チェック状態が保持されていることを再度開いて確認

### 13.2 グループ組合せロジック（実機推奨: 権限ルール設定済みアプリで）

1. 「担当」を自分のみ、「ステータス」を「予約済」「貸出中」のみチェック → AND/OR の組合せ結果を目視確認（AC-2）
2. 「ステータス」グループの全チェックを外す → ステータスに関わらず担当条件のみで絞り込まれることを確認（AC-3）
3. 全グループ全チェックを外す → 全件表示に戻ることを確認（AC-4）

### 13.3 設定画面（実機必須: kintone プラグイン設定画面）

1. プラグイン設定画面を開き、「フィルタ設定」セクションが表示されることを確認
2. 「担当」グループが削除不可であることを確認（削除ボタンが無効化 or 非表示）
3. 新規グループを追加し、対象フィールドに DROP_DOWN フィールドを選択 → 選択肢一覧が表示されることを確認
4. STATUS（プロセス管理）を対象にした場合、プロセス管理が有効なアプリでのみステータス一覧が表示されることを確認（`statusEnabled` ガード、AC-6, AC-7）
5. 保存 → 「保存して更新」でカレンダー側に反映されることを確認
6. 保存後の config を `getConfig` で確認し、`version: 11` かつ `filterConfig` が正しい構造で保存されていることを確認

### 13.4 後方互換（実機必須）

1. 本改修前の plugin.zip（version 10 以前）で保存されたテストアプリを用意する
2. 本改修後の plugin.zip をデプロイし、設定画面を開く → エラーが出ないこと、フィルタ設定セクションに「担当」グループが自動表示されることを確認（AC-11）
3. カレンダー画面を開く → フィルタパネルに「担当」グループのみ表示され、全件表示されることを確認
4. 改修前バージョンで `kc-event-filter=mine` を localStorage にセットした状態のブラウザ（同一 kintone 環境）で改修後バージョンを開く → 「自分の予定」のみチェックされた状態で起動することを確認（AC-12）
5. 「担当」グループを設定から削除した状態で上記 4 を再実行 → エラーにならず全件表示になることを確認（AC-13）

### 13.5 URL 共有（実機推奨）

1. フィルタを操作し、URL ハッシュに `f<groupId>=` パラメータが追加されることを DevTools で確認
2. URL をコピーして別タブ（同一ログインセッション）で開き、同じチェック状態が再現されることを確認（AC-10）
3. 全項目チェック済みのグループはパラメータが省略されている（URL が不要に長くならない）ことを確認

### 13.6 パフォーマンス・レイアウト

1. ステータス選択肢を10件以上登録した状態でパネルを開き、スクロール表示になることを確認（レイアウト崩れがないこと）
2. 狭幅ウィンドウでヘッダーの表示崩れがないことを確認

---

## 14. 想定 UX / シーケンス

### 14.1 フィルタ操作の基本フロー

```
ユーザー: ヘッダーの「フィルタ」ボタンをクリック
→ チェックボックスパネルが開く（「担当」「ステータス」等グループごとに表示）
→ 「ステータス」グループで「予約済」のみチェック、他は解除
→ 即座にカレンダーが再描画され、予約済の予定のみ表示される（API 再取得なし）
→ パネル外をクリック → パネルが閉じる（チェック状態は保持）
→ ページリロード → localStorage（および URL）からチェック状態が復元される
```

### 14.2 管理者の設定フロー

```
管理者: プラグイン設定画面を開く
→ 「フィルタ設定」セクションで「グループを追加」→ 種別「フィールド値」を選択
→ 対象フィールドで「ステータス（プロセス管理 $status）」を選ぶ
→ 「項目を追加」→ 候補一覧から「予約済」を選び、チェック項目として追加（ラベルは自動的に「予約済」）
→ 同様に「貸出中」「返却済」を追加。「返却済」は defaultChecked を OFF にする
→ 保存して更新 → カレンダー側のフィルタボタンにグループ「ステータス」が反映される
```

### 14.3 旧バージョンからのアップグレードフロー

```
既存ユーザー: 旧バージョン（フィルタ = すべて/自分のみ/他人のみ）を利用中、localStorage に kc-event-filter=mine が保存されている
→ 管理者がプラグインを本改修版にアップデート（plugin.zip 差し替え）
→ 設定画面を開く → 「フィルタ設定」に「担当」グループが自動生成されて表示される（違和感のない初期状態）
→ ユーザーがカレンダーを開く → 旧 localStorage の mine が新形式（担当グループ=自分の予定のみ）に自動変換され、
   従来と同じ絞り込み結果が得られる
```

---

## 15. 未解決事項・リスク・前提

### 15.1 残存未確定事項

| ID | 内容 | 対応方針 |
|---|---|---|
| Q-9 | `REQ_edit-permission-extension.md` の原文が未確認。本書は `permissionRules`/`fieldValueRules` の仕様を `desktop.js`/`config.js` の実装コードから逆引きしたのみ | **実装着手時に builder が当該文書を読み合わせ、用語・優先順位の記述に齟齬がないか確認すること**。齟齬が見つかった場合は本書を修正する |

### 15.2 リスクと対策

| リスク | 対策 |
|---|---|
| `KC.EventFilter.apply` 置換に伴う呼び出し箇所の漏れ（`desktop.js:4284, 6111, 6115, 6490` 等） | §8.4, §10.1 の一覧に基づき全箇所を機械的に確認する。特に `6115` の警告ログは文言修正を忘れやすいため注意 |
| グループ ID（`f<groupId>` の URL パラメータキー）に日本語・記号が使われた場合のエンコード事故 | 設定画面でグループ `id` は自動採番（`group-1`, `group-2`, ...）または半角英数字のみ許可するバリデーションを設定画面 UI に追加する（`label` は自由入力・日本語可、`id` は内部キーとして分離する） |
| USER_SELECT を対象フィールドにした場合の値入力ミス（コードの手入力、FR-9） | 設定画面で入力後にプレビュー表示、または既存 `KC.Api` 相当でユーザー検索補助を将来検討（本改修のスコープ外、初版は手動入力のみ） |
| `_matchFieldValue` のロジック重複（`KC.LoginContext` と `KC.EventFilter` の二重実装） | §8.1 のとおり共有関数化を推奨。必須ではないため、実装工数次第で見送り可（重複自体は動作に影響しない） |
| 旧バージョンとの並行運用期間中、localStorage 新旧キーが両方残ることによる混乱 | 旧キー（`kc-event-filter`）は削除せず放置する方針（§9.3）。実害はないため許容 |
| プロセス管理ステータスの選択肢が STATUS 名変更・削除された場合、保存済み `filterConfig` の項目が無効値化する | 既存の `buildPermissionFieldSelect` の「フィールドが見つかりません」警告パターン（`config.js:1222-1231`）と同様の UI（無効値の警告表示）を `fieldValue` グループの対象フィールド・値選択にも適用する |

### 15.3 前提

- 実装対象は `plugin/` 配下のみ。`src/kc-calendar.js`（未使用・旧版）は対象外
- 検証は実機（plugin.zip 手動アップロード）が必須（MEMORY.md 運用ルールに従う）
- 本改修は「置換」であり、既存の `KC.FilterDropdown` を残したまま並行稼働させるモードは提供しない（Q-4 確定事項）

---

*本書は確定版である。§15.1 Q-9（実装時の原文確認）以外の設計判断は完了しており、builder はそのまま実装に着手できる。*
