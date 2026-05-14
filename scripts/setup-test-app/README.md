# テストアプリセットアップスクリプト

kintone の空アプリに対して、KC Calendar プラグイン動作検証用のフィールドを一括追加してデプロイするスクリプトです。

## 前提

- kintone 環境に空アプリをあらかじめ作成しておく必要があります。アプリ名・スペース選択は手動で行ってください。
- Node.js 18 以上が必要です。
- 空アプリへの API アクセス権があること（アプリ管理権限が必要です）。

## API トークンの発行手順

1. 対象アプリを kintone で開く
2. アプリ設定 → 設定 → API トークン を開く
3. 「追加する」をクリックしてトークンを発行する
4. 以下のスコープにチェックを入れる:
   - **アプリ管理**（addFormFields / deployApp / getDeployStatus の呼び出しに必要）
5. 「保存」→「アプリを更新」をクリックして反映する
6. 表示されたトークン文字列をコピーして `.env` に貼り付ける

> 注意: API トークンは発行直後のみ全文が表示されます。控えておくか、再発行してください。

## セットアップ手順

### 1. .env を作成する

`.env` はプロジェクトルートで一元管理しています。プラグインアップローダーとこのスクリプトで同じ `.env` を共有します。

```bash
cp .env.example .env
```

`.env` を開いて以下の値を入力します。

```
KINTONE_BASE_URL=https://your-domain.cybozu.com
KINTONE_API_TOKEN=your-api-token-here
KINTONE_APP_ID=123
KC_FIELDS_VARIANT=datetime
```

| 変数名 | 説明 |
|---|---|
| `KINTONE_BASE_URL` | kintone 環境の URL（末尾スラッシュなし） |
| `KINTONE_API_TOKEN` | 手順 3 で発行した API トークン |
| `KINTONE_APP_ID` | 空アプリのアプリ ID（URL の `/k/123/` の数字） |
| `KC_FIELDS_VARIANT` | `datetime`（時間予定対応）または `date`（終日のみ） |

> 注意: `.env` はプロジェクトルート (`kintone-calendar/.env`) に配置してください。`scripts/setup-test-app/.env` は不要です。

### 2. 依存パッケージをインストールする

プロジェクトルートで実行してください。

```bash
npm install
```

`@kintone/rest-api-client` および `dotenv` がインストールされます。

### 3. スクリプトを実行する

```bash
npm run setup:test-app
```

実行すると以下の処理が行われます。

1. 既存フィールドコードを確認する
2. 不足しているフィールドのみを追加する（preview 環境）
3. デプロイを開始する
4. デプロイ完了まで待機する（最大 120 秒）

完了すると以下のようなメッセージが表示されます（新規アプリの場合）。

```
--- kintone テストアプリセットアップ ---
対象アプリ ID   : 123
フィールド構成  : datetime
設定フィールド数: 11

[1/3] フィールドを追加しています...
      追加対象: title, startDate, endDate, status, userColor, memo, allday, place, userName, userMail, account (11 件)
      フィールド追加完了 (新規 11 件 / スキップ 0 件)
[2/3] デプロイを開始しています...
      デプロイ開始
[3/3] デプロイ完了を待機しています (最大 120秒)...

セットアップが完了しました。
アプリ URL: https://your-domain.cybozu.com/k/123/
```

## 既存アプリへの再実行

すでにフィールドが追加済みのアプリに対して再実行した場合、不足しているフィールドのみが追加されます。全フィールドが追加済みの場合はデプロイも行わずに終了します。

例: 既存 6 フィールド (title/startDate/endDate/status/userColor/memo) に 5 件追加する場合

```
[1/3] フィールドを追加しています...
      既存フィールド検出: title, startDate, endDate, status, userColor, memo
      追加対象: allday, place, userName, userMail, account (5 件)
      フィールド追加完了 (新規 5 件 / スキップ 6 件)
[2/3] デプロイを開始しています...
      デプロイ開始
[3/3] デプロイ完了を待機しています (最大 120秒)...

セットアップが完了しました。
アプリ URL: https://your-domain.cybozu.com/k/123/
```

例: 全フィールドが既存の場合（変更なしで終了）

