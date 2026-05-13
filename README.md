# kintone-calendar

kintone レコードを Google カレンダー風に表示するカスタマイズ JS / プラグイン。

## 概要

月ビュー・週ビュー・日ビューでレコードをカレンダー表示し、ドラッグ&ドロップによる日付変更をサポートする。

- カスタマイズ JS 方式 (loader.js + GitHub Pages 配信) — 現行運用方式
- プラグイン方式 (plugin.zip) — Phase 1〜6 で段階的に移行予定

詳細は `DESIGN.md`、デプロイ手順は `DEPLOY_GUIDE.md`、プラグイン化移行計画は `requirements/REQ_plugin-migration.md` を参照。

---

## カスタマイズ JS 方式 (現行)

### デプロイ手順

```bash
# 1. 環境変数を設定
export KINTONE_BASE_URL=https://SUBDOMAIN.cybozu.com
export KINTONE_USERNAME=ユーザー名
export KINTONE_PASSWORD=パスワード

# 2. デプロイ実行
npm run deploy

# 3. 開発中 (ファイル保存で自動反映)
npm run dev
```

詳細は `DEPLOY_GUIDE.md` を参照。

---

## プラグイン版ビルド手順 (Phase 1 以降)

### セットアップ

```bash
npm install
```

### プラグイン ZIP のビルド

```bash
npm run build:plugin
```

`plugin/dist/plugin.zip` が生成される。

### kintone へのインストール

1. kintone システム管理 > プラグイン > 「プラグインの読み込み」で `plugin/dist/plugin.zip` をアップロード
2. 対象アプリの設定 > プラグイン > 「KC カレンダー」を有効化
3. プラグイン設定画面でフィールドマッピングを設定して保存
4. カスタマイズビューの HTML に `<div id="kc-root" class="kc-root"></div>` を設置
5. アプリを保存・公開してカレンダーが表示されることを確認

> 注意: 組織内運用では kintone システム管理者設定の「署名なしプラグインを許可」を ON にすること。
> 詳細は `DEPLOY_GUIDE.md` を参照予定 (Phase 6 で追記)。

---

## プラグインのアップロード (自動化)

### 初回セットアップ

1. ルートディレクトリの `.env.example` をコピーして `.env` を作成:
   ```bash
   cp .env.example .env
   ```
2. `.env` を編集:
   - `KINTONE_BASE_URL`: 例 `https://your-domain.cybozu.com`
   - `KINTONE_USERNAME`: kintone システム管理者のログイン名
   - `KINTONE_PASSWORD`: 同パスワード
3. kintone 側設定:
   - システム管理 → セキュリティ → 「**署名のないプラグインの追加を許可する**」を ON
   - 2 段階認証が有効な場合は無効化または専用ユーザー作成を検討

### アップロード実行

```bash
# 単発アップロード
npm run upload:plugin

# 開発中: plugin.zip 変更時に自動再アップロード
npm run upload:plugin:watch
```

実行すると Puppeteer 経由でブラウザが起動し、`plugin/dist/plugin.zip` が kintone にアップロードされます。

### 注意

- パスワード認証のみサポート (API トークンは非対応)
- システム管理者権限が必要
- アップロード後、対象アプリで「アプリの設定 → プラグイン → 追加」で適用してください (初回のみ)
- 2 回目以降はアップロードだけで自動的に最新版が反映されます

---

### ディレクトリ構成 (プラグイン版)

```
plugin/
├── manifest.json
├── src/
│   ├── js/
│   │   ├── desktop.js    (Phase 3 で実装)
│   │   └── config.js     (Phase 2 で実装)
│   ├── css/
│   │   ├── desktop.css   (Phase 3 で実装)
│   │   └── config.css    (Phase 2 で実装)
│   ├── html/
│   │   └── config.html   (Phase 2 で実装)
│   └── image/
│       └── icon.png      (Phase 1: 仮アイコン、Phase 4 までに本番用に差し替え)
└── dist/                 (ビルド成果物、git 管理外)
    └── plugin.zip
```
