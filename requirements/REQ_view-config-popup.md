# 要件定義書: ビュー個別設定 UI 改修（横並びレイアウト＋コピーポップアップ化＋サブセクション分割）

**文書番号**: REQ_view-config-popup
**作成日**: 2026-05-18
**最終更新日**: 2026-05-18（v2.0）
**作成者**: designer (サブエージェント)
**対象ファイル**:
- `plugin/src/html/config.html`（HTML 構造変更）
- `plugin/src/js/config.js`（JS ロジック追加・変更）
- `plugin/src/css/config.css`（スタイル追加）
**ステータス**: 確定版（未解決事項 0 件）

---

## 目次

1. [概要・背景](#1-概要背景)
2. [現状](#2-現状)
3. [機能要件](#3-機能要件)
4. [データ構造への影響](#4-データ構造への影響)
5. [既存機能との互換性](#5-既存機能との互換性)
6. [設計上の判断ポイント](#6-設計上の判断ポイント)
7. [受入基準](#7-受入基準)
8. [検証項目・テストシナリオ](#8-検証項目テストシナリオ)
9. [未確定事項・リスク・前提](#9-未確定事項リスク前提)

---

## 1. 概要・背景

### 1.1 背景

Phase 9（commit `35f3c47`）で「ビュー個別設定」セクションを実装した。このとき「対象ビュー選択」と「他ビューからコピー」は縦並びに配置され、コピー機能はセレクトボックス + 実行ボタンをセクション内に常時表示する設計だった。

v1 改修（commit 実装後）でコピー機能をモーダル化し、ビュー選択とコピーボタンを横並びにした。しかし「ビュー個別設定」セクション内には依然として「**どのビューの設定を行うか**（制御）」と「**指定したビューの個別設定**（編集対象）」が混在したフラット構造になっており、ユーザーの視線が設定対象を認識しにくい。

### 1.2 目的

v2 で達成する目的は 1 点。

1. **「ビュー個別設定」セクションを 2 サブセクションに分割し、制御エリアと編集エリアを視覚的に明確に分離する**

v1 の横並びレイアウト・コピーモーダル仕様はそのまま引き継ぐ。

---

## 2. 現状

### 2.1 HTML 構造（config.html 行 172–257）

現状の `#kc-per-view-section` 内の要素は以下のようにフラットに並んでいる。

| 要素 | セレクタ / ID | 役割 |
|---|---|---|
| セクションルート | `#kc-per-view-section` | ビュー個別設定全体 |
| ビュー選択行 | `.kc-view-control-row` | ビュー選択プルダウン + コピーボタン横並び行 |
| ビュー選択 | `#kc-per-view-select` | 対象ビューのドロップダウン |
| コピーボタン | `#kc-copy-open-modal` | コピーモーダルを開くボタン |
| 新規ビュー名フィールド | `#kc-new-view-name-field` | 新規作成モード時のみ表示 |
| 個別設定フォームエリア | `#kc-per-view-fields` | カレンダータイトル・初期ビューラジオボタン |

制御エリア（`.kc-view-control-row` + `#kc-new-view-name-field`）と編集エリア（`#kc-per-view-fields`）に論理的な区切りはなく、視覚的な分離もない。

### 2.2 JS（config.js）

| 関数 | 行番号 | 概要 |
|---|---|---|
| `handleViewSelectChange` | 行 970–985 | 対象ビュー変更時に `currentViewId` を更新して `applyViewConfig` を呼ぶ |
| `handleCopyFromView` | 行 992–1022 | コピー元の選択値を読み、フォームに転記。コピー結果メッセージを表示 |
| `rebuildCopySourceSelect` | 行 640–668 | コピー元セレクトを再構築。`excludeViewId` で現在ビューを除外 |
| `loadViews` | 行 836–843 | kintone API からビュー一覧を取得 |

### 2.3 CSS

| クラス名 | 役割 |
|---|---|
| `.kc-view-control-row` | ビュー選択行の wrapper（margin-bottom: 18px） |
| `.kc-view-control-row__inputs` | select + ボタン横並び flex 行 |
| `.kc-view-control-row__select` | ビュー選択 select（flex: 1） |
| `.kc-config-subsection-title` | 小見出しスタイル（既存: §1 編集権限設定 内で使用） |
| `.kc-per-view-fields` | 個別設定フォームエリア（margin-top: 8px） |

`kc-view-control-panel` および `kc-view-edit-panel` は未定義。

---

## 3. 機能要件

### 3.1 レイアウト（横並び配置）

v1 要件をそのまま引き継ぐ。

#### 3.1.1 ビュー選択行の変更

`#kc-per-view-select` の右側に `#kc-copy-open-modal` を配置し、flex 横並び。

- ラベル「設定を編集するビュー」はセレクトとボタンの共通ラベルとして上部に表示する
- `#kc-per-view-label`（span）はセレクトの下 or 右に残す（選択中ビュー名の aria-live 表示を維持）

#### 3.1.2 レイアウト確定値

| 項目 | 値 |
|---|---|
| ビュー選択行の配置 | flex、`align-items: center`、`gap: 8px` |
| `#kc-per-view-select` の幅 | `flex: 1`（残余幅を使用） |
| `#kc-copy-open-modal` の幅 | `auto`（ボタン幅に合わせる、収縮させない） |

### 3.2 コピーポップアップ（モーダル仕様）

v1 要件をそのまま引き継ぐ。詳細は v1 §3.2 を参照。主要点のみ再掲。

#### 3.2.1 ポップアップ構成

```
[オーバーレイ .kc-modal-overlay]
  └─ [モーダル本体 .kc-modal-content]
        ├─ [ヘッダー .kc-modal-header]
        │    ├─ <h3>他のビューからコピー</h3>
        │    └─ [閉じるボタン .kc-modal-close] (×)
        ├─ [ボディ .kc-modal-body]
        │    ├─ <label>コピー元ビュー</label>
        │    └─ <select id="kc-copy-source">
        ├─ [フッター .kc-modal-footer]
        │    ├─ <button id="kc-copy-execute">コピー実行</button>
        │    └─ <button id="kc-copy-modal-cancel">キャンセル</button>
        └─ [メッセージ .kc-modal-msg aria-live="polite"]
```

#### 3.2.2 開閉条件

| 操作 | 結果 |
|---|---|
| `#kc-copy-open-modal` クリック | ポップアップを開く |
| `#kc-copy-modal-cancel` クリック | ポップアップを閉じる（コピー処理なし） |
| `.kc-modal-close`（×）クリック | ポップアップを閉じる（コピー処理なし） |
| `.kc-modal-overlay` クリック | ポップアップを閉じる（背景クリック） |
| ESC キー押下 | ポップアップを閉じる |
| コピー実行成功 | ポップアップを閉じる → 設定画面側の成功メッセージを表示 |
| コピー実行失敗（未選択） | ポップアップ内の `.kc-modal-msg` にエラーを表示し、ポップアップは閉じない |

### 3.3 フォーカス・キーボード操作

v1 要件をそのまま引き継ぐ。

| 動作 | 仕様 |
|---|---|
| ポップアップを開いたとき | `.kc-modal-content` 内の最初のフォーカス可能要素（`#kc-copy-source`）にフォーカスを移す |
| ESC キー | ポップアップを閉じ、`#kc-copy-open-modal` にフォーカスを戻す |
| キャンセル / × クリック | ポップアップを閉じ、`#kc-copy-open-modal` にフォーカスを戻す |
| コピー実行後 | ポップアップを閉じ、`#kc-per-view-select` にフォーカスを戻す |

フォーカストラップ（Tab キーでモーダル内を循環）は Phase 2 送り（スコープ外）。

### 3.4 セクション構造の視覚的分離（v2 新規）

「ビュー個別設定」セクション（`#kc-per-view-section`）を以下 2 サブセクションに分割する。

#### サブセクション構造

```
セクション: ビュー個別設定
├ サブセクション①「対象ビューの選択」（制御）
│  ├ 設定を編集するビュー [プルダウン] [ほかビューからコピー]
│  └ 新規ビュー名（新規作成モード時のみ表示）
│
└ サブセクション②「選択中ビューの設定」（編集対象）
   ├ カレンダータイトル
   ├ 初期ビュー（ラジオボタン）
   └ （将来追加されるビュー固有設定を含む）
```

#### サブセクションタイトル（確定）

| # | タイトル | 理由 |
|---|---|---|
| サブセクション① | **対象ビューの選択** | 「何をするか（選ぶ）」を動詞 + 目的語で端的に表現。「設定対象の選択」より主語が明確。Office 系設定画面の慣習（「対象の選択 → 内容の編集」）に合わせる |
| サブセクション② | **選択中ビューの設定** | 「①で選んだビューに紐づく設定項目がここにある」という文脈を自然に伝える。「ビュー固有設定」より現在状態（選択中）が明示されている |

#### HTML 構造（確定）

```html
<section class="kc-config-section" id="kc-per-view-section">
  <h2 class="kc-config-section-title">ビュー個別設定</h2>
  <p class="kc-config-section-desc">
    カレンダービューの作成・更新と、ビューごとの表示設定を行います。
  </p>

  <!-- サブセクション①: 制御 -->
  <div class="kc-view-control-panel">
    <h3 class="kc-config-subsection-title">対象ビューの選択</h3>

    <!-- ビュー選択 + コピーボタン 横並び行 -->
    <div class="kc-view-control-row">
      <div class="kc-view-control-row__select-wrap">
        <label class="kc-config-label" for="kc-per-view-select">設定を編集するビュー</label>
        <div class="kc-view-control-row__inputs">
          <select id="kc-per-view-select" class="kc-config-select kc-view-control-row__select">
            <option value="__new__">-- 新規作成 --</option>
          </select>
          <button type="button" id="kc-copy-open-modal" class="kc-config-btn kc-config-btn-secondary">
            ほかビューからコピー
          </button>
        </div>
      </div>
    </div>

    <!-- 新規ビュー名入力 (新規選択時のみ表示) -->
    <div class="kc-config-field" id="kc-new-view-name-field" style="display: none;">
      <label class="kc-config-label" for="kc-new-view-name">新規ビュー名</label>
      <input id="kc-new-view-name" type="text" class="kc-config-input" />
    </div>
  </div>

  <!-- サブセクション②: 編集対象 -->
  <div class="kc-view-edit-panel">
    <h3 class="kc-config-subsection-title">選択中ビューの設定</h3>

    <!-- ビュー個別設定フォーム -->
    <div id="kc-per-view-fields" class="kc-per-view-fields">
      <!-- カレンダータイトル・初期ビュー等（既存フォーム要素をそのまま移動） -->
    </div>
  </div>
</section>
```

#### CSS スタイル（確定）

```css
/* サブセクション①: 背景色付きパネル */
.kc-view-control-panel {
  background: #f0f4f8;
  border: 1px solid #d1d9e0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

/* パネル内の小見出しは上余白をリセット */
.kc-view-control-panel .kc-config-subsection-title {
  margin-top: 0;
}

/* サブセクション②: 通常フォーム（追加スタイルなし） */
/* .kc-view-edit-panel は特別なスタイル不要。既存 .kc-per-view-fields が管理 */
```

`kc-view-control-row` の `margin-bottom: 18px` は `.kc-view-control-panel` 内で padding が確保されるため、パネル内では `margin-bottom: 0` に上書きすること。

#### 設計選択根拠（案 A 採用）

| 案 | 内容 | 採否 |
|---|---|---|
| A | サブセクション①を背景色 + border + padding で囲む。②は通常フォーム | **採用** |
| B | 両方に h4 + 区切り線のみ | 不採用（視覚的インパクト不足） |
| C | ①をコーナー配置の操作パネル風に | 不採用（レスポンシブ難・UX 慣れ必要） |

---

## 4. データ構造への影響

**変更なし。**

コピー機能は `currentConfig.views[srcViewId]` の読み取りと現在フォームへの転記のみ。サブセクション分割は HTML/CSS の構造変更のみで、保存データの構造（`views` オブジェクト）に影響しない。

---

## 5. 既存機能との互換性

### 5.1 `handleCopyFromView` の流用ポイント

既存の `handleCopyFromView`（行 992–1022）はそのまま流用する。

- コピー元値の読み取り元（`elCopySource.value`）はモーダル内の `#kc-copy-source-modal` を参照。変数の参照先は変更なし
- 転記対象（`elCalendarTitle`・`defaultView` ラジオ）は変更なし

### 5.2 成功メッセージ表示先の整合

| 状況 | 表示先 | 内容 |
|---|---|---|
| コピー元未選択（エラー） | モーダル内 `.kc-modal-msg` | 「コピー元のビューを選択してください。」|
| コピー成功 | 設定画面の `.kc-config-error` 要素（兼用） | 「「○○」からコピーしました。保存してください。」|

### 5.3 `rebuildCopySourceSelect` の呼出タイミング

モーダルを開く直前に `rebuildCopySourceSelect(currentViewId)` を呼び出す。これにより、ポップアップを開いた時点での最新ビュー一覧（現在ビューを除外）を確実に反映する。

### 5.4 サブセクション分割による DOM 移動の影響

`.kc-view-control-row`・`#kc-new-view-name-field` は `.kc-view-control-panel` 内に移動する。
`#kc-per-view-fields` は `.kc-view-edit-panel` 内に移動する。

いずれも ID / クラス名はそのまま維持するため、JS 側の `getElementById` / `querySelector` 参照は変更不要。

---

## 6. 設計上の判断ポイント

### 6.1 モーダルの実装方式

| 方式 | 採用判断 | 理由 |
|---|---|---|
| HTML `<dialog>` 要素 | 不採用 | kintone プラグイン設定画面での `showModal()` 動作に実機確認が必要。`::backdrop` のカスタマイズも難しい |
| **`<div class="kc-modal-overlay">` + `<div class="kc-modal-content">`** | **採用** | 既存 CSS パターンと一貫性を保てる。kintone 環境での動作実績を積みやすい |

### 6.2 背景クリック・ESC キー対応

| 機能 | 実装方式 |
|---|---|
| 背景クリックで閉じる | `kc-modal-overlay` の click ハンドラで閉じる。`kc-modal-content` の click は `stopPropagation` で遮断する |
| ESC キーで閉じる | `document` の `keydown` ハンドラで `event.key === 'Escape'` を検知。ポップアップ表示時に登録し、閉じ時に解除（`removeEventListener`） |

### 6.3 モーダル DOM の配置場所

`.kc-modal-overlay` は `config.html` の `</body>` 直前に静的記述し、`hidden` 属性で初期非表示。JS での動的生成は避ける。

### 6.4 CSS クラスの命名（全体）

| 要素 | クラス名 |
|---|---|
| オーバーレイ背景 | `.kc-modal-overlay` |
| モーダル本体 | `.kc-modal-content` |
| ヘッダー | `.kc-modal-header` |
| 閉じるボタン | `.kc-modal-close` |
| ボディ | `.kc-modal-body` |
| フッター | `.kc-modal-footer` |
| ポップアップ内メッセージ | `.kc-modal-msg` |
| 表示状態（JS 制御） | `.kc-modal-overlay--active`（`display: flex` を付与） |
| **制御サブセクション** | **`.kc-view-control-panel`**（v2 新規） |
| **編集サブセクション** | **`.kc-view-edit-panel`**（v2 新規） |

### 6.5 サブセクション分割の実装ポイント（v2 新規）

- 追加が必要な CSS クラス: `.kc-view-control-panel`、`.kc-view-edit-panel`
- `.kc-view-control-panel .kc-config-subsection-title` の `margin-top: 0` でパネル内の上余白をリセット
- `.kc-view-control-panel` 内の `.kc-view-control-row` は `margin-bottom: 0` に上書きする（パネルの `padding` が余白を代替するため）
- 既存の `kc-view-control-row` および `kc-view-control-row__*` クラスの grid / flex レイアウトは変更しない
- `#kc-new-view-name-field` の表示制御（`display: none` / `display: block`）は JS 管理のまま維持
- `h3.kc-config-subsection-title` は既存 CSS で定義済みのため、スタイル追加は不要。`margin-top: 0` の上書きのみ追加する

---

## 7. 受入基準

### AC7.1 ビュー選択とコピーボタンが横並びになっている

- **Given**: プラグイン設定画面を開く
- **When**: 「ビュー個別設定」セクションを確認する
- **Then**: `#kc-per-view-select` と `#kc-copy-open-modal` が同一行に横並びで表示される

### AC7.2 コピーボタンクリックでポップアップが開く

- **Given**: 既存ビューが 2 件以上存在し、いずれかを「対象ビュー」に選択している
- **When**: `#kc-copy-open-modal` をクリックする
- **Then**: `.kc-modal-overlay--active` が表示され、モーダルが画面中央に現れる
- **And**: `#kc-copy-source-modal` に現在の対象ビューが除外されたリストが表示される
- **And**: `#kc-copy-source-modal` にフォーカスが移る

### AC7.3 コピー元未選択でエラーメッセージがポップアップ内に表示される

- **Given**: ポップアップが開いている
- **When**: コピー元を選択せずに「コピー実行」をクリックする
- **Then**: `.kc-modal-msg` に「コピー元のビューを選択してください。」が表示される
- **And**: ポップアップは閉じない

### AC7.4 コピー実行成功後にポップアップが閉じ、成功メッセージが表示される

- **Given**: ポップアップが開き、コピー元ビューを選択している
- **When**: 「コピー実行」をクリックする
- **Then**: フォームのカレンダータイトルと初期ビューがコピー元の値に更新される
- **And**: ポップアップが閉じる（`.kc-modal-overlay--active` が除去される）
- **And**: 設定画面の `.kc-config-error` 要素に成功メッセージが表示される
- **And**: `#kc-per-view-select` にフォーカスが戻る

### AC7.5 背景クリックでポップアップが閉じる

- **Given**: ポップアップが開いている
- **When**: `.kc-modal-overlay`（モーダル外の背景部分）をクリックする
- **Then**: ポップアップが閉じる
- **And**: コピー処理は実行されない

### AC7.6 ESC キーでポップアップが閉じる

- **Given**: ポップアップが開いている
- **When**: ESC キーを押す
- **Then**: ポップアップが閉じる
- **And**: `#kc-copy-open-modal` にフォーカスが戻る

### AC7.7 キャンセルボタンでポップアップが閉じる

- **Given**: ポップアップが開いている
- **When**: 「キャンセル」ボタンをクリックする
- **Then**: ポップアップが閉じる
- **And**: `#kc-copy-open-modal` にフォーカスが戻る

### AC7.8 新規ビュー作成モードでもコピーボタンが機能する

- **Given**: 「対象ビュー」ドロップダウンで「-- 新規作成 --」を選択している
- **When**: `#kc-copy-open-modal` をクリックする
- **Then**: `#kc-copy-source-modal` に全ての既存ビューがリストアップされる（現在ビュー除外なし）

### AC7.9 既存のビュー選択・設定フォーム動作に影響がない

- **Given**: サブセクション分割の改修後
- **When**: ビュー選択ドロップダウンで各ビューを切り替える
- **Then**: 各ビューの設定（カレンダータイトル・初期ビュー）が正しくフォームに反映される
- **And**: コピー機能を使わない通常の編集フローで設定保存が正常に動作する

### AC7.10 サブセクション①が背景色付きパネルで視覚的に分離されている（v2 新規）

- **Given**: プラグイン設定画面を開く
- **When**: 「ビュー個別設定」セクションを確認する
- **Then**: `.kc-view-control-panel` が背景色（`#f0f4f8`）・ボーダー・角丸を持つパネルとして表示される
- **And**: 見出し「対象ビューの選択」がパネル内の最上部に表示される
- **And**: サブセクション②「選択中ビューの設定」はパネル外の通常フォームとして表示される

### AC7.11 各サブセクションに小見出しが表示されている（v2 新規）

- **Given**: プラグイン設定画面を開く
- **When**: 「ビュー個別設定」セクションを確認する
- **Then**: `h3.kc-config-subsection-title` として「対象ビューの選択」が `.kc-view-control-panel` 内に表示される
- **And**: `h3.kc-config-subsection-title` として「選択中ビューの設定」が `.kc-view-edit-panel` 内に表示される

---

## 8. 検証項目・テストシナリオ

### 8.1 正常系シナリオ

| # | シナリオ | 確認観点 |
|---|---|---|
| S01 | ビュー A を対象に選択 → コピーボタン押下 → ビュー B を選択 → 実行 | ビュー B の calendarTitle と defaultView がフォームに反映される。成功メッセージ表示。ポップアップ閉じる |
| S02 | 新規作成モードでコピーボタン押下 → 全ビューが選択肢に出る | excludeViewId = null のため全件表示 |
| S03 | コピー後、別ビューに切り替えて再度コピーを開く | コピー元リストが現在ビューを除外した最新リストになっている |
| S04 | ポップアップを開く → ESC キー → 再度開く → 正常動作する | ESC 後の再開でリストが正しく表示される |

### 8.2 異常系・境界値

| # | シナリオ | 確認観点 |
|---|---|---|
| E01 | ビューが 1 件のみ存在する状態でコピーボタン押下 | コピー元リストが空（プレースホルダーのみ）になる。実行しても未選択エラー |
| E02 | コピー元ビューに calendarTitle が空の設定 → コピー実行 | フォームのタイトルが空になり、エラーは発生しない |
| E03 | ポップアップ内でコピー元を選択後キャンセル → フォームは変更されていない | キャンセル時はフォームへの転記が行われないこと |
| E04 | 背景クリックで閉じた後、フォームは変更されていない | 背景クリック = キャンセルと同等 |

### 8.3 レイアウト確認

| # | 確認観点 |
|---|---|
| L01 | 設定画面のウィンドウ幅を縮小したとき、`#kc-per-view-select` が収縮しボタンが見切れない |
| L02 | ポップアップが画面中央に表示される（kintone 設定画面スクロール状態でも） |
| L03 | `.kc-view-control-panel` が背景色・ボーダー・角丸を持つパネルとして表示される |
| L04 | `h3.kc-config-subsection-title`「対象ビューの選択」がパネル内の最上部に余白なく表示される |
| L05 | サブセクション②「選択中ビューの設定」はパネル外の通常フォームとして表示され、スタイルが混在しない |

---

## 9. 未確定事項・リスク・前提

### 9.1 前提条件

- v1 改修（コピーモーダル化・横並びレイアウト）の実装がベースラインである
- `plugin/src/css/config.css` に `.kc-view-control-panel`・`.kc-view-edit-panel` 用スタイルを追記する権限がある
- kintone プラグイン設定画面の `config.html` は iframe 内で動作するため、`position: fixed` は iframe 内を基準とする（通常動作に影響なし）

### 9.2 リスク

| リスク | 対策 |
|---|---|
| `kc-view-control-row` の `margin-bottom: 18px` がパネル内で余白を過大にする | `.kc-view-control-panel .kc-view-control-row` セレクタで `margin-bottom: 0` に上書きする |
| `kc-config-subsection-title` がパネル内で既存スタイル（`margin-top: 24px`）のままだと上余白が目立つ | `.kc-view-control-panel .kc-config-subsection-title { margin-top: 0; }` を追加する |
| ESC キーの `keydown` ハンドラが複数回登録されてポップアップが 2 回閉じようとする | ポップアップを開く関数内で `addEventListener` 前に `removeEventListener` を呼ぶ、またはフラグ管理で二重登録を防ぐ |
| kintone 設定画面の z-index 競合でモーダルが隠れる | z-index を `1000` に設定。実機確認で調整が必要な場合は builder が報告する |

### 9.3 未確定事項

| Q | 内容 | ステータス |
|---|---|---|
| Q1 | コピーボタン ID | `#kc-copy-open-modal` に確定（既存実装から踏襲） |
| Q2 | コピー元セレクト ID | `#kc-copy-source-modal` に確定（既存実装から踏襲） |
| Q3 | モーダル実装方式 | `div` ベースのカスタムモーダルに確定 |
| Q4 | サブセクション分割 | 制御（背景色付きパネル）と編集（通常フォーム）の 2 分割に確定（2026-05-18） |

---

## バージョン履歴

**v1.0 (2026-05-18)**: 初版作成。横並びレイアウト + コピーポップアップ化。

**v1.1 (2026-05-18)**: §3.2.4 のキャンセルボタン ID 表記を実装側（#kc-copy-modal-cancel）に統一。

**v2.0 (2026-05-18)**: ビュー個別設定セクションを「対象ビューの選択（制御）」「選択中ビューの設定（編集）」の 2 サブセクションに分割。制御サブセクションを背景色付きパネル（.kc-view-control-panel）で視覚的に分離。AC7.10・AC7.11 追加。§3.4・§6.5 新規追加。

---

*本要件定義書: 章数 9、受入基準 11 件（AC7.1〜AC7.11）、未解決事項 0 件。v2.0 2026-05-18 更新。*
