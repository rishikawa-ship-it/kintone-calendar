# 要件定義書: デフォルト権限設定（条件未一致レコード用）

**文書番号**: REQ_default-permission  
**作成日**: 2026-06-22  
**最終更新日**: 2026-06-22 (v2: 管理者確定方針反映)  
**作成者**: designer (サブエージェント)  
**ステータス**: 確定（builder 実装可）  
**関連文書**: REQ_edit-permission-extension.md, plugin/src/html/config.html, plugin/src/js/config.js, plugin/src/js/desktop.js

---

## 1. 背景・目的

### 1.1 背景

KC Calendar プラグインの権限設定には以下 2 つのテーブルがある。

| テーブル | HTML 要素 ID | 設定対象 |
|---|---|---|
| 権限フィールド設定 | `kc-fieldvalue-rows` | フィールド値（DROP_DOWN / RADIO_BUTTON / CHECK_BOX / STATUS）でマッチした場合の権限・色 |
| 権限ユーザー設定 | `kc-permission-rows` | USER_SELECT フィールドにログインユーザーが含まれる場合の権限・色 |

`getPermission()` (desktop.js:3662) の判定優先順位は次のとおりである。

1. `fieldValueRules`（権限フィールド設定）— 先にマッチした行を使用
2. `permissionRules`（権限ユーザー設定）— 最高権限マッチを採用
3. **設定あり・どの行にも非マッチ**: `canEdit: false, bgColor: null`（閲覧のみ・色なし）← desktop.js:3701
4. **両配列が空**: `canEdit: true, bgColor: null`（全員 edit・色なし）← desktop.js:3705

現状、「両テーブルを通じていずれの行にも一致しなかったレコード」には **ハードコードされた閲覧のみ・色なし** または **全員 edit・色なし** が適用される。この挙動を管理者が設定画面から変更する手段がない。

### 1.2 目的

- 権限フィールド設定・権限ユーザー設定の **両テーブルを通じてどの行にも一致しなかったレコード** に適用する「デフォルト設定」を、プラグイン設定画面から管理者が設定できるようにする。
- デフォルト設定は **全体で 1 つ**（テーブルごとに個別設定しない）。
- 設定項目は「有効チェックボックス・権限・背景色・文字色」の 4 項目のみ（条件列なし）。
- UI は 2 つのテーブル群の直下（権限ユーザー設定テーブルの直後）に 1 ブロック設置する。

---

## 2. 現状分析

### 2.1 権限テーブルの構造（config.html:343–399）

#### 権限フィールド設定テーブル（`kc-fieldvalue-table`）

| 列クラス | ヘッダーラベル | 入力種別 | 用途 |
|---|---|---|---|
| `kc-fieldvalue-col-handle` | (なし) | ドラッグハンドル | 並び替え用 |
| `kc-fieldvalue-col-field` | フィールド | `<select>` | 判定対象フィールド（DROP_DOWN/RADIO_BUTTON/CHECK_BOX/STATUS） |
| (value) | 値 | `<select>`（動的） | 一致判定する値 |
| `kc-fieldvalue-col-perm` | 権限 | `<select>` | 編集者/閲覧者 |
| `kc-fieldvalue-col-bgcolor` | 背景 | カラーピッカー | 背景色 |
| `kc-fieldvalue-col-textcolor` | 文字 | カラーピッカー | 文字色 |
| (action) | (なし) | 削除ボタン | 行削除 |

行 1 件のデータ形式（`fieldValueRules` 配列要素）:

```json
{
  "fieldCode":  "status_field",
  "fieldType":  "DROP_DOWN",
  "value":      "完了",
  "permission": "view",
  "bgColor":    "#757575",
  "textColor":  "#ffffff"
}
```

- `buildFieldValueRow()` が行 DOM を生成（config.js:1381）
- `collectFieldValueRules()` が DOM から収集（config.js:1557）
- `applyFieldValueRules()` が保存値を DOM に反映（config.js:1595）

#### 権限ユーザー設定テーブル（`kc-permission-table`）

| 列クラス | ヘッダーラベル | 入力種別 | 用途 |
|---|---|---|---|
| `kc-permission-col-handle` | (なし) | ドラッグハンドル | 並び替え用 |
| `kc-permission-col-field` | フィールド | `<select>` | USER_SELECT フィールド |
| `kc-permission-col-perm` | 権限 | `<select>` | 編集者/閲覧者 |
| `kc-permission-col-bgcolor` | 背景 | カラーピッカー | 背景色 |
| `kc-permission-col-textcolor` | 文字 | カラーピッカー | 文字色 |
| (action) | (なし) | 削除ボタン | 行削除 |

