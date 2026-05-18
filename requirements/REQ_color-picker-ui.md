# 要件定義書: 配色選択 UI の改善

**文書番号**: REQ_color-picker-ui
**作成日**: 2026-05-18
**最終更新日**: 2026-05-18
**作成者**: designer (サブエージェント)
**ステータス**: 初版・推奨案提示済み
**関連文書**: REQ_edit-permission-extension.md, plugin/src/js/config.js, plugin/src/html/config.html, plugin/src/css/config.css

---

## 1. 概要・背景

### 1.1 背景

KC Calendar プラグイン設定画面の「編集権限設定」セクションでは、各ルール行に `<input type="color">` （HTML5 ネイティブカラーピッカー）を配置している（`config.js:buildPermissionRow` / `config.css:kc-permission-color`）。

HTML5 ネイティブカラーピッカーには以下の制約がある。

- **OS / ブラウザ依存**: Windows / macOS / Chrome / Edge / Firefox で UI が大きく異なり、ユーザー体験が統一されない
- **プリセット選択なし**: カレンダー用途に最適化された色セットをあらかじめ提示できない
- **視認性が低い**: 選択結果が小さい矩形のみで表示されるため、複数ルール行を並べたときに色の識別が難しい

### 1.2 ユーザー要望（優先順位付き）

1. **（最優先）タイル状カラーパレットから選択できる**
2. （高度な機能・後追い可）スポイト（EyeDropper API）での画面上の色取得
3. （高度な機能・後追い可）RGB 数値入力での精密指定
4. （高度な機能・後追い可）色相・彩度グラデーション上でのドラッグ指定

### 1.3 目的

- カレンダーに適したプリセット色をタイルとして提示し、1 クリックで色を選択できるようにする
- 上記プリセットに加えて、高度な色指定手段（スポイト/RGB/ドラッグ）を段階的に追加できる設計とする
- プラグイン設定画面の UI 一貫性を維持する

---

## 2. 機能要件

### 2.1 プリセットパレット（最優先）

#### 2.1.1 タイル仕様

- タイル数: **20 色**（4 列 × 5 行 または 5 列 × 4 行で実装側が調整してよい）
- グリッドレイアウト: `display: grid; grid-template-columns: repeat(5, 1fr);` を基本とする
- タイルサイズ: 28px × 28px（ホバー時は 32px × 32px へ拡大、transition: 0.1s）
- タイル間隔: 4px（gap）
- タイル形状: 角丸 4px（border-radius）

#### 2.1.2 推奨プリセット色一覧

Google Calendar 系統 + Material Design + 補色系を組み合わせた 20 色。

| # | 名称 | HEX | 出典系統 |
|---|---|---|---|
| 1 | トマト | `#d50000` | Google Calendar |
| 2 | フラミンゴ | `#e67c73` | Google Calendar |
| 3 | タンジェリン | `#f4511e` | Google Calendar |
| 4 | バナナ | `#f6bf26` | Google Calendar |
| 5 | セージ | `#33b679` | Google Calendar |
| 6 | バジル | `#0b8043` | Google Calendar |
| 7 | ピーコック | `#039be5` | Google Calendar |
| 8 | ブルーベリー | `#3f51b5` | Google Calendar |
| 9 | ラベンダー | `#7986cb` | Google Calendar |
| 10 | グレープ | `#8e24aa` | Google Calendar |
| 11 | グラファイト | `#616161` | Google Calendar |
| 12 | ライトブルー | `#1976d2` | Material Design Blue 700（現デフォルト色） |
| 13 | シアン | `#0097a7` | Material Design Cyan 700 |
| 14 | ティール | `#00796b` | Material Design Teal 700 |
| 15 | ライム | `#8bc34a` | Material Design Light Green 500 |
| 16 | アンバー | `#ff8f00` | Material Design Amber 800 |
| 17 | ディープオレンジ | `#e64a19` | Material Design Deep Orange 700 |
| 18 | ブラウン | `#6d4c41` | Material Design Brown 600 |
| 19 | ブルーグレー | `#546e7a` | Material Design Blue Grey 600 |
| 20 | ピンク | `#e91e63` | Material Design Pink 500 |

