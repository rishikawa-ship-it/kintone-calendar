# 要件定義書: 編集権限設定機能の拡張

**文書番号**: REQ_edit-permission-extension
**作成日**: 2026-05-15
**最終更新日**: 2026-05-19 (第 6 版: 権限フィールド設定の追加)
**作成者**: designer (サブエージェント)
**ステータス**: 確定 (2026-05-15 ユーザー判断により §9 全項目確定)
**関連文書**: REQ_plugin-migration.md, plugin/src/js/desktop.js, plugin/src/js/config.js, plugin/src/html/config.html

---

**v2 (2026-05-15)**: §9 全未確定事項をユーザー判断で確定し、§3〜§8 を具体化。
**v3 (2026-05-15)**: 組織・グループ選択フィールド対応を削除。USER_SELECT のみに縮小（別カスタマイズで組織所属ユーザーをユーザーフィールドに書き出す運用に変更したため）。
**v3.1 (2026-05-15)**: ダイアログ表示の権限ガードを撤廃（別カスタマイズで制御）。PERMISSION_FIELD_TYPES の定数化要件を削除し実装のインライン比較を正とする。
**v3.2 (2026-05-15)**: 保存ボタン制御の責任分担を明示（kintone 標準のアクセス権側で制御。JS は DnD のみガード）。
**v4 (2026-05-15)**: アカウントフィールド機能を編集権限ルールに統合。各ルールに color プロパティを追加（カラーピッカー）。fieldAccount は廃止。KC.LoginContext.isMine 廃止し getPermission に color を統合。version 3 → 4 マイグレーション規則を追加。
**v4.1 (2026-05-15)**: ビューフィルタ仕様（FR-7・§5.9）を明文化。permissionRules 空時の 'mine'/'others' フィルタ UI 非表示を確定。
**v4.2 (2026-05-18)**: 権限種別の表示ラベルを「管理者/編集者/閲覧者」に変更（内部値は維持）。Phase 2 までは「管理者」(`delete`) を UI 非表示。ドロップダウン順序を権限強い順に変更。既存 delete 値の取り扱いを §8.6 に明記。
**v5 (2026-05-18)**: 背景色と文字色を分離。`color` プロパティを廃止し、`bgColor` / `textColor` の 2 プロパティに変更。マイグレーション v4→v5 で背景色の WCAG 相対輝度から文字色を自動判定（白 or 黒）。本体側 getPermission の戻り値も拡張。新規行デフォルト: 青背景 #1976d2 + 白文字 #ffffff。
**v5.1 (2026-05-18)**: 新規行のデフォルト権限を edit (編集者) → view (閲覧者) に変更。安全側に倒すユーザー指示。
**v6 (2026-05-19)**: 「編集権限設定」を「権限ユーザー設定」にリネーム。新規「権限フィールド設定」(fieldValueRules) を追加 (フィールド値・ステータスベースで権限・色を判定)。優先順位: フィールド値ルール > ユーザー権限ルール (権限・色とも)。kintone プロセス管理ステータスにも対応。v5→v6 マイグレーション規則を §8.8 に追加。Q18〜Q20 を確定事項に追記。
**v6.1 (2026-05-19)**: フィールド型名表記を kintone 正式型名 `DROP_DOWN`（アンダースコア付き）に統一。

---

## 1. 概要・背景

### 1.1 背景

KC Calendar プラグインは、カレンダーイベントの DnD 移動・リサイズ・ダイアログ操作 (新規作成 / 削除) を「自分の予定か否か」で制限する仕組みを持つ。現状の判定ロジック (`KC.LoginContext.isMine`) は `USER_SELECT` 型フィールド 1 つのみを参照し、ログインユーザーのユーザーコードと完全一致する場合のみ「自分の予定 = 編集可」と判定する。

この設計では以下の運用ニーズに対応できない。

- 組織単位またはグループ単位で編集可能なユーザーを管理したい
- 複数のフィールド (担当者フィールド + 関係者フィールド等) のどちらかに含まれていれば編集できるようにしたい
- 「閲覧のみ」「編集可」「削除可」のような権限粒度を設定項目として明示し、ユーザーに意図を明確化したい
- 該当ユーザーの予定をそのユーザーに紐づいた色で表示したい

さらに、v3 まで「アカウントフィールド（ハイライト用）」と「編集権限設定」が独立した UI として分離していたため UX が悪かった。v4 でアカウントフィールドを廃止し、編集権限ルールの一部として統合する。

v5 では、各ルールに設定していた単一の `color`（背景色として使用）を `bgColor`（背景色）と `textColor`（文字色）に分離し、カレンダー上の予定バー・チップの視認性を向上させる。

v6 では、ユーザー属性（USER_SELECT フィールド）に基づく**権限ユーザー設定**（従来の「編集権限設定」をリネーム）に加え、レコードのフィールド値やプロセス管理ステータスに基づく**権限フィールド設定**を新設する。権限の強さと色の優先順位はいずれも「フィールド値ルール > ユーザー権限ルール」とする。

### 1.2 目的

1. 対応フィールドを `USER_SELECT` 型の複数フィールドへ拡張する（組織・グループ対応は別カスタマイズで USER_SELECT に書き出す運用とする）
2. 複数フィールドを組み合わせて権限判定できるようにする
3. フィールドごとに権限の種類 (閲覧のみ / 編集可 / 削除可) を設定できるようにする
4. 各ルールに背景色・文字色（カラーピッカー）を追加し、該当ユーザーの予定をその色で表示できるようにする
5. 上記をプラグイン設定画面の GUI として提供し、管理者がコードを変更せずに制御できるようにする
6. フィールド値（DROP_DOWN / RADIO_BUTTON / CHECK_BOX）およびプロセス管理ステータスに基づく権限・色制御を新設し、ユーザー属性によらないレコード属性ベースの制御を可能にする

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

#### FR-1: 対応フィールド種別（権限ユーザー設定）

- **権限ユーザー設定**（旧称「編集権限設定」）の参照対象として `USER_SELECT` 型フィールドを選択できるようにする
- 判定方法: ログインユーザーのコード (`kintone.getLoginUser().code`) がフィールドの `value[].code` に含まれるか

#### FR-2: 複数フィールドの選択

- 1 つのアプリで複数の `USER_SELECT` フィールドを「権限ユーザー設定」フィールドとして登録できるようにする
- 各フィールドエントリは独立して「フィールドコード + 権限種別 + 背景色 + 文字色」の組を保持する
- エントリ数の上限は設けない（§9 Q1 確定）

#### FR-3: 権限種別の設定

権限種別は内部値 3 段階（後方互換維持）:
- `view`（閲覧者）
- `edit`（編集者）
- `delete`（管理者）

段階的包含: `delete ⊇ edit ⊇ view`。複数フィールドのマージ規則は OR 結合（最高権限採用）。

**UI 表示ラベル**:
- `delete` → 管理者
- `edit` → 編集者
- `view` → 閲覧者

