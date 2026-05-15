# 要件定義書: 編集権限設定機能の拡張

**文書番号**: REQ_edit-permission-extension
**作成日**: 2026-05-15
**最終更新日**: 2026-05-15 (第 3 版: USER_SELECT のみに縮小)
**作成者**: designer (サブエージェント)
**ステータス**: 確定 (2026-05-15 ユーザー判断により §9 全項目確定)
**関連文書**: REQ_plugin-migration.md, plugin/src/js/desktop.js, plugin/src/js/config.js, plugin/src/html/config.html

---

**v2 (2026-05-15)**: §9 全未確定事項をユーザー判断で確定し、§3〜§8 を具体化。
**v3 (2026-05-15)**: 組織・グループ選択フィールド対応を削除。USER_SELECT のみに縮小（別カスタマイズで組織所属ユーザーをユーザーフィールドに書き出す運用に変更したため）。
**v3.1 (2026-05-15)**: ダイアログ表示の権限ガードを撤廃（別カスタマイズで制御）。PERMISSION_FIELD_TYPES の定数化要件を削除し実装のインライン比較を正とする。
**v3.2 (2026-05-15)**: 保存ボタン制御の責任分担を明示（kintone 標準のアクセス権側で制御。JS は DnD のみガード）。

---

## 1. 概要・背景

### 1.1 背景

KC Calendar プラグインは、カレンダーイベントの DnD 移動・リサイズ・ダイアログ操作 (新規作成 / 削除) を「自分の予定か否か」で制限する仕組みを持つ。現状の判定ロジック (`KC.LoginContext.isMine`) は `USER_SELECT` 型フィールド 1 つのみを参照し、ログインユーザーのユーザーコードと完全一致する場合のみ「自分の予定 = 編集可」と判定する。

この設計では以下の運用ニーズに対応できない。

- 組織単位またはグループ単位で編集可能なユーザーを管理したい
- 複数のフィールド (担当者フィールド + 関係者フィールド等) のどちらかに含まれていれば編集できるようにしたい
- 「閲覧のみ」「編集可」「削除可」のような権限粒度を設定項目として明示し、ユーザーに意図を明確化したい

### 1.2 目的

1. 対応フィールドを `USER_SELECT` 型の複数フィールドへ拡張する（組織・グループ対応は別カスタマイズで USER_SELECT に書き出す運用とする）
2. 複数フィールドを組み合わせて権限判定できるようにする
3. フィールドごとに権限の種類 (閲覧のみ / 編集可 / 削除可) を設定できるようにする
4. 上記をプラグイン設定画面の GUI として提供し、管理者がコードを変更せずに制御できるようにする

---

## 2. 現状 (既存実装の仕様まとめ)

### 2.1 権限判定ロジック

- **実装箇所**: `plugin/src/js/desktop.js` (および `src/kc-calendar.js`) 内の `KC.LoginContext` モジュール
- **判定関数**: `KC.LoginContext.isMine(evt)`
  - `kintone.getLoginUser().code` と `evt.account` を文字列比較する
  - `evt.account` は `KcEvent` オブジェクトの account プロパティ (ユーザーコード文字列)
  - `account` フィールドが空の場合は無条件で `false` (他人扱い)
- **参照フィールド**: `KC.Config.FIELD.account` (`USER_SELECT` 型 1 フィールド固定)
  - レコード取得時: `(rec[F.account].value || [])[0]?.code` で先頭ユーザーのコードのみ取得 (`desktop.js:425`)
  - 複数ユーザーが選択されていても先頭 1 名のみ参照する

### 2.2 isMine が判定を制御する操作

以下の操作で `KC.LoginContext.isMine(evt)` が `false` の場合は操作を無効化している。