#### 2.1.3 アクティブ表示

- 現在選択中のタイルに **チェックマーク（✓）** を白色で表示する
- または `border: 3px solid #333;` + `box-shadow: 0 0 0 2px #fff inset;` によるハイライト枠でもよい（実装者が視認性の高い方を選択）
- アクティブでないタイルは `border: 2px solid transparent;` を基本とし、ホバー時に `border-color: rgba(0,0,0,0.3);`

#### 2.1.4 パレットの表示方法

- 各ルール行の色セルをクリックするとパレットポップアップが開く（インライン展開 or フローティング）
- パレット外クリックで閉じる
- パレット開閉のトグルボタンは現在選択中の色を正方形プレビューとして表示する

### 2.2 高度な機能（フェーズ 2 以降・後追い対応可）

#### 2.2.1 スポイト（EyeDropper API）

- `window.EyeDropper` が利用可能な場合のみボタンを表示する
- ブラウザ互換性（2026-05 時点）:

| ブラウザ | 対応状況 |
|---|---|
| Chrome 95+ | 対応 |
| Edge 95+ | 対応 |
| Firefox | 未対応（Nightly で実装中） |
| Safari | 未対応 |

- 非対応ブラウザではボタン自体を非表示にする（エラーは表示しない）
- kintone は Chrome 推奨環境であるため、主要ユーザー環境では動作する見込み（実機未確認）

#### 2.2.2 RGB 数値入力

- R / G / B 各チャンネルを 0〜255 で入力できる `<input type="number">` を 3 つ並べる
- またはHEX文字列を直接入力する `<input type="text">` でも可
- 入力値のバリデーション: 0〜255 の整数であることを確認し、範囲外は端値にクランプ

#### 2.2.3 色相・彩度ドラッグ

- HSV / HSL カラーホイールまたは正方形グラデーション上でドラッグして色を指定する
- 実装コストが大きいため、Pickr などのライブラリ採用か独自実装かはフェーズ 2 設計時に決定する

### 2.3 適用範囲

- **プラグイン設定画面** (`plugin/src/html/config.html`) 内「編集権限設定」セクションの各ルール行（`.kc-permission-row`）の色カラムのみ
- カスタマイズ JS 版（`src/kc-calendar.js`）には本要件は適用しない
- `permissionRules[].color` のデータ形式（`#RRGGBB`）は変更しない

---

## 3. 実装方針の比較

| 項目 | 案 A（独自実装）| 案 B-1（Pickr CDN）| 案 B-2（Pickr バンドル）| 案 C（独自フル実装）|
|---|---|---|---|---|
| 実装工数 | 小 | 小〜中 | 中 | 大 |
| UI 統一性（OS 非依存） | プリセットのみ統一（カスタムは OS 依存） | 完全統一 | 完全統一 | 完全統一 |
| プリセットパレット対応 | ◎ ネイティブで実装 | ◎ `swatches` オプションで設定 | ◎ 同左 | ◎ 自力実装 |
| 外部依存 | なし | あり（CDN: jsDelivr） | あり（バンドル） | なし |
| プラグイン dist サイズへの影響 | 0 | 0 | +20〜30KB | +10〜20KB 程度 |
| カスタマイズ JS 配信への影響 | 0 | CDN 通信が追加発生 | N/A | コード追加 |
| メンテナンス | 簡単（自力管理） | ライブラリ更新追随が必要 | ライブラリ更新追随が必要 | 自力メンテ（高コスト）|
| ライセンス | 不要 | MIT | MIT | 不要 |
| kintone iframe 内動作 | OK（標準仕様） | 要確認（未検証）| 要確認（未検証）| OK（標準仕様）|
| CSP（Content Security Policy）影響 | 問題なし | CDN ドメインの allow が必要な場合あり | 問題なし | 問題なし |
| 高度機能（スポイト/RGB/ドラッグ） | OS 依存（ネイティブ任せ） | ◎ 全機能内包 | ◎ 全機能内包 | 自力実装が必要 |