**UI 表示の制約 (2026-05-18 時点)**:
削除操作のカレンダー UI は Phase 2 対応のため、設定画面の権限ドロップダウンから「管理者」(`delete`) は当面非表示にする。Phase 2 で削除 UI を実装するタイミングで表示を復活させる。

**ドロップダウン表示順序**: 権限強い順（管理者 → 編集者 → 閲覧者）。管理者非表示中は「編集者 → 閲覧者」。

- 各フィールドエントリは `{ fieldCode, fieldType: 'USER_SELECT', permission, bgColor, textColor }` の 5 要素を保持する（v5 変更）
- **新規ルール追加時の権限デフォルト: `view`（閲覧者）**（v5.1 変更）
- **bgColor・textColor はいずれも #RRGGBB 形式の文字列（HTML5 color picker のデフォルト出力形式）**
  - カラーピッカー（`<input type="color">`）で管理者が手動指定する
  - フィールドの値を元にした色算出は行わない
  - 各ルール行で必須項目とする
  - 新規ルール追加時のデフォルト: `bgColor = '#1976d2'`（青背景）、`textColor = '#ffffff'`（白文字）
- **背景色変更時の文字色自動補正は行わない**（§9 Q17 確定）。ユーザーが個別に設定する。マイグレーション時のみ WCAG 相対輝度から自動判定する（§8.7）

#### FR-4: 設定なし時のフォールバック

- `permissionRules` と `fieldValueRules` がともに空配列の場合、**全員を `edit` 権限（編集可）として扱う**
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

> 注1: 「マッチなし」とは `permissionRules` と `fieldValueRules` に設定が存在するが、ログインユーザーがいずれのルールにも該当しない状態。両配列が空配列の場合は §5.4 のフォールバック（全員 `edit`）が適用されるため、マッチなしとは区別する。
> 注2: 「削除操作」のカレンダー UI への追加は Phase 2 対応（§9 Q6 確定）。初期実装では `canDelete` フラグを算出するのみとし、削除 UI は実装しない。
> 注3: 保存ボタンの非活性化は **kintone 標準のレコード権限・フィールド権限** で制御する。JS カスタマイズ側で `disabled` 属性を付与する実装は行わない（kintone UI 更新時にセレクタが壊れるリスクがあるため）。

#### FR-6: 色適用ルール

- ログインユーザーが複数のユーザー権限ルールにマッチする場合、**上から最初にマッチした行の bgColor・textColor を採用する**
- 権限のマージ（OR 結合・最高権限採用）とは別ルールであることに注意する
  - 権限: 複数マッチ時は最高権限を採用
  - 色: 複数マッチ時は最初にマッチした行の bgColor / textColor を採用
- `permissionRules` と `fieldValueRules` がともに空配列の場合、またはマッチなしの場合は `bgColor: null, textColor: null` を返す
  - 呼び出し側でデフォルト色を適用するか、色付けをスキップする
- フィールド値ルールにマッチした場合、そのルールの bgColor / textColor を採用し、ユーザー権限ルールの色は参照しない（§5.11 参照）

#### FR-7: ビューフィルタ仕様

カレンダーは予定を絞り込む `'mine' / 'others' / 'all'` フィルタを持つ。本機能の文脈で各値は以下のように定義する:

- **mine**: ログインユーザーが permissionRules のいずれかにマッチする予定のみ表示
- **others**: ログインユーザーが permissionRules のいずれにもマッチしない予定のみ表示
- **all**: フィルタなし

判定は `getPermission(evt).bgColor !== null` で行う（bgColor が null = いずれのルールにもマッチしないため）。

**permissionRules / fieldValueRules がともに空配列の場合の UI 挙動**: フィルタが意味を成さないため、'mine' および 'others' のフィルタ UI を非表示にする。'all' は常時表示。設定画面でいずれかのルールを 1 件以上登録した時点でフィルタ UI が表示される。

#### FR-8: 権限フィールド設定（新規）

フィールド値に基づいて権限・表示色を判定する `fieldValueRules` を新設する。

- **対応フィールド型**: `DROP_DOWN` / `RADIO_BUTTON` / `CHECK_BOX` / `STATUS`
- **判定方式**:
  - `DROP_DOWN` / `RADIO_BUTTON` / `STATUS`: レコードのフィールド値（文字列）と `rule.value` の完全一致
  - `CHECK_BOX`: レコードのフィールド値（文字列配列）のいずれかの要素と `rule.value` が一致（任意要素一致、§10 U-7 参照）
- 各 `fieldValueRule` エントリは `{ fieldCode, fieldType, value, permission, bgColor, textColor }` の 6 要素を保持する
- 新規ルール追加時のデフォルト: `permission: 'view'`、`bgColor: '#1976d2'`、`textColor: '#ffffff'`
- ステータスフィールドは通常 `$status` フィールドコードまたはアプリ内で設定したフィールドコードでアクセスする（§10 U-9 参照）

**フィールド選択 UI**:
- DROP_DOWN / RADIO_BUTTON / CHECK_BOX 型: `GET /k/v1/app/form/fields.json` から取得
- STATUS 型: `GET /k/v1/app/status.json` から取得し、フィールド選択ドロップダウンに「ステータス (STATUS)」として追加

**値選択 UI**:
- 選択したフィールドの選択肢を動的に表示する
- DROP_DOWN / RADIO_BUTTON / CHECK_BOX: フォームフィールド定義の `options` から取得
- STATUS: プロセス管理の各ステータス名を `GET /k/v1/app/status.json` から取得

#### FR-9: 権限の優先順位（新規）

権限判定とカレンダー表示色の決定における優先順位:

1. **fieldValueRules（フィールド値ルール）を先にチェックする**
2. マッチした場合: そのルールの `permission` / `bgColor` / `textColor` を採用し、`permissionRules` は参照しない
3. マッチしなかった場合: `permissionRules`（ユーザー権限ルール）の判定に進む
4. どちらにもマッチしなかった場合: §5.4 のフォールバック（両配列空時は全員 `edit`、設定あり非マッチは `view` 相当）を適用する

この優先順位は権限の強さと色の決定の両方に適用される。

#### FR-10: ステータスフィールド対応（新規）

kintone のプロセス管理機能が有効なアプリにおいて、プロセス管理ステータスを権限判定条件として使用できるようにする。

- ステータスフィールドは kintone 内部で `STATUS` 型として扱われる
- レコード取得時に `record.$status.value`（または設定したフィールドコードの `.value`）でアクセスできる
- 設定画面でプロセス管理ステータスの選択肢を取得するため `GET /k/v1/app/status.json` を呼び出す
- アプリにプロセス管理が設定されていない場合、STATUS 型フィールドはフィールド選択ドロップダウンに表示されない

### 3.2 非機能要件

#### NF-1: API コール数の上限

