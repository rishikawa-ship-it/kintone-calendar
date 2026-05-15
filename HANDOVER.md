# kintone-calendar 引き継ぎ資料

**作成日**: 2026-04-30
**最終更新**: 2026-05-15
**旧担当**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
**想定読者**: 引き継ぎ先の担当者・Claude

---

## §1 プロジェクト概要

kintone レコードを Google Calendar 風に表示するカスタマイズ JS（週ビュー）。

| 項目 | 内容 |
|---|---|
| 実装形式 | kintone カスタマイズ JS + CSS（IIFE 単一ファイル方式） |
| 配信方式 | GitHub Pages（`https://rishikawa-ship-it.github.io/kintone-calendar/loader.js`）経由でブラウザが動的読込 |
| 対象アプリ | 貸与 Wi-Fi 予約カレンダー（終日イベントのみ運用中。時間予定フィールドは実装済だが未運用） |
| 主な機能 | 週ビュー表示、終日 DnD 移動・リサイズ、時間予定 DnD 移動・リサイズ（Phase 2 未検証）、イベント作成・編集・削除ダイアログ |
| デプロイ | `src/` 編集 → `docs/` 同期 → commit → push で自動反映（GitHub Pages） |
| リポジトリ | `https://github.com/rishikawa-ship-it/kintone-calendar`（GitHub Pages で `docs/` を配信） |

---

## §2 ファイル構成と読む順番

引き継ぎ時に Claude に読ませるべきファイルを優先順に列挙する。

| 順 | ファイルパス | 一行説明 |
|---|---|---|
| 1 | `projects/kintone-calendar/CLAUDE.md` | プロジェクト指示書（必読。共通ルールを @import で自動読込） |
| 2 | `claude-shared-rules/CLAUDE.md` | 共通指示書ハブ（@import で上記から参照される） |
| 2a | `claude-shared-rules/agent-orchestration-rules.md` | オーケストレーター/サブエージェント運用ルール |
| 2b | `claude-shared-rules/coding-rules.md` | JS コーディング規約 |
| 2c | `claude-shared-rules/git-rules.md` | Git 運用ルール（ただし本プロジェクトは main 直接運用） |
| 2d | `claude-shared-rules/kintone-rules.md` | kintone カスタマイズ固有ルール |
| 2e | `claude-shared-rules/document-rules.md` | ドキュメント記述規約 |
| 3 | `projects/kintone-calendar/DESIGN.md` | モジュール設計・UI 仕様・kintone API 連携仕様 |
| 4 | `projects/kintone-calendar/FIELD_REFERENCE.md` | kintone フィールドコード一覧・汎用化変更箇所 |
| 5 | `projects/kintone-calendar/DEPLOY_GUIDE.md` | デプロイ手順（customize-uploader / GitHub Pages 方式） |
| 6 | `projects/kintone-calendar/PLUGIN_DISCUSSION.md` | プラグイン化検討・メリデメ・移行計画 |
| 7 | `projects/kintone-calendar/requirements/REQ_allday-bar-redesign.md` | 終日バー Google カレンダー方式再設計 要件定義書（確定版） |
| 8 | `projects/kintone-calendar/requirements/REQ_event-drag-resize.md` | 予定 DnD 移動・リサイズ 要件定義書（確定版。未確定 1 件あり） |
| 8a | `projects/kintone-calendar/requirements/REQ_plugin-migration.md` | kintone プラグイン化移行 要件定義書（確定版 第 5 版。2026-05-14 更新） |
| 8b | `projects/kintone-calendar/requirements/REQ_view-switch-refactor.md` | ビュー切替責務一元化リファクタリング 要件定義書（確定版） |
| 8c | `projects/kintone-calendar/requirements/REQ_perf-phase1.md` | 軽量化 Phase 1 要件定義書（確定版） |
| 8d | `projects/kintone-calendar/requirements/REQ_month-view.md` | 月ビュー実装 要件定義書（確定版） |
| 8e | `projects/kintone-calendar/requirements/REQ_month-dnd.md` | 月ビュー予定 DnD 要件定義書（確定版） |
| 8f | `projects/kintone-calendar/requirements/REQ_day-view.md` | 日ビュー実装 要件定義書（確定版） |
| 9 | `git log --oneline -40` | 直近の変更履歴（重要コミット: 219d720 = `.kc-cell` data-date 付与） |

---

## §3 運用方針（最重要）

### 主スレッドはオーケストレーター専任

- コード修正・大規模調査は**規模を問わずサブエージェント委譲**（`agent-orchestration-rules.md §2` 厳格運用）
- 1 行のタイポ修正・単発 grep であっても主スレッドでは行わない
- 2026-04-30 に主スレッドによる直接コード修正で手戻りが発生した経緯があるため厳格化済み

