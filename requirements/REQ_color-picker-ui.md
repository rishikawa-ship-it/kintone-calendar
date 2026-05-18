# 要件定義書: 配色選択 UI の改善

**文書番号**: REQ_color-picker-ui
**作成日**: 2026-05-18
**最終更新日**: 2026-05-18
**作成者**: designer (サブエージェント)
**ステータス**: v2・推奨案提示済み
**関連文書**: REQ_edit-permission-extension.md, plugin/src/js/config.js, plugin/src/html/config.html, plugin/src/css/config.css

---

## バージョン履歴

| バージョン | 更新日 | 概要 |
|---|---|---|
| v1 | 2026-05-18 | 初版作成。フラット 20 色プリセット（Google Calendar / Material Design 系）+ 案 A/B/C の比較表 |
| v2 | 2026-05-18 | フラット 20 色プリセットを廃止し、Office 風の系統化パレット（テーマの色 10×5 + 標準の色 1×10 + カスタム）に変更。色相×明度のマトリクス構造でユーザーが色を見つけやすくする。 |

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

#### v2 追加要望（2026-05-18）

- **「色の系統ごとにまとまった UI にしたい」** — フラットなプリセットでなく、色相 × 明度のマトリクス構造（Microsoft Office 風）に変更する

### 1.3 目的

- カレンダーに適したプリセット色を **系統化されたマトリクス構造** のタイルとして提示し、1 クリックで色を選択できるようにする
- 上記プリセットに加えて、高度な色指定手段（スポイト/RGB/ドラッグ）を段階的に追加できる設計とする
- プラグイン設定画面の UI 一貫性を維持する

---

## 2. 機能要件

### 2.1 プリセットパレット（最優先）

#### 2.1.1 パレット構成（v2: Office 風マトリクス）

パレットは 3 つのセクションで構成する。

| セクション | 構成 | 色数 | 説明 |
|---|---|---|---|
| テーマの色 | 10 列 × 5 行 | 50 色 | 色相別（10 列）× 明度別（5 行）のマトリクス |
| 標準の色 | 1 行 × 10 列 | 10 色 | 彩度を重視した鮮やかな色 |
| カスタム色… | ボタン | - | ネイティブ `<input type="color">` を呼び出す |

合計プリセット: **60 色**（タイル）+ カスタム

#### 2.1.2 テーマの色: 列構成（色相 10 列）

| 列 | 色相系統 | 基準色（行 1）|
|---|---|---|
| 1 | グレー | `#757575` |
| 2 | 赤 | `#d50000` |
| 3 | オレンジ | `#f4511e` |
| 4 | アンバー | `#ff8f00` |
| 5 | 黄 | `#f6bf26` |
| 6 | 緑 | `#0b8043` |
| 7 | ティール | `#00796b` |
| 8 | 青 | `#1976d2` |
| 9 | 紫 | `#8e24aa` |
| 10 | ピンク | `#e91e63` |

#### 2.1.3 テーマの色: 行構成（明度 5 段階）

| 行 | 明度ラベル | 方向 |
|---|---|---|
| 1 | 標準 | 基準色 |
| 2 | 明 +1 | 基準より明るい |
| 3 | 明 +2 | より明るい（最明） |
| 4 | 暗 -1 | 基準より暗い |
| 5 | 暗 -2 | より暗い（最暗） |

#### 2.1.4 テーマの色: 確定 HEX 一覧（50 色）

行の並び順は「標準 → 明 +1 → 明 +2 → 暗 -1 → 暗 -2」の 5 段階。HEX は Material Design Color System（400 / 200 / 100 / 700 / 900 相当）を参考に静的定義する。

| 行 | グレー | 赤 | オレンジ | アンバー | 黄 | 緑 | ティール | 青 | 紫 | ピンク |
|---|---|---|---|---|---|---|---|---|---|---|
| 標準 (行1) | `#757575` | `#d50000` | `#f4511e` | `#ff8f00` | `#f6bf26` | `#0b8043` | `#00796b` | `#1976d2` | `#8e24aa` | `#e91e63` |
| 明+1 (行2) | `#bdbdbd` | `#ef9a9a` | `#ffab91` | `#ffcc80` | `#fff176` | `#81c784` | `#80cbc4` | `#90caf9` | `#ce93d8` | `#f48fb1` |
| 明+2 (行3) | `#f5f5f5` | `#ffebee` | `#fbe9e7` | `#fff8e1` | `#fffde7` | `#e8f5e9` | `#e0f2f1` | `#e3f2fd` | `#f3e5f5` | `#fce4ec` |
| 暗-1 (行4) | `#424242` | `#b71c1c` | `#bf360c` | `#e65100` | `#f57f17` | `#1b5e20` | `#004d40` | `#0d47a1` | `#6a1b9a` | `#880e4f` |
| 暗-2 (行5) | `#212121` | `#7f0000` | `#6d1f0a` | `#7c3700` | `#7c5c00` | `#0a3010` | `#00251a` | `#072356` | `#3b0a52` | `#4a0526` |