- ログインユーザーのコードは `kintone.getLoginUser()` で取得する（追加 API 不要）
- 権限判定・色決定はすべてメモリ内で完結し、カレンダー描画ごとに追加 API を呼び出さない
- `fieldValueRules` の判定も `KcEvent` に格納済みのフィールド値を参照するため、追加 API 不要

#### NF-2: パフォーマンス

- 権限判定・色決定はメモリ内判定のみとし、追加 API コールを発生させない
- `kintone.getLoginUser()` は既存の `KC.LoginContext.init()` で取得済みであり、追加コストなし
- `GET /k/v1/app/status.json` は設定画面表示時のみ呼び出す（カレンダー表示時は不要）

#### NF-3: 後方互換性

- 既存の `fieldAccount` 設定は移行規則（§8）により権限ユーザー設定の先頭行に変換する
- version 2 / 3 / 4 / 5 の設定スキーマは version 6 の移行ロジックで補完する
- `fieldValueRules` キーが存在しない旧設定は `[]` として初期化する（§8.8）

---

## 4. 設定画面 UI 仕様

### 4.1 変更方針

`plugin/src/html/config.html` のセクション 1 (共通設定) に「権限ユーザー設定」と「権限フィールド設定」の 2 つのサブセクションを設ける。既存の「アカウントフィールド」プルダウン（`id="kc-field-account"`）は**廃止**済み（v4 で削除）。

### 4.2 権限ユーザー設定 UI（旧称「編集権限設定」、複数行）

```
【権限ユーザー設定】
┌───────────────────────────────────────────────────────────────────────┐
│ フィールド         権限種別        背景        文字        操作        │
│ [──フィールド選択─▼] [──権限選択──▼] [■ #1976d2] [■ #ffffff] [削除 −] │
│ [──フィールド選択─▼] [──権限選択──▼] [■ #e53935] [■ #000000] [削除 −] │
│ [+ 行を追加]                                                           │
└───────────────────────────────────────────────────────────────────────┘
ヒント: フィールド未設定（0 行）かつ権限フィールド設定も 0 行の場合は全員編集可（§9 Q4 確定）
```

#### 各行のカラム構造（v5 変更）

- 旧 (v4): フィールド / 権限 / 色 / 操作（grid-template-columns: 2fr 1fr 44px 40px）
- 新 (v5): フィールド / 権限 / 背景色 / 文字色 / 操作（grid-template-columns: 2fr 1fr 44px 44px 40px）

#### ヘッダー行のラベル

- 「フィールド」「権限」「背景」「文字」（操作列は空）

#### 各行の構成要素

1. **フィールドプルダウン** (`<select>`)
   - `GET /k/v1/app/form/fields` の結果から `USER_SELECT` 型のフィールドを抽出して表示
   - 先頭オプションは「-- フィールドを選択 --」(空値)
   - フィールドコードの右にフィールド名を表示 (例: `アカウント (アカウント)`)
2. **権限種別プルダウン** (`<select>`)
   - 選択肢: 「編集者（edit）」「閲覧者（view）」の 2 選択肢を権限強い順に表示（§9 Q2 確定）
   - 「管理者（delete）」は Phase 2 まで非表示（§3.1 FR-3・§8.6 参照）
3. **背景色カラーピッカー** (`<input type="color">`)
   - 管理者が任意の背景色を手動指定する
   - 初期値（新規行追加時）: `#1976d2`
   - 選択した色は #RRGGBB 形式で `permissionRules[].bgColor` に保存する
4. **文字色カラーピッカー** (`<input type="color">`)
   - 管理者が任意の文字色を手動指定する
   - 初期値（新規行追加時）: `#ffffff`
   - 選択した色は #RRGGBB 形式で `permissionRules[].textColor` に保存する
   - 背景色変更時の自動補正は行わない（§9 Q17 確定）
5. **削除ボタン** (−)
   - 当該行を削除する
   - 最後の 1 行でも削除可能 (0 行 = 設定なし)

#### 行追加ボタン

- 「+ 行を追加」ボタン押下で新規行を末尾に追加する
- 追加行は初期値「フィールド未選択 / 権限: view (閲覧者) / 背景色 #1976d2 / 文字色 #ffffff」

### 4.3 権限フィールド設定 UI（新規）

```
【権限フィールド設定】
┌────────────────────────────────────────────────────────────────────────────────┐
│ フィールド         値             権限種別        背景        文字        操作  │
│ [──フィールド選択─▼] [──値を選択──▼] [──権限選択──▼] [■ #d50000] [■ #ffffff] [−] │
│ [──フィールド選択─▼] [──値を選択──▼] [──権限選択──▼] [■ #ff8f00] [■ #ffffff] [−] │
│ [+ 行を追加]                                                                    │
└────────────────────────────────────────────────────────────────────────────────┘
ヒント: フィールド値がルールの条件に一致した場合、ユーザー権限設定より優先されます
```

#### 各行のカラム構造

- grid-template-columns: 2fr 1.5fr 1fr 44px 44px 40px

#### ヘッダー行のラベル

- 「フィールド」「値」「権限」「背景」「文字」（操作列は空）

#### 各行の構成要素

1. **フィールドプルダウン** (`<select>`)
   - DROP_DOWN / RADIO_BUTTON / CHECK_BOX 型: `GET /k/v1/app/form/fields.json` の結果から該当型を抽出
   - STATUS 型: `GET /k/v1/app/status.json` でプロセス管理が有効な場合のみ「ステータス (STATUS)」を追加
   - 先頭オプションは「-- フィールドを選択 --」(空値)
2. **値プルダウン** (`<select>`)
   - フィールドプルダウンの選択変更に連動して動的に更新する
   - DROP_DOWN / RADIO_BUTTON / CHECK_BOX: フォームフィールド定義の `options` からラベルを表示
   - STATUS: プロセス管理の各ステータス名を表示
   - フィールド未選択時は「-- フィールドを選択してください --」(無効)
3. **権限種別プルダウン** (`<select>`)
   - §4.2 と同一（「編集者」「閲覧者」の 2 選択肢、権限強い順）
4. **背景色カラーピッカー** (`<input type="color">`)
   - 初期値（新規行追加時）: `#1976d2`
   - 選択した色は #RRGGBB 形式で `fieldValueRules[].bgColor` に保存する
5. **文字色カラーピッカー** (`<input type="color">`)
   - 初期値（新規行追加時）: `#ffffff`
   - 選択した色は #RRGGBB 形式で `fieldValueRules[].textColor` に保存する
6. **削除ボタン** (−)
   - 当該行を削除する

#### 行追加ボタン

- 「+ 行を追加」ボタン押下で新規行を末尾に追加する
- 追加行は初期値「フィールド未選択 / 値未選択 / 権限: view / 背景色 #1976d2 / 文字色 #ffffff」

### 4.4 フィールドプルダウンの型フィルタ定義

権限ユーザー設定の絞り込みは `USER_SELECT` 型の直接比較で実装する（`field.type === 'USER_SELECT'`）。