行 1 件のデータ形式（`permissionRules` 配列要素）:

```json
{
  "fieldCode":  "担当者",
  "fieldType":  "USER_SELECT",
  "permission": "edit",
  "bgColor":    "#1976d2",
  "textColor":  "#ffffff"
}
```

- `buildPermissionRow()` が行 DOM を生成（config.js:1129）
- `collectPermissionRules()` が DOM から収集（config.js:1271）
- `applyPermissionRules()` が保存値を DOM に反映（config.js:1302）

### 2.2 並び替え（DnD）

`attachRowDragEvents(row, handle)` (config.js:1034) を各行に適用している。ドラッグハンドル要素のみ `draggable="true"`。デフォルト設定エリアはテーブル外の固定 UI のため DnD 対象外とする。

### 2.3 どの行にも一致しない場合の現状フォールバック

`getPermission()` (desktop.js:3662) の非マッチ分岐は以下の 2 箇所でハードコードされている。

| 分岐 | コード箇所 | 現状の戻り値 |
|---|---|---|
| fvRules または permRules 設定あり・全行非マッチ | desktop.js:3701 | `{ canEdit: false, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'user' }` |
| 両配列が空（設定なし） | desktop.js:3705 | `{ canEdit: true, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'fallback' }` |

本機能では **両分岐ともデフォルト設定の適用対象** とする（確定方針 §5）。`enabled: true` の場合は、テーブルが空でも非マッチでも同一のデフォルト設定を返す。

---

## 3. 要件

### 3.1 機能要件

#### FR-1: デフォルト設定 UI の追加（config.html）

権限ユーザー設定テーブルの `+ 行を追加` ボタン（`kc-permission-add-row`）の直後、`</div>` 閉じタグ（`.kc-permission-section` の末尾）の前に、以下のブロックを **静的 HTML** として追加する。

```html
<!-- デフォルト権限設定 (REQ_default-permission) -->
<div class="kc-default-permission-section" id="kc-default-permission-section">
  <h4 class="kc-config-subsection-title kc-default-permission-title">
    デフォルト設定（上のいずれの条件にも一致しない場合）
  </h4>
  <p class="kc-config-hint">
    権限フィールド設定・権限ユーザー設定のどの行にも一致しないレコードに適用します。
    チェックを外すと従来の動作（設定あり非マッチ: 閲覧のみ、設定なし: 全員編集可）を維持します。
  </p>
  <label class="kc-config-checkbox-label">
    <input type="checkbox" id="kc-default-permission-enabled" name="defaultPermissionEnabled" />
    デフォルト設定を使用する
  </label>
  <div class="kc-default-permission-fields" id="kc-default-permission-fields">
    <div class="kc-default-permission-row">
      <div class="kc-default-permission-cell kc-default-permission-col-perm">
        <label class="kc-config-label" for="kc-default-permission-perm">権限</label>
        <select id="kc-default-permission-perm" class="kc-config-select kc-default-perm-select">
          <option value="edit">編集者</option>
          <option value="view" selected>閲覧者</option>
        </select>
      </div>
      <div class="kc-default-permission-cell kc-default-permission-col-bgcolor">
        <label class="kc-config-label">背景色</label>
        <!-- buildDefaultPermissionColorWidgets() で JS から挿入 -->
      </div>
      <div class="kc-default-permission-cell kc-default-permission-col-textcolor">
        <label class="kc-config-label">文字色</label>
        <!-- buildDefaultPermissionColorWidgets() で JS から挿入 -->
      </div>
    </div>
  </div>
</div>
```

**補足**: カラーピッカーウィジェット（プレビューボタン＋パレットポップオーバー＋hidden input 構成）は `buildColorPickerWidget()` (config.js:724) を `init()` 内で呼び出して動的挿入する。色 native input のクラス名は `kc-default-perm-bgcolor` / `kc-default-perm-textcolor` を使用する。

#### FR-2: デフォルト設定の設定項目

| 項目名 | 入力種別 | 要素 ID / クラス名 | 備考 |
|---|---|---|---|
| 有効/無効 | `<input type="checkbox">` | `id="kc-default-permission-enabled"` | オフ時: 以下 3 項目を非活性（disabled） |
| 権限 | `<select>` | `id="kc-default-permission-perm"` クラス `kc-default-perm-select` | 選択肢: 編集者(edit) / 閲覧者(view)。管理者(delete)は対象外 |
| 背景色 | カラーピッカー | native input クラス `kc-default-perm-bgcolor` | `buildColorPickerWidget(initialColor, 'kc-default-perm-bgcolor')` で生成 |
| 文字色 | カラーピッカー | native input クラス `kc-default-perm-textcolor` | `buildColorPickerWidget(initialColor, 'kc-default-perm-textcolor')` で生成 |