#### 2.1.5 標準の色: 確定 HEX 一覧（10 色）

彩度を重視した 10 色。1 行に横並びで表示する。

| # | 色名 | HEX |
|---|---|---|
| 1 | 純赤 | `#ff0000` |
| 2 | 鮮やかオレンジ | `#ff6600` |
| 3 | 鮮やか黄 | `#ffcc00` |
| 4 | 鮮やか緑 | `#33cc00` |
| 5 | 鮮やかシアン | `#00cccc` |
| 6 | 鮮やか青 | `#0066ff` |
| 7 | 鮮やか紫 | `#6600cc` |
| 8 | 鮮やかピンク | `#ff0099` |
| 9 | 黒 | `#000000` |
| 10 | 白 | `#ffffff` |

#### 2.1.6 タイル仕様

- タイルサイズ: 22px × 22px（テーマの色）/ 24px × 24px（標準の色）
- ホバー時: scale(1.2)、`transition: transform 0.1s`
- タイル間隔: 3px（gap）
- タイル形状: 角丸 3px（border-radius）

#### 2.1.7 アクティブ表示

- 現在選択中のタイルに **チェックマーク（✓）** を白色で表示する
- または `border: 3px solid #333;` + `box-shadow: 0 0 0 2px #fff inset;` によるハイライト枠でもよい（実装者が視認性の高い方を選択）
- アクティブでないタイルは `border: 2px solid transparent;` を基本とし、ホバー時に `border-color: rgba(0,0,0,0.3);`

#### 2.1.8 パレットの表示方法

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

カレンダー向けプリセット色（v2: テーマの色 50 色 + 標準の色 10 色）をタイルグリッドとして表示し、「カスタム」タイルクリックでネイティブ `<input type="color">` を開く。高度な機能（スポイト/RGB/ドラッグ）は OS のネイティブピッカーに委ねる。外部依存ゼロ、実装工数最小。

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

## 5. UI 仕様（フェーズ 1: 案 A ベース・v2）

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

    <!-- テーマの色セクション（10列×5行） -->
    <div class="kc-color-section" role="group" aria-label="テーマの色">
      <div class="kc-color-section-title">テーマの色</div>
      <div class="kc-color-theme-grid" role="listbox" aria-label="テーマカラー">
        <!-- 行1: 標準 -->
        <button type="button" class="kc-color-tile" role="option"
          aria-label="グレー" aria-selected="false"
          data-color="#757575" style="background-color: #757575;"></button>
        <!-- ...行1の残り9色... -->
        <!-- 行2〜5: 50色分繰り返し -->
      </div>
    </div>

    <!-- 標準の色セクション（1行×10列） -->
    <div class="kc-color-section" role="group" aria-label="標準の色">
      <div class="kc-color-section-title">標準の色</div>
      <div class="kc-color-standard-grid" role="listbox" aria-label="標準カラー">
        <button type="button" class="kc-color-tile kc-color-tile--standard" role="option"
          aria-label="純赤" aria-selected="false"
          data-color="#ff0000" style="background-color: #ff0000;"></button>
        <!-- ...10色分繰り返し... -->
      </div>
    </div>

    <!-- カスタム色ボタン（ネイティブピッカーを呼び出す） -->
    <div class="kc-color-palette-custom">
      <button type="button" class="kc-color-custom-btn" aria-label="カスタムカラーを選択">
        その他の色...
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
  min-width: 240px;
}

/* セクション区切り */
.kc-color-section + .kc-color-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e8e8e8;
}

/* セクションタイトル */
.kc-color-section-title {
  font-size: 11px;
  color: #666;
  margin-bottom: 4px;
}

/* テーマの色グリッド（10列×5行） */
.kc-color-theme-grid {
  display: grid;
  grid-template-columns: repeat(10, 22px);
  gap: 3px;
}

/* 標準の色グリッド（10列×1行） */
.kc-color-standard-grid {
  display: grid;
  grid-template-columns: repeat(10, 24px);
  gap: 3px;
}

/* 色タイル（共通） */
.kc-color-tile {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s, border-color 0.1s;
}
.kc-color-tile--standard {
  width: 24px;
  height: 24px;
}
.kc-color-tile:hover {
  transform: scale(1.2);
  border-color: rgba(0, 0, 0, 0.3);
}