権限フィールド設定の絞り込みは以下の型の直接比較で実装する:
- `field.type === 'DROP_DOWN'`
- `field.type === 'RADIO_BUTTON'`
- `field.type === 'CHECK_BOX'`
- STATUS 型はフォームフィールドではなくプロセス管理として別途取得する

`PERMISSION_FIELD_TYPES` のような定数は定義しない（v3.1 方針を継承）。

### 4.5 廃止: 既存「アカウントフィールド」

v3 まで存在した `id="kc-field-account"` プルダウンは **v4 で廃止** 済み。設定 UI から該当フォームグループを削除する。アカウントフィールドの役割（ハイライト・編集権限）は「権限ユーザー設定」ルール行の `bgColor` / `textColor` プロパティで代替する。

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

### 5.2 個別フィールドの権限判定（ユーザー権限ルール）

権限ユーザー設定リスト (`permissionRules`) の各エントリに対して以下を評価する。すべてのエントリは `USER_SELECT` 型であり、追加 API 呼び出しなしでメモリ内判定が完結する。

```
function evalPermissionEntry(entry, record, userCode):
  field = entry.fieldCode
  permission = entry.permission  // 'view' / 'edit' / 'delete'

  matched = record[field].value の code に userCode が含まれるか

  if matched:
    return permission  // 'view' / 'edit' / 'delete'
  return null  // 非該当
```

### 5.3 複数フィールドのマージ規則（権限）

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

`permissionRules` と `fieldValueRules` がともに空配列の場合は **全員 `edit` 権限を返す**（DnD 移動・リサイズ操作を全員に許可）。

これは既存 `fieldAccount` 未設定時の挙動（`isMine` が常に `true` 相当）と後方互換する。

空配列の場合の `getPermission` 戻り値:

```
{ canEdit: true, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'fallback' }
```

### 5.5 廃止: KC.LoginContext.isMine

`KC.LoginContext.isMine(evt)` は v4 で廃止する。既存の `isMine` 呼び出し箇所はすべて `KC.LoginContext.getPermission(evt, record)` に置き換える。

```
// 旧 (v3 以前)
if (!KC.LoginContext.isMine(evt)) return;

// 新 (v4 以降)
if (!KC.LoginContext.getPermission(evt, record).canEdit) return;
```

`kc-ad-event--mine` / `kc-event--mine` CSS クラスによる色付けも廃止する。代わりに `getPermission(evt, record).bgColor` / `.textColor` の値を `style.backgroundColor` / `style.color` 等に直接設定する（CSS クラス切り替えではなくインラインスタイル設定）。

### 5.6 getPermission の戻り値（v6 拡張）

`KC.LoginContext.getPermission(evt, record)` の戻り値を以下の形に拡張する:

```
getPermission(evt, record):
  最終権限 = §5.10 のフィールド値優先判定結果
  色 = §5.11 の色決定ロジック結果
  return {
    canEdit:       最終権限 === 'edit' || 最終権限 === 'delete',
    canDelete:     最終権限 === 'delete',
    canOpenDialog: true,       // 権限に関わらず常に true
    bgColor:       色.bgColor  // string (#RRGGBB) | null
    textColor:     色.textColor // string (#RRGGBB) | null
    source:        色.source   // 'field' | 'user' | 'fallback' (デバッグ・フィルタ用)
  }
```

ダイアログを開く処理（`KC.Popup.openEdit`）への権限ガードは追加しない。ダイアログ内の保存ボタンは `canEdit` が `false` の場合に非活性として表示するが、非活性化の実装は kintone 標準のアクセス権に委ねる（§5.7 参照）。

### 5.7 保存ボタン制御の責任分担

ダイアログ内の保存ボタンの活性／非活性制御は本 JS カスタマイズの責任範囲外とする。以下のいずれかの方法で kintone 側の権限設定で制御する想定:

- レコード単位の編集権限（アプリ設定 > アクセス権 > レコード）
- フィールド単位の編集権限（アプリ設定 > アクセス権 > フィールド）
- 別カスタマイズによる `app.record.edit.show` イベントでの DOM 制御

本カスタマイズで提供する `getPermission(evt).canEdit` は DnD・リサイズの制御にのみ使用する。

### 5.8 色決定ロジック（ユーザー権限ルール）

ユーザー権限ルール内の色決定は権限マージとは独立したロジックで行う。`permissionRules` を上から順番に走査し、**最初にマッチした行の bgColor と textColor を一組で返す**。

```
// 擬似コード: ユーザー権限ルールの色決定（上から最初マッチ優先）

function resolveUserColors(permissionRules, record, userCode):
  if permissionRules is empty:
    return { bgColor: null, textColor: null }

  for each entry in permissionRules:
    matched = record[entry.fieldCode].value の code に userCode が含まれるか

    if matched:
      return { bgColor: entry.bgColor, textColor: entry.textColor }

  return { bgColor: null, textColor: null }  // マッチなし → 色なし（デフォルト表示色）
```

`resolveUserColors` の結果が `{ bgColor: null, textColor: null }` の場合、呼び出し側ではデフォルト表示色（テーマカラー等）をそのまま使用する。インラインスタイルへの設定はスキップする。

### 5.9 ビューフィルタ判定

`KC.EventFilter` の判定式:

- 'mine': `getPermission(evt).bgColor !== null`
- 'others': `getPermission(evt).bgColor === null`

`permissionRules` と `fieldValueRules` がともに空配列のときは全予定で `bgColor === null` となるため、'mine' は 0 件 / 'others' は全件となる。FR-7 に従い、空配列時はフィルタ UI 自体を非表示にする運用とする。

### 5.10 フィールド値権限の判定ロジック（新規）

`fieldValueRules` を先に評価し、マッチしなかった場合のみ `permissionRules` を評価する。

```
// 擬似コード: フィールド値優先の権限判定

function getPermission(evt, record):
  // 1. フィールド値ルールを先にチェック
  for each rule in fieldValueRules:
    fieldValue = getFieldValue(record, rule.fieldCode, rule.fieldType)
    matched = matchFieldValue(fieldValue, rule.value, rule.fieldType)

    if matched:
      perm = rule.permission
      return {
        canEdit:       permLevel(perm) >= 2,  // 'edit' or 'delete'
        canDelete:     permLevel(perm) >= 3,  // 'delete' のみ
        canOpenDialog: true,
        bgColor:       rule.bgColor,
        textColor:     rule.textColor,
        source:        'field'
      }

  // 2. ユーザー権限ルール (既存ロジック §5.3 / §5.8)
  if permissionRules is not empty:
    userPerm = resolvePermission(permissionRules, record, userCode)  // §5.3
    colors   = resolveUserColors(permissionRules, record, userCode)  // §5.8

    if userPerm !== 'none':
      return {
        canEdit:       permLevel(userPerm) >= 2,
        canDelete:     permLevel(userPerm) >= 3,
        canOpenDialog: true,
        bgColor:       colors.bgColor,
        textColor:     colors.textColor,
        source:        'user'
      }
    else:
      // 設定あり・非マッチ: view 相当
      return {
        canEdit: false, canDelete: false, canOpenDialog: true,
        bgColor: null, textColor: null, source: 'user'
      }

  // 3. 両配列空: フォールバック（全員 edit）
  return {
    canEdit: true, canDelete: false, canOpenDialog: true,
    bgColor: null, textColor: null, source: 'fallback'
  }

// フィールド値取得ヘルパー
function getFieldValue(record, fieldCode, fieldType):
  if fieldType === 'CHECK_BOX':
    return record[fieldCode].value  // 文字列配列
  return record[fieldCode].value    // 文字列 (DROP_DOWN / RADIO_BUTTON / STATUS)

// フィールド値マッチ判定
function matchFieldValue(fieldValue, ruleValue, fieldType):
  if fieldType === 'CHECK_BOX':
    return fieldValue.includes(ruleValue)  // 任意要素一致 (§10 U-7)
  return fieldValue === ruleValue          // 完全一致

// permLevel: 'none'=0, 'view'=1, 'edit'=2, 'delete'=3
```