### 主スレッドが行ってよい PM 業務（限定列挙）

- ユーザーとの対話・ヒアリング・最終承認
- `git status` / `git commit` / `git push`（コード内容を読む `git diff` は禁止）
- メモリ・タスクリスト・共通ルールの更新
- サブエージェント成果物のファイルパス受け渡し（内容を読み込まない）

### src / docs 同期ルール（絶対）

- `src/kc-calendar.js` または `src/kc-calendar.css` を編集したら**必ず `docs/` にも同内容を同期**してからコミット
- 差分が残ったまま push しない（`CLAUDE.md` 規約）

### ブランチ運用

- **main 直接運用**。`feature/` ブランチ等は採用していない
- 共通ルール（`git-rules.md`）には feature ブランチの記載があるが、本プロジェクトは main 直接で運用している

---

## §4 現状（2026-05-15 時点）

| カテゴリ | 状態 |
|---|---|
| **確認済（Phase 1 + 周辺）** | 終日 DnD 移動・リサイズ、ポップアップサイズ割合化（max 1400×900・画面中央）、終日バー単一行+連結+開閉トグル、CSS z-index 修正、placeEvents 単一バー方式、`$revision` 楽観ロック、連続ドラッグ対応 |
| **未検証（Phase 2）** | 時間予定 DnD（移動・上下リサイズ）、日跨ぎ表示復活、バグ A〜D 修正、`.kc-cell` data-date 付与（commit 219d720）。**現運用が終日のみのため実機未検証** |
| **残存 NG（reviewer 観察事項）** | #3 翌日表記、#4 `.kc-overlay` の CSS/JS 競合、Low 2 件（定数集約等）、ARIA 属性は別フェーズ |
| **実装済（プラグイン化 Phase 1〜9）** | `plugin/` ディレクトリに src/html/js/css 構成＋ビルド成果物（`plugin/dist/*.ppk`）が存在。設定画面（config.html/config.js/config.css）・desktop.js/desktop.css・manifest.json・ローカル開発環境（plugin/dev/）・ビュー単位設定管理（Phase 9 の 2 階層設計）まで実装済（REQ_plugin-migration.md 参照）。ただし実機アップロードでの動作検証は未実施 |
| **未着手** | 月ビュー（`KC.RenderMonth` スタブ）、日ビュー（`KC.RenderDay` スタブ）、重複時間予定の並列表示、API 失敗時 UI 改善（alert 据置）、プラグイン版別アプリ動作検証（Phase 4 以降）、Phase 2 実機検証（Phase 5） |

### 主要バグ（未修正: Phase 2 スコープ）

| バグ ID | 内容 |
|---|---|
| A | `.kc-cell` に `data-date` が未付与 → DnD 日付移動が破綻（219d720 で修正済みだが実機未検証） |
| B | 終日バー `.kc-ad-event` に mousedown 未配線 → 終日 DnD 不動 |
| C | CSS `.kc-event.ghost` と JS `.kc-ghost` のクラス名不整合 → ゴースト UI 無効 |
| D | リサイズハンドル DOM が存在しない → リサイズ操作不可 |
| E | 5px 閾値なし → マウスダウン直後に DnD 誤発動 |

---

## §5 デプロイ手順

| ステップ | コマンド / 操作 |
|---|---|
| 1. 編集 | `src/kc-calendar.js` / `src/kc-calendar.css` を修正 |
| 2. 同期 | `docs/kc-calendar.js` / `docs/kc-calendar.css` に同内容をコピー |
| 3. コミット | `git add . && git commit -m "feat: ..."` |
| 4. プッシュ | `git push origin main` |
| 5. 反映確認 | 数十秒〜1 分後に `https://rishikawa-ship-it.github.io/kintone-calendar/loader.js` へアクセスして確認 |

- kintone カスタマイズへの登録は初回のみ（ローダー URL を kintone 側に登録済み）
- `@kintone/customize-uploader` を使った直接アップロード方式も選択可（`DEPLOY_GUIDE.md` 参照）
- `customize-uploader` は 2026 年 8 月にメンテナンス終了予定 → 後継は `@kintone/cli-kintone`

---

## §6 引き継ぎ時の Claude 初回プロンプトテンプレート

以下をそのままコピーして Claude に渡す。