### 3.1 案 A（独自実装: プリセットタイル + ネイティブ input[type=color] 連携）

カレンダー向けプリセット色（20 色）をタイルグリッドとして表示し、「カスタム」タイルクリックでネイティブ `<input type="color">` を開く。高度な機能（スポイト/RGB/ドラッグ）は OS のネイティブピッカーに委ねる。外部依存ゼロ、実装工数最小。

### 3.2 案 B-1（Pickr CDN ロード）

`@simonwep/pickr` を jsDelivr CDN から動的にロードする。`classic` テーマでプリセット・スポイト・RGB・ドラッグをすべて提供。CDN への通信が追加発生するため、kintone 環境の CSP 設定によっては追加許可が必要になる可能性がある（未検証）。プラグインの plugin.zip には影響なし。

### 3.3 案 B-2（Pickr npm バンドル）

`npm install @simonwep/pickr` してプラグインビルドに同梱。統一 UI で全高度機能を提供。plugin.zip サイズが 20〜30KB 増加するが、既存 80KB 程度のサイズに対して許容範囲。CDN 通信は発生しない。

### 3.4 案 C（独自フル実装）

全機能を独自実装。外部依存ゼロで完全なコントロールが可能だが、スポイト・RGB・ドラッグ UI の実装コストが大きく、メンテナンス負荷も高い。

---

## 4. 推奨案と判断根拠

### 4.1 推奨: 段階的アプローチ（フェーズ 1: 案 A → フェーズ 2: 案 B-2 への移行）

**フェーズ 1（今回実装）: 案 A を採用する。**

判断根拠:

1. ユーザー要望の最優先はプリセットパレットであり、案 A で完全に充足できる
2. kintone プラグインは iframe 内で動作するため、CDN ロード（案 B-1）は CSP の影響を受ける可能性がある（実機未検証）
3. 案 A は外部依存ゼロのため、将来の kintone プラットフォーム変更に対してリスクが最小
4. 高度機能（スポイト/RGB/ドラッグ）は「後追いでも可」と位置付けられており、フェーズ 2 で案 B-2 を採用することで漸進的に追加できる
5. ネイティブ `<input type="color">` を「カスタム色」の入口として残すことで、高度機能のフォールバックが既存実装から無変更で提供される

**フェーズ 2（後追い）: 案 B-2 への移行を検討する。**

- 高度機能が正式要件化した際に Pickr をバンドルし、フェーズ 1 のプリセット部分を Pickr の `swatches` オプションで置き換える
- この時点では 案 B-1（CDN）より案 B-2（バンドル）を推奨する: CDN 通信・CSP リスクを排除できるため

### 4.2 不採用理由

**案 B-1 不採用**: CDN ロードは追加通信が発生し、kintone iframe 環境での CSP 影響が未確認（§9 参照）。現時点でのリスクが案 A・B-2 より高い。

**案 B-2 フェーズ 1 不採用**: 最優先要件（プリセットパレット）のみを実現するには工数過剰。Pickr の全機能は現時点では不要であり、先行導入のコストに見合わない。フェーズ 2 で正式採用する。

**案 C 不採用**: スポイト・RGB・ドラッグを自前実装するコストが大きく、メンテナンス負荷も高い。同等機能を MIT ライセンスの Pickr で代替できるため合理性がない。

---

## 5. UI 仕様（フェーズ 1: 案 A ベース）

### 5.1 HTML 構造案

既存の `buildPermissionRow` 関数内で `<input type="color">` を生成している箇所（`config.js:407-411`）を以下の構造に置き換える。