複数の `fieldValueRules` がマッチする可能性がある場合、**上から最初にマッチしたルールを採用**する（§10 U-8 参照）。

### 5.11 色決定の優先順位（新規）

```
色の優先順位:
  1. fieldValueRules にマッチ → そのルールの bgColor / textColor を採用
  2. fieldValueRules にマッチせず、permissionRules にマッチ → resolveUserColors の結果
  3. いずれにもマッチしない / 両配列空 → bgColor: null, textColor: null
```

カレンダー描画側での処理:
- `bgColor !== null` の場合: `element.style.backgroundColor = bgColor` を設定
- `textColor !== null` の場合: `element.style.color = textColor` を設定
- `null` の場合: インラインスタイルを設定しない（テーマデフォルト色を維持）

### 5.12 マッチなし時の扱い

`resolvePermission` がマッチなし（`best === 'none'`）を返した場合、`getPermission` は以下を返す。

```
{ canEdit: false, canDelete: false, canOpenDialog: true, bgColor: null, textColor: null, source: 'user' }
```

すなわち、`permissionRules` / `fieldValueRules` に設定が存在するがログインユーザーがいずれにも該当しない場合は、`view` 相当として扱う（DnD 不可・保存ボタン非活性・ダイアログ表示は可・色なし）。

---

## 6. データ構造

### 6.1 プラグイン設定 JSON スキーマ (version 6)

