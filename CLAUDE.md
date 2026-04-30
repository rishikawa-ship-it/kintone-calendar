# kintone-calendar プロジェクト指示書

## プロジェクト概要

kintone レコードを Google Calendar 風に表示するカスタマイズ JS。GitHub Pages 配信のローダーから本体 JS/CSS を動的に読み込む方式で kintone カスタマイズに組み込む。

詳細は `DESIGN.md` を参照。kintone フィールドコードは `FIELD_REFERENCE.md`、デプロイ手順は `DEPLOY_GUIDE.md` を参照。

---

## 共通ルールの読み込み

@../../claude-shared-rules/CLAUDE.md
@../../claude-shared-rules/kintone-rules.md

> **管理者＋サブエージェント方式で運用する**（詳細は `agent-orchestration-rules.md`）。主スレッド Claude はオーケストレーター役に徹し、設計・実装・レビューはサブエージェントへ委譲する。

---

## プロジェクト固有の注意事項

### ファイル構成

```
kintone-calendar/
├── CLAUDE.md            ← 本ファイル
├── DESIGN.md            ← システム設計
├── FIELD_REFERENCE.md   ← kintone フィールドコード一覧
├── DEPLOY_GUIDE.md      ← デプロイ手順
├── PLUGIN_DISCUSSION.md ← プラグイン化検討
├── requirements/        ← 各機能の要件定義書
├── src/
│   ├── kc-calendar.js   ← 編集対象正本
│   └── kc-calendar.css  ← スタイル正本
└── docs/                ← GitHub Pages 配信用ミラー
    ├── kc-calendar.js   ← src の同内容
    ├── kc-calendar.css  ← src の同内容
    └── loader.js        ← kintone カスタマイズに登録するローダー
```

### 編集ルール

- **`src/` を編集したら必ず `docs/` にも同期する**
- src と docs の差分が残ったまま push しない
- ローダー URL: `https://rishikawa-ship-it.github.io/kintone-calendar/loader.js`（kintone 側にはこれだけ登録）

### デプロイ

`src/` 編集 → `docs/` 同期 → コミット → push → GitHub Pages が反映。手順は `DEPLOY_GUIDE.md` 参照。

### 旧版（参照禁止）

`G:\マイドライブ\desktop\その他案件\モバイルWi-Fi\` 配下の GAS 版ファイル群（`class/code.js`, `js/*.html`, `appsscript.json` 等）は旧版で現状実装と乖離している。**参照しないこと**。

### プラグイン化方針

全要件実装後に kintone プラグイン化を予定。現段階はカスタマイズ JS 方式を維持。詳細は `PLUGIN_DISCUSSION.md`。
