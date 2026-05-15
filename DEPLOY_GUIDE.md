# kintone カスタマイズ JS/CSS 自動デプロイガイド

## 結論: 自動反映は可能です

手動アップロードに頼らず、コマンド1つで JS/CSS を kintone に反映できます。

---

## 推奨方式: @kintone/customize-uploader

kintone 公式の npm ツール。ファイル保存時に自動で kintone に反映する `--watch` モードが強力。

### セットアップ手順

```bash
# 1. プロジェクトで npm 初期化
cd C:/Users/r.ishikawa/Desktop/Claude_project/projects/kintone-calendar
npm init -y

# 2. ツールインストール
npm install @kintone/customize-uploader --save-dev

# 3. 環境変数設定
export KINTONE_BASE_URL=https://SUBDOMAIN.cybozu.com
export KINTONE_USERNAME=ユーザー名
export KINTONE_PASSWORD=パスワード

# 4. デプロイ実行
npx kintone-customize-uploader customize-manifest.json

# 5. 開発中（ファイル保存で自動反映）
npx kintone-customize-uploader --watch customize-manifest.json
```

### customize-manifest.json

```json
{
  "app": "対象アプリID",
  "scope": "ALL",
  "desktop": {
    "js": ["src/kc-calendar.js"],
    "css": ["src/kc-calendar.css"]
  },
  "mobile": {
    "js": [],
    "css": []
  }
}
```

### package.json の scripts

```json
{
  "scripts": {
    "deploy": "kintone-customize-uploader customize-manifest.json",
    "dev": "kintone-customize-uploader --watch customize-manifest.json"
  }
}
```

---

## 他の方法との比較

| 方法 | 自動化 | 開発中の即時反映 | 備考 |
|------|--------|-----------------|------|
| **customize-uploader** | ○ | ○ (--watch) | **推奨**。2026年8月にメンテナンス終了予定 |
| **cli-kintone** | ○ | △ (watchなし) | customize-uploaderの後継。manifest互換 |
| **REST API 直接** | ○ | △ | customize.json PUT で APIトークン不可。スクリプト自作が必要 |
| **CDN配信 (GitHub Pages等)** | ○ | ○ | git push で反映。外部サーバー依存リスクあり |

### REST API による直接デプロイ（参考）

```
1. POST /k/v1/file.json → ファイルアップロード → fileKey取得
2. PUT /k/v1/preview/app/customize.json → カスタマイズ設定更新
3. POST /k/v1/preview/app/deploy.json → 本番反映
```

**制約**: customize.json の PUT はパスワード認証のみ（APIトークン不可）

### CDN配信方式（参考）

JS/CSSを GitHub Pages 等でホストし、kintone に URL 登録:
```
コード修正 → git push → GitHub Pages に配信 → kintone が URL から自動読込
```
URL登録は初回のみ。以降はファイル更新だけで反映。
ただしキャッシュバスティングやサーバーダウンリスクの考慮が必要。

### loader.js のキャッシュバスター版数管理

`docs/loader.js` の `var V` に固定版数文字列（例: `'2026-05-13-perf1'`）を設定している。
本体 `kc-calendar.js` または `kc-calendar.css` を更新してデプロイする際は、`docs/loader.js` の `var V` を新しい値（例: `'YYYY-MM-DD-識別子'` 形式）に手動更新してから push すること。
更新しない場合、ブラウザが古いキャッシュを使い続けて変更が反映されないことがある。
（注: GitHub Pages のキャッシュ制御ヘッダーの設定によって効果が変わる場合があるため、初回デプロイ後に DevTools Network タブで `304 Not Modified` が返ることを実機確認すること）

**2026-05-13 実機確認結果**: `kc-calendar.css?v=2026-05-13-perf1` および `kc-calendar.js?v=2026-05-13-perf1` について、DevTools Network タブで Status 200 / Size: (disk cache) / Time: 2〜5 ms を確認。期待していた 304 Not Modified を上回るキャッシュヒット（disk cache から即取得・ネットワーク経由ゼロ）を達成。バージョン文字列を更新するまで本体 JS/CSS はキャッシュから配信されるため、リリース時は `docs/loader.js` の `var V` を確実に更新すること。

---

## 将来の移行先: cli-kintone

customize-uploader のメンテナンス終了後は cli-kintone へ移行。manifest.json はそのまま流用可能。

```bash
npm install @kintone/cli --save-dev
npx cli-kintone customize apply \
  --input customize-manifest.json \
  --app APP_ID --yes
```

---

## プラグインビルドと Plugin ID 固定化

### 概要

`npm run build:plugin` は `plugin/keys/kintone-calendar.ppk` を固定鍵として使用し、
毎回同じ Plugin ID でプラグインをパッケージングする。

### 鍵ファイルの所在

```
plugin/keys/kintone-calendar.ppk
```

この鍵は **git 管理対象外**（public リポジトリのため）。`.gitignore` の `plugin/keys/` および `*.ppk` パターンで除外済み。

### Plugin ID の確認方法

鍵ファイル名（拡張子を除いた部分）が Plugin ID に対応する。
現在の固定鍵 `meffobaoegjochdnnlndalghgfppgpbf.ppk` から生成された Plugin ID: `meffobaoegjochdnnlndalghgfppgpbf`

### 鍵の引き継ぎ手順

環境構築時や担当者交代時は、以下の手順で鍵を共有する:

1. 鍵ファイル `plugin/keys/kintone-calendar.ppk` を社内ファイル共有（Google Drive 等）で引き継ぎ先に渡す
2. 引き継ぎ先は `plugin/keys/` ディレクトリを作成し、受け取ったファイルを `kintone-calendar.ppk` として配置する
3. `npm run build:plugin` を実行し、同じ Plugin ID で plugin.zip が生成されることを確認する

### 鍵を紛失した場合の復元

`plugin/dist/` 配下に過去ビルドの `.ppk` が保存されている（gitignore 対象のため git 履歴には残らないが、ローカルに残存している場合がある）。
最新のビルドに使用した鍵は `plugin/dist/meffobaoegjochdnnlndalghgfppgpbf.ppk`。
これを `plugin/keys/kintone-calendar.ppk` にコピーすることで復元可能。

### kintone へのアップロード

SAML 認証環境（bushiroad-group.cybozu.com）のため、プラグインのアップロードは手動で行う:

1. `npm run build:plugin` で `plugin/dist/plugin.zip` を生成
2. kintone 管理者画面 > プラグイン管理 から `plugin.zip` を手動アップロード
3. 対象アプリの設定 > プラグイン から追加して有効化