```json
{
  "version": 6,
  "fieldMapping": {
    "fieldStart": "string",
    "fieldEnd": "string",
    "fieldTitle": "string",
    "fieldAllday": "string"
  },
  "permissionRules": [
    {
      "fieldCode": "string",
      "fieldType": "USER_SELECT",
      "permission": "view | edit | delete",
      "bgColor": "#RRGGBB",
      "textColor": "#RRGGBB"
    }
  ],
  "fieldValueRules": [
    {
      "fieldCode": "string",
      "fieldType": "STATUS | DROP_DOWN | RADIO_BUTTON | CHECK_BOX",
      "value": "string",
      "permission": "view | edit | delete",
      "bgColor": "#RRGGBB",
      "textColor": "#RRGGBB"
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

**変更点（v5 → v6）**:
- `fieldValueRules` 配列を追加（空配列 `[]` で初期化）
- `version` を `6` に変更
- `permissionRules` の構造・型は変更なし

#### JSON スキーマ例（実際の設定値）

```json
{
  "version": 6,
  "fieldMapping": {
    "fieldTitle": "予定タイトル",
    "fieldStart": "開始日時",
    "fieldEnd": "終了日時",
    "fieldAllday": ""
  },
  "permissionRules": [
    {
      "fieldCode": "担当者",
      "fieldType": "USER_SELECT",
      "permission": "edit",
      "bgColor": "#1976d2",
      "textColor": "#ffffff"
    }
  ],
  "fieldValueRules": [
    {
      "fieldCode": "$status",
      "fieldType": "STATUS",
      "value": "確定済",
      "permission": "view",
      "bgColor": "#d50000",
      "textColor": "#ffffff"
    },
    {
      "fieldCode": "重要度",
      "fieldType": "DROP_DOWN",
      "value": "高",
      "permission": "view",
      "bgColor": "#ff8f00",
      "textColor": "#ffffff"
    }
  ],
  "views": {
    "1234567": {
      "calendarTitle": "カレンダー",
      "defaultView": "month"
    }
  }
}
```

- `permissionRules` が空配列 (`[]`) かつ `fieldValueRules` も空配列 (`[]`) のとき → 全員 `edit` 権限・`bgColor: null, textColor: null`（フォールバック）
- `fieldValueRules` に設定がある場合、レコードのフィールド値が一致すればそのルールを優先採用

### 6.2 KcEvent オブジェクトへの影響（v6 拡張）

v5 では `permissionFields: { [fieldCode]: string[] }` を追加した。v6 では `fieldValueRules` の判定に必要なフィールド値を格納するため `valueFields` を追加する。

- **既存**: `permissionFields: { [fieldCode]: string[] }` (USER_SELECT の `value[].code`)
- **新規**: `valueFields: { [fieldCode]: string | string[] }` (DROP_DOWN / RADIO_BUTTON / STATUS は文字列、CHECK_BOX は文字列配列)

レコード取得時に `fieldValueRules[].fieldCode` 配下のフィールド値も取得し、`evt.valueFields` に格納する。STATUS 型は `record.$status.value`（または設定フィールドコードの `.value`）から取得する。

```
// KcEvent の型定義（v6 拡張）
{
  // ... 既存フィールド
  permissionFields: { [fieldCode: string]: string[] }  // USER_SELECT の value[].code
  valueFields: {
    [fieldCode: string]: string | string[]  // DROP_DOWN/RADIO/STATUS: string, CHECK_BOX: string[]
  }
}
```

---

## 7. 既存実装からの変更点 (影響範囲)

### 7.1 desktop.js / kc-calendar.js の変更

| 箇所 | 変更内容 |
|---|---|
| `KC.LoginContext.isMine()` | **廃止**。`getPermission()` に完全移行 |
| `KC.LoginContext.getPermission()` 戻り値 | `source` フィールドを追加（'field' / 'user' / 'fallback'）（v6） |
| `getPermission()` ロジック | `fieldValueRules` を先に評価し、マッチしなかった場合のみ `permissionRules` を評価（v6） |
| `KcEvent` 変換処理 | `valueFields` プロパティを追加。`fieldValueRules[].fieldCode` 対象フィールドの値を格納（v6） |
| `isMine()` 呼び出し箇所 (全 8 箇所程度) | `getPermission(evt, record).canEdit` に置き換え |
| 色付け処理 | `getPermission(evt, record).bgColor` / `.textColor` ベースに変更（インラインスタイル直接設定） |

### 7.2 config.js の変更

| 箇所 | 変更内容 |
|---|---|
| `ACCOUNT_FIELD_TYPES` | **廃止**（v4 で削除済み） |
| `collectFieldValueRules()` | 新規追加。`fieldValueRules` テーブルの各行を収集し JSON 化 |
| `applyFieldValueRules()` | 保存済みの `fieldValueRules` を設定画面の「権限フィールド設定」テーブルに反映 |
| `saveConfig()` | `fieldValueRules` の保存ロジックを追加。version を 6 に変更 |
| `loadInitialConfig()` | version 6 のパース対応。version 5 からの移行処理を追加（§8.8） |
| `loadStatusOptions()` | 新規追加。`GET /k/v1/app/status.json` でプロセス管理ステータス一覧を取得 |
| `buildFieldValueRow()` | 新規追加。「権限フィールド設定」テーブルの 1 行を生成（フィールド選択→値選択の連動含む） |
| フィールドプルダウンラベル | 「編集権限設定」→「権限ユーザー設定」に変更 |

### 7.3 config.html / config.css の変更

| 箇所 | 変更内容 |
|---|---|
| セクション見出し | 「編集権限設定」→「権限ユーザー設定」にラベル変更 |
| 「権限フィールド設定」テーブル | 新規追加。§4.3 の UI 仕様に従い「権限ユーザー設定」テーブルの下に配置 |
| 権限フィールド設定行のスタイル | grid-template-columns: 2fr 1.5fr 1fr 44px 44px 40px |
| ヘッダー行 | 「権限フィールド設定」のヘッダー「フィールド」「値」「権限」「背景」「文字」を追加 |

### 7.4 バー・チップの色設定

v3 まで `kc-ad-event--mine` / `kc-event--mine` CSS クラスを付与することで色を制御していた箇所を、v5 以降では以下に変更する:

- `getPermission(evt, record).bgColor` が `null` でない場合: `element.style.backgroundColor = bgColor;` を直接設定
- `getPermission(evt, record).textColor` が `null` でない場合: `element.style.color = textColor;` を直接設定
- `null` の場合: 該当するインラインスタイルを設定しない（テーマデフォルト色を維持）
- CSS クラス切り替えは行わない

---

## 8. 移行・互換性

### 8.1 version 2 → version 6 の変換ルール

`loadInitialConfig()` でバージョンを検出し、以下の変換を実行してメモリ内のみで version 6 形式に昇格させる。ファイルへの保存は管理者が「保存」ボタンを押すまで実行しない。

| 条件 | 変換内容 |
|---|---|
| `parsed.version === 2` かつ `fieldMapping.fieldAccount` が存在する（空でない） | §8.5 の変換ルール（v3 → v5 と同じ）に従い `permissionRules` を生成。`fieldMapping.fieldAccount` を削除。`fieldValueRules: []` で初期化 |
| `parsed.version === 2` かつ `fieldMapping.fieldAccount` が空 | `permissionRules: []` として初期化。`fieldValueRules: []` で初期化 |
| `parsed.version < 2` | 既存ルール通り全破棄 (REQ_plugin-migration.md Q11 確定) |

### 8.2 version 3 → version 6 の変換ルール

| 条件 | 変換内容 |
|---|---|
| `parsed.version === 3` かつ `fieldMapping.fieldAccount` が存在する（空でない） | §8.5 の変換ルールに従い `permissionRules` 先頭に追加 |
| `parsed.version === 3` かつ `fieldMapping.fieldAccount` が空または存在しない | `permissionRules` は既存のまま維持。各エントリの `color` を §8.7 の WCAG 輝度判定で `bgColor` + `textColor` に変換 |
| 共通 | `fieldMapping.fieldAccount` を削除。既存 `permissionRules` 各エントリに `color` がなければ `bgColor: '#1976d2'` / `textColor: '#ffffff'` を補完。`fieldValueRules: []` で初期化 |

### 8.3 desktop.js での後方互換読み込み

`KC.Config.loadFromPluginConfig()` で version 2 / 3 / 4 / 5 の設定を読み込んだ場合、`permissionRules` が存在しなければ空配列として初期化する。`fieldValueRules` が存在しなければ空配列として初期化する。両配列が `[]` のフォールバック（全員 `edit`・`bgColor: null, textColor: null`）が適用されるため、既存の動作が維持される。

### 8.4 (廃止) fieldAccount の役割分離 (v3)

v3 では `fieldMapping.fieldAccount` を「視覚的ハイライト専用フィールド」として残置していたが、v4 で廃止する。ハイライト（色付け）の役割は `permissionRules[].bgColor` / `.textColor` が担う。

### 8.5 version 3 → 6 マイグレーション詳細

旧 `fieldMapping.fieldAccount` の値を取得し、`permissionRules` の先頭行として追加する。`color` プロパティは §8.7 の WCAG 輝度判定で `bgColor` + `textColor` に変換する。

```json
// マイグレーション前 (version 3 の例)
{
  "version": 3,
  "fieldMapping": {
    "fieldTitle": "予定タイトル",
    "fieldStart": "開始日時",
    "fieldEnd": "終了日時",
    "fieldAllday": "",
    "fieldAccount": "アカウント"
  },
  "permissionRules": [
    { "fieldCode": "担当者", "fieldType": "USER_SELECT", "permission": "edit" }
  ]
}

