# kintone-calendar 引き継ぎ資料

**作成日**: 2026-04-30
**最終更新**: 2026-06-12
**旧担当**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
**想定読者**: 引き継ぎ先の担当者・Claude

---

## §1 プロジェクト概要

kintone レコードを Google Calendar 風に表示するカスタマイズ JS（月・週・日ビュー対応）。

| 項目 | 内容 |
|---|---|
| 実装形式 | kintone プラグイン（IIFE 単一ファイル方式） |
| 配信方式 | **プラグイン版が正本**。`plugin/dist/plugin.zip` を kintone 管理画面から手動アップロード（SAML 認証のため CLI 不可）。`src/docs/` の GitHub Pages ローダー方式は現在未使用（プラグイン実装前の代替として作成したもの） |
| 対象アプリ | 貸与 Wi-Fi 予約カレンダー（k/891: 【DEV】カレンダーアプリ検証用） |
| 主な機能 | 月・週・日ビュー表示、終日 DnD 移動・リサイズ、時間予定 DnD 移動・リサイズ（Phase 2 未検証）、イベント作成・編集・削除（iframe モーダル）、検索バー（REFERENCE_TABLE 対応）、フィルタ（自分の予定）、全画面表示、URL 状態同期（ディープリンク）、DnD 重複ブロック（モード A/B）|
| デプロイ | `plugin/src/` 編集 → `npm run build` → `plugin/dist/plugin.zip` を kintone 管理画面にアップロード |
| リポジトリ | `https://github.com/rishikawa-ship-it/kintone-calendar` |

### src / docs 版について（重要）

`src/kc-calendar.js`・`docs/kc-calendar.js` は GitHub Pages ローダー方式の旧実装であり、**現在は実運用・検証で使用していない**。新機能はすべて `plugin/src/js/desktop.js` に実装する。src/docs 同期ルールは形式上 `CLAUDE.md` に残っているが、現段階では plugin が正本と解釈して運用すること。

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
| 8k | `projects/kintone-calendar/requirements/REQ_month-overflow-popup.md` | 月ビュー `+N more` ポップオーバー 要件定義書（確定版 第 5 版。2026-06-10 更新） |
| 8l | `projects/kintone-calendar/requirements/REQ_search-bar.md` | 検索バー 要件定義書（v4 確定版。2026-06-02 更新） |
| 8m | `projects/kintone-calendar/requirements/REQ_month-cell-fixed-height.md` | 月ビュー セル高さ固定・表示件数動的算出 要件定義書（確定版 第 5 版。2026-06-11 更新。実機検証済み） |
| 8n | `projects/kintone-calendar/requirements/REQ_url-state-sync.md` | URL 状態同期（ディープリンク化）要件定義書（確定版 第 3 版。2026-06-11 更新。実機検証済み） |
| 8o | `projects/kintone-calendar/requirements/REQ_dnd-overlap-block.md` | DnD 重複予防ブロック 要件定義書（確定版 第 6 版。2026-06-11 更新。モード B は実機未検証） |
| 8p | `projects/kintone-calendar/requirements/PERF_AUDIT_2026-06.md` | 処理効率化調査レポート（全 14 件。2026-06-12 作成。P-1〜P-14 実装済み） |
| 9 | `git log --oneline -40` | 直近の変更履歴（重要コミット: df9ff76 = DnD 重複モード B 実装、9af5a55/f05ae9c = URL 状態同期 Phase 1/2、8b2550f = リロード URL パラメータ消失修正、ea799b7 = CB_VA01 バグ修正、c67daa6 = getViewId 誤使用修正（ビュー個別設定が初めて有効化）、b64d251 = ポップアップ初回即閉じ修正、0a0b293 = 処理効率化 P-1〜P-14 一括実装） |

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

### プラグイン版が正本（重要）

- **実運用・検証はプラグイン版のみ**（`plugin/src/` が正本）
- `src/kc-calendar.js` / `docs/kc-calendar.js` は旧 GitHub Pages ローダー方式で現在未使用
- 新機能はすべて `plugin/src/js/desktop.js`（および必要に応じて `config.js`）に実装する
- `CLAUDE.md` の src/docs 同期ルールは形式上残っているが「plugin が正本」と読み替えて運用すること

