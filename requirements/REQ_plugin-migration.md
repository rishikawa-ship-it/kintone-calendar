# 要件定義書: kintone プラグイン化移行

**文書番号**: REQ_plugin-migration
**作成日**: 2026-05-13
**最終更新日**: 2026-05-13
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 (第 1 版)
**関連文書**: PLUGIN_DISCUSSION.md, HANDOVER.md, DESIGN.md, FIELD_REFERENCE.md, DEPLOY_GUIDE.md

### 更新履歴

| 版 | 日付 | 変更内容 |
|---|---|---|
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
| テストアプリのアプリテンプレート XML 作成 | 時間予定対応版・終日のみ版の 2 種類を作成。ユーザーが kintone 管理画面でインポートして使用 |
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
- **アプリテンプレート XML 作成**: 時間予定対応版 (DATETIME + CHECK_BOX) と終日のみ版 (DATE) の 2 種類を designer/builder が作成する
- **ユーザーによるテストアプリ構築**: ユーザーが kintone 管理画面でアプリテンプレート XML をインポートしてテストアプリを作成する
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

### 合計見積

| Phase | 内容 | 見積 |
|---|---|---|
| 1 | 準備 | 1〜2 営業日 |
| 2 | 設定画面実装 | 3〜5 営業日 |
| 3 | desktop.js 改修 | 3〜5 営業日 |
| 4 | パッケージング・別アプリ動作検証 | 3〜4 営業日 |
| 5 | 時間レーン挙動の実機検証 | 2〜3 営業日 |
| 6 | ドキュメント・公開 | 1〜2 営業日 |
| | **合計** | **13〜21 営業日** |

> 注: Phase 4 にアプリテンプレート XML 作成ステップを追加したため、PLUGIN_DISCUSSION.md の 10〜17 営業日から微増。

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
| ステータスフィールド | フィールドプルダウン / 未設定 | `FIELD.status` | DROP_DOWN 型を選択。未設定時はフィルタなし |
| 除外ステータス | テキスト (カンマ区切り) | `EXCLUDED_STATUSES` | 例: 返却済,削除済。現在ハードコード (`src/kc-calendar.js:58`) |
| 終日フィールド | フィールドプルダウン / 未設定 | `FIELD.allday` | CHECK_BOX 型。DATETIME 型使用時に ON |
| 終日ラベル値 | テキスト | `ALLDAY_LABEL` | チェックボックスの選択肢値。例: 終日 (`src/kc-calendar.js:57`) |
| 色フィールド | フィールドプルダウン / 未設定 | `FIELD.color` | イベント色分け用 |
| 場所フィールド | フィールドプルダウン / 未設定 | `FIELD.place` | |
| 利用者氏名フィールド | フィールドプルダウン / 未設定 | `FIELD.userName` | |
| メールアドレスフィールド | フィールドプルダウン / 未設定 | `FIELD.userMail` | |
| アカウントフィールド | フィールドプルダウン / 未設定 | `FIELD.account` | USER_SELECT 型 |
| メモフィールド | フィールドプルダウン / 未設定 | `FIELD.memo` | MULTI_LINE_TEXT 型 |

### 4.3 設定値の保存形式

`kintone.plugin.app.setConfig()` に渡す設定オブジェクトのキー定義 (設計時点案):

```javascript
{
  fieldTitle:    'フィールドコード',  // 必須
  fieldStart:    'フィールドコード',  // 必須
  fieldEnd:      'フィールドコード',  // 必須
  defaultView:   'month',            // 'month' | 'week' | 'day'
  fieldStatus:   'フィールドコード',  // 任意 (未設定時は空文字)
  excludedStatuses: '返却済,削除済', // カンマ区切り文字列
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

> 注意: `kintone.plugin.app.setConfig` / `getConfig` の値はすべて文字列として保存される。配列 (`EXCLUDED_STATUSES`) はカンマ区切り文字列で保存し、読み込み時に `split(',').map(s => s.trim())` で配列に変換する。

### 4.4 設定画面での手順ガイド表示

kintone のカスタマイズビュー HTML への `<div id="kc-root" class="kc-root"></div>` の設置は API では自動化不可 (kintone 制約)。設定画面に手動設置手順を表示する。
参照: `PLUGIN_DISCUSSION.md §論点5`

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
- CSP / CORS 設定を考慮した外部サーバー依存リスクが解消される (実機確認必須: §7 リスク参照)
- キャッシュバスター手動更新の運用負荷が解消される

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

### Phase 5 完了基準

- AC15: 時間予定フィールド (DATETIME 型) を持つテストアプリで時間レーンにイベントが表示される (未検証状態から検証完了への移行)
- AC16: Phase 2 バグ A〜E の検証結果 (Pass / Fail / 未再現) が `HANDOVER.md §4` に記録される
- AC17: 検出した不具合が HANDOVER.md に追記され、個別対応が別タスクとして requirements/ 配下で起案される (Q4 確定)

### Phase 6 完了基準

- AC18: インストール手順・設定マニュアルが README または別ドキュメントに整備される
- AC19: `DEPLOY_GUIDE.md` にプラグインビルド手順が追記される
- AC20: `HANDOVER.md §4` に Phase 5 検証結果が反映される
- AC21: アプリテンプレート XML (時間予定対応版・終日のみ版) がユーザー環境の kintone 管理画面で正常にインポートできること
- AC22: Phase 5 検証で検出した不具合が HANDOVER.md に追記されていること

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

---

## 8. 想定 UX / シーケンス

### 8.1 プラグイン初回セットアップ手順 (kintone 管理者向け)

```
1. kintone システム管理 → プラグイン → plugin.zip をアップロード
2. 対象アプリの設定 → プラグイン → KC Calendar を有効化
3. プラグイン設定画面を開く
   3a. タイトル・開始日時・終了日時フィールドをプルダウンで選択 (必須)
   3b. ステータス・色等の任意フィールドを選択
   3c. 除外ステータスをテキスト入力 (例: 返却済,削除済)
   3d. 手順ガイドに従い、カスタマイズビューの HTML に
       <div id="kc-root" class="kc-root"></div> を設置
   3e. 保存ボタンをクリック