| 操作 | 箇所 (desktop.js 相当行) |
|---|---|
| 終日バーの左右リサイズハンドル (週ビュー) | `startResizeAllday` へのイベント配線 |
| 終日バーの DnD 移動 (週ビュー) | `startMoveAllday` へのイベント配線 |
| 時間帯イベントの左右リサイズハンドル (週ビュー) | `startResize` へのイベント配線 |
| 時間帯イベントの DnD 移動 (週ビュー) | `startMove` へのイベント配線 |
| 月ビューの終日バー左右リサイズ | `startResizeAlldayMonth` へのイベント配線 |
| 月ビューの終日バー DnD 移動 | `startMoveAlldayMonth` へのイベント配線 |
| 月ビューの chip DnD 移動 | `startMoveMonthChip` へのイベント配線 |

なお、「クリックして kintone 標準編集ポップアップを開く」操作 (`KC.Popup.openEdit`) は `isMine` による制限を受けていない (全ユーザーがクリックできる)。実際の編集可否は kintone のフィールド権限・レコード権限に委ねている。

### 2.3 設定画面での現状 UI

- **config.html セクション 1 (共通設定)** に「アカウントフィールド」プルダウン (`id="kc-field-account"`) が 1 つ存在する
- 選択できる型は `USER_SELECT` のみ (`config.js:59` `ACCOUNT_FIELD_TYPES = ['USER_SELECT']`)
- 権限の種別設定 UI は現状存在しない
- 設定画面での「編集権限」という明示的な UI 区画はなく、「アカウントフィールド」という汎用的な名称で提供されている

### 2.4 プラグイン設定 JSON の現状スキーマ (version 2)

```json
{
  "version": 2,
  "fieldMapping": {
    "fieldTitle": "予定タイトル",
    "fieldStart": "開始日時",
    "fieldEnd": "終了日時",
    "fieldAllday": "",
    "fieldColor": "",
    "fieldPlace": "",
    "fieldUserMail": "",
    "fieldAccount": "アカウント",
    "fieldMemo": "",
    "alldayLabel": "終日"
  },
  "views": {
    "<viewId>": {
      "calendarTitle": "カレンダー",
      "defaultView": "month"
    }
  }
}
```

`fieldAccount` が単一文字列でユーザー選択フィールドコードを保持している。

---

## 3. 要件

### 3.1 機能要件

#### FR-1: 対応フィールド種別

- 編集権限の参照対象として `USER_SELECT` 型フィールドを選択できるようにする
- 判定方法: ログインユーザーのコード (`kintone.getLoginUser().code`) がフィールドの `value[].code` に含まれるか

#### FR-2: 複数フィールドの選択

- 1 つのアプリで複数の `USER_SELECT` フィールドを「編集権限フィールド」として登録できるようにする
- 各フィールドエントリは独立して「フィールドコード + 権限種別」のペアを保持する
- エントリ数の上限は設けない（§9 Q1 確定）

#### FR-3: 権限種別の設定

- 各フィールドエントリに対して権限種別を設定できるようにする
- **権限種別は 3 段階: `view`（閲覧のみ）/ `edit`（編集可）/ `delete`（削除可）**
  - 段階的包含: `delete` ⊇ `edit` ⊇ `view`（削除可は編集と閲覧も含意、編集可は閲覧も含意）
  - この 3 段階は kintone 標準のレコード権限粒度と整合する
- **複数フィールドのマージ規則は OR 結合（最高権限採用）**
  - 複数エントリのうちどれか 1 つでも該当すれば、該当したエントリの権限を付与する
  - 複数エントリに該当する場合は、最も高い権限（`delete` > `edit` > `view`）を最終権限とする

#### FR-4: 設定なし時のフォールバック

- `permissionRules` が空配列の場合、**全員を `edit` 権限（編集可）として扱う**
  - これは既存の `fieldAccount` 未設定時の挙動（全員 DnD 操作可）と後方互換
- 既存の `fieldAccount` 設定の扱いについては §8 参照

#### FR-5: 権限種別ごとの操作制御

権限判定の結果に基づき、以下の操作を制御する。

**ダイアログ表示（openEdit）は権限に関わらず全ユーザーが開くことができる**（マッチなしを含む）。ダイアログ内の保存ボタンの活性／非活性、および DnD・削除の可否のみを権限で制御する。ダイアログ表示自体の細かい権限制御は別カスタマイズで行う前提のため、本実装では行わない。