### ブランチ運用

- **main 直接運用**。`feature/` ブランチ等は採用していない
- 共通ルール（`git-rules.md`）には feature ブランチの記載があるが、本プロジェクトは main 直接で運用している

### デプロイ手順（プラグイン版）

1. `plugin/src/` 配下を編集
2. `plugin/` ディレクトリで `npm run build` → `plugin/dist/plugin.zip` が生成される
3. kintone 管理画面 → プラグイン管理 → アップロードで `plugin.zip` を手動登録
4. SAML 認証環境のため CLI（`@kintone/plugin-uploader` 等）は使用不可

### kintone 環境の注意事項

- **検証アプリ**: k/891（【DEV】カレンダーアプリ検証用）
- **フォーム側の重複チェック**: Customine で実装済み（DnD 側は kintone-calendar JS が担当。棲み分け明確）
- **kintone システム全体カスタマイズ JS**: 6 本存在し、うち 1 本が一覧表示のたびに PUT `/k/v1/records.json` を実行している（カレンダーとは無関係・未調査の別件）

---

## §4 現状（2026-06-12 時点）

| カテゴリ | 状態 |
|---|---|
| **確認済（Phase 1 + 周辺）** | 終日 DnD 移動・リサイズ、ポップアップサイズ割合化（max 1400×900・画面中央）、終日バー単一行+連結+開閉トグル、CSS z-index 修正、placeEvents 単一バー方式、`$revision` 楽観ロック、連続ドラッグ対応 |
| **未検証（Phase 2）** | 時間予定 DnD（移動・上下リサイズ）、日跨ぎ表示復活、バグ A〜D 修正、`.kc-cell` data-date 付与（commit 219d720）。**現運用が終日のみのため実機未検証** |
| **残存 NG（reviewer 観察事項）** | #3 翌日表記、#4 `.kc-overlay` の CSS/JS 競合、Low 2 件（定数集約等）、ARIA 属性は別フェーズ |
| **月ビュー セル高さ固定一式** | セル高固定・終日/日跨ぎ/chip の件数制限統一・`+N more` 最終スロット+1 配置・週行数動的化（4〜6 週。全日翌月の末尾週は非表示）。REQ_month-cell-fixed-height 第 5 版。**実機検証済み（k/891）** |
| **+N more ポップオーバー（終日バー新形式）** | ポップオーバー内の複数日終日バーを「タイトル M/D - M/D」flex 形式（括弧なし・スペース区切り）に変更。旧「別行期間ラベル」方式廃止。終了日 +1 ずれバグも同時修正。REQ_month-overflow-popup 第 5 版。**実機検証済み** |
| **DnD 重複ブロック** | モード A（`overlapKeyFieldCode` による直接フィールド比較クエリ）と モード B（関連レコード方式: 申請番号 → 機器 ID 集合の交差判定、4 ステップ）。config v7→v9。REQ_dnd-overlap-block 第 6 版。**モード A は実機検証済み、モード B は実機未検証** |
| **URL 状態同期（ディープリンク）** | `KC.UrlState` モジュール新規追加。`#kc:` プレフィクスのハッシュ。view/date/filter/q/fs/scroll（replaceState 系）+ record/new/more（pushState 系・戻るボタン連動）。リロード時の URL 書き戻し（`_initialParams` キャッシュ方式）。REQ_url-state-sync 第 3 版。**実機検証済み（k/891 でリロード保持確認）** |
| **処理効率化 P-1〜P-14** | `detectFields`/`detectAppName` 並列化、関連レコード TTL 5 分キャッシュ、placeMonthEvents 二重実行除去、祝日取得後の不要 loadEvents 削減、iframe ポーリング→イベント駆動+1500ms フォールバック、`KC_DEBUG` ログゲート等。PERF_AUDIT_2026-06.md 参照。**実機体感は未確認** |
| **実装済（プラグイン化 Phase 1〜10）** | `plugin/` ディレクトリに src/html/js/css 構成＋ビルド成果物（`plugin/dist/*.ppk`）が存在。設定画面（config.html/config.js/config.css）・desktop.js/desktop.css・manifest.json・ローカル開発環境（plugin/dev/）・ビュー単位設定管理（Phase 9 の 2 階層設計）・重なり描画（Phase 10: 時間予定の列分割 + 半重ね + 右側余白、`OVERLAP_RATIO=0.5`、`RIGHT_MARGIN_PX=24`、FullCalendar 第 6 版互換）まで実装済 |
| **重複時間予定の並列表示** | 実装済（FullCalendar 第 6 版互換、`OVERLAP_RATIO=0.5`、`RIGHT_MARGIN_PX=24`、実機検証完了 2026-05-21） |
| **ポップアップ iframe モーダル化** | 予定クリック時の背面落ち問題を解消するため kintone レコード編集画面を iframe モーダルで表示する方式に変更。カーソル対策・エラーバナーも同時実装（c5b5cf1）。初回クリック即閉じバグ（SSO リダイレクト誤判定）を `_loadCount` 猶予方式で修正済み（b64d251） |
| **権限テーブル HTML5 DnD 行並び替え** | 設定画面の権限テーブルに HTML5 DnD による行並び替えを追加（09ff272） |
| **月ビュー `+N more` ポップオーバー** | フローティングポップオーバー（Google カレンダー踏襲）を実装。全画面表示モード / 通常表示モード両方で動作確認済み（2026-05-29 実機検証 OK）。初版 b3614be → イベント委譲 03ba4a2 → ownerDocument + WeakSet 1e3e0ea → hover 完全分離 aed90c4 → z-index 99999 21ecde6 |
| **検索バー Phase 2** | プラグイン設定で検索対象フィールドをテーブル形式で指定（文字列系 + REFERENCE_TABLE + USER_SELECT）。カーソル API で関連先全件を事前一括取得。フローティング一覧で `+N more` 隠れ予定も含む全マッチ表示。Enter キー / アイテムクリック → iframe モーダル起動。実機検証 OK（2026-06-02）。コミット系列: cfe4372 → 790546a → 970b494 → 81dd00b |
| **バグ修正（2026-06-10〜12）** | 検索 REFERENCE_TABLE キャッシュ CB_VA01（空フィールドコード混入）修正（ea799b7）、リロード URL パラメータ消失修正（8b2550f）、`kintone.app.getViewId()` 不存在 API 誤使用修正（c67daa6）、ポップアップ初回即閉じ修正（b64d251） |
| **未着手** | プラグイン版別アプリ動作検証（Phase 4 以降）、Phase 2 実機検証（Phase 5）、モード B 実機検証 |