```
kintone-calendar プロジェクトを引き継ぎました。以下の順番で読んで現状を把握してください。

1. projects/kintone-calendar/HANDOVER.md
2. projects/kintone-calendar/CLAUDE.md（@import で claude-shared-rules が自動読込）
3. projects/kintone-calendar/DESIGN.md
4. projects/kintone-calendar/FIELD_REFERENCE.md
5. projects/kintone-calendar/PLUGIN_DISCUSSION.md
6. requirements/ 配下すべて（REQ_allday-bar-redesign.md, REQ_event-drag-resize.md,
   REQ_plugin-migration.md, REQ_view-switch-refactor.md, REQ_perf-phase1.md,
   REQ_month-view.md, REQ_month-dnd.md, REQ_day-view.md）
7. git log --oneline -40

運用方針（厳守）:
- 主スレッドはオーケストレーター専任。コード修正・大規模調査はサブエージェントに委譲
- PM 業務（軽量参照、git status、成果物確認、commit/push）は主スレッド OK
- src/ 編集後は docs/ に必ず同期
- agent-orchestration-rules.md §2 厳格運用に従う

【未検証】Phase 2（時間予定 DnD・日跨ぎ表示・バグ A〜E 修正、commit 219d720）は実機未検証。
時間予定機能への追加要件・バグ報告は検証環境の準備から始めること。
実機検証は REQ_plugin-migration.md Phase 5 のスコープで実施予定。

【確認済】Phase 1（終日 DnD 移動・リサイズ）、ポップアップサイズ割合化、終日バー単一行+連結+開閉トグル。

【プラグイン化】plugin/ 配下に Phase 9 まで実装済（2026-05-14）。
次のアクションは kintone への実機アップロード（plugin/dist/plugin.zip）と
別アプリでの動作検証（Phase 4: REQ_plugin-migration.md §3）。
SAML 認証のためアップロードは手動操作のみ（CLI ツール不可）。

直近の未解決事項:
- リサイズハンドルの ARIA 属性対応は別タスク（REQ_event-drag-resize.md §10.5）
- プラグイン版 Phase 4〜6（別アプリ検証・Phase 2 実機検証・ドキュメント）が未着手
```

---

## §7 引き継ぎ時の注意事項

### Claude のメモリ引き継ぎ不可

- Claude のメモリは PC アカウント単位で保存されるため、新担当者の環境には一切引き継がれない
- **§6 のプロンプトで明示的にコンテキストを渡すことが必須**
- プロジェクト固有の判断経緯（バグ修正方針・UI 仕様の確定経緯等）は各要件定義書の「未確定事項」セクションに記録してある

### GitHub Pages アカウント変更時

- `https://rishikawa-ship-it.github.io/kintone-calendar/loader.js` のホストアカウントを変更する場合は、kintone カスタマイズ側に登録したローダー URL も更新が必要
- kintone カスタマイズのファイル URL 変更は手動操作（REST API ではパスワード認証のみ対応）

### src / docs 同期は絶対

- この規則は `CLAUDE.md` と `git-rules.md` 双方に明記されている
- push 後に docs と src の差分が残っていると、GitHub Pages と src のコードが乖離して混乱の原因になる

### 旧版ファイルは参照禁止

- `G:\マイドライブ\desktop\その他案件\モバイルWi-Fi\` 配下の GAS 版ファイル群（`class/code.js`, `js/*.html` 等）は旧アーキテクチャであり現状実装と乖離している

---

## §8 既知の制約・将来課題

| 制約・課題 | 詳細 |
|---|---|
| DATE / DATETIME フィールド | フィールドコードは `KC.Config.FIELD` にハードコード。汎用化する場合は `KC.Config.detectFields()` を使い起動時に fields API で自動判別する方式に移行（FIELD_REFERENCE.md §3〜§4 参照） |
| 終日 ⇄ 時間あり相互変換 | kintone フィールド型固定のため未実装。変換には kintone アプリ側のフィールド設計変更が必要 |
| 月ビュー / 日ビュー | `KC.RenderMonth` / `KC.RenderDay` はスタブ（DESIGN.md §3 参照） |
| ARIA / キーボード DnD / タッチ | 将来対応フェーズ。REQ_event-drag-resize.md §10.5 参照 |
| API 失敗通知 | 現状は `alert()` 据え置き。後フェーズで UI 化予定 |
| ステータス定数 | `EXCLUDED_STATUSES` 定数が定義されているが、クエリ構築では文字列リテラル直書き（FIELD_REFERENCE.md §2 参照）。プラグイン化時に統一推奨 |
| プラグイン化 | Phase 1〜9 の実装が完了し `plugin/` 配下にビルド成果物が存在する（2026-05-14 時点）。次のアクションは kintone への実機アップロードと別アプリでの動作検証（Phase 4）、およびその後の Phase 2 実機検証（Phase 5）。詳細は REQ_plugin-migration.md 参照 |

---

## §9 連絡・サポート

- **旧担当**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
- **不明点**: 上記旧担当者に問い合わせること