| 権限 | DnD 移動・リサイズ | ダイアログ表示 (openEdit) | 保存ボタン | 削除操作 |
|---|---|---|---|---|
| マッチなし | 不可 | 可（閲覧モード） | 非活性 | 不可 |
| 閲覧のみ (view) | 不可 | 可（閲覧モード） | 非活性 | 不可 |
| 編集可 (edit) | 可 | 可 | 活性 | 不可 |
| 削除可 (delete) | 可 | 可 | 活性 | 可 |

> 注1: 「マッチなし」とは `permissionRules` に設定が存在するが、ログインユーザーがいずれのルールにも該当しない状態。`permissionRules` が空配列の場合は §5.4 のフォールバック（全員 `edit`）が適用されるため、マッチなしとは区別する。
> 注2: 「削除操作」のカレンダー UI への追加は Phase 2 対応（§9 Q6 確定）。初期実装では `canDelete` フラグを算出するのみとし、削除 UI は実装しない。
> 注3: 保存ボタンの非活性化は **kintone 標準のレコード権限・フィールド権限** で制御する。JS カスタマイズ側で `disabled` 属性を付与する実装は行わない（kintone UI 更新時にセレクタが壊れるリスクがあるため）。

### 3.2 非機能要件

#### NF-1: API コール数の上限

- ログインユーザーのコードは `kintone.getLoginUser()` で取得する（追加 API 不要）
- 権限判定はすべてメモリ内で完結し、カレンダー描画ごとに追加 API を呼び出さない

#### NF-2: パフォーマンス

- 権限判定はメモリ内判定のみとし、追加 API コールを発生させない
- `kintone.getLoginUser()` は既存の `KC.LoginContext.init()` で取得済みであり、追加コストなし

#### NF-3: 後方互換性

- 既存の `fieldAccount` 設定は拡張後も動作を維持する (移行規則は §8 参照)
- version 2 の設定スキーマを version 3 に変更し、version 2 以下の設定は移行ロジックで補完する

---

## 4. 設定画面 UI 仕様

### 4.1 変更方針

`plugin/src/html/config.html` のセクション 1 (共通設定) に「編集権限設定」サブセクションを追加する。既存の「アカウントフィールド」プルダウンを廃止し (または「編集権限設定」へ統合し)、新しい複数行 UI に置き換える。

### 4.2 編集権限設定 UI (複数行)

```
【編集権限設定】
┌─────────────────────────────────────────────────────────────┐
│ フィールド         権限種別          操作                    │
│ [──フィールド選択─▼] [──権限選択──▼] [削除 −]               │
│ [──フィールド選択─▼] [──権限選択──▼] [削除 −]               │
│ [+ 行を追加]                                                  │
└─────────────────────────────────────────────────────────────┘
ヒント: フィールド未設定（0 行）の場合は全員編集可（§9 Q4 確定）
```

#### 各行の構成要素

1. **フィールドプルダウン** (`<select>`)
   - `GET /k/v1/app/form/fields` の結果から `USER_SELECT` 型のフィールドを抽出して表示
   - 先頭オプションは「-- フィールドを選択 --」(空値)
   - フィールドコードの右にフィールド名を表示 (例: `アカウント (アカウント)`)
2. **権限種別プルダウン** (`<select>`)
   - 選択肢: 「閲覧のみ（view）」「編集可（edit）」「削除可（delete）」の 3 選択肢（§9 Q2 確定）
3. **削除ボタン** (−)
   - 当該行を削除する
   - 最後の 1 行でも削除可能 (0 行 = 設定なしとする)

#### 行追加ボタン

- 「+ 行を追加」ボタン押下で新規行を末尾に追加する
- 追加行は初期値「フィールド未選択 / 権限未選択」

### 4.3 フィールドプルダウンの型フィルタ定義