### 主要バグ（Phase 2 スコープ、2026-05-20 実機検証結果を追記）

| バグ ID | 内容 | 実機検証結果（2026-05-20） |
|---|---|---|
| A | `.kc-cell` に `data-date` が未付与 → DnD 日付移動が破綻 | **動作確認済**（219d720） |
| B | 終日バー `.kc-ad-event` に mousedown 未配線 → 終日 DnD 不動 | **動作確認済**（最初の DnD で動作。ただし連続 DnD は反映されないケースあり） |
| C | CSS `.kc-event.ghost` と JS `.kc-ghost` のクラス名不整合 → ゴースト UI 無効 | 実機未確認（ゴースト UI が動作するかは別途検証必要） |
| D | リサイズハンドル DOM が存在しない → リサイズ操作不可 | DOM 上は存在を確認。ただし **MCP / JS dispatch でリサイズ操作が反応しない所見あり**（要追跡） |
| E | 5px 閾値なし → マウスダウン直後に DnD 誤発動 | 単独クリックと DnD の切り分け動作を確認 |

### 残存 NG・観察事項（2026-06-12 更新）

| 観察事項 | 備考 |
|---|---|
| リサイズ DnD が MCP / JS dispatch で反応しない | 実機ユーザー操作で要再確認 |
| 同一レコードへの連続 DnD が反映されないケース | 要件 §3.10.1「レスポンス待たない非同期送信」と関連 |
| DnD 重複ブロック モード B 実機未検証 | REFERENCE_TABLE 方式（機器集合の交差判定）。検証環境の準備が必要 |
| CHECK_BOX 型 `in` 演算子の動作（Q-4） | REQ_dnd-overlap-block §10 Q-4 参照。実機確認が必要 |
| 処理効率化の実機体感確認 | P-1〜P-14 実装済み（0a0b293）。実際の起動時間・月送り速度の変化を実機で確認すること |
| `B-P4`（_computeMatchList の空クエリ時 _renderDropdown スキップ）は見送り | 既存動作保護のため実装見送り（PERF_AUDIT_2026-06 §4 参照） |