**デフォルト値（初期表示・新規インストール時）**:

| 項目 | デフォルト値 | 備考 |
|---|---|---|
| 有効チェックボックス | オフ（`false`） | 既存動作を変えないため |
| 権限 | `view`（閲覧者） | 安全側 |
| 背景色 | `#bdbdbd`（グレー明+1） | `THEME_COLORS` の `['グレー'][1]` |
| 文字色 | `#000000`（黒） | WCAG 輝度から自動判定済みの値 |

#### FR-3: チェックボックスによる活性/非活性制御（config.js）

`id="kc-default-permission-enabled"` の `change` イベントで `id="kc-default-permission-fields"` 配下の select・カラーピッカー内 native input を `disabled` トグルする。初期表示時も `applyDefaultPermission()` 内で同様の制御を行う。

#### FR-4: 保存形式（config JSON）

バージョンを `9 → 10` に更新する。最上位に **1 つのキー** `defaultPermission` を追加する。

```json
{
  "version": 10,
  "fieldMapping": { ... },
  "permissionRules": [ ... ],
  "fieldValueRules": [ ... ],
  "searchTargets": [ ... ],
  "defaultPermission": {
    "enabled":    false,
    "permission": "view",
    "bgColor":    "#bdbdbd",
    "textColor":  "#000000"
  },
  "views": { ... }
}
```

| プロパティ | 型 | 説明 |
|---|---|---|
| `enabled` | `boolean` | `true`: デフォルト設定を適用。`false`: ハードコードフォールバックを維持 |
| `permission` | `'edit'` または `'view'` | 権限種別（管理者 `delete` は当面対象外） |
| `bgColor` | `string` | `'#RRGGBB'` 形式の背景色 |
| `textColor` | `string` | `'#RRGGBB'` 形式の文字色 |

`defaultPermission` が存在しない（v9 以前の設定）場合は `{ enabled: false, permission: 'view', bgColor: '#bdbdbd', textColor: '#000000' }` として扱う（後方互換）。

#### FR-5: v9→v10 マイグレーション（config.js: `loadInitialConfig()`）

`loadInitialConfig()` (config.js:2064) のマイグレーション連鎖に以下を追加する（既存の v8→v9 分岐の直後）。

```javascript
// version 9 → 10 マイグレーション（defaultPermission 追加）
if (Number(parsed.version) < 10) {
  console.log('[KC Config] version 9 → 10 へマイグレーション実行');
  if (!parsed.defaultPermission) {
    parsed.defaultPermission = {
      enabled:    false,
      permission: 'view',
      bgColor:    '#bdbdbd',
      textColor:  '#000000'
    };
  }
  parsed.version = 10;
}
```

`currentConfig` の初期値（config.js:150）に `defaultPermission` を追加する:

```javascript
var currentConfig = {
  version: 10,
  fieldMapping: {},
  permissionRules: [],
  fieldValueRules: [],
  searchTargets: [],
  defaultPermission: {
    enabled:    false,
    permission: 'view',
    bgColor:    '#bdbdbd',
    textColor:  '#000000'
  },
  views: {}
};
```

#### FR-6: 設定画面の読み込み（config.js: 新規関数 `applyDefaultPermission()`）

```javascript
/**
 * 保存済み defaultPermission をデフォルト設定エリアに反映する
 * @param {Object|null} obj - defaultPermission オブジェクト
 */
function applyDefaultPermission(obj) {
  var elEnabled  = document.getElementById('kc-default-permission-enabled');
  var elPerm     = document.getElementById('kc-default-permission-perm');
  var elFields   = document.getElementById('kc-default-permission-fields');
  if (!elEnabled) { return; }

  var enabled = obj && obj.enabled === true;
  elEnabled.checked = enabled;

  if (obj && obj.permission) { elPerm.value = obj.permission; }

  // カラーピッカーの native input を取得して値を反映
  var bgInput   = elFields ? elFields.querySelector('.kc-default-perm-bgcolor')   : null;
  var textInput = elFields ? elFields.querySelector('.kc-default-perm-textcolor') : null;
  if (bgInput   && obj && obj.bgColor)   { bgInput.value   = obj.bgColor;   }
  if (textInput && obj && obj.textColor) { textInput.value = obj.textColor; }

  // 活性/非活性の同期（_syncDefaultPermissionEnabled を呼ぶ）
  _syncDefaultPermissionEnabled(enabled);
}
```

