# 要件定義書: kintone プラグイン化移行

**文書番号**: REQ_plugin-migration
**作成日**: 2026-05-13
**最終更新日**: 2026-05-14 (第 4 版)
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 (第 4 版)
**関連文書**: PLUGIN_DISCUSSION.md, HANDOVER.md, DESIGN.md, FIELD_REFERENCE.md, DEPLOY_GUIDE.md

### 更新履歴

| 版 | 日付 | 変更内容 |
|---|---|---|
| 第 4 版 | 2026-05-14 | ユーザー要望反映: Phase 7 (ビュー自動管理) + Phase 8 (フィルタの一覧委譲) を追補。§3・§4・§5・§6・§7・§8・§9・§10 を更新。Q7-Q9 確定反映 (2026-05-14 ユーザー確定)。reviewer 指摘反映 (htmlForPC → html、AC25 文言緩和、デプロイ巻き込み警告) |
| 第 3 版 | 2026-05-13 | Q1 方針変更: アプリテンプレート XML 方式 → REST API スクリプト方式。§2.1・§3 Phase 4・§6 AC21・§9・§10 Q1 を更新 |
| 第 2 版 | 2026-05-13 | Phase 2 実装との §4.3 整合: calendarTitle キーを追記 (reviewer 指摘 NG#1 対応) |
| 第 1 版 | 2026-05-13 | Q1〜Q4 ユーザー確定内容を反映。ステータスを確定版に更新。AC9, AC10 追加。§5.3 移行マイルストーン新規追加 |
| ドラフト | 2026-05-13 | 初版作成 |

---

## 1. 目的・背景

### 1.1 現状の課題

- カスタマイズ JS 方式 (loader.js + GitHub Pages 配信) は単一アプリ向け設計であり、複数アプリへ展開する際に loader.js の登録とフィールドコードの合わせ込みが重複作業になる
- フィールドコード (`KC.Config.FIELD`) や除外ステータス (`EXCLUDED_STATUSES`)、終日ラベル (`ALLDAY_LABEL`) 等の運用パラメータがソースコードにハードコードされており、非エンジニアが変更できない
  - 参照: `src/kc-calendar.js:18-60` (`KC.Config` ブロック)
  - 参照: `FIELD_REFERENCE.md §2` (ステータス固定文字列の不整合)
- Phase 2 (時間予定 DnD / 日跨ぎ表示 / バグ A〜E 修正) はコミット 219d720 で push 済みだが、現運用アプリ (モバイル Wi-Fi 貸出管理) が終日のみ運用のため **実機未検証** のまま残っている
  - 参照: `HANDOVER.md §4`、メモリ `project-kintone-calendar-phase2-unverified`
- 旧カスタマイズ JS 方式では loader.js のキャッシュバスター (`docs/loader.js:17` の `var V`) を手動更新する運用が必要であり、ヒューマンエラーのリスクがある

### 1.2 戦略

ロードマップ 3 段階 (2026-05-13 ユーザー提示) を以下の共通基盤で解決する:

1. **プラグイン化を進行** — kintone プラグイン ZIP 形式への移行により、複数アプリへの展開と設定の GUI 化を実現
2. **別アプリでプラグインが使えるか検証** — 時間予定フィールド (DATETIME 型) を持つテストアプリを構築し、プラグインの動作を検証
3. **その別アプリで時間レーン挙動の検証を行う** — Phase 2 (時間予定 DnD / 日跨ぎ表示) の実機検証を同一テストアプリ上で実施

戦略の核心: プラグイン化と Phase 2 実機検証を「別アプリ環境構築」という共通基盤で同時解決する。

---

## 2. スコープ

### 2.1 含まれるもの

| 成果物 | 説明 |
|---|---|
| `manifest.json` | kintone プラグイン仕様に準拠したマニフェスト |
| `config.html` / `config.js` / `config.css` | プラグイン設定画面 (§4 参照) |
| `desktop.js` | 現 `src/kc-calendar.js` のプラグイン設定読み込み対応版 |
| `desktop.css` | 現 `src/kc-calendar.css` のプラグイン版コピー |
| ビルドスクリプト | `@kintone/plugin-packer` による zip 化 |
| 設定値の保存 / 読み込み | `kintone.plugin.app.getConfig` / `setConfig` 利用 |
| テストアプリ構築 | 時間予定 (DATETIME) + 終日 (DATE or CHECK_BOX) を含む kintone アプリ |
| テストアプリ構築用 REST API スクリプト (scripts/setup-test-app/) | アプリ ID と API トークンを `.env` で受け取り、フィールド一括追加 → デプロイまで自動化。時間予定対応版 (DATETIME) と終日のみ版 (DATE) の 2 バリエーションを `fields-config.*.json` で提供 |
| ドキュメント整備 | インストール手順・設定マニュアル・移行ガイド |

### 2.2 含まれないもの (将来検討)

| 項目 | 理由 |
|---|---|
| 組織選択・グループ選択フィールド連携 | `PLUGIN_DISCUSSION.md` 将来検討項目に分類済み |
| カスタマイズ JS 方式 (loader.js) の廃止 | プラグイン版安定化後に別タスクとして実施 |
| TypeScript / ビルドツール導入 | `kintone-rules.md` 優先順位: JS で十分な規模 |
| 月ビュー / 日ビューのスタブ実装 | `DESIGN.md §3` に記載のスタブは本フェーズ外 |
| ARIA / キーボード DnD / タッチ対応 | `HANDOVER.md §4` 残存課題。別フェーズ |
| API 失敗時通知の UI 改善 | `HANDOVER.md §8` 将来課題 |

---

## 3. Phase 構成

PLUGIN_DISCUSSION.md の 5 Phase 構成を踏襲しつつ、ロードマップ 3 段階と統合した 6 Phase 構成とする。

### Phase 1: 準備 (1〜2 営業日)

**目的**: プラグイン開発環境を整備し、ディレクトリ構成と manifest 雛形を確定する

- `@kintone/plugin-packer` (または `create-plugin`) のセットアップ
- プラグインディレクトリ構成の確定 (下記 §3.7 参照)
- `manifest.json` 雛形の作成 (required_params の最小構成)
- `.gitignore` への plugin/dist/ 追加
- `package.json` にビルドスクリプト追加 (`npm run build:plugin`)

### Phase 2: 設定画面実装 (3〜5 営業日)

**目的**: kintone 管理者が GUI でフィールドマッピングと運用パラメータを設定できるようにする

- `config.html`: §4 の全設定項目を含む設定画面 HTML
- `config.js`:
  - `kintone.api('/k/v1/app/form/fields.json')` でフィールド一覧を取得し、プルダウンに表示
  - 設定値の `kintone.plugin.app.setConfig()` による保存
  - 保存済み設定値の再表示 (`getConfig` からの復元)
  - 必須項目の入力バリデーション
- `config.css`: 設定画面スタイル
- 設定項目の詳細は §4 を参照

### Phase 3: desktop.js 改修 (3〜5 営業日)

**目的**: `src/kc-calendar.js` をプラグイン設定から値を読み込む形式に改修する

- IIFE を `(function(PLUGIN_ID) { ... })(kintone.$PLUGIN_ID);` 形式に変更
  - 参照: `PLUGIN_DISCUSSION.md` desktop.js 主要変更点
- 起動時に `kintone.plugin.app.getConfig(PLUGIN_ID)` で設定値を取得
- 設定値が存在する場合は `KC.Config.FIELD` に上書き
- 設定値が存在しない場合は既存の `KC.Config.detectFields()` フォールバックを使用 (KC_ プレフィックス自動検出)
  - 参照: `src/kc-calendar.js:62-115` (`detectFields` メソッド)
- `EXCLUDED_STATUSES`、`ALLDAY_LABEL` も設定値から読み込む
- 既存ロジック (KC.Render / KC.DnD / KC.TimeSlots / KC.RenderWeek) は**変更しない** (ビュー切替リファクタ完了済・軽量化 Phase 1 完了済)
- `KC.Boot.init` 起動シーケンスの変更: `detectFields` 呼び出し前にプラグイン設定読み込みを挿入
  - 参照: `src/kc-calendar.js:4400-4815` (KC.Boot ブロック)

### Phase 4: パッケージング・別アプリ動作検証 (3〜4 営業日)

**目的**: プラグイン ZIP を生成し、別 kintone アプリへのインストールと基本動作を確認する (ロードマップ ②)

- ビルドスクリプトで plugin.zip を生成
- **scripts/setup-test-app/ に Node.js スクリプトを配置**: `@kintone/rest-api-client` を使用し、`/k/v1/preview/app/form/fields.json` へのフィールド一括追加と `/k/v1/preview/app/deploy.json` によるデプロイを自動化する
- **テストアプリ構築手順**: ユーザーが kintone で空アプリを作成 → API トークン発行 (フィールド追加 + 設定変更権限) → `.env` に設定 → `npm run setup:test-app` でフィールド一括投入
- **時間予定対応版 (DATETIME)** と**終日のみ版 (DATE)** の 2 バリエーションを `fields-config.*.json` で提供する
- **注意**: ユーザーが手動でアプリ枠 (アプリ名・スペース選択) を作成する必要あり。スクリプトはフィールド追加とデプロイのみを担う
- テストアプリへのプラグインインストールと設定
- 終日 DnD 移動・リサイズ・予定作成・編集・削除が現 loader 方式と同等動作することを確認

### Phase 5: 時間レーン挙動の実機検証 (2〜3 営業日) ← ロードマップ ③

**目的**: Phase 2 (時間予定 DnD / 日跨ぎ表示 / バグ A〜E) の実機検証を Phase 4 のテストアプリで実施する

- Phase 2 コミット 219d720 の以下を実機検証:
  - バグ A: `.kc-cell` への `data-date` 付与 → DnD 日付移動
  - バグ B: 終日バー `.kc-ad-event` への mousedown 配線
  - バグ C: CSS `.kc-event.ghost` / JS `.kc-ghost` クラス名整合
  - バグ D: リサイズハンドル DOM 存在確認
  - バグ E: 5px 閾値によるマウスダウン誤発動防止
  - 時間予定 DnD 移動・上下リサイズ
  - 日跨ぎ表示
  - 参照: `HANDOVER.md §4 主要バグ`
- **検証で発見した不具合は HANDOVER.md に追記し、個別対応は別タスクとして requirements/ 配下で起案する** (Q4 確定)
- 検証結果を `HANDOVER.md §4` に追記する

### Phase 6: ドキュメント・公開 (1〜2 営業日)

**目的**: プラグイン版の運用に必要なドキュメントを整備する

- `README.md` にプラグイン版インストール手順を追加
- `DEPLOY_GUIDE.md` にプラグインビルド手順 (`npm run build:plugin` → zip → kintone アップロード) を追加
  - 参照: `DEPLOY_GUIDE.md` 現行デプロイ方式の説明
- `DEPLOY_GUIDE.md` に kintone システム管理者設定の「署名なしプラグインを許可」を ON にする手順を追記する (Q2 確定: 署名なし + 許可設定で運用)
- 旧カスタマイズ JS 方式からプラグイン版への移行ガイド作成
- cybozu develop tools による署名手順は本フェーズでは取り扱わない。将来公開検討時の別タスクとする (Q2 確定)
- `HANDOVER.md` に Phase 5 検証結果を反映

### Phase 7: カスタマイズビューの自動管理 (見積 2〜3 営業日)

**目的**: プラグイン設定画面からカレンダー用カスタマイズビューを自動作成・更新し、管理者の手動 HTML 設置作業を不要にする

- 設定画面に「カレンダー用ビュー管理」セクションを追加
- 既存ビュー一覧をプルダウン表示 (`GET /k/v1/app/views.json` で取得)
- 「新規作成」または「既存ビューを更新」をプルダウンで選択
- 新規作成時: ビュー名入力フィールド (デフォルト名は **「カレンダー」** (2026-05-14 ユーザー確定))
- 「ビューを自動作成 / 更新」ボタン押下時の処理フロー:
  1. `GET /k/v1/app/views.json` で現在のビュー一覧を取得
  2. 既存ビュー更新の場合は**上書き確認ダイアログを表示する** (2026-05-14 ユーザー確定)
  3. `PUT /k/v1/preview/app/views.json` でカスタマイズビュー (`type: 'CUSTOM'`) を作成・更新
  4. `html` / `htmlForMobile` に `<div id="kc-root" class="kc-root"></div>` を設定
  5. 成功時は「ビューを作成しました。アプリを保存・公開してください。」と案内
- エラー時はエラーメッセージを表示し、手動設置手順 (§8.3 セクション 5 のガイド) へ誘導
- **API 呼出**: プラグイン設定画面では kintone セッションが使えるため `kintone.api()` で呼出可能 (REST API トークン不要、ログインユーザーのアプリ管理権限で動作)

### Phase 8: フィルタの kintone 一覧委譲 (見積 1〜2 営業日)

**目的**: プラグイン設定画面での除外ステータス設定を廃止し、kintone 標準の一覧絞り込み機能でフィルタを管理する

- `plugin/src/js/desktop.js` の `KC.Api.loadEvents` (`desktop.js:537`) でクエリ組み立て時に `kintone.app.getQueryCondition()` を呼び出す
  - 参照: `plugin/src/js/desktop.js:549-568` (現在のクエリ組み立てロジック)
- 取得した絞り込み文字列が空文字でない場合は、既存クエリ (期間絞り込み等) と AND で結合
- 空文字または null の場合はスキップ (期間絞り込みのみで動作)
- 設定画面 (`config.html`) の「フィルタ設定」セクションから「除外ステータス」入力欄 (`id="kc-excluded-statuses"`) を削除
  - 「ステータスフィールド」プルダウン (`id="kc-field-status"`) も不要になるため削除する。`excludedStatuses` 関連コード (`KC.Config.EXCLUDED_STATUSES` の参照箇所を含む) は**完全削除**する。空文字無視のフォールバックは持たない (2026-05-14 ユーザー確定)
  - 参照: `plugin/src/html/config.html:206-224` (現在の除外ステータス UI)
  - 参照: `plugin/src/js/config.js:72` (`elExcludedStatuses` DOM 参照)
  - 参照: `plugin/src/js/config.js:204-212` (excludedStatuses バリデーション)
  - 参照: `plugin/src/js/config.js:244` (collectConfig での収集)
- 設定画面「フィルタ設定」セクションに「フィルタは kintone 一覧の絞り込みで設定してください」のガイダンス文言を追加
  - 終日ラベル値 (`alldayLabel`) は残存させる (終日フィールド判定に必要なため)
- 旧設定値 (`excludedStatuses`) の取扱:
  - 旧プラグイン設定に `excludedStatuses` が残っていても読み込み時に無視する
  - マイグレーション処理は不要 (新方針での運用に切り替え)
  - 参照: `plugin/src/js/desktop.js:161` (desktop.js での excludedStatuses 読み込みコメント)
  - 参照: `plugin/src/js/desktop.js:191-193` (現在の excludedStatuses 反映処理)

### 合計見積

| Phase | 内容 | 見積 |
|---|---|---|
| 1 | 準備 | 1〜2 営業日 |
| 2 | 設定画面実装 | 3〜5 営業日 |
| 3 | desktop.js 改修 | 3〜5 営業日 |
| 4 | パッケージング・別アプリ動作検証 | 3〜4 営業日 |
| 5 | 時間レーン挙動の実機検証 | 2〜3 営業日 |
| 6 | ドキュメント・公開 | 1〜2 営業日 |
| 7 | カスタマイズビューの自動管理 | 2〜3 営業日 |
| 8 | フィルタの kintone 一覧委譲 | 1〜2 営業日 |
| | **合計** | **16〜26 営業日** |

> 注: Phase 4 に REST API スクリプト実装・ドキュメント作成・実機検証の工数を含むため、PLUGIN_DISCUSSION.md の 10〜17 営業日から微増。Phase 7 / Phase 8 は 2026-05-14 ユーザー要望により追補。

### 3.7 プラグインディレクトリ構成 (設計時点案)

```
kintone-calendar/ (既存)
├── src/                        ← 現 loader 方式向け (継続)
│   ├── kc-calendar.js
│   └── kc-calendar.css
├── docs/                       ← GitHub Pages 配信用 (継続)
│   ├── loader.js
│   ├── kc-calendar.js
│   └── kc-calendar.css
└── plugin/                     ← プラグイン版 (新規)
    ├── manifest.json
    ├── src/
    │   ├── js/
    │   │   ├── config.js
    │   │   └── desktop.js      ← src/kc-calendar.js のプラグイン対応版
    │   ├── css/
    │   │   ├── config.css
    │   │   └── desktop.css     ← src/kc-calendar.css のコピー
    │   ├── html/
    │   │   └── config.html
    │   └── image/
    │       └── icon.png
    └── dist/                   ← ビルド成果物 (gitignore 対象)
        └── plugin.zip
```

---

## 4. 設定画面の項目設計

プラグイン設定画面で kintone 管理者が入力する項目を定義する。

フィールドコード入力はテキスト入力ではなく、`kintone.api('/k/v1/app/form/fields.json')` で取得したフィールド一覧をプルダウン表示する設計とする (UX 向上・フィールドコード誤入力防止)。

参照: `PLUGIN_DISCUSSION.md §プラグイン設定画面仕様`、`FIELD_REFERENCE.md §1`

### 4.1 必須設定項目

| 設定項目 | 入力種別 | 対応 KC.Config キー | 説明 |
|---|---|---|---|
| タイトルフィールド | フィールドプルダウン | `FIELD.title` | SINGLE_LINE_TEXT 型のフィールドを選択 |
| 開始日時フィールド | フィールドプルダウン | `FIELD.start` | DATETIME 型または DATE 型を選択 |
| 終了日時フィールド | フィールドプルダウン | `FIELD.end` | DATETIME 型または DATE 型を選択 |
| デフォルトビュー | ラジオ (月 / 週 / 日) | `State.view` の初期値 | デフォルト: 月 |

### 4.2 任意設定項目

| 設定項目 | 入力種別 | 対応 KC.Config キー | 説明 |
|---|---|---|---|
| 終日フィールド | フィールドプルダウン / 未設定 | `FIELD.allday` | CHECK_BOX 型。DATETIME 型使用時に ON |
| 終日ラベル値 | テキスト | `ALLDAY_LABEL` | チェックボックスの選択肢値。例: 終日 (`src/kc-calendar.js:57`) |
| 色フィールド | フィールドプルダウン / 未設定 | `FIELD.color` | イベント色分け用 |
| 場所フィールド | フィールドプルダウン / 未設定 | `FIELD.place` | |
| 利用者氏名フィールド | フィールドプルダウン / 未設定 | `FIELD.userName` | |
| メールアドレスフィールド | フィールドプルダウン / 未設定 | `FIELD.userMail` | |
| アカウントフィールド | フィールドプルダウン / 未設定 | `FIELD.account` | USER_SELECT 型 |
| メモフィールド | フィールドプルダウン / 未設定 | `FIELD.memo` | MULTI_LINE_TEXT 型 |

> **Phase 8 変更 (2026-05-14)**: 「ステータスフィールド」と「除外ステータス」は設定画面から削除する。フィルタは kintone 一覧の絞り込み機能で管理する方針に変更 (§3 Phase 8 参照)。

### 4.3 設定値の保存形式

`kintone.plugin.app.setConfig()` に渡す設定オブジェクトのキー定義 (設計時点案):

```javascript
{
  fieldTitle:    'フィールドコード',  // 必須
  fieldStart:    'フィールドコード',  // 必須
  fieldEnd:      'フィールドコード',  // 必須
  calendarTitle: '',                 // 任意。空文字時は detectAppName フォールバック (§10 Q5)
  defaultView:   'month',            // 'month' | 'week' | 'day'
  fieldAllday:   'フィールドコード',  // 任意
  alldayLabel:   '終日',
  fieldColor:    '',
  fieldPlace:    '',
  fieldUserName: '',
  fieldUserMail: '',
  fieldAccount:  '',
  fieldMemo:     '',
}
```

> 注意: `kintone.plugin.app.setConfig` / `getConfig` の値はすべて文字列として保存される。
>
> **Phase 8 変更 (2026-05-14)**: `fieldStatus` と `excludedStatuses` を保存形式から削除。旧設定値に `excludedStatuses` が残っていても desktop.js は読み込み時に無視する。フィルタは `kintone.app.getQueryCondition()` で取得した kintone 一覧の絞り込み条件を使用する。

### 4.4 設定画面でのビュー管理 UI (Phase 7 追加)

Phase 7 により、カスタマイズビューの作成・更新を設定画面から自動化できるようになる。

- REST API (`PUT /k/v1/preview/app/views.json`) を使用してカスタマイズビューを作成・更新
- 設定画面に「カレンダー用ビュー管理」セクションを追加 (§8.3 セクション構成参照)
- Phase 7 実装前は従来の手動設置ガイドを設定画面に表示する
  - 参照: `plugin/src/html/config.html:247-279` (現在のセットアップガイドセクション)
  - 参照: `PLUGIN_DISCUSSION.md §論点5`

---

## 5. 移行戦略

### 5.1 既存アプリへの影響

- 現運用アプリ (モバイル Wi-Fi 貸出管理) は **loader.js 方式を継続**する
- 並行運用期間は **プラグイン Phase 5 完了まで** に限定する
- `docs/loader.js` のキャッシュバスター運用 (`var V` の更新) は並行運用中も継続が必要
  - 参照: `DEPLOY_GUIDE.md §loader.js のキャッシュバスター版数管理`
- **プラグイン安定後 (Phase 5 検証クリア後) に現運用アプリ (モバイル Wi-Fi 貸出管理) も全面移行する** (Q3 確定)

### 5.2 フォールバック設計

プラグイン設定値が存在しない場合 (初回インストール・設定未完了) は既存の `KC.Config.detectFields()` (KC_ プレフィックス自動検出) をフォールバックとして使用する。

```
優先順位:
1. プラグイン設定 (getConfig) に値があれば使用
2. なければ KC_ プレフィックスで自動検出 (detectFields)
3. どちらも失敗した場合はエラーを表示して起動を中断
```

参照: `PLUGIN_DISCUSSION.md §論点4`、`src/kc-calendar.js:62-115` (detectFields)

### 5.3 移行マイルストーン

旧 loader 方式からプラグイン方式への全面移行は以下の 3 ステップで実施する:

1. **Phase 5 検証クリア**: テストアプリでプラグイン版の品質を確認し、HANDOVER.md に結果を記録する
2. **現運用アプリへの段階適用**: Phase 5 検証クリア後に現運用アプリ (モバイル Wi-Fi 貸出管理) へプラグイン版を適用する (別タスク)
3. **loader.js 方式の廃止**: 現運用アプリの移行完了後に loader.js 方式を廃止し、`docs/` の並行管理・キャッシュバスター運用を終了する (別タスク)

### 5.4 src / plugin の関係

- `plugin/src/js/desktop.js` は `src/kc-calendar.js` を基に改修する (コピー&改修、同一ファイルの兼用は行わない)
- 将来的に両方式の同期が問題になった場合は、`src/kc-calendar.js` を真とし `plugin/src/js/desktop.js` への反映手順を整備する (別タスク)
- loader 方式の `src/kc-calendar.js` → `docs/kc-calendar.js` の同期ルールは変更しない
  - 参照: `CLAUDE.md §編集ルール`、`HANDOVER.md §3`

### 5.5 プラグイン版における loader.js 不使用

プラグイン版では GitHub Pages 経由の動的読み込みは行わない。`plugin/dist/plugin.zip` を kintone に直接アップロードする形式とする。これにより:
- CSP / CORS 設定を考慮した外部サーバー依存リスクが解消される (実機確認必須: §9 リスク参照)
- キャッシュバスター手動更新の運用負荷が解消される

### 5.6 Phase 7 / Phase 8 適用時の互換性 (2026-05-14 追記)

**Phase 7 (ビュー自動管理) 適用後**:
- 旧 loader 方式のユーザーがプラグインに移行する際、設定画面からカレンダー用カスタマイズビューを自動生成できる
- ただし、`PUT /k/v1/preview/app/views.json` でビューを更新した後は**アプリの保存・公開**が別途必要 (kintone の仕様)
- 既存の手動設置ガイド (§4.4 の手順) はフォールバックとして残す

**Phase 8 (フィルタの一覧委譲) 適用後**:
- 旧 `excludedStatuses` 設定で運用していたユーザーは、除外条件を kintone 一覧の絞り込み設定に移行する必要がある
  - 例: 旧設定「除外ステータス: 返却済,削除済」→ kintone 一覧画面で「ステータス が 返却済 でない かつ 削除済 でない」の絞り込みを保存ビューとして設定
- 旧 `excludedStatuses` 設定値は desktop.js が読み込み時に無視するため、自動フォールバックは行わない
- **運用注意点**: Phase 8 適用後、既存ユーザーへの案内ドキュメントを整備する (Phase 6 ドキュメント整備の中で対応)

---

## 6. 受け入れ条件 (AC)

### Phase 1 完了基準

- AC1: `plugin/` ディレクトリ構造が §3.7 の構成に準拠している
- AC2: `manifest.json` が kintone プラグイン仕様 (cybozu developer network) に準拠している
- AC3: `npm run build:plugin` で `plugin/dist/plugin.zip` が生成される

### Phase 2 完了基準

- AC4: 設定画面で §4.1 の必須項目がすべて入力・保存・再表示できる
- AC5: 設定画面で §4.2 の任意項目が入力・保存・再表示できる (未設定も含む)
- AC6: フィールドプルダウンにアプリのフィールド一覧が表示される
- AC7: 必須項目が未入力の状態で保存ボタンを押した際にバリデーションエラーが表示される

### Phase 3 完了基準

- AC8: プラグイン設定値が `KC.Config.FIELD` に正しく反映される
- AC9: プラグイン設定値が存在しない場合、`detectFields()` フォールバックが動作する
- AC10: `EXCLUDED_STATUSES` と `ALLDAY_LABEL` がプラグイン設定値から読み込まれる

### Phase 4 完了基準

- AC11: `plugin.zip` が kintone にアップロード可能であり、インストールエラーが発生しない
- AC12: 別 kintone アプリ (テストアプリ) にインストールし、設定値で動作する
- AC13: ビュー切替 (月 / 週 / 日)・予定追加・編集・削除・DnD (終日) が現 loader 方式と同等動作する
- AC14: 既存 loader 方式の運用アプリには影響を与えない (並行運用は Phase 5 完了まで)

> **Phase 8 変更 (2026-05-14)**: AC14 は既存 loader 方式アプリへの無影響確認に限定する。旧 excludedStatuses によるフィルタ動作確認は Phase 8 完了後は AC26 / AC27 で代替する。

### Phase 5 完了基準

- AC15: 時間予定フィールド (DATETIME 型) を持つテストアプリで時間レーンにイベントが表示される (未検証状態から検証完了への移行)
- AC16: Phase 2 バグ A〜E の検証結果 (Pass / Fail / 未再現) が `HANDOVER.md §4` に記録される
- AC17: 検出した不具合が HANDOVER.md に追記され、個別対応が別タスクとして requirements/ 配下で起案される (Q4 確定)

### Phase 6 完了基準

- AC18: インストール手順・設定マニュアルが README または別ドキュメントに整備される
- AC19: `DEPLOY_GUIDE.md` にプラグインビルド手順が追記される
- AC20: `HANDOVER.md §4` に Phase 5 検証結果が反映される
- AC21: `scripts/setup-test-app/` のスクリプトがユーザー環境で正常に実行され、フィールド一括追加とデプロイが完了すること
- AC22: Phase 5 検証で検出した不具合が HANDOVER.md に追記されていること

### Phase 7 完了基準

```
AC23:
Given: プラグイン設定画面の「カレンダー用ビュー管理」セクションで「新規作成」を選択し
       ビュー名を入力して「ビューを自動作成」ボタンを押下する
When:  API 呼出が成功する
Then:  kintone アプリにカスタマイズビューが新規作成され
       html / htmlForMobile に <div id="kc-root" class="kc-root"></div> が含まれること
       設定画面に「ビューを作成しました。アプリを保存・公開してください。」が表示されること
       設定画面の成功メッセージに「未保存の設定変更も同時に公開されます」の旨が含まれること
```

```
AC24:
Given: プラグイン設定画面の「カレンダー用ビュー管理」セクションで既存カスタマイズビューを選択し
       「ビューを更新」ボタンを押下する
When:  上書き確認ダイアログで承認し API 呼出が成功する
Then:  既存ビューの html / htmlForMobile が <div id="kc-root" class="kc-root"></div>
       を含む内容に更新されること
```

### Phase 8 完了基準

```
AC25:
Given: プラグイン設定画面を開く
When:  「フィルタ設定」セクションを確認する
Then:  「除外ステータス」テキスト入力欄 (id="kc-excluded-statuses") が存在しないこと
       「ステータスフィールド」プルダウン (id="kc-field-status") が存在しないこと
       設定画面にフィルタ設定の入力欄が存在せず、代わりに「kintone 一覧の絞り込み機能を使うこと」を
       案内するガイダンス文言が表示されること
       (文字列完全一致は不問、意味的に等価であればよい。例:「フィルタは kintone 一覧の絞り込みで
       設定してください」も「表示するレコードの絞り込みは kintone 一覧の標準フィルタ機能 をご利用
       ください。」も合格とする)
```

```
AC26:
Given: desktop.js の KC.Api.loadEvents が呼び出される
When:  kintone 一覧画面で絞り込み条件が設定されている状態 (kintone.app.getQueryCondition() が非空文字を返す)
Then:  loadEvents 内で組み立てる API クエリに getQueryCondition() の結果が AND で結合されること
       (例: 期間条件 AND kintone 絞り込み条件 AND order by ...)
```

```
AC27:
Given: kintone 一覧画面でユーザーが絞り込み条件を変更する
When:  カレンダー描画が更新 (loadEvents が再実行) される
Then:  変更後の絞り込み条件がカレンダーのレコード取得クエリに反映され
       絞り込み条件に合致するレコードのみがカレンダーに表示されること
```

---

## 7. テストシナリオ

### TS-1: 設定画面の基本動作

```
Given: テストアプリにプラグインをインストールし、設定画面を開く
When:  タイトル・開始日時・終了日時フィールドをプルダウンで選択し保存する
Then:  保存成功後に設定画面を再度開くと、保存した値がプルダウンに選択された状態で表示される
```

### TS-2: プラグイン設定からの KC.Config 反映

```
Given: プラグイン設定にフィールドコードが保存されている
When:  カレンダービューを表示する
Then:  KC.Config.FIELD の各キーがプラグイン設定値と一致し、カレンダーが正常に描画される
```

### TS-3: フォールバック動作

```
Given: プラグイン設定が空 (インストール直後・設定未完了)
       かつアプリに KC_ プレフィックスのフィールドが存在する
When:  カレンダービューを表示する
Then:  detectFields() が KC_ プレフィックスのフィールドを検出し、カレンダーが正常に描画される
```

### TS-4: 終日イベントの DnD (プラグイン版)

```
Given: テストアプリにプラグインを設定し、終日イベントが存在する
When:  終日イベントを別の日付にドラッグ&ドロップする
Then:  イベントの日付が更新され、カレンダーが再描画される
       (AC13 と同等動作の確認)
```

### TS-5: 時間予定イベントの表示 (Phase 5 実機検証)

```
Given: DATETIME 型フィールドを持つテストアプリにプラグインを設定する
       開始日時・終了日時が時間指定のレコードが存在する
       終日フラグ (CHECK_BOX) がオフのレコードが存在する
When:  カレンダービューを週ビューで表示する
Then:  時間レーンに該当するスロットにイベントが表示される
       (未検証→検証済への移行を確認)
```

### TS-6: 別アプリへの独立した設定

```
Given: アプリ A とアプリ B に同じプラグインをインストールする
When:  アプリ A の設定でフィールドコード X を指定し、アプリ B の設定でフィールドコード Y を指定する
Then:  アプリ A では X のフィールドを使用して動作し、アプリ B では Y のフィールドを使用して動作する
       互いの設定が影響しない
```

### TS-7: 既存 loader 方式への無影響確認

```
Given: 現運用アプリ (loader.js 方式) でカレンダーが動作している
When:  プラグイン版をテストアプリにインストールする
Then:  現運用アプリの動作に変化がない (loader.js 方式は独立して継続動作する)
```

### TS-8: ビュー自動作成 (Phase 7)

```
Given: テストアプリにプラグインをインストールし設定画面を開く
       「カレンダー用ビュー管理」で「新規作成」を選択しビュー名を入力する
When:  「ビューを自動作成」ボタンを押下する
Then:  kintone アプリに指定したビュー名のカスタマイズビューが作成される
       html が <div id="kc-root" class="kc-root"></div> を含む
       設定画面に成功メッセージが表示される
```

### TS-9: ビュー自動更新・上書き確認 (Phase 7)

```
Given: テストアプリに既存のカスタマイズビューが存在する
       設定画面の「カレンダー用ビュー管理」でそのビューを選択する
When:  「ビューを更新」ボタンを押下し上書き確認ダイアログで「OK」を選択する
Then:  既存ビューの HTML が更新され <div id="kc-root" class="kc-root"></div> が含まれる
```

### TS-10: kintone 一覧絞り込みのカレンダー反映 (Phase 8)

```
Given: テストアプリにプラグインをインストールし kintone 一覧でカスタマイズビューを表示する
       kintone 一覧の絞り込みでステータス = 承認済 の条件を設定する
When:  カレンダーがレコードを取得する (loadEvents が実行される)
Then:  ステータス = 承認済 のレコードのみがカレンダーに表示される
       ステータスが異なるレコードはカレンダーに表示されない
```

### TS-11: 旧 excludedStatuses 設定の無視 (Phase 8)

```
Given: 旧設定で excludedStatuses に値が保存されているプラグイン設定を持つアプリ
When:  カレンダービューを表示する
Then:  desktop.js が excludedStatuses を API クエリに反映しない
       kintone 一覧の絞り込み条件のみが適用される
```

---

## 8. 想定 UX / シーケンス

### 8.1 プラグイン初回セットアップ手順 (kintone 管理者向け)

**Phase 7 実装後のフロー:**

```
1. kintone システム管理 → プラグイン → plugin.zip をアップロード
2. 対象アプリの設定 → プラグイン → KC Calendar を有効化
3. プラグイン設定画面を開く
   3a. タイトル・開始日時・終了日時フィールドをプルダウンで選択 (必須)
   3b. 色等の任意フィールドを選択
   3c. 「カレンダー用ビュー管理」セクションでビュー名を入力し
       「ビューを自動作成」ボタンを押下 (Phase 7 新機能)
   3d. 保存ボタンをクリック
4. アプリを保存・公開 (ビュー作成の反映に必要)
5. カスタマイズビューにアクセスしカレンダーが表示されることを確認
6. kintone 一覧の絞り込みでフィルタ条件を設定する (Phase 8: 除外ステータス相当の設定)
```

**Phase 7 実装前 (現状) のフロー:**

```
1〜3b は同様
3c. 手順ガイドに従い、カスタマイズビューの HTML に
    <div id="kc-root" class="kc-root"></div> を手動で設置
3d. 保存ボタンをクリック
4〜6 は同様
```

### 8.2 desktop.js 起動シーケンス (プラグイン版)

**Phase 8 適用後:**

```
kintone.events.on('app.record.index.show')
  └─ KC.Boot._initialized チェック
      └─ KC.Boot.init() 呼び出し
          ├─ KC.LoginContext.init()
          ├─ conf = kintone.plugin.app.getConfig(PLUGIN_ID)
          ├─ conf に必須フィールドコードが存在する場合:
          │    KC.Config.FIELD を conf の値で上書き
          │    KC.Config.ALLDAY_LABEL を conf.alldayLabel から設定
          │    (conf.excludedStatuses は無視する)
          └─ conf が空 / 必須フィールド未設定の場合:
               KC.Config.detectFields() を実行 (KC_ プレフィックス自動検出)
          ├─ KC.Config.detectAppName()
          ├─ KC.Boot._buildDOM()
          └─ KC.Render.refresh()

KC.Api.loadEvents(isoStart, isoEnd)
  ├─ 期間条件を conditions に追加 (start / end フィールドで絞り込み)
  ├─ queryCondition = kintone.app.getQueryCondition()
  ├─ queryCondition が非空文字の場合: conditions に追加 (AND 結合)
  └─ query = conditions.join(' and ') + ' order by ...'
```

**Phase 8 実装前 (現状):**

```
KC.Api.loadEvents では kintone.app.getQueryCondition() を使用しない。
excludedStatuses を API クエリの NOT IN 条件として使用している。
参照: plugin/src/js/desktop.js:563-566
```

### 8.3 設定画面 UX ワイヤーフレーム

参照: `PLUGIN_DISCUSSION.md §プラグイン設定画面仕様` (ASCII ワイヤーフレーム)

**Phase 7 / Phase 8 適用後の設定画面セクション構成:**

1. **基本設定**: カレンダータイトル、デフォルトビュー
2. **フィールドマッピング (必須)**: タイトル / 開始日時 / 終了日時
3. **フィールドマッピング (任意)**: 終日 / 色 / 場所 / 氏名 / メール / アカウント / メモ
4. **フィルタ設定**: 終日ラベル値のみ。ガイダンス「フィルタは kintone 一覧の絞り込みで設定してください」を表示 (Phase 8)
5. **カレンダー用ビュー管理**: 既存ビュー一覧プルダウン + 「ビューを自動作成 / 更新」ボタン (Phase 7)
6. **セットアップガイド**: フォールバック手順として `<div id="kc-root">` 手動設置手順を残す

**Phase 7 / Phase 8 実装前 (現状) のセクション構成:**

1. 基本設定
2. フィールドマッピング (必須)
3. フィールドマッピング (任意): ステータス含む
4. フィルタ設定: 除外ステータス / 終日ラベル値
5. セットアップガイド (手動設置のみ)

---

## 9. リスク・前提

| リスク / 前提 | 詳細 | 対応方針 |
|---|---|---|
| Phase 5 で不具合多発の可能性 | 時間予定 DnD は実機未検証のため、バグ A〜E 以外の不具合が存在する可能性が高い | 検出した不具合は別タスク化。本要件定義書のスコープ外 |
| packer-cli 未経験 | Phase 1 で学習コストが発生する可能性あり | Phase 1 見積に学習時間を含む |
| プラグイン署名 (本番展開時) | 組織内限定運用は「署名なし + 許可設定」で対応 (Q2 確定)。kintone システム管理者設定の「署名なしプラグインを許可」を ON にすることで組織内インストールが可能。cybozu develop tools による署名は将来の kintone marketplace 公開時の別タスクとして検討する | 署名なし許可設定の手順を DEPLOY_GUIDE.md に追記 (Phase 6) |
| CSP / CORS 差分 | loader.js 方式 (外部 URL) とプラグイン方式 (zip 内蔵) では CSP の挙動が異なる可能性がある | Phase 4 の実機確認で検証必須 |
| src と plugin/desktop.js の乖離 | 二重管理となるため、loader 方式への修正をプラグイン版に反映し忘れるリスクがある | 並行運用期間は変更時に両ファイルへの反映を徹底。廃止時期の検討が必要 |
| テストアプリの kintone アカウント | テストアプリを作成できる kintone 環境・権限が必要 | 前提: ユーザー側で開発用 kintone スペースが利用可能であること |
| API トークンの管理リスク | スクリプト実行時のトークンは `.env` で管理し `.gitignore` 対象とする。kintone-rules.md / security-rules.md の API トークンスコープ最小化原則に従い、フィールド追加 + 設定変更権限のみ付与する | `.env.example` にキー名のみ記載し、実際のトークンをコミット履歴に含めない。トークン漏洩時は即座に再発行する |
| `@kintone/customize-uploader` 終了 | 2026 年 8 月にメンテナンス終了予定。プラグイン開発には直接影響しないが、旧 loader 方式のデプロイに使用している場合は後継 `cli-kintone` への移行が必要 | DEPLOY_GUIDE.md に記載済み。プラグイン化後の loader 方式廃止で解消 |
| **[Phase 7]** ビュー上書き時に既存カスタマイズが失われる可能性 | `PUT /k/v1/preview/app/views.json` で既存ビューを更新すると、既存の HTML コンテンツが `<div id="kc-root">` のみに置き換わる。ユーザーが独自 HTML を追加していた場合にそれが失われる | 設定画面に上書き確認 UI を実装する (Q8 の確認後に確定)。エラー時は手動設置ガイドへ誘導する |
| **[Phase 7]** ビュー作成後に「アプリの保存・公開」が必要 | kintone の仕様として `PUT /k/v1/preview/app/views.json` はプレビュー状態への反映であり、アプリを保存・公開しないと本番に適用されない | 設定画面の成功メッセージで「アプリを保存・公開してください」を明示する |
| **[Phase 8]** kintone 一覧フィルタ仕様変更による齟齬リスク | `kintone.app.getQueryCondition()` の返値形式が kintone のバージョンアップで変わった場合、カレンダー描画と実際の絞り込み条件に齟齬が生じる可能性がある | 単体テストで `getQueryCondition()` の返値をモックして挙動を確認する。kintone アップデート時に動作確認を実施する |
| **[Phase 8]** 旧 excludedStatuses 利用ユーザーへの影響 | Phase 8 適用後、旧 excludedStatuses 設定値が無視されるため、除外条件なしでレコードが表示されるケースが発生する | 運用ドキュメントに移行手順を記載し、kintone 一覧絞り込みへの移行を案内する |
| **[Phase 7]** デプロイ巻き込みリスク | `POST /k/v1/preview/app/deploy.json` はアプリの全プレビュー変更を本番に反映するため、ビュー操作のみのつもりでも未保存のフィールド追加・設定変更が一緒にデプロイされるリスクがある。Phase 7 の「ビューを自動作成 / 更新」ボタンは `PUT /k/v1/preview/app/views.json` (プレビュー書き込みのみ) であり `deploy.json` を呼ばない設計とする。「アプリを保存・公開してください」の案内はユーザー手動操作を前提とし、アプリに他の未保存変更がないかを確認するよう注意喚起する | 設定画面の成功メッセージに「他に未保存の設定変更がある場合も同時に公開されます。公開前に設定内容を確認してください。」を明記する (AC23 参照) |

---

## 10. 未解決事項

| ID | 事項 | ステータス | 確定内容 / 残課題 |
|---|---|---|---|
| Q1 | テストアプリの作成主体 | **確定済 (第 3 版更新)** | REST API スクリプト方式を採用。`scripts/setup-test-app/` に Node.js スクリプトを配置し、ユーザーが空アプリ作成 + API トークン発行後に `npm run setup:test-app` でフィールド一括投入・デプロイを自動化する。理由: kintone アプリテンプレート XML はフォーマット仕様非公開のため Claude 側で完全自動生成は困難。REST API 方式は公式仕様準拠かつ複数アプリへの展開時に再利用可能 |
| Q2 | プラグイン署名のタイミング・方式 | **確定済** | 「署名なし + 許可設定」で運用 (kintone システム管理者設定で「署名なしプラグインを許可」を ON)。cybozu develop tools による署名は将来公開時の別タスク |
| Q3 | 旧 loader 方式の廃止時期 | **確定済** | プラグイン安定後 (Phase 5 検証クリア後) に現運用アプリへ全面移行し、廃止する。廃止までの並行運用期間は Phase 5 完了まで |
| Q4 | Phase 5 で不具合検出時の管理方法 | **確定済** | 検出した不具合は HANDOVER.md に追記し、個別対応は別タスクとして requirements/ 配下で起案する |
| Q5 | カスタマイズビュー名の扱い | 設計時点での暫定確定 (将来見直し対象) | プラグイン設定画面でカレンダータイトルを任意入力できるようにする方針。現状の `KC.Config.detectAppName()` はフォールバックとして維持 |
| Q6 | プラグイン版の対応ビュー | 設計時点での暫定確定 (将来見直し対象) | 月ビュー・日ビューはスタブのまま (ビュー切替 UI は表示するが実装なし) とする方針。本フェーズ完了後に別タスクで検討 |
| Q7 | Phase 7 でビューを新規作成する場合のデフォルトビュー名 | **確定済 (2026-05-14 ユーザー確定)** | 「カレンダー」を採用する。Phase 7 実装時のビュー名入力フィールドのデフォルト値として設定する |
| Q8 | Phase 7 で既存ビューを更新する場合の上書き確認要否 | **確定済 (2026-05-14 ユーザー確定)** | 上書き確認ダイアログを表示する。AC24 の実装仕様に反映済み |
| Q9 | Phase 8 で desktop.js から excludedStatuses 関連コードを完全削除するか | **確定済 (2026-05-14 ユーザー確定)** | `excludedStatuses` 関連コードは完全削除する。後方互換は不要。`KC.Config.EXCLUDED_STATUSES` の参照箇所はすべて削除し、空文字無視のフォールバックは持たない。ユーザー方針「フィルタは一覧側で」を厳格適用 |

---

## 付録: 関連ファイル参照マップ

| 確認すべき仕様 | 参照先 |
|---|---|
| KC.Config フィールド定義・detectFields | `src/kc-calendar.js:18-136` |
| KC.Boot 起動シーケンス | `src/kc-calendar.js:4400-4816` |
| EXCLUDED_STATUSES / ALLDAY_LABEL | `src/kc-calendar.js:57-58` |
| フィールド型一覧と汎用化変更箇所 | `FIELD_REFERENCE.md §1, §3` |
| ステータス固定値の不整合 | `FIELD_REFERENCE.md §2` |
| プラグイン設定画面ワイヤーフレーム | `PLUGIN_DISCUSSION.md §プラグイン設定画面仕様` |
| プラグインファイル構成 (元案) | `PLUGIN_DISCUSSION.md §プラグインのファイル構成` |
| Phase 2 未検証バグ一覧 | `HANDOVER.md §4 主要バグ` |
| loader.js キャッシュバスター運用 | `DEPLOY_GUIDE.md §loader.js のキャッシュバスター版数管理` |
| ビュー切替リファクタ (setActiveView) | `DESIGN.md §4.8` |
| excludedStatuses 関連 UI (Phase 8 削除対象) | `plugin/src/html/config.html:206-224` |
| excludedStatuses DOM 参照 (Phase 8 削除対象) | `plugin/src/js/config.js:72` |
| excludedStatuses バリデーション (Phase 8 削除対象) | `plugin/src/js/config.js:204-212` |
| loadEvents クエリ組み立て (Phase 8 改修対象) | `plugin/src/js/desktop.js:537-616` |
| kintone ビュー API (Phase 7) | `GET /k/v1/app/views.json` / `PUT /k/v1/preview/app/views.json` |

---

**2026-05-14 第 4 版 (Phase 7 / Phase 8 追補)**
合計見積: 13〜21 営業日 → **16〜26 営業日** (Phase 7: 2〜3 営業日 + Phase 8: 1〜2 営業日 追加)