権限フィールドの絞り込みは `USER_SELECT` 型の直接比較で実装する（`field.type === 'USER_SELECT'`）。`PERMISSION_FIELD_TYPES` のような定数は定義しない。

`config.js` の `filterFields()` 呼び出し時も、`USER_SELECT` 型を直接指定して選択肢を生成する。

### 4.4 既存「アカウントフィールド」との関係

既存の `id="kc-field-account"` プルダウンは**残置し「視覚的ハイライト用フィールド」として独立保持する**（§8.3 参照）。
設定 UI 上では「アカウントフィールド（自分の予定のハイライト用）」として引き続き表示し、編集権限判定には使用しない。

---

## 5. 権限判定ロジック仕様

### 5.1 ログインユーザー情報の取得

`KC.LoginContext.init()` で `kintone.getLoginUser()` を呼び出す (既存動作)。

取得できる主なフィールド:

| フィールド | 説明 |
|---|---|
| `code` | ユーザーコード (ログイン名) |
| `id` | ユーザー ID (数値) |
| `name` | 表示名 |

ユーザーコードはメモリ内にキャッシュし、権限判定のたびに再取得しない。追加 API 呼び出しは不要。

### 5.2 個別フィールドの権限判定

権限設定リスト (`permissionRules`) の各エントリに対して以下を評価する。すべてのエントリは `USER_SELECT` 型であり、追加 API 呼び出しなしでメモリ内判定が完結する。

```
function evalPermissionEntry(entry, record, userCode):
  field = entry.fieldCode
  permission = entry.permission  // 'view' / 'edit' / 'delete'

  matched = record[field].value の code に userCode が含まれるか

  if matched:
    return permission  // 'view' / 'edit' / 'delete'
  return null  // 非該当
```

### 5.3 複数フィールドのマージ規則

**OR 結合（確定）**: 複数フィールドのいずれかで権限が認められれば、その中で最も高い権限を適用する。

権限の強さ（順序）: `delete` > `edit` > `view` > `none`

```
// 擬似コード: OR 結合 + 段階的包含判定

function resolvePermission(permissionRules, record, userCode):
  best = 'none'

  for each entry in permissionRules:
    granted = evalPermissionEntry(entry, record, userCode)
    // granted は 'view' / 'edit' / 'delete' / null

    if permissionLevel(granted) > permissionLevel(best):
      best = granted

  return best

// 段階的包含 (delete ⊇ edit ⊇ view)
function canEdit(permission):
  return permission === 'edit' || permission === 'delete'

function canDelete(permission):
  return permission === 'delete'

// 使用例:
//   ルール A で 'edit' 一致、ルール B で 'view' 一致 → best = 'edit'
//   → canEdit = true, canDelete = false
```

### 5.4 設定なし時のフォールバック

`permissionRules` が空配列の場合は **全員 `edit` 権限を返す**（DnD 移動・リサイズ操作を全員に許可）。

これは既存 `fieldAccount` 未設定時の挙動（`isMine` が常に `true` 相当）と後方互換する。

### 5.5 既存 isMine との関係

`KC.LoginContext.isMine(evt)` を拡張した `KC.LoginContext.getPermission(evt, record)` に置き換える。

```
getPermission(evt, record):
  最終権限 = §5.3 のマージ結果
  return {
    canEdit:  最終権限 === 'edit' || 最終権限 === 'delete',
    canDelete: 最終権限 === 'delete',
    canOpenDialog: true  // 権限に関わらず常に true（ダイアログは誰でも開ける）
  }
```

既存の `if (!KC.LoginContext.isMine(evt)) return;` の呼び出し箇所を `if (!KC.LoginContext.getPermission(evt, record).canEdit) return;` に置き換える。

ダイアログを開く処理（`KC.Popup.openEdit`）への権限ガードは追加しない。ダイアログ内の保存ボタンは `canEdit` が `false` の場合に非活性（disabled）として表示する。

### 5.6 マッチなし時の扱い

`resolvePermission` がマッチなし（`best === 'none'`）を返した場合、`getPermission` は以下を返す。