`_syncDefaultPermissionEnabled(enabled)` ヘルパーを別途定義し、`id="kc-default-permission-fields"` 配下の select と native input の `disabled` 属性を `!enabled` でセットする。

`init()` (config.js:2939) の初期化ステップに追加する位置（ステップ 3.6 の `applyFieldValueRules()` 後、ステップ 3.65 の `applySearchTargets()` の前）:

```javascript
// 3.61. デフォルト権限設定をフォームに反映
applyDefaultPermission(currentConfig.defaultPermission || null);

// 3.62. カラーピッカーウィジェットをデフォルト設定エリアに挿入（applyDefaultPermission の前に挿入すること）
```

**注意**: カラーピッカーウィジェットの生成（`buildColorPickerWidget()`）は `applyDefaultPermission()` 呼び出しより前に実行する必要がある。`init()` の冒頭または DOM 参照確立後に以下を実行する:

```javascript
// デフォルト設定エリアにカラーピッカーを挿入
var elDefaultBgCell   = document.querySelector('#kc-default-permission-fields .kc-default-permission-col-bgcolor');
var elDefaultTextCell = document.querySelector('#kc-default-permission-fields .kc-default-permission-col-textcolor');
if (elDefaultBgCell) {
  elDefaultBgCell.appendChild(buildColorPickerWidget('#bdbdbd', 'kc-default-perm-bgcolor'));
}
if (elDefaultTextCell) {
  elDefaultTextCell.appendChild(buildColorPickerWidget('#000000', 'kc-default-perm-textcolor'));
}
```

#### FR-7: 設定画面の収集（config.js: 新規関数 `collectDefaultPermission()`）

```javascript
/**
 * デフォルト設定エリアの DOM から defaultPermission を収集する
 * @returns {{ enabled: boolean, permission: string, bgColor: string, textColor: string }}
 */
function collectDefaultPermission() {
  var elEnabled  = document.getElementById('kc-default-permission-enabled');
  var elPerm     = document.getElementById('kc-default-permission-perm');
  var elFields   = document.getElementById('kc-default-permission-fields');
  var bgInput    = elFields ? elFields.querySelector('.kc-default-perm-bgcolor')   : null;
  var textInput  = elFields ? elFields.querySelector('.kc-default-perm-textcolor') : null;

  return {
    enabled:    elEnabled  ? elEnabled.checked        : false,
    permission: elPerm     ? (elPerm.value || 'view') : 'view',
    bgColor:    bgInput    ? bgInput.value             : '#bdbdbd',
    textColor:  textInput  ? textInput.value           : '#000000'
  };
}
```

`saveConfig()` (config.js:2642) 内で `collectFieldValueRules()` の後に呼び出す:

```javascript
// 現在の行: currentConfig.fieldValueRules = collectFieldValueRules();
currentConfig.defaultPermission = collectDefaultPermission();
```

#### FR-8: 保存オブジェクトへの追加（config.js: `saveConfig()` 内 `finalConfig` 構築箇所）

`finalConfig` の構築（config.js:2785 付近）に `defaultPermission` を追加する:

```javascript
var finalConfig = {
  version: 10,                                              // 9 → 10 に変更
  fieldMapping:       updatedFieldMapping,
  permissionRules:    currentConfig.permissionRules    || [],
  fieldValueRules:    currentConfig.fieldValueRules    || [],
  searchTargets:      currentConfig.searchTargets      || [],
  defaultPermission:  currentConfig.defaultPermission  || {
    enabled: false, permission: 'view', bgColor: '#bdbdbd', textColor: '#000000'
  },
  views:              mergedViews
};
```

#### FR-9: desktop.js: Config への読み込み（`loadFromPluginConfig()`）

`loadFromPluginConfig()` (desktop.js:212) に以下を追加する（`KC.Config.SEARCH_TARGETS` のセット直後）:

```javascript
// デフォルト権限設定 (version 10 以降)
KC.Config.DEFAULT_PERMISSION = config.defaultPermission || null;
```

`KC.Config.DEFAULT_PERMISSION` の初期値（定義箇所: desktop.js:350 付近の KC.Config 初期値群）:

```javascript
/**
 * デフォルト権限設定 (REQ_default-permission)
 * loadFromPluginConfig で上書きされる。null = ハードコードフォールバックを維持
 * @type {{ enabled: boolean, permission: string, bgColor: string, textColor: string }|null}
 */
KC.Config.DEFAULT_PERMISSION = null;
```

