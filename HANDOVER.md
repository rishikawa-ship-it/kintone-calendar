# kintone-calendar 引き継ぎ資料

**作成日**: 2026-04-30
**最終更新**: 2026-05-29
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
| 8g | `projects/kintone-calendar/requirements/REQ_month-duplicate-fix.md` | 月ビュー 2 重表示修正 要件定義書（確定版 第 1 版。2026-05-21 起票） |
| 8h | `projects/kintone-calendar/requirements/REQ_permission-reorder.md` | 権限テーブル HTML5 DnD 行並び替え 要件定義書（確定版 第 1 版。2026-05-22 起票） |
| 8i | `projects/kintone-calendar/requirements/REQ_popup-behavior-fix.md` | ポップアップ iframe モーダル化（背面落ち問題解決）要件定義書（確定版 第 3 版。2026-05-27 起票） |
| 8j | `projects/kintone-calendar/requirements/REQ_cursor-error-and-notify.md` | カーソル API 上限エラー対策 & エラー通知 UI 要件定義書（確定版 第 1 版。2026-05-27 起票） |
| 8k | `projects/kintone-calendar/requirements/REQ_month-overflow-popup.md` | 月ビュー `+N more` ポップオーバー 要件定義書（確定版 第 1 版。2026-05-28 起票） |
| 9 | `git log --oneline -40` | 直近の変更履歴（重要コミット: 219d720 = `.kc-cell` data-date 付与、c5b5cf1 = ポップアップ iframe モーダル化、aa029ba = more トグル縦線除去・BAR_H 統一、b3614be = 月ビュー `+N more` ポップオーバー実装） |

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

## §4 現状（2026-05-29 時点）

| カテゴリ | 状態 |
|---|---|
| **確認済（Phase 1 + 周辺）** | 終日 DnD 移動・リサイズ、ポップアップサイズ割合化（max 1400×900・画面中央）、終日バー単一行+連結+開閉トグル、CSS z-index 修正、placeEvents 単一バー方式、`$revision` 楽観ロック、連続ドラッグ対応 |
| **未検証（Phase 2）** | 時間予定 DnD（移動・上下リサイズ）、日跨ぎ表示復活、バグ A〜D 修正、`.kc-cell` data-date 付与（commit 219d720）。**現運用が終日のみのため実機未検証** |
| **残存 NG（reviewer 観察事項）** | #3 翌日表記、#4 `.kc-overlay` の CSS/JS 競合、Low 2 件（定数集約等）、ARIA 属性は別フェーズ |
| **実装済（プラグイン化 Phase 1〜10）** | `plugin/` ディレクトリに src/html/js/css 構成＋ビルド成果物（`plugin/dist/*.ppk`）が存在。設定画面（config.html/config.js/config.css）・desktop.js/desktop.css・manifest.json・ローカル開発環境（plugin/dev/）・ビュー単位設定管理（Phase 9 の 2 階層設計）・重なり描画（Phase 10: 時間予定の列分割 + 半重ね + 右側余白、`OVERLAP_RATIO=0.5`、`RIGHT_MARGIN_PX=24`、FullCalendar 第 6 版互換）まで実装済。実機アップロードでの動作検証は未実施 |
| **重複時間予定の並列表示** | 実装済（FullCalendar 第 6 版互換、`OVERLAP_RATIO=0.5`、`RIGHT_MARGIN_PX=24`、実機検証完了 2026-05-21） |
| **ポップアップ iframe モーダル化** | 予定クリック時の背面落ち問題を解消するため kintone レコード編集画面を iframe モーダルで表示する方式に変更。カーソル対策・エラーバナーも同時実装（c5b5cf1、実機未検証）|
| **権限テーブル HTML5 DnD 行並び替え** | 設定画面の権限テーブルに HTML5 DnD による行並び替えを追加（09ff272、実機未検証）|
| **プラグインアイコン・説明文更新** | マニフェストのアイコンと説明文を更新し「社内開発プラグイン」である旨を明示（6667d40）|
| **終日 more トグル縦線除去・BAR_H 統一** | `.kc-allday-toggle` の背景を `var(--kc-surface)` に変更して縦線アーティファクトを除去。JS 側 BAR_H 定数を 22 → 24 に修正して CSS と統一（aa029ba、実機未検証）|
| **月ビュー `+N more` ポップオーバー** | フローティングポップオーバー（Google カレンダー踏襲）を実装。`KC.MonthOverflowPopup` モジュール新規追加、`applyOverflow()` にクリックハンドラ接続。**実機検証 OK**（2026-05-29 完了）。初版 b3614be → イベント委譲 03ba4a2 → ownerDocument + WeakSet 1e3e0ea → hover 完全分離 aed90c4 → z-index 99999 21ecde6。全画面表示モード / 通常表示モード両方で動作確認済み|
| **未着手** | プラグイン版別アプリ動作検証（Phase 4 以降）、Phase 2 実機検証（Phase 5） |