---

## §5 デプロイ手順（プラグイン版）

| ステップ | コマンド / 操作 |
|---|---|
| 1. 編集 | `plugin/src/js/desktop.js` / `plugin/src/css/desktop.css` / `plugin/src/html/config.html` 等を修正 |
| 2. ビルド | `cd plugin && npm run build` → `plugin/dist/plugin.zip` が生成される |
| 3. コミット | `git add . && git commit -m "feat: ..."` |
| 4. プッシュ | `git push origin main` |
| 5. アップロード | kintone 管理画面 → プラグイン管理 → `plugin.zip` を手動アップロード（SAML 認証のため CLI 不可） |
| 6. 反映確認 | kintone アプリを再読み込みして動作確認（k/891: 【DEV】カレンダーアプリ検証用） |

- src/docs の GitHub Pages 方式は現在未使用。新機能のデプロイはプラグイン版のみ
- `@kintone/customize-uploader` は 2026 年 8 月にメンテナンス終了予定 → 後継は `@kintone/cli-kintone`

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
   REQ_month-overflow-popup.md [第 5 版], REQ_search-bar.md [v4 確定],
   REQ_month-cell-fixed-height.md [第 5 版・実機検証済み],
   REQ_url-state-sync.md [第 3 版・実機検証済み],
   REQ_dnd-overlap-block.md [第 6 版・モード B 実機未検証],
   PERF_AUDIT_2026-06.md [P-1〜P-14 実装済み]）
7. git log --oneline -40

運用方針（厳守）:
- 主スレッドはオーケストレーター専任。コード修正・大規模調査はサブエージェントに委譲
- PM 業務（軽量参照、git status、成果物確認、commit/push）は主スレッド OK
- 新機能は plugin/src/ に実装。src/docs は旧版で現在未使用
- agent-orchestration-rules.md §2 厳格運用に従う

【重要事実】
- 実運用・検証はプラグイン版のみ（plugin/dist/plugin.zip を kintone に手動アップロード。SAML のため CLI 不可）
- 検証アプリ: k/891（【DEV】カレンダーアプリ検証用）
- フォーム側の重複チェックは Customine で実装済み（DnD 側は kintone-calendar JS が担当。棲み分け明確）
- kintone システム全体カスタマイズ JS が 6 本存在し、うち 1 本が一覧表示のたびに PUT /k/v1/records.json を実行（カレンダーとは無関係）
- kintone.app.getViewId() は存在しない API（c67daa6 で修正済み）。event.viewId を使用すること
- kintone はハッシュ（#）を使用しない（k/891 実機確認済み）。#kc: プレフィクスのハッシュが URL 状態同期に使用されている

【実装済（2026-06-12 時点）】
- 月ビュー セル高さ固定一式（実機検証済み。0191c4a〜83557ef の系列）
- +N more ポップオーバー 終日バー新形式「タイトル M/D - M/D」flex 表示（実機検証済み。bbd0d9b〜0ea7325）
- DnD 重複ブロック モード A（実機検証済み）+ モード B（実機未検証。df9ff76）
- URL 状態同期 Phase 1/2（実機検証済み。9af5a55/f05ae9c）
- 処理効率化 P-1〜P-14（実機体感未確認。0a0b293）
- バグ修正: CB_VA01（ea799b7）、リロード URL 消失（8b2550f）、getViewId 誤使用（c67daa6）、初回クリック即閉じ（b64d251）