#### FR-10: desktop.js: `getPermission()` の変更

`getPermission()` (desktop.js:3662) を以下のロジックに修正する。変更箇所は 3701 と 3705 の 2 行のみ。

**変更前** (desktop.js:3700–3705):

```javascript
// 設定あり・非マッチ: view 相当・色なし
return { canEdit: false, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'user' };
```

```javascript
// 3. 両配列空: フォールバック（全員 edit）
return { canEdit: true, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'fallback' };
```

**変更後** (3701 と 3705 をそれぞれ以下のヘルパー呼び出しで置換):

```javascript
// 3701 の置換: 設定あり・非マッチ
return _applyDefaultPermissionOrFallback(false);

// 3705 の置換: 両配列空（設定なし）
return _applyDefaultPermissionOrFallback(true);
```

ヘルパー関数 `_applyDefaultPermissionOrFallback()` を `getPermission()` の直前に定義する:

```javascript
/**
 * デフォルト設定が有効な場合はその値を返し、無効な場合はハードコードフォールバックを返す
 * @param {boolean} isFallbackCase - true: 両配列空（全員 edit ケース）/ false: 設定あり非マッチ
 * @returns {{ canEdit, canDelete, canOpenDialog, bgColor, textColor, source }}
 */
function _applyDefaultPermissionOrFallback(isFallbackCase) {
  var def = KC.Config.DEFAULT_PERMISSION;
  if (def && def.enabled === true) {
    return {
      canEdit:       _permLevel(def.permission) >= 2,
      canDelete:     false,
      canOpenDialog: true,
      bgColor:       def.bgColor   || null,
      textColor:     def.textColor || null,
      source:        'default'
    };
  }
  // enabled でない場合は従来のハードコードフォールバックを維持
  if (isFallbackCase) {
    // 両配列空: 全員 edit（従来の source: 'fallback' 動作）
    return { canEdit: true, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'fallback' };
  }
  // 設定あり非マッチ: 閲覧のみ・色なし（従来の source: 'user' 動作）
  return { canEdit: false, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'user' };
}
```

**`_buildCachedFieldList()` (desktop.js:434) への影響**: `DEFAULT_PERMISSION` はフィールドコードを持たないため、フィールドリストへの追加は不要。

### 3.2 非機能要件

#### NF-1: 後方互換

- v9 以前の設定は `loadInitialConfig()` の v9→v10 マイグレーションで `enabled: false` を自動付与する。動作変更なし。
- `DEFAULT_PERMISSION` が `null` または `enabled: false` の場合、`getPermission()` は現状と完全に同じ値を返す。

#### NF-2: 既存機能の無変更

- `fieldValueRules` / `permissionRules` テーブルの行追加・削除・並び替え DnD には影響を与えない。
- `collectPermissionRules()` / `collectFieldValueRules()` / `buildPermissionRow()` / `buildFieldValueRow()` の既存実装は変更しない。
- 色ピッカーウィジェット（`buildColorPickerWidget()`）はそのまま再利用する。

#### NF-3: UI 配置

- デフォルト設定エリアは `plugin/src/html/config.html` に静的 HTML として記述する（JS 動的生成禁止）。カラーピッカーウィジェット部分のみ `init()` で動的挿入する。
- 配置位置: `.kc-permission-section` 末尾（`kc-permission-add-row` の直後）、`.kc-view-edit-panel` 閉じタグの前。

---

## 4. 受入基準

| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | 権限フィールド設定に 1 行以上あり、デフォルト設定 enabled:true | レコードがいずれの行にもマッチしない | デフォルト設定の permission・bgColor が適用される |
| AC-2 | AC-1 の設定 | チェックボックスをオフにして保存 | 非マッチレコードは「閲覧のみ・色なし」（旧動作）に戻る |
| AC-3 | デフォルト設定: permission=edit、bgColor=#1976d2、enabled:true | 非マッチレコードを DnD 操作 | DnD 可能（canEdit: true）|
| AC-4 | デフォルト設定: permission=view、bgColor=#757575、enabled:true | 非マッチレコードを DnD 操作 | DnD 不可（canEdit: false）、ポインターカーソル |
| AC-5 | デフォルト設定: bgColor=#bdbdbd、textColor=#000000、enabled:true | 非マッチレコードがカレンダーに表示される | イベントチップ・バーがその色で表示される |
| AC-6 | v9 形式の既存設定（defaultPermission なし）でプラグイン設定を開く | — | エラーなく開き、チェックボックスオフ・非活性で表示される |
| AC-7 | フィールド値ルールにマッチするレコード、デフォルト設定 enabled:true | — | デフォルト設定ではなくマッチしたルールの設定が適用される |
| AC-8 | 権限ユーザー設定が空（0 行）、デフォルト設定 enabled:true | — | デフォルト設定が適用される（全員 edit の旧動作は適用されない） |
| AC-9 | デフォルト設定の値を変更して保存後、再度設定画面を開く | — | 変更した権限・色・チェック状態が正しく復元されている |
| AC-10 | フィールド値ルール非マッチ、ユーザー権限ルールにマッチ、デフォルト設定 enabled:true | — | ユーザー権限ルールのマッチ結果が適用され、デフォルトは使われない |