### 主要バグ（Phase 2 スコープ、2026-05-20 実機検証結果を追記）

| バグ ID | 内容 | 実機検証結果（2026-05-20） |
|---|---|---|
| A | `.kc-cell` に `data-date` が未付与 → DnD 日付移動が破綻 | **動作確認済**（219d720） |
| B | 終日バー `.kc-ad-event` に mousedown 未配線 → 終日 DnD 不動 | **動作確認済**（最初の DnD で動作。ただし連続 DnD は反映されないケースあり） |
| C | CSS `.kc-event.ghost` と JS `.kc-ghost` のクラス名不整合 → ゴースト UI 無効 | 実機未確認（ゴースト UI が動作するかは別途検証必要） |
| D | リサイズハンドル DOM が存在しない → リサイズ操作不可 | DOM 上は存在を確認。ただし **MCP / JS dispatch でリサイズ操作が反応しない所見あり**（要追跡） |
| E | 5px 閾値なし → マウスダウン直後に DnD 誤発動 | 単独クリックと DnD の切り分け動作を確認 |

### 残存 NG・観察事項（2026-05-29 更新）

| 観察事項 | 備考 |
|---|---|
| リサイズ DnD が MCP / JS dispatch で反応しない | 実機ユーザー操作で要再確認 |
| 同一レコードへの連続 DnD が反映されないケース | 要件 §3.10.1「レスポンス待たない非同期送信」と関連 |
| 月ビュー `+N more` ポップオーバー | 実機検証 OK (2026-05-29)。残存課題なし |

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
   REQ_month-view.md, REQ_month-dnd.md, REQ_day-view.md,
   REQ_month-duplicate-fix.md, REQ_permission-reorder.md,
   REQ_popup-behavior-fix.md, REQ_cursor-error-and-notify.md,
   REQ_month-overflow-popup.md）
7. git log --oneline -40

運用方針（厳守）:
- 主スレッドはオーケストレーター専任。コード修正・大規模調査はサブエージェントに委譲
- PM 業務（軽量参照、git status、成果物確認、commit/push）は主スレッド OK
- src/ 編集後は docs/ に必ず同期
- agent-orchestration-rules.md §2 厳格運用に従う

【未検証】Phase 2（時間予定 DnD・日跨ぎ表示・バグ A〜E 修正、commit 219d720）は実機未検証。
時間予定機能への追加要件・バグ報告は検証環境の準備から始めること。
実機検証は REQ_plugin-migration.md Phase 5 のスコープで実施予定。