4. アプリを保存・公開
5. カスタマイズビューでカレンダーが表示されることを確認
```

### 8.2 desktop.js 起動シーケンス (プラグイン版)

```
kintone.events.on('app.record.index.show')
  └─ KC.Boot._initialized チェック
      └─ KC.Boot.init() 呼び出し
          ├─ KC.LoginContext.init()
          ├─ conf = kintone.plugin.app.getConfig(PLUGIN_ID)
          ├─ conf に必須フィールドコードが存在する場合:
          │    KC.Config.FIELD を conf の値で上書き
          │    KC.Config.EXCLUDED_STATUSES を conf.excludedStatuses から変換
          │    KC.Config.ALLDAY_LABEL を conf.alldayLabel から設定
          └─ conf が空 / 必須フィールド未設定の場合:
               KC.Config.detectFields() を実行 (KC_ プレフィックス自動検出)
          ├─ KC.Config.detectAppName()
          ├─ KC.Boot._buildDOM()
          └─ KC.Render.refresh()
```

### 8.3 設定画面 UX ワイヤーフレーム

参照: `PLUGIN_DISCUSSION.md §プラグイン設定画面仕様` (ASCII ワイヤーフレーム)

設定画面のセクション構成:
1. **基本設定**: カレンダータイトル、デフォルトビュー
2. **フィールドマッピング (必須)**: タイトル / 開始日時 / 終了日時
3. **フィールドマッピング (任意)**: ステータス / 終日 / 色 / 場所 / 氏名 / メール / アカウント / メモ
4. **フィルタ設定**: 除外ステータス / 終日ラベル値
5. **セットアップガイド**: `<div id="kc-root">` 設置手順の説明

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
| `@kintone/customize-uploader` 終了 | 2026 年 8 月にメンテナンス終了予定。プラグイン開発には直接影響しないが、旧 loader 方式のデプロイに使用している場合は後継 `cli-kintone` への移行が必要 | DEPLOY_GUIDE.md に記載済み。プラグイン化後の loader 方式廃止で解消 |

---

## 10. 未解決事項

| ID | 事項 | ステータス | 確定内容 / 残課題 |
|---|---|---|---|
| Q1 | テストアプリの作成主体 | **確定済** | アプリテンプレート XML を designer/builder が作成し、ユーザーが kintone 管理画面でインポートして構築する |
| Q2 | プラグイン署名のタイミング・方式 | **確定済** | 「署名なし + 許可設定」で運用 (kintone システム管理者設定で「署名なしプラグインを許可」を ON)。cybozu develop tools による署名は将来公開時の別タスク |
| Q3 | 旧 loader 方式の廃止時期 | **確定済** | プラグイン安定後 (Phase 5 検証クリア後) に現運用アプリへ全面移行し、廃止する。廃止までの並行運用期間は Phase 5 完了まで |
| Q4 | Phase 5 で不具合検出時の管理方法 | **確定済** | 検出した不具合は HANDOVER.md に追記し、個別対応は別タスクとして requirements/ 配下で起案する |
| Q5 | カスタマイズビュー名の扱い | 設計時点での暫定確定 (将来見直し対象) | プラグイン設定画面でカレンダータイトルを任意入力できるようにする方針。現状の `KC.Config.detectAppName()` はフォールバックとして維持 |
| Q6 | プラグイン版の対応ビュー | 設計時点での暫定確定 (将来見直し対象) | 月ビュー・日ビューはスタブのまま (ビュー切替 UI は表示するが実装なし) とする方針。本フェーズ完了後に別タスクで検討 |

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