```
[1/3] フィールドを追加しています...
      既存フィールド検出: title, startDate, endDate, status, userColor, memo, allday, place, userName, userMail, account
      追加対象: なし (全 11 件が既存)
      追加処理をスキップします。デプロイも不要のため終了します。

セットアップが完了しました (変更なし)。
アプリ URL: https://your-domain.cybozu.com/k/123/
```

## 追加されるフィールド一覧

### datetime バリアント（時間予定対応版）

| フィールドコード | ラベル | kintone 型 | 必須 |
|---|---|---|---|
| `title` | タイトル | SINGLE_LINE_TEXT | 必須 |
| `startDate` | 開始日時 | DATETIME | 必須 |
| `endDate` | 終了日時 | DATETIME | 必須 |
| `status` | ステータス | DROP_DOWN | 任意 |
| `userColor` | 色 | DROP_DOWN | 任意 |
| `memo` | メモ | MULTI_LINE_TEXT | 任意 |
| `allday` | 終日 | CHECK_BOX | 任意 |
| `place` | 場所 | SINGLE_LINE_TEXT | 任意 |
| `userName` | 利用者氏名 | SINGLE_LINE_TEXT | 任意 |
| `userMail` | メールアドレス | SINGLE_LINE_TEXT | 任意 |
| `account` | アカウント | USER_SELECT | 任意 |

### date バリアント（終日のみ版）

`startDate` / `endDate` のフィールド型が `DATE` になります。他は datetime バリアントと同じです。

> 注意: `date` バリアントはすべての予定が自動的に終日扱いになります。時間ありレーンには表示されません（FIELD_REFERENCE.md §1 参照）。

> 補足: `date` バリアントでは `startDate`/`endDate` が DATE 型（終日固定）のため、追加された `allday` CHECK_BOX フィールドは実質的に参照されません。時間あり予定と終日予定の混在運用を想定する場合は `datetime` バリアントを使用してください。

## KC Calendar プラグインとのフィールドマッピング

セットアップ完了後、プラグイン設定画面で以下のように設定してください。

| プラグイン設定項目 | フィールドコード |
|---|---|
| タイトルフィールド | `title` |
| 開始日時フィールド | `startDate` |
| 終了日時フィールド | `endDate` |
| ステータスフィールド | `status` |
| 終日フィールド | `allday` |
| 色フィールド | `userColor` |
| 場所フィールド | `place` |
| 利用者氏名フィールド | `userName` |
| メールアドレスフィールド | `userMail` |
| アカウントフィールド | `account` |
| メモフィールド | `memo` |

## 特定フィールドの型を変更したい場合

kintone REST API はフィールドの型変更をサポートしていません。型を変更するには、対象フィールドを一度削除してから再追加する必要があります。

### 手順: 削除 → 再追加

```bash
# 削除対象フィールドコードをスペース区切りで指定する
npm run reset:test-app:fields -- userMail account

# 削除完了後、正しい型でフィールドを再追加する
npm run setup:test-app
```

> 注意: フィールドを削除すると、そのフィールドに入力されていたデータはすべて失われます。テストアプリでのみ実行してください。

### reset:test-app:fields の動作

- 指定フィールドがアプリに存在しない場合は警告を表示してスキップします（エラーにはなりません）
- 削除 → デプロイ まで自動で行います
- デプロイ完了後に `npm run setup:test-app` を実行すると、fields-config から正しい型でフィールドが再追加されます

## 失敗時の対処

### 「環境変数が設定されていません」

`.env` ファイルが存在するか、値が正しく入力されているか確認してください。

### 「既存フィールドの取得に失敗しました」

API トークンのスコープを確認してください。`getFormFields` (preview) の呼び出しにはアプリ管理権限が必要です。

### 「デプロイが FAIL ステータスで終了しました」

kintone 管理画面の「アプリの設定」→「変更の履歴」でエラー内容を確認してください。API トークンのスコープが不足している場合は「アプリ管理」権限を追加してください。

### デプロイタイムアウト（120 秒超過）

kintone 管理画面でデプロイ状況を確認してください。デプロイ完了後であれば、アプリはすでに更新されています。デプロイが失敗している場合はエラー内容を確認して対処してください。

### API トークン認証エラー

API トークンが正しくコピーされているか確認してください。スペースや改行が混入していないか注意してください。