---

## 5. 検証項目・テストシナリオ

### 5.1 設定画面の動作確認

1. 設定画面を開き、権限ユーザー設定テーブルの `+ 行を追加` ボタン直下に「デフォルト設定（上のいずれの条件にも一致しない場合）」エリアが表示されること（ブロック 1 つのみ）
2. チェックボックスをオフにすると権限 select・色ピッカーが非活性になること
3. チェックボックスをオンにすると活性化すること
4. 色ピッカーが正常に開閉し、選択色がプレビューボタンに反映されること
5. 「保存」後に設定画面を再度開くと変更値（チェック状態・権限・色）が復元されていること

### 5.2 カレンダー表示の動作確認

1. **デフォルト設定（編集者・青）+ 権限フィールド設定 1 行（値 A = 閲覧者・赤）**
   - 値 A を持つレコード → 赤・閲覧のみ
   - それ以外のレコード → 青・編集可（DnD 可能）
2. **デフォルト設定（閲覧者・グレー）+ 権限ユーザー設定 1 行（担当者 = 編集者・緑）**
   - ログインユーザーが担当者に含まれるレコード → 緑・編集可
   - 含まれないレコード → グレー・閲覧のみ（DnD 不可）
3. **フィールド値ルールにマッチ + デフォルト設定有効** → フィールド値ルールが優先されること
4. **両テーブルが空 + デフォルト設定有効** → デフォルト設定が適用されること（全員 edit の旧動作が起きないこと）
5. **v9 形式 config** → エラーなく表示され、非マッチ時に旧動作（閲覧のみ・色なし）が継続すること

### 5.3 実機検証手順

1. `plugin/` 配下を修正後、`plugin.zip` をビルドして kintone 開発環境にアップロード
2. プラグイン設定画面を開き、デフォルト設定エリアが権限ユーザー設定テーブルの下に表示されることを確認
3. チェックボックスをオンにし、権限=編集者・背景=#1976d2・文字=#ffffff に設定して「保存」
4. カレンダービューを開き、非マッチレコードが指定色で表示され DnD 可能なことを確認
5. 設定画面に戻り、チェックボックスをオフにして「保存」 → 非マッチレコードが色なし・DnD 不可になることを確認
6. v9 形式の config（`defaultPermission` なし）を手動で `setConfig` して動作が変わらないことを確認（後方互換テスト）

---

## 6. 想定 UX / シーケンス

### 6.1 UI 配置イメージ（config.html 内の順序）

```
[ 権限フィールド設定 ]
  ┌────────────────────────────────────────────────┐
  │  フィールド | 値 | 権限 | 背景 | 文字 | [削除]   │
  ├────────────────────────────────────────────────┤
  │  ステータス | 完了 | 閲覧 | ■ | ■ | [−]       │
  └────────────────────────────────────────────────┘
  [ + 行を追加 ]         ← kc-fieldvalue-add-row（変更なし）

[ 権限ユーザー設定 ]
  ┌────────────────────────────────────────────────┐
  │  フィールド | 権限 | 背景 | 文字 | [削除]       │
  ├────────────────────────────────────────────────┤
  │  担当者 | 編集者 | ■ | ■ | [−]               │
  └────────────────────────────────────────────────┘
  [ + 行を追加 ]         ← kc-permission-add-row（変更なし）

┌──────────────────────────────────────────────────┐
│ デフォルト設定（上のいずれの条件にも一致しない場合） │ ← 新規追加エリア（1ブロック）
│ ヒント: どのルールにもマッチしないレコードに適用    │
│ ☐ デフォルト設定を使用する                        │
│   権限: [ 閲覧者 ▼ ]  背景: [■]  文字: [■]     │
└──────────────────────────────────────────────────┘
```