【実装済】Phase 1（終日 DnD 移動・リサイズ）、ポップアップサイズ割合化、終日バー単一行+連結+開閉トグル、
重なり描画（FullCalendar 第 6 版互換、2026-05-21）、権限テーブル行並び替え（HTML5 DnD、09ff272）、
ポップアップ iframe モーダル化 + カーソル対策・エラーバナー（c5b5cf1、実機未検証）、
終日 more トグル縦線除去・BAR_H 統一（aa029ba、実機未検証）、
月ビュー `+N more` ポップオーバー（フローティング・Google カレンダー踏襲、b3614be〜21ecde6、実機検証 OK 2026-05-29）。

【プラグイン化】plugin/ 配下に Phase 10 まで実装済（2026-05-28）。
Phase 10 = 重なり描画（時間予定の列分割 + 半重ね + 右側余白）。
次のアクションは kintone への実機アップロード（plugin/dist/plugin.zip）と
別アプリでの動作検証（Phase 4: REQ_plugin-migration.md §3）。
SAML 認証のためアップロードは手動操作のみ（CLI ツール不可）。

直近の未解決事項:
- 月ビュー `+N more` ポップオーバーは実機検証 OK (2026-05-29)。全画面表示モード / 通常表示モード両方で動作確認済み
- リサイズ DnD が MCP / JS dispatch で反応しない（実機ユーザー操作で要再確認）
- 同一レコードへの連続 DnD が反映されないケース（§3.10.1「レスポンス待たない非同期送信」と関連）
- リサイズハンドルの ARIA 属性対応は別タスク（REQ_event-drag-resize.md §10.5）
- プラグイン版 Phase 4〜6（別アプリ検証・Phase 2 実機検証・ドキュメント）が未着手
- ポップアップ iframe モーダル化・more トグル縦線除去・BAR_H 統一は実機未検証（実機確認が必要）
- 終日バー / 日跨ぎバーの超過時の `+N more` カウント問題は未対応（REQ_month-overflow-popup.md §3.5 参照）
- CSS の `#dbeafe` vs `#eef2ff` 差分（plugin/src と src の不一致）は別タスクで整理推奨
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
| 月ビュー / 日ビュー | `KC.RenderMonth` / `KC.RenderDay` は実装済（実機未検証。DESIGN.md §3 参照）|
| ARIA / キーボード DnD / タッチ | 将来対応フェーズ。REQ_event-drag-resize.md §10.5 参照 |
| API 失敗通知 | 現状は `alert()` 据え置き。後フェーズで UI 化予定 |
| ステータス定数 | `EXCLUDED_STATUSES` 定数が定義されているが、クエリ構築では文字列リテラル直書き（FIELD_REFERENCE.md §2 参照）。プラグイン化時に統一推奨 |
| プラグイン化 | Phase 1〜10 の実装が完了し `plugin/` 配下にビルド成果物が存在する（2026-05-29 時点）。Phase 10 = 重なり描画（時間予定の列分割 + 半重ね + 右側余白）。月ビュー `+N more` ポップオーバー実装 + 全画面表示対応 + hover 領域完全分離 + z-index 99999 (2026-05-29 実機検証完了)。次のアクションは kintone への実機アップロードと別アプリでの動作検証（Phase 4）、およびその後の Phase 2 実機検証（Phase 5）。終日バー / 日跨ぎバーの超過時の `+N more` カウント問題は本ポップオーバー実装のスコープ外（REQ_month-overflow-popup.md §3.5 参照）。CSS の `#dbeafe` vs `#eef2ff` 差分（plugin/src と src の不一致）は別タスクで整理推奨。詳細は REQ_plugin-migration.md 参照 |
| kintone 全画面表示モードの z-index 階層 | kintone 全画面表示モードは独自の高 z-index overlay を使用するため、カスタマイズ JS / プラグインで生成する popup 系要素は z-index 9999 以上（推奨 99999）が必要。既存の iframe モーダル: z-index 10000〜10001。`+N more` ポップオーバー: z-index 99999 (21ecde6 で対応済み) |

---

## §9 連絡・サポート

- **旧担当**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
- **不明点**: 上記旧担当者に問い合わせること