```
{ canEdit: false, canDelete: false, canOpenDialog: true }
```

すなわち、`permissionRules` に設定が存在するがログインユーザーがいずれにも該当しない場合は、`view` 相当として扱う（DnD 不可・保存ボタン非活性・ダイアログ表示は可）。`permissionRules` が空配列の場合は §5.4 のフォールバック（全員 `edit`）が適用されるため、マッチなし扱いにはならない。

### §5.7 保存ボタン制御の責任分担

ダイアログ内の保存ボタンの活性／非活性制御は本 JS カスタマイズの責任範囲外とする。以下のいずれかの方法で kintone 側の権限設定で制御する想定:

- レコード単位の編集権限（アプリ設定 > アクセス権 > レコード）
- フィールド単位の編集権限（アプリ設定 > アクセス権 > フィールド）
- 別カスタマイズによる `app.record.edit.show` イベントでの DOM 制御

本カスタマイズで提供する `getPermission(evt).canEdit` は DnD・リサイズの制御にのみ使用する。

---

## 6. データ構造

### 6.1 プラグイン設定 JSON スキーマ (version 3)

```json
{
  "version": 3,
  "fieldMapping": {
    "fieldTitle": "string",
    "fieldStart": "string",
    "fieldEnd": "string",
    "fieldAllday": "string",
    "fieldColor": "string",
    "fieldPlace": "string",
    "fieldUserMail": "string",
    "fieldAccount": "string",
    "fieldMemo": "string",
    "alldayLabel": "string"
  },
  "permissionRules": [
    {
      "fieldCode": "string",
      "fieldType": "USER_SELECT",
      "permission": "view | edit | delete"
    }
  ],
  "views": {
    "<viewId>": {
      "calendarTitle": "string",
      "defaultView": "month | week | day"
    }
  }
}
```

**変更点**: `fieldMapping.fieldAccount` は視覚的ハイライト用途として `fieldMapping` 内に残置する。`permissionRules` 配列を新設し、編集権限判定はこちらで管理する（§8.3 参照）。

#### JSON スキーマ例（実際の設定値）

```json
{
  "version": 3,
  "fieldMapping": {
    "fieldTitle": "予定タイトル",
    "fieldStart": "開始日時",
    "fieldEnd": "終了日時",
    "fieldAllday": "",
    "fieldColor": "",
    "fieldPlace": "",
    "fieldUserMail": "",
    "fieldAccount": "アカウント",
    "fieldMemo": "",
    "alldayLabel": "終日"
  },
  "permissionRules": [
    { "fieldCode": "担当者", "fieldType": "USER_SELECT", "permission": "edit" },
    { "fieldCode": "閲覧者", "fieldType": "USER_SELECT", "permission": "view" }
  ],
  "views": {
    "1234567": {
      "calendarTitle": "カレンダー",
      "defaultView": "month"
    }
  }
}
```

- `permissionRules` が空配列 (`[]`) のとき → 全員 `edit` 権限（フォールバック）
- `permissionRules` に複数エントリがあるとき → OR 結合で最高権限を採用（§5.4）

### 6.2 KcEvent オブジェクトへの影響

現状 `evt.account` に先頭ユーザーコード 1 つのみを保持しているが、権限判定には元レコード (`record`) の全フィールド値が必要になる。

**採用方針（§9 Q8 確定）**: `KcEvent` に `permissionFields: { [fieldCode]: string[] }` プロパティを追加し、レコード取得時に権限対象 `USER_SELECT` フィールドの `value[].code` をすべて格納する。

- 権限判定は `evt.permissionFields` を参照することで追加 API 呼び出しを不要とする（すべて `USER_SELECT` 型のため、ログインユーザーの code との比較のみで完結）
- `evt.account`（先頭ユーザーコード）は視覚的ハイライト用途（`fieldAccount` と対応）として引き続き保持する

---

## 7. 既存実装からの変更点 (影響範囲)

### 7.1 desktop.js の変更

