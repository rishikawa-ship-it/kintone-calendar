# 要件定義書: 月ビュー予定デザイン Google カレンダー風刷新

**文書番号**: REQ_month-event-design-google  
**作成日**: 2026-06-19  
**作成者**: designer (サブエージェント)  
**対象ファイル**: `plugin/src/js/desktop.js` / `plugin/src/css/desktop.css`（正本）  
**ステータス**: 確定版（ユーザー方針確定済み）

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析](#2-現状分析)
3. [スコープと非干渉範囲](#3-スコープと非干渉範囲)
4. [要件（変更後仕様）](#4-要件変更後仕様)
5. [受入基準](#5-受入基準)
6. [検証項目・テストシナリオ](#6-検証項目テストシナリオ)
7. [想定 UX・シーケンス](#7-想定-uxシーケンス)
8. [変更対象ファイル・関数・セレクタ一覧](#8-変更対象ファイル関数セレクタ一覧)
9. [実機確認手順](#9-実機確認手順)
10. [未解決事項・リスク・前提](#10-未解決事項リスク前提)

---

## 1. 背景・目的

### 1.1 目的

月ビューの予定表示（終日バー・日跨ぎバー・単発時間予定チップ）を Google カレンダーに近いビジュアルへ刷新する。
現状は終日バーが固定グレー背景（左線ストライプ型）であり、色による予定種別の視認性が低い。ユーザーからモックアップ合意を経て以下の方針を確定した。

### 1.2 合意済み方針

| 要素 | 現状 | 変更後方針 |
|---|---|---|
| 終日バー (`.kc-ad-event--month`) | 固定グレー背景 + 左線 | bgColor で全面塗り + 角丸 + 白/濃色文字自動判定 |
| 日跨ぎバー (`.kc-month-chip--span`) | bgColor 全面塗り + 角丸 + 時刻表示 | 現状維持 + 時計アイコンを追加して終日バーとの視覚区別を強化 |
| 単発チップ (`.kc-month-chip`) | bgColor 全面塗り + 角丸 + ドット + 時刻 | 透明背景 + 先頭ドット (bgColor) + 時刻 + タイトル |

---

## 2. 現状分析

### 2.1 終日バー

- **JS**: `buildMonthAlldayBar()` — `plugin/src/js/desktop.js:4911`
  - `perm.bgColor || ev.color` を `border-left-color` に適用、背景は `#e5e7eb` 固定
  - 文字色は `#1f2937` 固定（`isLightColor` 判定なし）
  - bgColor 未設定時のフォールバック: CSS デフォルト `border-left: 4px solid #818cf8`
- **CSS**: `.kc-ad-event--month` — `desktop.css:1082-1105`
  - `border-radius: 0`（角丸なし）
  - `background: #e5e7eb`
  - `border-left: 4px solid #818cf8`（デフォルト左線色）
  - `color: #1f2937`（固定）
  - ホバー: `filter: brightness(0.96)`

### 2.2 日跨ぎバー

- **JS**: `buildMonthTimedSpanBar()` — `desktop.js:5058`
  - `perm.bgColor || ev.color` を `background` に適用
  - 文字色: `perm.textColor || KC.Lanes.isLightColor(bgColor) ? '#1f2937' : '#ffffff'`
  - 時刻テキスト (`kc-month-chip--span-time`) を DOM に追加
  - bgColor 未設定時: CSS デフォルト `background: #dbeafe`
- **CSS**: `.kc-month-chip--span` — `desktop.css:1113-1157`
  - `border-radius: 10px`
  - `padding: 1px 6px`
  - ホバー: `filter: brightness(0.95)`
  - リサイズハンドル: `desktop.css:646-649` (hover 時に表示)

### 2.3 単発チップ

- **JS**: `buildMonthChip()` — `desktop.js:4997`
  - `bgColor` 指定時: `chip.style.background = bgColor` で全面塗り
  - 文字色: `isLightColor` 自動判定
  - ドット: `.kc-month-chip-dot`、`background = bgColor || '#818cf8'`
  - bgColor 未設定時: CSS デフォルト `background: #dbeafe`
- **CSS**: `.kc-month-chip` — `desktop.css:928-971`
  - `background: #dbeafe`（デフォルト全面塗り）
  - `border-radius: 10px`
  - `cursor: grab`
  - ホバー: `filter: brightness(0.95)`

### 2.4 isLightColor ロジック

- `KC.Lanes.isLightColor(color)` — `desktop.js:3634-3646`
- Canvas 1x1 px に描画して輝度 (luminance) を計算。`luminance > 0.6` で `true`（明るい色）
- 結果はキャッシュ済み（`_colorCache`）
- `true` → 文字色 `#1f2937`（濃色）、`false` → 文字色 `#ffffff`（白）

### 2.5 CSS 変数

```
--kc-ad-bar-h:         20px    /* バー高 */
--kc-ad-bar-gap:       3px     /* バー間隔 */
--kc-font-size-base:   12px    /* 本文フォントサイズ */
--kc-subtext:          #6b7280 /* サブテキスト色 */
```

### 2.6 リサイズハンドル

- `.kc-resize-handle--left` / `.kc-resize-handle--right` — `desktop.css:625-649`
- 終日バー (`.kc-ad-event:hover`) および日跨ぎバー (`.kc-month-chip--span:hover`) のホバー時に `opacity: 1` で表示
- `position: absolute; top: 0; bottom: 0; width: 6px`

### 2.7 自分の予定強調 (--mine クラス)

- CSS: `.kc-ad-event--mine`, `.kc-month-chip--mine` — `desktop.css:1169-1187`
- 固定オレンジ色 `!important` で上書き
- 注: JS 側ではこれらのクラス付与コードが現時点で見当たらない（desktop.js には `--mine` 付与処理なし）。今回の変更スコープ外だが、終日バーの背景変更後も `!important` ルールにより既存の --mine 強調は維持される。

### 2.8 DnD・ゴースト

- ドラッグ中の薄表示: `.kc-event--dragging` (`opacity: 0.4`) — `desktop.css:652`
- 終日バードラッグ: `.kc-ad-event--dragging` (`opacity: 0.4`) — `desktop.css:657`
- 月ビュー chip ドラッグ: `.kc-month-chip.kc-event--dragging` — `desktop.css:1071`
- 日跨ぎバードラッグ: `.kc-month-chip--span.kc-event--dragging` — `desktop.css:1155`
- ゴーストバー: `.kc-event--ghost` (`!important` でグレー統一) — `desktop.css:569-593`

---

## 3. スコープと非干渉範囲

### 3.1 スコープ内（本要件の対象）

| 対象 | 変更内容 |
|---|---|
| `buildMonthAlldayBar()` の色・スタイル設定部分 | 左線ストライプ → 全面塗りに変更 |
| `.kc-ad-event--month` CSS | 背景・角丸・border-left・文字色の変更 |
| `buildMonthChip()` の色・DOM 生成部分 | 全面塗り → 透明背景 + ドット色のみ bgColor に変更 |
| `.kc-month-chip` CSS | 背景透明化・文字色・ホバー変更 |
| `buildMonthTimedSpanBar()` の DOM 生成部分 | 時計アイコン相当の要素を先頭に追加 |
| `.kc-month-chip--span` / `.kc-month-chip--span-time` CSS | 時計アイコン表示スタイルの追加 |

### 3.2 スコープ外（非干渉）

| 対象 | 理由 |
|---|---|
| バーのレーン割当・top/lane 計算ロジック | 並行作業中（日跨ぎバーの余白問題・ソート変更）と干渉しないこと |
| `placeMonthAlldayEvents` / `placeMonthTimedSpanEvents` の配置ロジック | 上記と同じ |
| spacer / localMax 計算 | 同上 |
| `_calcMaxItems` / +N more ロジック | レイアウト計算。変更後のバー高が CSS 変数と一致していれば問題なし |
| 週/日ビューの終日バー (`.kc-ad-event` 本体 = `--month` なし) | スコープ外 |
| `KC.DnD` のイベントハンドラ | mousedown/click のイベント配線は変更しない |
| `isLightColor()` 関数本体 | 既存実装を流用するのみ |
| kintone プラグイン設定 UI・`KC.Config` | 変更なし |

---

## 4. 要件（変更後仕様）

### 4.1 終日バー（`.kc-ad-event--month`）: 全面塗り化

#### 4.1.1 見た目仕様

| プロパティ | 変更前 | 変更後 |
|---|---|---|
| `background` | `#e5e7eb`（固定グレー） | `perm.bgColor \|\| ev.color \|\| '#818cf8'`（bgColor を背景色に適用） |
| `border-left` | `4px solid <bgColor>` | `なし`（廃止） |
| `border` | `none` | `none`（維持） |
| `border-radius` | `0` | `4px`（Google カレンダー風の小さい角丸） |
| `color`（文字色） | `#1f2937`（固定） | `isLightColor(bgColor)` による自動判定: 明 → `#1f2937`、暗 → `#ffffff` |
| `padding` | `0 4px` | `0 6px`（左線廃止による左余白補正） |
| `gap` | `0` | `0`（dot は非表示維持） |
| ホバー | `filter: brightness(0.96)` | `filter: brightness(0.92)`（塗り色上での視認性向上） |

#### 4.1.2 bgColor フォールバック

- `perm.bgColor` → `ev.color` → フォールバック `#818cf8`（現状の左線デフォルト色を転用）
- フォールバック適用時の文字色: `isLightColor('#818cf8')` を評価（`#818cf8` の輝度 ≈ 0.35 → 暗色 → 文字は白 `#ffffff`）

#### 4.1.3 JS 変更箇所（`buildMonthAlldayBar()`）

変更前（`desktop.js:4931-4936`）:
```javascript
var displayBgColor = perm.bgColor || ev.color || null;
if (displayBgColor) {
  el.style.borderLeftColor = displayBgColor;
  el.style.background      = '#e5e7eb';
  el.style.color           = '#1f2937';
}
```

変更後:
```javascript
// フォールバック込みで必ず色を確定する（終日バーは常に塗り色が必要）
var displayBgColor = perm.bgColor || ev.color || '#818cf8';
el.style.background = displayBgColor;
el.style.borderLeft = 'none';  // 左線ストライプ廃止
el.style.color = perm.textColor || (KC.Lanes.isLightColor(displayBgColor) ? '#1f2937' : '#ffffff');
```

#### 4.1.4 CSS 変更箇所（`.kc-ad-event--month`、`desktop.css:1082-1105`）

```css
/* 変更後 */
.kc-ad-event--month {
  border-radius: 4px;             /* 0 → 4px (Google 風小角丸) */
  background: #818cf8;            /* デフォルト色（JSで上書き）。左線廃止のため既定値変更 */
  border: none;
  border-left: none;              /* 左線廃止 */
  color: #ffffff;                 /* デフォルト文字色（JSで上書き）*/
  gap: 0;
  padding: 0 6px;                 /* 0 4px → 0 6px */
}
.kc-ad-event--month:hover {
  filter: brightness(0.92);       /* 0.96 → 0.92 */
}
/* .kc-ad-event--month .dot { display: none } は維持 */
```

#### 4.1.5 タイトル表示

- タイトルのみ表示（時刻なし）。現状と同様。
- `el.title` 属性（ツールチップ）も現状維持: `(ev.title || '(無題)') + (ev.adDateRange ? '\n' + ev.adDateRange : '')`

### 4.2 日跨ぎバー（`.kc-month-chip--span`）: 時計アイコン追加

#### 4.2.1 見た目仕様（維持する項目）

| プロパティ | 値 |
|---|---|
| `background` | `bgColor`（維持） |
| `border-radius` | `10px`（維持） |
| `color` | `isLightColor` 自動判定（維持） |
| `padding` | `1px 6px`（維持） |

#### 4.2.2 時計アイコンの追加方針

プラグイン内は Tabler Icons 等の外部フォントアイコンを使用できない。以下の手段で時計を表現する。

**採用案: Unicode 文字 `🕐` ではなく CSS 擬似要素による時計記号**

- `.kc-month-chip--span-clock` クラスの `<span>` を DOM 先頭に追加（JS）
- CSS で `content: "⏱"` (U+23F1 STOPWATCH) または `"🕐"` (U+1F550) を表示

ただし絵文字 (U+1F550) は環境依存でサイズや見た目が不安定なため、以下を優先する。

**推奨: `::before` 擬似要素 + テキスト記号 `⏱` (U+23F1)**

```css
.kc-month-chip--span::before {
  content: "⏱";           /* U+23F1 STOPWATCH */
  font-size: 9px;
  flex: 0 0 auto;
  margin-right: 1px;
  opacity: 0.85;
}
```

- バー全体の `display: flex; align-items: center` を利用して自然に先頭配置
- `font-size: 9px` にして時刻テキストと同等サイズに揃える

**代替案 (フォールバック): DOM に `<span class="kc-month-chip--span-icon">⏱</span>` を追加**

CSS 擬似要素と DOM span のどちらでも視覚効果は同等。builder は実装しやすい方を選択してよい。DOM span 方式を選ぶ場合は `buildMonthTimedSpanBar()` の先頭に以下を追加する:

```javascript
var clockSpan = document.createElement('span');
clockSpan.className = 'kc-month-chip--span-icon';
clockSpan.textContent = '⏱';
el.insertBefore(clockSpan, el.firstChild);
// または el.appendChild(clockSpan) のあと DOM 順を調整
```

**最小代替案 (アイコン不要版)**: 実装コスト削減のため「時刻表示の有無」だけで終日と日跨ぎを区別する案も許容する（詳細は §10.1 参照）。

#### 4.2.3 CSS 追加（アイコン用）

```css
/* 日跨ぎバー先頭アイコン（時計記号。擬似要素方式の場合） */
.kc-month-chip--span::before {
  content: "⏱";
  font-size: 9px;
  flex: 0 0 auto;
  opacity: 0.85;
  line-height: 1;
}

/* DOM span 方式の場合 */
.kc-month-chip--span-icon {
  font-size: 9px;
  flex: 0 0 auto;
  opacity: 0.85;
  line-height: 1;
}
```

#### 4.2.4 時刻テキスト (`.kc-month-chip--span-time`)

- 現状の時刻表示 (`HH:MM`) は維持
- 色: `color: inherit; opacity: 0.8`（現状維持）

### 4.3 単発チップ（`.kc-month-chip`）: 透明背景化

#### 4.3.1 見た目仕様

| プロパティ | 変更前 | 変更後 |
|---|---|---|
| `background` | `bgColor`（全面塗り） | `transparent` |
| `border-radius` | `10px` | `4px`（Google 風。または `0` も可。builder 判断） |
| `color`（文字色） | `isLightColor` 自動判定 | `#1f2937`（kintone 白背景前提の濃色固定） |
| `.kc-month-chip-dot` の `background` | `bgColor \|\| '#818cf8'` | `bgColor \|\| '#818cf8'`（維持） |
| `.kc-month-chip-time` の `color` | `var(--kc-subtext)` (#6b7280) | `var(--kc-subtext)` (#6b7280)（維持） |
| ホバー | `filter: brightness(0.95)` | `background: rgba(0,0,0,0.05)`（透明背景時は brightness 効果なし。ホバー時に薄く背景付与） |
| `cursor` | `grab` | `grab`（維持） |
| `z-index` | `2` | `2`（維持） |

#### 4.3.2 JS 変更箇所（`buildMonthChip()`、`desktop.js:5010-5013`）

変更前:
```javascript
if (bgColor) {
  chip.style.background = bgColor;
  chip.style.color = chipPerm.textColor || (KC.Lanes.isLightColor(bgColor) ? '#1f2937' : '#ffffff');
}
```

変更後:
```javascript
// 透明背景に変更: background は CSS デフォルト (transparent) に委ねる
// chip.style.background を設定しない（または明示的に 'transparent' を設定）
chip.style.background = 'transparent';
chip.style.color = '#1f2937';  // kintone 白背景前提で濃色固定
// ドット色のみ bgColor で彩色（以降の dot 設定は変更なし）
```

#### 4.3.3 CSS 変更箇所（`.kc-month-chip`、`desktop.css:928-947`）

```css
/* 変更後 */
.kc-month-chip {
  /* background: #dbeafe; を削除し transparent に変更 */
  background: transparent;
  /* border-radius: 10px → 4px に変更 */
  border-radius: 4px;
  /* color: #1f2937 は維持 */
  color: #1f2937;
  /* その他のプロパティは維持 */
}
.kc-month-chip:hover {
  /* filter: brightness(0.95) → 透明背景に適したホバー表現に変更 */
  filter: none;
  background: rgba(0, 0, 0, 0.05);
}
```

#### 4.3.4 kintone 白背景での可読性

kintone の月ビューセル背景は白 (`#ffffff`) 固定。透明背景のチップ上に `#1f2937` (コントラスト比 ≈ 15:1) のテキストが乗るため可読性は問題なし。ただし、同一日に多数のチップが重なる場合は透明背景同士が視覚的に混在する可能性があるが、これは月ビューの +N more で件数制限されるため実害は限定的。

### 4.4 bgColor 未設定時の全体フォールバック方針

| 要素 | 未設定時の扱い |
|---|---|
| 終日バー | `#818cf8`（現状の左線デフォルト色を転用）。文字色は白 (`#ffffff`) |
| 日跨ぎバー | CSS デフォルト `#dbeafe`（変更なし）。文字色は `#1f2937`（現状維持） |
| 単発チップ | `transparent`。ドットは `#818cf8` |

### 4.5 終日バーと日跨ぎバーの視覚区別まとめ

| 区別軸 | 終日バー | 日跨ぎバー |
|---|---|---|
| 時刻表示 | なし | あり (`HH:MM`) |
| アイコン | なし | 時計記号 `⏱` |
| 角丸 | 小 (`4px`) | 大 (`10px`) |
| padding | `0 6px` | `1px 6px` |

---

## 5. 受入基準

### 5.1 終日バー: 全面塗り

- **Given**: bgColor が設定された終日予定が月ビューに表示されている
- **When**: 目視確認する
- **Then**: バー全体が bgColor で塗りつぶされている。左線（`border-left`）は表示されない
- **And**: 角丸 `4px` が視認できる

### 5.2 終日バー: 文字色自動判定

- **Given**: 明るい bgColor（例: `#fef08a` 黄色）の終日予定がある
- **When**: 月ビューで表示する
- **Then**: タイトル文字が濃色 (`#1f2937`) で表示される
- **Given**: 暗い bgColor（例: `#1e3a5f` 紺色）の終日予定がある
- **When**: 月ビューで表示する
- **Then**: タイトル文字が白 (`#ffffff`) で表示される

### 5.3 終日バー: bgColor 未設定時フォールバック

- **Given**: bgColor が設定されていない終日予定がある
- **When**: 月ビューで表示する
- **Then**: バーが `#818cf8` で全面塗りされ、文字は白で表示される

### 5.4 終日バー: タイトルのみ（時刻なし）

- **Given**: 終日予定が表示されている
- **When**: バーを目視する
- **Then**: タイトルテキストのみ表示され、時刻文字列は表示されない

### 5.5 日跨ぎバー: 時計アイコン表示

- **Given**: allday=false かつ複数日にまたがる時間予定がある
- **When**: 月ビューで表示する
- **Then**: バー先頭に時計記号 (`⏱`) が表示される
- **And**: 時刻テキスト (`HH:MM`) が表示される

### 5.6 終日バーと日跨ぎバーの視覚区別

- **Given**: 同一週行に終日バーと日跨ぎバーが並んでいる
- **When**: 目視確認する
- **Then**: 終日バー（時刻なし・アイコンなし・小角丸）と日跨ぎバー（時計アイコン・時刻あり・大角丸）が明確に区別できる

### 5.7 単発チップ: 透明背景

- **Given**: bgColor が設定された時間予定が月ビューに表示されている
- **When**: 目視確認する
- **Then**: チップの背景は透明で、セルの背景色（白）が透けて見える
- **And**: 先頭ドットが bgColor で彩色されている
- **And**: 時刻テキストと件名が `#1f2937` / `#6b7280` で視認できる

### 5.8 単発チップ: bgColor 未設定時

- **Given**: bgColor が未設定の時間予定がある
- **When**: 月ビューで表示する
- **Then**: チップ背景は透明。先頭ドットは `#818cf8`。テキストは `#1f2937`

### 5.9 DnD: 終日バーのドラッグ

- **Given**: 編集権限のある終日バーを月ビューで表示している
- **When**: バーをドラッグする
- **Then**: ドラッグ中の元バーが `opacity: 0.4` で薄表示になる
- **And**: ゴーストバーがグレー (`#9ca3af`) で表示される
- **And**: ドロップ後に新しい日付にバーが移動する

### 5.10 DnD: リサイズハンドル

- **Given**: 終日バーにマウスオーバーする
- **When**: バーの左端または右端付近にカーソルを当てる
- **Then**: リサイズハンドル（`.kc-resize-handle--left` / `--right`）が出現する
- **And**: 全面塗り後もハンドルの `position: absolute; top:0; bottom:0; width:6px` は正常に機能する（border-left 廃止の影響なし）

### 5.11 DnD: 月ビュー chip のドラッグ

- **Given**: 透明背景の単発チップを表示している
- **When**: チップをドラッグする
- **Then**: ドラッグ中に `opacity: 0.4` の薄表示になる
- **And**: cursor が `grabbing` になる

### 5.12 +N more の可視性

- **Given**: セルの最大表示件数を超えた予定がある
- **When**: 月ビューで表示する
- **Then**: `+N more` リンクが正常に表示される
- **And**: `_calcMaxItems` のバー高計算（`--kc-ad-bar-h: 20px`、`PITCH`）は本変更で変わらないため +N more の件数は変化しない

### 5.13 自分の予定強調 (--mine) との共存

- **Given**: ログインユーザー自身の終日予定がある（`--mine` クラスが付与される場合）
- **When**: 月ビューで表示する
- **Then**: CSS の `!important` ルール（`background-color: #ea580c`）が終日バーに適用され、全面塗り化後も強調色で表示される

### 5.14 並行作業との非干渉

- **Given**: 日跨ぎバーの余白問題修正・ソート変更が同時に適用されている
- **When**: 月ビューを表示する
- **Then**: バーの top / lane / spacer 計算結果が本変更によって変化しない
- **And**: +N more の件数が本変更によって変化しない

---

## 6. 検証項目・テストシナリオ

| # | 分類 | シナリオ | 期待結果 |
|---|---|---|---|
| T-01 | 終日バー色 | bgColor `#818cf8`（デフォルト）の終日予定 | 全面インジゴ塗り、文字白 |
| T-02 | 終日バー色 | bgColor `#fef08a`（黄）の終日予定 | 全面黄塗り、文字濃色 (`#1f2937`) |
| T-03 | 終日バー色 | bgColor 未設定の終日予定 | `#818cf8` で全面塗り、文字白 |
| T-04 | 終日バー色 | bgColor `#ef4444`（赤）の終日予定 | 全面赤塗り、文字白 |
| T-05 | 終日バー形状 | 任意の終日バー | 角丸 4px 確認。左線 (`border-left`) が存在しないこと |
| T-06 | 終日バー内容 | 長いタイトルの終日予定 | 末尾が `...` で省略され、時刻は表示されない |
| T-07 | 日跨ぎバー | 月火水にまたがる時間予定 | 先頭に `⏱`、続いて `HH:MM`、タイトル表示 |
| T-08 | 日跨ぎバー | 終日バーと日跨ぎバーが同じ週行に存在 | 終日（アイコンなし・小角丸）と日跨ぎ（アイコンあり・大角丸）が目視で区別可能 |
| T-09 | 単発チップ | bgColor 設定済みの時間予定 | 背景透明、ドットが bgColor、時刻と件名が可読 |
| T-10 | 単発チップ | bgColor 未設定の時間予定 | 背景透明、ドット `#818cf8`、テキスト `#1f2937` |
| T-11 | 単発チップ | ホバー | `rgba(0,0,0,0.05)` の背景が薄く表示される |
| T-12 | DnD | 終日バーのドラッグ | ドラッグ中に薄表示、ゴーストがグレー |
| T-13 | DnD | 終日バーのリサイズ | 左右ハンドルが hover 時に出現し、リサイズ操作が完了する |
| T-14 | DnD | 単発チップのドラッグ | `cursor: grabbing`、薄表示、ドロップ後に日時変更 |
| T-15 | DnD | 日跨ぎバーのリサイズ | 時計アイコン追加後もハンドルが正常に出現・機能する |
| T-16 | +N more | セル件数超過 | +N more が正常表示、クリックで拡張ポップアップが開く |
| T-17 | 計算 | バー高変更なし確認 | `--kc-ad-bar-h: 20px` が変更されていないこと |
| T-18 | 強調 | --mine 予定 (CSS 準拠) | 終日バーが強調オレンジ (`#ea580c`) で表示される（!important 有効） |
| T-19 | クリック | 終日バークリック | 編集ポップアップが開く |
| T-20 | クリック | 単発チップクリック | 編集ポップアップが開く |
| T-21 | 並行作業 | 日跨ぎ余白修正・ソート変更と同時適用 | バー位置・件数が変化しないこと |

---

## 7. 想定 UX・シーケンス

### 7.1 月ビュー描画フロー（変更後）

```
placeMonthAlldayEvents(weekEl, weekYMD, alldayEvents, maxItems)
  └─ buildMonthAlldayBar(ev)   ← 本変更: 全面塗り・isLightColor 適用
       └─ el.style.background = displayBgColor
       └─ el.style.color      = isLightColor(displayBgColor) ? '#1f2937' : '#fff'
       └─ el.appendChild(titleSpan)  ← タイトルのみ（時刻なし）

placeMonthTimedSpanEvents(weekEl, weekYMD, timedSpanEvents, ...)
  └─ buildMonthTimedSpanBar(ev)  ← 本変更: 時計アイコン追加
       └─ el.style.background = bgColor
       └─ el.appendChild(clockSpan / ::before)  ← ⏱ 追加
       └─ el.appendChild(timeSpan)
       └─ el.appendChild(titleSpan)

renderMonthTimedChips(cellEl, timedEvents, ...)
  └─ buildMonthChip(evt)  ← 本変更: 透明背景化
       └─ chip.style.background = 'transparent'
       └─ chip.style.color      = '#1f2937'
       └─ chip.appendChild(dot)      ← ドットは bgColor のまま
       └─ chip.appendChild(timeSpan)
       └─ chip.appendChild(titleSpan)
```

### 7.2 ユーザーが月ビューを見たときの印象

1. カラフルな終日バーが各日を横断し、予定の種別（人物・プロジェクト）が色で瞬時に把握できる
2. 日跨ぎする時間予定には時計アイコンが付き、「時間の概念がある予定」であることが一目でわかる
3. 単発の時間予定はすっきりした透明背景で表示され、月ビュー全体の視覚的ノイズが軽減される

---

## 8. 変更対象ファイル・関数・セレクタ一覧

### 8.1 `plugin/src/js/desktop.js`

| 関数 | 行（参考） | 変更内容 |
|---|---|---|
| `buildMonthAlldayBar()` | 4911 | `borderLeftColor` 削除、`background = displayBgColor`、`isLightColor` 適用、フォールバック `#818cf8` |
| `buildMonthTimedSpanBar()` | 5058 | 時計アイコン用 span（または ::before 対応不要）を DOM に追加 |
| `buildMonthChip()` | 4997 | `chip.style.background = 'transparent'`、`chip.style.color = '#1f2937'`（bgColor 依存の色設定を削除） |

### 8.2 `plugin/src/css/desktop.css`

| セレクタ | 行（参考） | 変更内容 |
|---|---|---|
| `.kc-ad-event--month` | 1082 | `border-left` 削除、`border-radius: 4px`、`background: #818cf8`（デフォルト更新）、`color: #ffffff`（デフォルト更新）、`padding: 0 6px` |
| `.kc-ad-event--month:hover` | 1103 | `filter: brightness(0.92)` |
| `.kc-month-chip--span` | 1114 | 変更なし（維持） |
| `.kc-month-chip--span::before` または `.kc-month-chip--span-icon` | 新規追加 | 時計アイコン用スタイル |
| `.kc-month-chip` | 928 | `background: transparent`、`border-radius: 4px`（または維持）、`color: #1f2937` |
| `.kc-month-chip:hover` | 947 | `filter: none; background: rgba(0,0,0,0.05)` |

---

## 9. 実機確認手順

1. `plugin/src/js/desktop.js` と `plugin/src/css/desktop.css` を変更する
2. `plugin/` ディレクトリで `npm run build`（または該当ビルドコマンド）を実行し `plugin/dist/plugin.zip` を生成する
3. kintone 管理画面からプラグインを手動アップロードして更新する
4. kintone の対象アプリを開き、月ビューを表示する
5. §6「検証項目」の T-01〜T-21 を順に確認する
6. 特に T-12〜T-15 (DnD) は実際にドラッグ操作を行い動作確認する
7. 問題なければ `plugin/src/` → `plugin/dist/` の差分なし確認後コミット

> **注意**: src 版 (`src/kc-calendar.js`) は現在未使用。本変更の正本は `plugin/src/` のみ。

---

## 10. 未解決事項・リスク・前提

### 10.1 時計アイコンの実装方式（builder に確認・判断委任）

| 案 | 方式 | メリット | デメリット |
|---|---|---|---|
| A（推奨） | CSS `::before` + `content: "⏱"` | DOM 変更なし | 擬似要素のため JS から制御困難 |
| B | DOM `<span>` + `textContent = "⏱"` | JS から完全制御可能 | DOM に要素追加が必要 |
| C（最小対応） | アイコンなし（時刻表示のみで区別） | 変更量が最小 | 視覚区別がやや弱い |

builder は A または B を選択すること。C はユーザー確認なしに採用しないこと（方針未確定）。

### 10.2 `border-radius` の統一方針

- 終日バー: `4px`（新規）
- 日跨ぎバー: `10px`（維持）
- 単発チップ: 現状 `10px`。本要件では `4px` に変更するか維持するかを builder に委任。ユーザーへの確認は不要（見た目上の微差）。

### 10.3 `.kc-ad-event--mine` との整合

CSS の `.kc-ad-event--mine` は `background-color: #ea580c !important` を持つ。終日バーの背景色が `el.style.background`（インラインスタイル）で設定されるため、`!important` を持つ CSS クラスルールがインラインスタイルを上書きする。
ただし現状 JS コード側で `--mine` クラスを付与している箇所が確認できない (`desktop.js` に `kc-ad-event--mine` の参照なし)。CSS 定義はあるが現在未使用の可能性あり。**実機でログインユーザー自身の予定の表示を確認すること**（builder への申し送り）。

### 10.4 並行作業との調整

「日跨ぎバーの余白問題」修正と「レーン割当ソート変更」が同じ月ビュー描画コードに並行作業中。本要件の変更は `buildMonthAlldayBar` / `buildMonthChip` / `buildMonthTimedSpanBar` の **DOM 生成・スタイル設定部分のみ**に限定し、`top` / `lane` / `spacer` 計算には一切触れないこと。コンフリクトが生じた場合は管理者に報告してマージ順序を確認すること。

### 10.5 前提条件

- kintone の月ビューセル背景は白 (`#ffffff`) 固定とし、ダークモードは考慮しない
- `KC.Lanes.isLightColor()` は変更なし（既存実装を流用）
- `--kc-ad-bar-h: 20px` は変更しない（+N more の maxItems 計算に影響するため）
- プラグイン外（kintone ページ本体）のフォントや背景色は制御外とし、本要件の受入基準に含めない

---

*本要件定義書は builder への委譲準備完了。§10.1（時計アイコン方式）は builder に選択を委任する。*
