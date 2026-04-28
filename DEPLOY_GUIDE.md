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

---

## 将来の移行先: cli-kintone

customize-uploader のメンテナンス終了後は cli-kintone へ移行。manifest.json はそのまま流用可能。

```bash
npm install @kintone/cli --save-dev
npx cli-kintone customize apply \
  --input customize-manifest.json \
  --app APP_ID --yes
```