### 6.2 getPermission() の新フローシーケンス（確定版）

```
getPermission(evt) 呼び出し
  ↓
[1] fieldValueRules を上から走査
    → マッチ: そのルールの権限・色を返す（source: 'field'）
    → 全行マッチなし: 次へ
  ↓
[2] permRules.length > 0 の場合
    → 最高権限マッチを採用: 返す（source: 'user'）
    → マッチなし: 次へ
  ↓
[3] _applyDefaultPermissionOrFallback(false) を呼ぶ
      ├── DEFAULT_PERMISSION.enabled === true
      │     → デフォルト設定の権限・色を返す（source: 'default'）
      └── enabled でない
            → 旧動作: view 相当・色なし（source: 'user'）

  ※ [2] に入らなかった場合（permRules が空）:
    _applyDefaultPermissionOrFallback(true) を呼ぶ
      ├── DEFAULT_PERMISSION.enabled === true
      │     → デフォルト設定の権限・色を返す（source: 'default'）
      └── enabled でない
            → 旧動作: 全員 edit・色なし（source: 'fallback'）
```

---

## 7. 確定事項（旧未解決事項）

| ID | 内容 | 確定内容 |
|---|---|---|
| U-1 | デフォルト設定 UI に「条件列」を含めるか | **含めない**。設定項目は有効チェックボックス・権限・背景色・文字色の 4 項目のみ |
| U-2 | キーを 2 つ（テーブル別）に分けるか 1 つにまとめるか | **1 キー** `defaultPermission`。両テーブルを通じた単一のデフォルト設定とする |
| U-3 | 「両テーブルが共に 0 行」の状態でデフォルト設定を適用するか | **適用する**。`enabled: true` の場合は空テーブルでも非マッチでも同一のデフォルト設定を返す |
| U-4 | 管理者（delete）権限をデフォルト設定に含めるか | **含めない**（当面。将来対応） |

### リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | `enabled: true` 時に「両テーブル空 → デフォルト適用」となり、従来の「全員 edit」が消える | ヒントテキストで「チェックを外すと従来の動作（設定なし: 全員編集可）を維持します」と明示する |
| R-2 | `KC.Filter.apply()` の `'mine'`/`'others'` フィルタが bgColor で判定（desktop.js:7621–7629）。デフォルト設定で bgColor を設定すると非マッチレコードが `'mine'` 扱いになる | 意図した動作。bgColor を透明にしたい場合は色なし（カスタムカラー `#ffffff` 等）を選択するよう案内する |
| R-3 | v9 設定でプラグインを開くとマイグレーションが走り、保存せずに離脱しても問題ない（`loadInitialConfig` は `currentConfig` メモリ更新のみ） | `setConfig` は保存ボタン押下時のみ呼ばれるため動作変更は保存時のみ。既存設定は保護される |

### 前提

- プラグイン形式（`plugin/` 配下）のみを対象とする。`src/kc-calendar.js` は対象外（MEMORY.md 参照: src 版は未使用）。
- 「管理者（delete）権限」のデフォルト設定への追加は将来対応とし、本要件の範囲外とする。
- `plugin.zip` のビルド・アップロード手順は `DEPLOY_GUIDE.md` に準拠する。

---

## 8. builder 申し送り（変更指示）

### 変更ファイル一覧

| ファイル | 変更種別 | 主な内容 |
|---|---|---|
| `plugin/src/html/config.html` | 追記 | デフォルト設定エリアの静的 HTML を追加 |
| `plugin/src/js/config.js` | 追記・一部変更 | 新規関数追加・`loadInitialConfig()` / `saveConfig()` / `init()` を修正 |
| `plugin/src/js/desktop.js` | 追記・一部変更 | `loadFromPluginConfig()` に読み込み追加・`getPermission()` を修正 |
| `plugin/src/css/config.css` | 追記 | デフォルト設定エリアのスタイル追加 |

### config.html の変更

- **追加位置**: `kc-permission-add-row` の `</div>` 直後（`.kc-permission-section` の末尾）
- **追加内容**: FR-1 に記載の静的 HTML ブロック（`id="kc-default-permission-section"`）
- **既存 HTML への変更なし**

### config.js の変更

**新規追加関数**（既存関数は一切変更しない）:

| 関数名 | 役割 |
|---|---|
| `applyDefaultPermission(obj)` | 保存済み defaultPermission を DOM に反映。FR-6 参照 |
| `collectDefaultPermission()` | DOM から defaultPermission を収集。FR-7 参照 |
| `_syncDefaultPermissionEnabled(enabled)` | チェックボックス連動で inputs を disabled/enabled。FR-3 参照 |