| 箇所 | 変更内容 |
|---|---|
| `KC.LoginContext` モジュール | `isMine()` を `getPermission()` に拡張。ユーザーコードは `kintone.getLoginUser()` から取得（既存動作）|
| `KC.LoginContext.init()` | 既存の同期処理を維持（追加 API 呼び出しなし）|
| `KC.Config.loadFromPluginConfig()` | `permissionRules` の読み込みを追加。`fm.fieldAccount` の参照を削除 |
| `buildAlldayBar()` 等の各レンダリング関数 | `isMine()` → `getPermission().canEdit` に変更 (全 8 箇所程度) |
| `KC.Boot.init()` | `KC.LoginContext.init()` は同期のまま変更なし |

### 7.2 config.js の変更

| 箇所 | 変更内容 |
|---|---|
| `ACCOUNT_FIELD_TYPES` | 視覚的ハイライト用フィールド絞り込みとして引き続き保持する。権限フィールド絞り込みは `USER_SELECT` 型のインライン比較（`field.type === 'USER_SELECT'`）で実装するため、`PERMISSION_FIELD_TYPES` への名称変更は行わない。|
| `collectFieldMapping()` | `fieldAccount` キーの収集を削除 |
| 新規: `collectPermissionRules()` | 権限設定行を配列として収集する関数を追加 |
| 新規: `applyPermissionRules()` | 保存済み権限設定をフォームに反映する関数を追加 |
| `saveConfig()` | `permissionRules` の保存ロジックを追加。version を 3 に変更 |
| `loadInitialConfig()` | version 3 のパース対応。version 2 からの移行処理を追加 (§8) |

### 7.3 config.html の変更

| 箇所 | 変更内容 |
|---|---|
| `#kc-field-account` プルダウン | 廃止 (または §9 Q5 次第で残存) |
| セクション 1 への追加 | 「編集権限設定」サブセクションを追加 (§4 参照) |

---

## 8. 移行・互換性

### 8.1 version 2 → version 3 の変換ルール

`loadInitialConfig()` でバージョンを検出し、以下の変換を実行してメモリ内のみで version 3 形式に昇格させる。ファイルへの保存は管理者が「保存」ボタンを押すまで実行しない。

| 条件 | 変換内容 |
|---|---|
| `parsed.version === 2` かつ `fieldMapping.fieldAccount` が存在する | `permissionRules: []` として初期化（`fieldAccount` の値は `fieldMapping.fieldAccount` に残置。自動変換は行わない） |
| `parsed.version === 2` かつ `fieldMapping.fieldAccount` が空 | `permissionRules: []` として初期化 |
| `parsed.version < 2` | 既存ルール通り全破棄 (REQ_plugin-migration.md Q11 確定) |

> 注: version 2 の `fieldAccount` を `permissionRules` へ自動変換しない理由は、`fieldAccount` が今後「視覚的ハイライト専用フィールド」として独立した役割を持つため、意図せず権限ルールに取り込まれることを避けるため。

### 8.2 desktop.js での後方互換読み込み

`KC.Config.loadFromPluginConfig()` で version 2 の設定を読み込んだ場合、`permissionRules` が存在しなければ空配列として初期化する。`permissionRules: []` のフォールバック（全員 `edit`）が適用されるため、既存の動作が維持される（§5.4 参照）。

### 8.3 fieldAccount の役割分離

- **編集権限判定**: `permissionRules[]` が担う（version 3 以降）
- **視覚的ハイライト（自分の予定の色付け）**: `fieldMapping.fieldAccount` が担う（既存動作を継続）

`fieldMapping.fieldAccount` は `fieldMapping` 内のキーとして残置し、`kc-ad-event--mine` / `kc-event--mine` CSS クラスの付与判定（`KC.LoginContext.isMine` 相当の処理）に引き続き使用する。編集権限判定とは完全に独立した処理とする。

---

## 9. 確定事項（2026-05-15 ユーザー判断）

以下は 2026-05-15 にユーザーの判断により確定した設計方針。既存実装との後方互換と kintone 標準的な考え方を最重視して採用。

