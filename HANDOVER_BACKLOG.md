# kintone-calendar 引き継ぎ手順（Claude Code 起動 → プロジェクト引き継ぎ）

**作成日**: 2026-04-30
**対象読者**: 新担当者
**想定所要時間**: 30〜60 分（環境準備込み）

本資料の目的は、新担当者が VS Code で Claude Code を起動し、kintone-calendar プロジェクトを引き継ぐまでの作業手順を示すことです。

---

## §1 概要

kintone-calendar は、kintone レコードを Google Calendar 風（週ビュー）に表示するカスタマイズ JS です。GitHub Pages 経由でローダーを配信しており、kintone 側への登録は初回のみ必要です。

本手順に沿って Claude Code を起動し、引き継ぎプロンプトを投入することで、Claude がプロジェクトのコンテキストを把握した状態で作業を開始できます。

---

## §2 前提条件

作業開始前に以下をすべて確認してください。

- [ ] VS Code インストール済
- [ ] Claude Code (Anthropic CLI) インストール済 / 認証済
  - 未インストールの場合: https://docs.claude.com/en/docs/claude-code/quickstart 参照
- [ ] Git インストール済 + GitHub アカウント認証済
- [ ] リポジトリへのアクセス権限あり（`rishikawa-ship-it/kintone-calendar`）
- [ ] kintone カスタマイズ View の HTML 設定権限あり（デプロイが必要な場合）

---

## §3 環境準備

### 1. リポジトリのクローン

```bash
git clone https://github.com/rishikawa-ship-it/kintone-calendar.git
cd kintone-calendar
```

### 2. VS Code でプロジェクトを開く

```bash
code .
```

### 3. 統合ターミナルを開く

VS Code 上で `Ctrl+`` （バッククォート）を押して統合ターミナルを起動します。

---

## §4 Claude Code の起動

### 1. `claude` コマンドを実行

統合ターミナルで以下を実行します。

```bash
claude
```

### 2. 認証が必要な場合

初回起動時や認証期限切れの場合、ブラウザが開いて Anthropic の認証画面が表示されます。画面の指示に従ってログインしてください。認証後、ターミナルに戻ると自動的に接続が完了します。

### 3. 起動確認

以下のようなプロンプト待機画面が表示されれば正常です。

```text
Claude Code v*.*.*
> 
```

---

## §5 引き継ぎプロンプトの投入

### プロンプトの投入方法

Claude のプロンプト待機画面に、以下のテンプレートをそのままコピー&ペーストして Enter を押してください。

```text
kintone-calendar プロジェクトを引き継ぎました。以下の順番で読んで現状を把握してください。

1. projects/kintone-calendar/HANDOVER.md
2. projects/kintone-calendar/CLAUDE.md（@import で claude-shared-rules が自動読込）
3. projects/kintone-calendar/DESIGN.md
4. projects/kintone-calendar/FIELD_REFERENCE.md
5. projects/kintone-calendar/PLUGIN_DISCUSSION.md
6. requirements/ 配下すべて（REQ_allday-bar-redesign.md, REQ_event-drag-resize.md）
7. git log --oneline -30

運用方針（厳守）:
- 主スレッドはオーケストレーター専任。コード修正・大規模調査はサブエージェントに委譲
- PM 業務（軽量参照、git status、成果物確認、commit/push）は主スレッド OK
- src/ 編集後は docs/ に必ず同期
- agent-orchestration-rules.md §2 厳格運用に従う

【未検証】Phase 2（時間予定 DnD・日跨ぎ表示・バグ A〜E 修正、commit 219d720）は実機未検証。
時間予定機能への追加要件・バグ報告は検証環境の準備から始めること。

【確認済】Phase 1（終日 DnD 移動・リサイズ）、ポップアップサイズ割合化、終日バー単一行+連結+開閉トグル。

直近の未解決事項（REQ_event-drag-resize.md §10.5）:
リサイズハンドルの ARIA 属性対応は別タスク（マウス専用フェーズ完了後）。
```

### 投入後に Claude が行うこと

プロンプト投入後、Claude は以下の順番で作業を進めます。

1. 指定ファイルを順番に読み込む
2. `git log --oneline -30` で直近のコミット履歴を確認する
3. プロジェクトの現状を把握してレポートする
4. 不明点があれば質問する（質問には回答してください）

---

## §6 動作確認

Claude が引き継ぎプロンプトを処理した後、以下を確認してください。

### 確認項目

- [ ] Claude が「現状把握完了。何から進めますか?」などの応答を返すか
- [ ] 試しに `git status` のような無害な確認指示を投げて正しく応答するか
- [ ] サブエージェント起動が正常か（簡単なタスクを 1 件だけ依頼して確認する）

### サブエージェント動作確認の例

Claude に以下のような指示を出して、サブエージェントが正常に起動するか確認します。

```text
HANDOVER.md の §1（プロジェクト概要）を 3 行で要約してください。designer サブエージェントに委譲してください。
```

---

## §7 トラブルシュート

| 症状 | 対処方法 |
|------|---------|
| `claude` コマンドが見つからない | npm 経由で再インストール: `npm install -g @anthropic-ai/claude-code` |
| GitHub clone で 403 / 404 | SSH 認証設定またはリポジトリのアクセス権限を確認する |
| Claude が応答しない | 認証期限切れの可能性。`claude` を再実行して認証をやり直す / インターネット接続を確認する |
| ファイル読込エラー（CRLF 警告） | CRLF 警告は無視して問題なし。文字コードを UTF-8 で保存していることを確認する |
| プロンプト投入後にファイルが見つからない | カレントディレクトリが `kintone-calendar/` になっているか確認する（`pwd` で確認） |
| サブエージェントが起動しない | Claude Code のバージョンが古い可能性。`claude --version` で確認し、必要なら更新する |

---

## §8 引き継ぎ完了の判定

以下がすべて確認できたら引き継ぎ完了です。

- [ ] HANDOVER.md の §1〜§9 を Claude が把握している
- [ ] サブエージェント（builder / designer / reviewer / Explore / general-purpose）を呼び出せる
- [ ] main ブランチへのコミット / push が成功する
- [ ] 終日 DnD（Phase 1 確認済）の挙動を実機で確認できる

---

## §9 関連リンク・参照

| 資料 | 場所 |
|------|------|
| リポジトリ | https://github.com/rishikawa-ship-it/kintone-calendar |
| GitHub Pages（ローダー） | https://rishikawa-ship-it.github.io/kintone-calendar/loader.js |
| HANDOVER.md | `projects/kintone-calendar/HANDOVER.md` |
| DEPLOY_GUIDE.md | `projects/kintone-calendar/DEPLOY_GUIDE.md` |
| agent-orchestration-rules.md | `claude-shared-rules/agent-orchestration-rules.md` |
| Anthropic Claude Code 公式 docs | https://docs.claude.com/en/docs/claude-code/quickstart |

---

**旧担当者への問い合わせ**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