【未検証】Phase 2（時間予定 DnD・日跨ぎ表示・バグ A〜E 修正）は実機未検証。
時間予定機能への追加要件・バグ報告は検証環境の準備から始めること。

【残存未確定事項】
- DnD 重複ブロック モード B の実機検証（REFERENCE_TABLE 機器集合方式）
- CHECK_BOX 型 in 演算子の実機確認（REQ_dnd-overlap-block §10 Q-4）
- URL 状態同期 Q-3〜Q-5（builder 判断または実機確認）
- 処理効率化の実機体感確認（起動時間・月送り速度）
- リサイズ DnD が実機ユーザー操作で動作するか（MCP/JS dispatch では反応しない）
- 同一レコードへの連続 DnD が反映されないケース（§3.10.1 関連）
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

### src / docs について

- `src/kc-calendar.js`・`docs/kc-calendar.js` は GitHub Pages ローダー方式の旧実装。**現在は実運用・検証で使用していない**
- 新機能はすべて `plugin/src/js/desktop.js` に実装すること
- `CLAUDE.md` の「src 編集後は docs に同期」ルールは形式上残っているが、現段階では plugin が正本

### 旧版ファイルは参照禁止

- `G:\マイドライブ\desktop\その他案件\モバイルWi-Fi\` 配下の GAS 版ファイル群（`class/code.js`, `js/*.html` 等）は旧アーキテクチャであり現状実装と乖離している

---

## §8 既知の制約・将来課題

| 制約・課題 | 詳細 |
|---|---|
| DATE / DATETIME フィールド | フィールドコードは `KC.Config.FIELD` にハードコード。汎用化する場合は `KC.Config.detectFields()` を使い起動時に fields API で自動判別する方式に移行（FIELD_REFERENCE.md §3〜§4 参照） |
| 終日 ⇄ 時間あり相互変換 | kintone フィールド型固定のため未実装。変換には kintone アプリ側のフィールド設計変更が必要 |
| ARIA / キーボード DnD / タッチ | 将来対応フェーズ。REQ_event-drag-resize.md §10.5 参照 |
| DnD 重複ブロック モード B 実機未検証 | 関連レコード方式（REFERENCE_TABLE 経由の機器集合交差判定）。4 ステップ非同期処理。実機での動作確認が必要。CHECK_BOX 型 `in` 演算子の挙動（Q-4）も未確認 |
| URL 状態同期 Q-3〜Q-5 | 残存未確定事項。builder 判断または実機確認が必要（REQ_url-state-sync §10 参照） |
| 処理効率化 実機体感 | P-1〜P-14 すべて実装済み（0a0b293）。起動時間・月送り速度の実機計測は未実施 |
| B-P4 見送り | `_computeMatchList` の空クエリ時 `_renderDropdown` スキップ。既存動作保護のため見送り（PERF_AUDIT_2026-06 §4 参照） |
| プラグイン化 | Phase 1〜10 の実装が完了し `plugin/` 配下にビルド成果物が存在する。次のアクションは kintone への実機アップロードと別アプリでの動作検証（Phase 4: REQ_plugin-migration.md §3）。SAML 認証のためアップロードは手動操作のみ |
| kintone REFERENCE_TABLE 検索 | 関連レコードをカーソル API で全件取得・キャッシュ（TTL 5 分）。TTL 内は再取得なし。キャッシュ更新は保存操作時に明示的に無効化 |
| kintone 全画面表示モードの z-index 階層 | カスタマイズ JS / プラグインで生成する popup 系要素は z-index 9999 以上（推奨 99999）が必要。既存の iframe モーダル: z-index 10000〜10001。`+N more` ポップオーバー: z-index 99999（21ecde6 で対応済み） |
| ステータス定数 | `EXCLUDED_STATUSES` 定数が定義されているが、クエリ構築では文字列リテラル直書き。プラグイン化時に統一推奨 |

---

## §9 連絡・サポート

- **旧担当**: 石川 怜治（r.ishikawa@brgp.bushiroad.co.jp）
- **不明点**: 上記旧担当者に問い合わせること