**既存関数内への追記**:

| 関数 | 箇所 | 変更内容 |
|---|---|---|
| `var currentConfig = {...}` (config.js:150) | 初期値オブジェクト | `defaultPermission: { enabled: false, ... }` を追加 |
| `loadInitialConfig()` (config.js:2064) | v8→v9 マイグレーション分岐の直後 | v9→v10 マイグレーション分岐を追加（FR-5） |
| `loadInitialConfig()` (config.js:2163) | `currentConfig =` の構築 | `defaultPermission: parsed.defaultPermission` を追加 |
| `saveConfig()` (config.js:2642) | `currentConfig.fieldValueRules =` の直後 | `currentConfig.defaultPermission = collectDefaultPermission();` を追加 |
| `saveConfig()` (config.js:2785) | `finalConfig =` の構築 | `version: 10`・`defaultPermission: currentConfig.defaultPermission || {...}` を追加 |
| `init()` (config.js:2939) | ステップ 3.6 の `applyFieldValueRules()` 直後 | カラーピッカー挿入 + `applyDefaultPermission()` 呼び出し + チェックボックス change イベント登録を追加 |

### desktop.js の変更

**`loadFromPluginConfig()` (desktop.js:212) への追記**:

`KC.Config.SEARCH_TARGETS = ...` の直後に以下を追加する:

```javascript
KC.Config.DEFAULT_PERMISSION = config.defaultPermission || null;
```

**KC.Config 初期値（desktop.js:350 付近）への追記**:

```javascript
KC.Config.DEFAULT_PERMISSION = null;
```

**`getPermission()` (desktop.js:3662) への変更**:

1. `getPermission()` の直前に `_applyDefaultPermissionOrFallback(isFallbackCase)` ヘルパーを定義する（FR-10 参照）
2. desktop.js:3701 の return 文を `return _applyDefaultPermissionOrFallback(false);` に置換
3. desktop.js:3705 の return 文を `return _applyDefaultPermissionOrFallback(true);` に置換

### config.css の変更

デフォルト設定エリアに以下のスタイルを追加する:

- `.kc-default-permission-section`: 上マージン・ボーダー上線（テーブルとの区切り）・パディング
- `.kc-default-permission-title`: 小見出しフォントサイズ
- `.kc-default-permission-row`: フレックスレイアウト（権限・背景・文字を横並び）
- `.kc-default-permission-fields[disabled相当]`: チェックボックスオフ時の薄い不透明度（`opacity: 0.5`）

---

## 付録: 参照コード箇所一覧

| 機能 | ファイル | 行番号（概算） |
|---|---|---|
| 権限フィールド設定テーブル HTML | plugin/src/html/config.html | 343–368 |
| 権限ユーザー設定テーブル HTML | plugin/src/html/config.html | 373–400 |
| `buildFieldValueRow()` | plugin/src/js/config.js | 1381 |
| `collectFieldValueRules()` | plugin/src/js/config.js | 1557 |
| `applyFieldValueRules()` | plugin/src/js/config.js | 1595 |
| `buildPermissionRow()` | plugin/src/js/config.js | 1129 |
| `collectPermissionRules()` | plugin/src/js/config.js | 1271 |
| `applyPermissionRules()` | plugin/src/js/config.js | 1302 |
| `buildColorPickerWidget()` | plugin/src/js/config.js | 724 |
| `currentConfig` 初期値 | plugin/src/js/config.js | 150 |
| `loadInitialConfig()` | plugin/src/js/config.js | 2064 |
| `saveConfig()` の fieldValueRules 収集箇所 | plugin/src/js/config.js | 2670 |
| `saveConfig()` の finalConfig 構築 | plugin/src/js/config.js | 2785 |
| `init()` | plugin/src/js/config.js | 2939 |
| `loadFromPluginConfig()` | plugin/src/js/desktop.js | 212–341 |
| `KC.Config.SEARCH_TARGETS` セット箇所 | plugin/src/js/desktop.js | 310 |
| KC.Config 初期値群 | plugin/src/js/desktop.js | 344–366 |
| `getPermission()` | plugin/src/js/desktop.js | 3662–3706 |
| 現状フォールバック行（非マッチ） | plugin/src/js/desktop.js | 3701 |
| 現状フォールバック行（両配列空） | plugin/src/js/desktop.js | 3705 |
| `KC.Filter.apply()` | plugin/src/js/desktop.js | 7621 |