| ID | 確定内容 | 採用理由 |
|---|---|---|
| Q1 エントリ数上限 | 上限なし（バリデーションなし） | `kintone.plugin.app.setConfig` の 65535 バイト制限に対し、権限設定エントリの情報量は小さく、実用範囲では制限に達しない |
| Q2 権限粒度 | 3 段階: `view`（閲覧のみ）/ `edit`（編集可）/ `delete`（削除可） | kintone 標準のレコード権限粒度と整合。段階的包含（delete ⊇ edit ⊇ view） |
| Q3 マージ規則 | OR 結合（複数エントリのどれか 1 つでも該当すれば該当権限を付与、最高権限採用） | kintone のレコード権限設定と同じ考え方。複数手段で権限を付与できる柔軟性を確保 |
| Q4 空設定フォールバック | 全員 `edit` 権限（既存挙動互換） | 既存の `fieldAccount` 未設定時の挙動（全員編集可相当）と後方互換を優先 |
| Q5 既存 fieldAccount | 残置。視覚的ハイライト（自分の予定の色付け）専用として独立保持。編集権限判定は `permissionRules[]` 側で実施 | 既存設定アプリへの影響を最小化。役割分離で意図が明確化（§8.3 参照） |
| Q6 削除操作の実装範囲 | `delete` 権限の制御は将来実装。初期実装では `canDelete` フラグを算出するのみとし、削除 UI は実装しない | 現状カレンダー画面に削除ボタンが存在しない。初期実装スコープを絞る |
| Q7 フィールド種別 | USER_SELECT のみ対応（未対応: 組織・グループ選択フィールド） | 別カスタマイズで組織所属ユーザーを USER_SELECT フィールドに書き出す運用に変更したため、ORGANIZATION_SELECT / GROUP_SELECT の判定は不要 |
| Q8 レコードデータ参照 | 案 A 採用: `KcEvent` に `permissionFields: { [fieldCode]: string[] }` を追加し、レコード取得時に権限対象フィールドの value[] を格納 | 追加 API 呼び出しが不要で、権限判定をメモリ内で完結できる |
| Q9 組織・グループフィールド対応 | 未対応（別カスタマイズで USER_SELECT に書き出す運用） | ORGANIZATION_SELECT / GROUP_SELECT への直接参照は行わない。組織所属管理は kintone アプリ外の別カスタマイズに委ねる |

---

## 付録: UX / シーケンス概要

### A.1 設定画面の操作フロー

```
1. 管理者がプラグイン設定画面を開く
2. セクション 1「共通設定」→「編集権限設定」エリアを確認
3. 「+ 行を追加」で権限エントリを追加
4. フィールドプルダウン: USER_SELECT 型フィールドを選択
5. 権限種別ドロップダウン: 「閲覧のみ（view）」「編集可（edit）」「削除可（delete）」を選択
6. 必要な行数分繰り返す
7. 「保存」または「保存して更新」で保存
```

### A.2 エンドユーザーのカレンダー表示フロー

```
1. ユーザーがカレンダービューを開く
2. KC.Boot.init() 起動
   a. loadFromPluginConfig() で permissionRules を読み込む
   b. KC.LoginContext.init():
      - getLoginUser() でユーザーコード取得（追加 API 呼び出しなし）
3. レコード一覧取得 → KcEvent 変換 (権限対象 USER_SELECT フィールドの value[] を含める)
4. カレンダー描画:
   - 各イベントに対して getPermission() を評価（メモリ内判定のみ）
   - canEdit = true の場合のみ DnD ハンドラを有効化
   - canDelete = true の場合の削除ボタン表示は Phase 2 対応（§9 Q6 確定）
```

---

*このドキュメントは 2026-05-15 時点の調査結果をもとに作成されました。第 2 版（2026-05-15）にて §9 全未確定事項をユーザー判断で確定し、§3〜§8 を具体化。第 3 版（2026-05-15）にて組織・グループ対応を削除し USER_SELECT のみに縮小。*