/* アクティブ（選択中）タイル */
.kc-color-tile[aria-selected="true"] {
  border-color: #333;
  box-shadow: 0 0 0 2px #fff inset;
}
.kc-color-tile[aria-selected="true"]::after {
  content: '\2713';
  color: #fff;
  font-size: 12px;
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

#### 5.3.1 データ構造

```javascript
// テーマの色（10列×5行 = 50色）
// 配列は列優先（同じ列の5行をまとめる）で定義する
var THEME_COLORS = [
  // [列名, [行1標準, 行2明+1, 行3明+2, 行4暗-1, 行5暗-2]]
  ['グレー',    ['#757575', '#bdbdbd', '#f5f5f5', '#424242', '#212121']],
  ['赤',        ['#d50000', '#ef9a9a', '#ffebee', '#b71c1c', '#7f0000']],
  ['オレンジ',  ['#f4511e', '#ffab91', '#fbe9e7', '#bf360c', '#6d1f0a']],
  ['アンバー',  ['#ff8f00', '#ffcc80', '#fff8e1', '#e65100', '#7c3700']],
  ['黄',        ['#f6bf26', '#fff176', '#fffde7', '#f57f17', '#7c5c00']],
  ['緑',        ['#0b8043', '#81c784', '#e8f5e9', '#1b5e20', '#0a3010']],
  ['ティール',  ['#00796b', '#80cbc4', '#e0f2f1', '#004d40', '#00251a']],
  ['青',        ['#1976d2', '#90caf9', '#e3f2fd', '#0d47a1', '#072356']],
  ['紫',        ['#8e24aa', '#ce93d8', '#f3e5f5', '#6a1b9a', '#3b0a52']],
  ['ピンク',    ['#e91e63', '#f48fb1', '#fce4ec', '#880e4f', '#4a0526']],
];

// 標準の色（10色）
var STANDARD_COLORS = [
  { name: '純赤',           hex: '#ff0000' },
  { name: '鮮やかオレンジ', hex: '#ff6600' },
  { name: '鮮やか黄',       hex: '#ffcc00' },
  { name: '鮮やか緑',       hex: '#33cc00' },
  { name: '鮮やかシアン',   hex: '#00cccc' },
  { name: '鮮やか青',       hex: '#0066ff' },
  { name: '鮮やか紫',       hex: '#6600cc' },
  { name: '鮮やかピンク',   hex: '#ff0099' },
  { name: '黒',             hex: '#000000' },
  { name: '白',             hex: '#ffffff' },
];
```

#### 5.3.2 グリッド生成方針

- `THEME_COLORS` は列優先で定義し、グリッドへの DOM 追加は **行優先（左上→右上→折り返し）** で行う
- 行優先に変換するには「行インデックス × 10列を走査」するループで展開する

擬似コード:

```
for row = 0 to 4:           // 行: 0=標準, 1=明+1, ... 4=暗-2
  for col = 0 to 9:         // 列: 0=グレー, ... 9=ピンク
    hex = THEME_COLORS[col][1][row]
    name = THEME_COLORS[col][0] + ROW_LABELS[row]
    themeGrid.append(buildTile(hex, name))
```

#### 5.3.3 パレットの開閉

- `.kc-color-preview-btn` クリック: パレットの `hidden` を toggle し、`aria-expanded` を更新する
- パレット外クリック（`document` の `mousedown` イベント）: パレットを閉じる
- `Escape` キー: パレットを閉じ、フォーカスをプレビューボタンに戻す

#### 5.3.4 タイルクリック時の処理

```
1. クリックされたタイルの data-color を取得する
2. .kc-color-preview-btn の background-color を更新する
3. .kc-color-native-input の value を更新する（#RRGGBB 形式）
4. 全タイルの aria-selected を false にリセットし、クリックされたタイルを true に設定する
5. パレットを閉じる
6. collectPermissionRules() が .kc-color-native-input の value を参照して保存するため、
   追加の保存処理は不要（既存の collectPermissionRules の参照先を変更しないことが前提）
```

#### 5.3.5 カスタムボタンクリック時の処理

```
1. .kc-color-native-input.click() を呼び出してネイティブピッカーを開く
2. .kc-color-native-input の input / change イベントで:
   a. .kc-color-preview-btn の background-color を更新する
   b. 全タイルの aria-selected を false にリセットする（カスタム色はプリセット外のため）
```

#### 5.3.6 既存 collectPermissionRules との連携

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

### 6.2 config.js: プリセット色配列の変更

**変更前（v1）:**

```javascript
var PRESET_COLORS = [/* 20色フラット配列 */];
```

**変更後（v2）:**

```javascript
// PRESET_COLORS を廃止し、2つの配列に分割する
var THEME_COLORS = [/* 10列 × 5行 = 50色のマトリクス（§5.3.1 参照）*/];
var STANDARD_COLORS = [/* 10色の標準色（§5.3.1 参照）*/];
```

### 6.3 config.js: collectPermissionRules 関数（`config.js:480` 付近）

変更なし（`.kc-permission-color` のセレクタを引き続き使用。§5.3.6 参照）。

### 6.4 config.js: applyPermissionRules 関数

`applyPermissionRules` で保存済みの `color` をフォームに反映する際、`.kc-permission-color` への `.value` セットは従来通り機能する。ただし `.kc-color-preview-btn` の `background-color` スタイルも同期して更新する必要がある。

**追加処理（擬似コード）:**

```
function syncColorPreview(row, color):
  var nativeInput = row.querySelector('.kc-permission-color')
  var previewBtn  = row.querySelector('.kc-color-preview-btn')
  if nativeInput: nativeInput.value = color
  if previewBtn:  previewBtn.style.backgroundColor = color
  // aria-selected 更新（THEME_COLORS + STANDARD_COLORS の両方を走査）
  row.querySelectorAll('.kc-color-tile').forEach(function(tile) {
    tile.setAttribute('aria-selected',
      tile.dataset.color === color ? 'true' : 'false')
  })
```

### 6.5 config.css

- `.kc-permission-color` の既存スタイル（`width: 44px;` 等）は削除または `.kc-color-native-input` 向けに hidden 化スタイルへ変更する
- `config.css:443-586` の `.kc-permission-*` ルールのうち、`.kc-permission-col-color` の幅指定（`grid-template-columns: 2fr 1fr 44px 40px;`）は変更なし（プレビューボタンが 28px のためカラム幅は 44px で余白が生じるが許容範囲）
- v2 追加スタイル: `.kc-color-section`, `.kc-color-section-title`, `.kc-color-theme-grid`, `.kc-color-standard-grid`（§5.2 参照）

### 6.6 データ構造への影響

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
- テーマの色セクション: `role="group"`, `aria-label="テーマの色"`
- 標準の色セクション: `role="group"`, `aria-label="標準の色"`
- タイルグリッド: `role="listbox"`, `aria-label="テーマカラー"` / `"標準カラー"`
- 各タイル: `role="option"`, `aria-label="[色名]"`, `aria-selected="true/false"`
- ネイティブ input: `aria-hidden="true"`（スクリーンリーダー向けには直接操作を隠蔽）

---

## 8. パフォーマンス

### 8.1 フェーズ 1（案 A）のパフォーマンス影響

- 追加の外部通信: **なし**
- プラグイン dist サイズ増加: 微増（v1 の 20 色配列から 60 色配列への変更。推定 +1〜3KB 未満）
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
| U-5 | 暗-2 行（行5）の視認性 | グレー暗-2（`#212121`）など極暗色はパレット上で黒との区別が難しい場合がある | 実装・レビュー時に視認性を確認し、必要に応じて HEX を微調整する。builder が判断してよい |

### 9.1 確定事項

| Q-ID | 項目 | 決定内容（決定日）|
|---|---|---|
| Q1 | フェーズ 1 の実装方針 | 案 A（独自実装）採用 (2026-05-18) |
| Q2 | プリセット色の出典 | Google Calendar + Material Design 系（v1）→ Office 風マトリクス構造（v2, 2026-05-18） |
| Q3 | カスタム色の実装 | ネイティブ `<input type="color">` をフォールバックとして残す (2026-05-18) |
| Q4 | データ形式 | `permissionRules[].color` は `#RRGGBB` 形式を維持 (2026-05-18) |
| Q15 | カラーパレット構造 | Office 風 (10×5 テーマ + 10 標準 + カスタム) (2026-05-18) |

---

## 10. 実装フェーズ提案

### フェーズ 1（今回: 最優先）

**目標**: プリセットパレット選択 UI を実装し、ユーザー要望の最優先要件を達成する

**スコープ:**

- `buildColorPickerWidget()` ヘルパー関数の実装（`config.js` への追加）
- `THEME_COLORS`（50 色）と `STANDARD_COLORS`（10 色）の 2 配列定義（`PRESET_COLORS` を廃止）
- テーマの色（10 列 × 5 行）グリッド表示
- 標準の色（1 行 × 10 列）グリッド表示
- タイルクリックによる色設定・プレビュー更新
- 「その他の色...」ボタン経由でのネイティブ `<input type="color">` へのフォールバック
- `collectPermissionRules` / `applyPermissionRules` との連携確認
- CSS スタイルの追加（`config.css`）: 2 セクション対応（§5.2 参照）
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

*このドキュメントは 2026-05-18 に初版作成、同日 v2 に更新されました。フェーズ 1 実装時に変更が生じた場合は本ドキュメントを更新してください。*