```html
<!-- 色セル内の構造（JavaScript で生成） -->
<div class="kc-color-picker-wrapper">
  <!-- プレビュー兼トグルボタン -->
  <button type="button"
    class="kc-color-preview-btn"
    aria-label="色を選択: [現在の色名]"
    aria-expanded="false"
    aria-haspopup="true"
    style="background-color: #1976d2;">
  </button>

  <!-- プリセットパレットポップアップ -->
  <div class="kc-color-palette" role="dialog" aria-label="カラーパレット" hidden>
    <!-- プリセット色タイル（20 個） -->
    <div class="kc-color-palette-grid" role="listbox" aria-label="プリセットカラー">
      <button type="button"
        class="kc-color-tile"
        role="option"
        aria-label="トマト"
        aria-selected="false"
        data-color="#d50000"
        style="background-color: #d50000;">
      </button>
      <!-- ... 20 色分繰り返し ... -->
    </div>

    <!-- カスタム色ボタン（ネイティブピッカーを呼び出す） -->
    <div class="kc-color-palette-custom">
      <button type="button" class="kc-color-custom-btn" aria-label="カスタムカラーを選択">
        カスタム...
      </button>
      <!-- ネイティブピッカー（hidden で配置し、カスタムボタンから click() を呼び出す） -->
      <input type="color" class="kc-color-native-input" tabindex="-1"
        aria-hidden="true" value="#1976d2">
    </div>
  </div>
</div>
```

### 5.2 CSS スタイル案

```css
/* プレビューボタン（色の正方形） */
.kc-color-preview-btn {
  display: block;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 2px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
  padding: 0;
  position: relative;
}
.kc-color-preview-btn:hover {
  border-color: rgba(0, 0, 0, 0.4);
}

/* パレットポップアップ */
.kc-color-palette {
  position: absolute;
  z-index: 100;
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px;
  margin-top: 4px;
}

/* タイルグリッド */
.kc-color-palette-grid {
  display: grid;
  grid-template-columns: repeat(5, 28px);
  gap: 4px;
}

/* 色タイル */
.kc-color-tile {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s, border-color 0.1s;
}
.kc-color-tile:hover {
  transform: scale(1.15);
  border-color: rgba(0, 0, 0, 0.3);
}
/* アクティブ（選択中）タイル */
.kc-color-tile[aria-selected="true"] {
  border-color: #333;
  box-shadow: 0 0 0 2px #fff inset;
}
/* アクティブタイルのチェックマーク */
.kc-color-tile[aria-selected="true"]::after {
  content: '✓';
  color: #fff;
  font-size: 14px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* カスタムボタンエリア */
.kc-color-palette-custom {
  margin-top: 8px;
  border-top: 1px solid #e8e8e8;
  padding-top: 8px;
}
.kc-color-custom-btn {
  width: 100%;
  font-size: 12px;
  padding: 4px 8px;
  background: #f5f5f5;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
}
.kc-color-custom-btn:hover {
  background: #ebebeb;
}

/* ネイティブピッカーは非表示（カスタムボタンからトリガー） */
.kc-color-native-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
```

### 5.3 JS 動作仕様

#### 5.3.1 パレットの開閉

- `.kc-color-preview-btn` クリック: パレットの `hidden` を toggle し、`aria-expanded` を更新する
- パレット外クリック（`document` の `mousedown` イベント）: パレットを閉じる
- `Escape` キー: パレットを閉じ、フォーカスをプレビューボタンに戻す

#### 5.3.2 タイルクリック時の処理

```
1. クリックされたタイルの data-color を取得する
2. .kc-color-preview-btn の background-color を更新する
3. .kc-color-native-input の value を更新する（#RRGGBB 形式）
4. 全タイルの aria-selected を false にリセットし、クリックされたタイルを true に設定する
5. パレットを閉じる
6. collectPermissionRules() が .kc-color-native-input の value を参照して保存するため、
   追加の保存処理は不要（既存の collectPermissionRules の参照先を変更しないことが前提）
```

#### 5.3.3 カスタムボタンクリック時の処理

```
1. .kc-color-native-input.click() を呼び出してネイティブピッカーを開く
2. .kc-color-native-input の input / change イベントで:
   a. .kc-color-preview-btn の background-color を更新する
   b. 全タイルの aria-selected を false にリセットする（カスタム色はプリセット外のため）
```