// マイグレーション後 (version 6)
{
  "version": 6,
  "fieldMapping": {
    "fieldTitle": "予定タイトル",
    "fieldStart": "開始日時",
    "fieldEnd": "終了日時",
    "fieldAllday": ""
  },
  "permissionRules": [
    {
      "fieldCode": "アカウント",
      "fieldType": "USER_SELECT",
      "permission": "edit",
      "bgColor": "#1976d2",
      "textColor": "#ffffff"
    },
    {
      "fieldCode": "担当者",
      "fieldType": "USER_SELECT",
      "permission": "edit",
      "bgColor": "#1976d2",
      "textColor": "#ffffff"
    }
  ],
  "fieldValueRules": []
}
```

### 8.6 既存「管理者」(delete) 設定値の取り扱い

設定画面で「管理者」(`delete`) を非表示にしている期間中も、データとしての `permission: 'delete'` は保持される。

- 既に `permission: 'delete'` で保存されている設定は読み込み時にそのまま保持
- 設定画面で行を編集する際、ドロップダウンに `delete` 選択肢がないため、保存時に意図しない値降格が起きないよう注意が必要
- 対策: `applyPermissionRules` で `delete` 値の行を表示する際は、ドロップダウンに `delete` オプションを一時的に追加するか、別の方法で値を保持する
- 内部の権限判定（`canEdit` / `canDelete` 算出）は引き続き `delete` を `edit` の上位として処理する

### 8.7 version 4 → version 6 マイグレーション詳細

`color` プロパティを `bgColor` に流用し、背景色の WCAG 相対輝度から `textColor` を自動判定する。

**WCAG 相対輝度計算式**:

```javascript
function getRelativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const linearize = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const R = linearize(r);
  const G = linearize(g);
  const B = linearize(b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function pickTextColorByBg(bgHex) {
  return getRelativeLuminance(bgHex) > 0.5 ? '#000000' : '#ffffff';
}
```

**判定基準**:
- 輝度 > 0.5 → `textColor = '#000000'`（黒文字）
- 輝度 ≤ 0.5 → `textColor = '#ffffff'`（白文字）

**変換手順（擬似コード）**:

```
function migrateV4toV6(config):
  newRules = []

  for each rule in config.permissionRules:
    bgColor = rule.color ?? '#1976d2'
    textColor = pickTextColorByBg(bgColor)
    newRules.push({
      fieldCode: rule.fieldCode,
      fieldType: rule.fieldType,
      permission: rule.permission,
      bgColor: bgColor,
      textColor: textColor
    })
    // color プロパティは含めない（削除）

  config.permissionRules = newRules
  config.fieldValueRules = []  // v6 新規追加
  config.version = 6
  return config
```

version 2 / 3 → version 6 の直接マイグレーション:
- 先に v3 → v4 相当の変換（`fieldAccount` 変換・`color` 補完）を行い、その後 §8.7 の v4 → v6 変換を適用する
- `color` が存在しないエントリは `bgColor: '#1976d2'`・`textColor: '#ffffff'` を補完する

### 8.8 version 5 → version 6 マイグレーション（新規）

v5 から v6 への変換は最小限。`fieldValueRules` キーを空配列で追加し、`version` を更新するのみ。

```javascript
function migrateV5toV6(config) {
  // permissionRules はそのまま維持（構造変更なし）
  // fieldValueRules を空配列で初期化
  if (!Array.isArray(config.fieldValueRules)) {
    config.fieldValueRules = [];
  }
  config.version = 6;
  return config;
}
```

v4 / v3 / v2 → v6 は既存の連鎖マイグレーション（v? → v5 → v6 相当）で対応する。各マイグレーション関数を順番に呼び出す方式を推奨する（例: `migrateV2toV3()` → `migrateV3toV4()` → `migrateV4toV5()` → `migrateV5toV6()`）。

---

## 9. 確定事項（2026-05-15 ユーザー判断 / 2026-05-19 追記）

以下は 2026-05-15 にユーザーの判断により確定した設計方針。既存実装との後方互換と kintone 標準的な考え方を最重視して採用。

| ID | 確定内容 | 採用理由 |
|---|---|---|
| Q1 エントリ数上限 | 上限なし（バリデーションなし） | `kintone.plugin.app.setConfig` の 65535 バイト制限に対し、権限設定エントリの情報量は小さく、実用範囲では制限に達しない |
| Q2 権限粒度 | 3 段階: `view`（閲覧のみ）/ `edit`（編集可）/ `delete`（削除可） | kintone 標準のレコード権限粒度と整合。段階的包含（delete ⊇ edit ⊇ view） |
| Q3 マージ規則 | OR 結合（複数エントリのどれか 1 つでも該当すれば該当権限を付与、最高権限採用） | kintone のレコード権限設定と同じ考え方。複数手段で権限を付与できる柔軟性を確保 |
| Q4 空設定フォールバック | 全員 `edit` 権限・`bgColor: null, textColor: null`（既存挙動互換）。permissionRules と fieldValueRules がともに空配列の場合に適用 | 既存の `fieldAccount` 未設定時の挙動（全員編集可相当）と後方互換を優先 |
| Q5 既存 fieldAccount (v4) | **廃止**。マイグレーション時に `permissionRules` 先頭行へ変換（permission: edit, bgColor: #1976d2, textColor: 輝度自動判定） | アカウントフィールドと編集権限設定の分離による UX 低下を解消。役割を一元管理 |
| Q6 削除操作の実装範囲 | `delete` 権限の制御は将来実装。初期実装では `canDelete` フラグを算出するのみとし、削除 UI は実装しない | 現状カレンダー画面に削除ボタンが存在しない。初期実装スコープを絞る |
| Q7 フィールド種別 | USER_SELECT のみ対応（未対応: 組織・グループ選択フィールド） | 別カスタマイズで組織所属ユーザーを USER_SELECT フィールドに書き出す運用に変更したため、ORGANIZATION_SELECT / GROUP_SELECT の判定は不要 |
| Q8 レコードデータ参照 | 案 A 採用: `KcEvent` に `permissionFields: { [fieldCode]: string[] }` を追加し、レコード取得時に権限対象フィールドの value[] を格納 | 追加 API 呼び出しが不要で、権限判定をメモリ内で完結できる |
| Q9 組織・グループフィールド対応 | 未対応（別カスタマイズで USER_SELECT に書き出す運用） | ORGANIZATION_SELECT / GROUP_SELECT への直接参照は行わない。組織所属管理は kintone アプリ外の別カスタマイズに委ねる |
| Q10 色指定方法 | HTML5 `<input type="color">`（カラーピッカー）。`bgColor` / `textColor` はいずれも #RRGGBB 形式必須 | フィールド値に依存しない管理者手動設定。標準 HTML5 入力要素で実装コスト最小 |
| Q11 複数該当時の色優先 | 上から最初にマッチした行の bgColor / textColor を採用（権限の OR 結合とは別ルール） | 色と権限で独立したルールを採用。色は「自分のメインフィールド」の感覚に合致する先勝ち方式 |
| Q12 既定色 | マイグレーション時のデフォルト bgColor は `#1976d2`（青系）/ textColor は WCAG 輝度自動判定。新規ルール追加時のデフォルトは permission: view / bgColor: #1976d2 / textColor: #ffffff | 既存の kc-event--mine CSS における青系ハイライトとの視覚的整合性を維持。権限デフォルトは安全側（閲覧者）に設定 |
| Q13 'mine'/'others' フィルタの permissionRules 空時挙動 | フィルタ UI を非表示にする（設定後に表示）。v6 では fieldValueRules も含め両配列空時に非表示 | 空配列時は全予定が bgColor === null となりフィルタが機能しないため、誤解を招く UI を排除 |
| Q14 権限種別の表示ラベルと UI 表示 | 「管理者(delete)/編集者(edit)/閲覧者(view)」。管理者は Phase 2 まで非表示。順序は権限強い順 (2026-05-18) | |
| Q16 背景色と文字色の分離 | bgColor + textColor の 2 プロパティ (2026-05-18) | カレンダー上の予定バー・チップの視認性向上。管理者が背景色・文字色を独立して設定できる |
| Q17 背景色変更時の文字色自動補正 | 自動補正しない（マイグレーション時のみ WCAG 輝度から自動判定）(2026-05-18) | ユーザーの選択を尊重。意図的な配色（例: 赤背景に白文字）を自動で書き換えない |
| Q18 権限設定の 2 系統 | permissionRules（権限ユーザー設定）と fieldValueRules（権限フィールド設定）の 2 系統で権限を管理する (2026-05-19) | ユーザー属性ベースとレコード属性ベースの 2 軸で柔軟な権限制御を実現 |
| Q19 権限の優先順位 | フィールド値ルール（fieldValueRules）> ユーザー権限ルール（permissionRules）。権限・色の決定ともに同一の優先順位を適用 (2026-05-19) | レコード属性（ステータス等）による制御を優先することで、個人属性より業務フローを重視した制御が可能 |
| Q20 対応フィールド型 | 権限フィールド設定の対応型: DROP_DOWN / RADIO_BUTTON / CHECK_BOX / STATUS (2026-05-19) | 選択系フィールドおよびプロセス管理ステータスを対象とすることで、業務フロー連携に対応 |

---

## 10. 未解決事項・リスク・前提

| ID | 内容 | 推奨方針 |
|---|---|---|
| U-7 | CHECK_BOX フィールドのマッチ条件（配列の任意要素一致 or 完全一致） | 任意要素一致を推奨（チェックボックスの複数選択を柔軟に扱うため）。管理者確認後に確定 |
| U-8 | fieldValueRules が複数マッチした場合の挙動（例: 同一レコードで「ステータス=確定済」と「重要度=高」の両方にマッチ） | 上から最初マッチ採用を推奨（permissionRules の既存ルールと統一）。ただし permissionRules は権限 OR 結合・色は先勝ちというデュアルルールのため、fieldValueRules も同様に権限単独の場合はどう扱うか管理者確認要 |
| U-9 | ステータスフィールドのフィールドコード自動検出（kintone API から `$status` として取得）か、ユーザーが手動でフィールドコードを入力するか | kintone API 自動取得を推奨（`GET /k/v1/app/status.json` の `enabled` フィールドで有効無効を判定し、有効な場合のみ「ステータス (STATUS)」を選択肢に追加）。手動入力はタイポによる設定ミスリスクがある |

---

## 付録: UX / シーケンス概要

### A.1 設定画面の操作フロー（v6 更新）

```
1. 管理者がプラグイン設定画面を開く
2. セクション 1「共通設定」を確認

【権限ユーザー設定】
3. 「+ 行を追加」で権限ユーザーエントリを追加
4. フィールドプルダウン: USER_SELECT 型フィールドを選択
5. 権限種別ドロップダウン: 「編集者」「閲覧者」を選択
6. 背景色・文字色カラーピッカーで色を指定
7. 必要な行数分繰り返す

【権限フィールド設定】
8. 「+ 行を追加」で権限フィールドエントリを追加
9. フィールドプルダウン: DROP_DOWN / RADIO_BUTTON / CHECK_BOX / STATUS から選択
10. 値プルダウン: 選択したフィールドの選択肢が自動表示されるので選択
11. 権限種別ドロップダウン: 「編集者」「閲覧者」を選択
12. 背景色・文字色カラーピッカーで色を指定
13. 必要な行数分繰り返す

14. 「保存」または「保存して更新」で保存
```

### A.2 エンドユーザーのカレンダー表示フロー（v6 更新）

```
1. ユーザーがカレンダービューを開く
2. KC.Boot.init() 起動
   a. loadFromPluginConfig() で permissionRules / fieldValueRules (bgColor / textColor 含む) を読み込む
   b. KC.LoginContext.init():
      - getLoginUser() でユーザーコード取得（追加 API 呼び出しなし）
3. レコード一覧取得 → KcEvent 変換
   - 権限対象 USER_SELECT フィールドの value[].code を permissionFields に格納
   - fieldValueRules 対象フィールドの値を valueFields に格納
4. カレンダー描画:
   - 各イベントに対して getPermission() を評価（メモリ内判定のみ）
   - [優先] fieldValueRules のいずれかにマッチ → そのルールの権限・色を採用 (source='field')
   - [次順] permissionRules のいずれかにマッチ → そのルールの権限・色を採用 (source='user')
   - [最後] 両配列空 → フォールバック（全員 edit）(source='fallback')
   - canEdit = true の場合のみ DnD ハンドラを有効化
   - bgColor が null でない場合: element.style.backgroundColor にインライン設定
   - textColor が null でない場合: element.style.color にインライン設定
   - 両方 null の場合: インラインスタイル設定をスキップ（テーマ色を維持）
   - canDelete = true の場合の削除ボタン表示は Phase 2 対応（§9 Q6 確定）
```

### A.3 権限判定フローチャート（v6）

```
レコード取得
    ↓
fieldValueRules を上から走査
    ↓
マッチあり? → YES → そのルールの permission / bgColor / textColor を採用 → カレンダー描画
    ↓ NO
permissionRules を上から走査
    ↓
マッチあり? → YES → 最高権限採用 (§5.3) + 最初マッチ色採用 (§5.8) → カレンダー描画
    ↓ NO
設定あり・非マッチ? → YES → view 相当 (canEdit:false) + 色なし → カレンダー描画
    ↓ NO
両配列空? → YES → フォールバック (全員 edit) + 色なし → カレンダー描画
```

---

*このドキュメントは 2026-05-15 時点の調査結果をもとに作成されました。第 2 版（2026-05-15）にて §9 全未確定事項をユーザー判断で確定し、§3〜§8 を具体化。第 3 版（2026-05-15）にて組織・グループ対応を削除し USER_SELECT のみに縮小。第 4 版（2026-05-15）にてアカウントフィールドを廃止し編集権限ルールに統合。各ルールに color プロパティを追加。KC.LoginContext.isMine を廃止し getPermission に color を統合。version 3 → 4 マイグレーション規則を追加。第 4.1 版（2026-05-15）にて KC.EventFilter の 'mine'/'others' フィルタ仕様（FR-7・§5.9）を明文化。permissionRules 空時のフィルタ UI 非表示を確定（Q13）。第 4.2 版（2026-05-18）にて権限種別の表示ラベルを「管理者/編集者/閲覧者」に変更（内部値は維持）。Phase 2 までは「管理者」(delete) を UI 非表示。ドロップダウン順序を権限強い順に変更。既存 delete 値の取り扱いを §8.6 に明記（Q14）。第 5 版（2026-05-18）にて背景色と文字色を分離。`color` プロパティを廃止し `bgColor` / `textColor` の 2 プロパティに変更。v4 → v5 マイグレーションで WCAG 相対輝度から textColor を自動判定。§5.6 getPermission 戻り値・§5.8 色決定ロジック・§6.1 JSON スキーマ・§8.7 マイグレーション詳細を更新（Q16・Q17）。第 6 版（2026-05-19）にて「編集権限設定」を「権限ユーザー設定」にリネーム。新規「権限フィールド設定」(fieldValueRules) を追加。FR-8〜FR-10、§5.10〜§5.11、§6.1〜§6.2、§8.8 を新設。優先順位: フィールド値ルール > ユーザー権限ルール（権限・色とも）。Q18〜Q20 を確定事項に追記。未解決事項 U-7〜U-9 を §10 に整理。*