#### 5.3.4 既存 collectPermissionRules との連携

`collectPermissionRules()` は `.kc-permission-color` クラスの要素の `.value` を参照して色を収集している（`config.js:480-487`）。新実装では `.kc-color-native-input` が `<input type="color">` の役割を引き継ぎ、`.kc-permission-color` クラスを引き続き付与することで `collectPermissionRules()` の変更を最小化する。

```javascript
// kc-color-native-input に kc-permission-color クラスも付与する
colorNativeInput.className = 'kc-color-native-input kc-permission-color';
```

---

## 6. 既存実装からの変更点

### 6.1 config.js: buildPermissionRow 関数（`config.js:407-411` 付近）

**変更前:**

```javascript
// カラーピッカー（デフォルト色: #1976d2）
var colorInput = document.createElement('input');
colorInput.type = 'color';
colorInput.className = 'kc-permission-color';
colorInput.value = (rule && rule.color) ? rule.color : '#1976d2';
```

**変更後:**

`buildPermissionRow` 内で `buildColorPickerWidget(initialColor)` ヘルパー関数を呼び出し、返された `.kc-color-picker-wrapper` 要素を `cellColor` に追加する。ヘルパー関数の詳細は §5.3 の仕様に従う。`collectPermissionRules` が参照する `.kc-permission-color` クラスは `.kc-color-native-input` に付与して互換性を維持する。

### 6.2 config.js: collectPermissionRules 関数（`config.js:480` 付近）

変更なし（`.kc-permission-color` のセレクタを引き続き使用。§5.3.4 参照）。

### 6.3 config.js: applyPermissionRules 関数

`applyPermissionRules` で保存済みの `color` をフォームに反映する際、`.kc-permission-color` への `.value` セットは従来通り機能する。ただし `.kc-color-preview-btn` の `background-color` スタイルも同期して更新する必要がある。

**追加処理（擬似コード）:**

```
function syncColorPreview(row, color):
  var nativeInput = row.querySelector('.kc-permission-color')
  var previewBtn  = row.querySelector('.kc-color-preview-btn')
  if nativeInput: nativeInput.value = color
  if previewBtn:  previewBtn.style.backgroundColor = color
  // aria-selected 更新
  row.querySelectorAll('.kc-color-tile').forEach(function(tile) {
    tile.setAttribute('aria-selected',
      tile.dataset.color === color ? 'true' : 'false')
  })
```

### 6.4 config.css

- `.kc-permission-color` の既存スタイル（`width: 44px;` 等）は削除または `.kc-color-native-input` 向けに hidden 化スタイルへ変更する
- `config.css:443-586` の `.kc-permission-*` ルールのうち、`.kc-permission-col-color` の幅指定（`grid-template-columns: 2fr 1fr 44px 40px;`）は変更なし（プレビューボタンが 28px のためカラム幅は 44px で余白が生じるが許容範囲）

### 6.5 データ構造への影響

**なし。** `permissionRules[].color` は引き続き `#RRGGBB` 形式の文字列を保持する（REQ_edit-permission-extension §6.1）。

---

## 7. アクセシビリティ

### 7.1 キーボード操作

| キー | 動作 |
|---|---|
| `Tab` | ルール行内のコントロール間を移動（プレビューボタン → プリセットタイル → カスタムボタン → 次行） |
| `Enter` / `Space` | プレビューボタン: パレット開閉 / タイル: 色を選択して閉じる / カスタムボタン: ネイティブピッカーを開く |
| `Escape` | パレットを閉じ、プレビューボタンにフォーカスを戻す |
| 方向キー | パレット内タイル間をグリッドナビゲーション（実装オプション: 必須ではない）|

### 7.2 aria 属性

- プレビューボタン: `aria-label="色を選択: [色名]"`, `aria-expanded`, `aria-haspopup="true"`
- パレットコンテナ: `role="dialog"`, `aria-label="カラーパレット"`
- タイルグリッド: `role="listbox"`, `aria-label="プリセットカラー"`
- 各タイル: `role="option"`, `aria-label="[色名]"`, `aria-selected="true/false"`
- ネイティブ input: `aria-hidden="true"`（スクリーンリーダー向けには直接操作を隠蔽）

---

## 8. パフォーマンス

### 8.1 フェーズ 1（案 A）のパフォーマンス影響

- 追加の外部通信: **なし**
- プラグイン dist サイズ増加: 最小（タイル定義の配列とイベントハンドラのみ。推定 +1〜2KB 未満）
- 初期表示への影響: **なし**（DOM 生成は既存の `buildPermissionRow` 呼び出し時に同期で完結）
- パレットポップアップの遅延表示は不要（DOM は `buildPermissionRow` で生成済み、`hidden` 属性で表示制御）

### 8.2 フェーズ 2（案 B-2: Pickr バンドル）のパフォーマンス影響

- プラグイン dist サイズ増加: +20〜30KB（minified gzip 後は +8〜12KB 程度）
- 初期表示への影響: 軽微（プラグイン設定画面は管理者のみが使用し、頻度が低い）
- CDN 通信: **なし**（バンドル版のため）

---

## 9. 未確定事項・リスク・前提

| ID | 項目 | 内容 | 対応方針 |
|---|---|---|---|
| U-1 | kintone iframe 内での Pickr 動作 | フェーズ 2 で採用予定の Pickr が kintone の iframe 環境で正常に動作するか未検証 | フェーズ 2 着手前に開発環境で実機確認を行う。問題があれば案 A を維持またはフォールバック実装を追加する |
| U-2 | kintone 環境の CSP 設定 | 案 B-1（CDN）を採用する場合、`https://cdn.jsdelivr.net` を CSP の `script-src` / `style-src` に追加許可する必要がある可能性がある（bushiroad-group.cybozu.com の CSP 設定未確認）| フェーズ 2 で案 B-1 を再評価する場合は管理者に CSP 設定を確認する。案 B-2（バンドル）であれば CSP の影響を受けない |
| U-3 | パレットのポジション計算 | ルール行数が多い場合、パレットポップアップが設定画面の表示領域外に出る可能性がある | 実装時に `getBoundingClientRect()` で位置を動的計算し、下方向に余裕がない場合は上方向に展開するロジックを追加する |
| U-4 | フェーズ 2 の移行タイミング | フェーズ 2 で Pickr バンドルへ移行する際、フェーズ 1 のプリセット UI を廃止するか共存させるかは未定 | Pickr の `swatches` オプションでプリセット色を引き継ぐ方針とし、フェーズ 2 の設計時に決定する |

---

## 10. 実装フェーズ提案

### フェーズ 1（今回: 最優先）

**目標**: プリセットパレット選択 UI を実装し、ユーザー要望の最優先要件を達成する

**スコープ:**

- `buildColorPickerWidget()` ヘルパー関数の実装（`config.js` への追加）
- プリセット 20 色のタイルグリッド表示
- タイルクリックによる色設定・プレビュー更新
- 「カスタム...」ボタン経由でのネイティブ `<input type="color">` へのフォールバック
- `collectPermissionRules` / `applyPermissionRules` との連携確認
- CSS スタイルの追加（`config.css`）
- アクセシビリティ対応（aria 属性、キーボード操作）

**スコープ外（フェーズ 2）:**

- スポイト（EyeDropper API）
- RGB 数値直接入力フォーム
- 色相・彩度グラデーションドラッグ
- Pickr ライブラリへの移行

### フェーズ 2（後追い: 高度機能）

- Pickr (`@simonwep/pickr`) を npm バンドル方式（案 B-2）で採用
- 案 A のプリセット UI を Pickr の `swatches` に移行
- スポイト・RGB・ドラッグ機能を追加提供
- フェーズ 2 着手前に U-1（kintone iframe 内動作）を実機確認すること

---

*このドキュメントは 2026-05-18 に作成されました。フェーズ 1 実装時に変更が生じた場合は本ドキュメントを更新してください。*
