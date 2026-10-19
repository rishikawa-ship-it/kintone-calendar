# REQ_dnd-enable-setting — ドラッグ操作（移動・リサイズ）の許可設定

ステータス: 確定版 第1版（2026-10-19 本番で主要経路を実機検証済み）
作成日: 2026-10-19
更新日: 2026-10-19
担当: designer

---

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 確定版 第1版 | 2026-10-19 | 初版。`fieldMapping.dndEnabled` による DnD 許可 ON/OFF を定義。モバイルWi-Fi貸出管理アプリでは OFF 運用（2026-10-19 決定） |

---

## §1 背景・目的

### 背景

カレンダー上のドラッグ移動・リサイズは `KC.DnD` → `_commitOptimistic` → `KC.Api.updateEvent`（REST PUT）で直接保存される。kintone の保存イベント（`app.record.edit.submit` / `submit.success` 等）を経由しないため、Customine の保存直前チェック（台数・期間重複）や保存直後処理（サブテーブル行の更新・通知）が一切走らない。

モバイルWi-Fi貸出管理アプリは整合性の担保を Customine 側に寄せているため、ドラッグ保存は二重予約や通知漏れ・サブテーブル不整合の原因になり得る。

### 目的

- ドラッグ操作を設定で無効化できるようにする（既定は従来どおり有効）。
- 無効化したアプリでは、期間変更を「予定クリックで開く編集ポップアップ」（`REQ_popup-behavior-fix.md`）に統一し、必ず kintone の保存イベントを通す。
- 2026-10-19 決定: モバイルWi-Fi貸出管理アプリでは OFF にする。

---

## §2 現状分析

- 保存経路: `plugin/src/js/desktop.js` の `_commitOptimistic`（約 2695 行）が各 DnD の mouseup 後に呼ばれ、`KC.Api.updateEvent` で REST PUT する（呼び出し 約 3015 / 3558 / 4010 行）。
- DnD の start 系 8 関数（`KC.DnD` 公開）: `startMoveAllday` / `startResizeAllday` / `startMove` / `startResize` / `startMoveAlldayMonth` / `startResizeAlldayMonth` / `startMoveMonthChip` / `startResizeMonthTimedSpan`（約 3026〜4101 行）。呼び出し元は週・日・月ビューの mousedown ハンドラ（約 4539〜6014 行）。
- 既存の boolean 設定の先例: `fieldMapping.mailLoginUserDefault`（約 336〜338 行。キー欠落時は false の後方互換デフォルト）。本機能は逆に欠落時 true。
- 権限制御（`PERMISSION_RULES` / `DEFAULT_PERMISSION` の `canEdit`）は別機構で、DnD 開始可否に作用している。本機能はこれと独立。
- 設定スキーマ `version` は 13（本機能では上げない）。

> 行番号は実装中の変動があり得るため目安。実装後の正は `plugin/src/js/desktop.js` を参照。

---

## §3 機能要件

### FR-1: 設定項目

- `fieldMapping.dndEnabled`（boolean、既定 true）を追加する。`version` は 13 のまま。
- 判定はすべて `!== false`。キー欠落・null・非 boolean の旧設定は ON 扱い。

### FR-2: 設定画面

- 基本設定タブにチェックボックス `#kc-dnd-enabled`、ラベル「カレンダー上のドラッグで予定の移動・期間変更を許可する」を置く。
- 初期表示は保存値を反映。キー欠落時はチェック ON。

### FR-3: 保存・エクスポート・インポート

- 保存時・エクスポート時: `mailLoginUserDefault` と同じ方式で `fieldMapping` に `dndEnabled` をマージする。
- インポート時: `fieldMapping` をマージした後にチェックボックスへ再反映する。
- マイグレーションチェーン末尾: `fieldMapping.dndEnabled` が boolean でなければ true を補う。

### FR-4: 本体の判定

- `KC.Config.DND_ENABLED`（既定 true）を持ち、`loadFromPluginConfig` で `fm.dndEnabled !== false` として設定する。

### FR-5: DnD の無効化

- `KC.DnD` の start 系 8 関数の先頭で `KC.Config.DND_ENABLED === false` なら即 return する。`preventDefault` / `stopPropagation` より前に置き、mousedown 後のクリックでポップアップを開く既存動作を妨げない。
- `_commitOptimistic` 先頭にも同条件の二重防御を置く（return のみ。保存・楽観更新をしない）。

### FR-6: 見た目

- OFF のとき、カレンダーのルート要素に `kc-dnd-disabled` クラスを付ける。
- CSS（`plugin/src/css/desktop.css`）で、`.kc-dnd-disabled` 配下のリサイズハンドルを非表示、イベントバーの `cursor: grab` を `pointer` にする。

### FR-7: 権限機構との関係

- 本設定は `PERMISSION_RULES` / `DEFAULT_PERMISSION` の `canEdit` とは独立した AND 条件。DnD が可能なのは「`DND_ENABLED` が ON かつ canEdit が許可」のときのみ。
- 本設定を OFF にしても canEdit の判定や編集ポップアップの権限挙動は変えない。

---

## §4 受け入れ基準

### AC-1: OFF で移動が始まらない

- Given: `dndEnabled=false` で月・週・日のいずれかのビューを表示している
- When: 終日バー・時間バー・月 chip をドラッグする
- Then: ゴーストは出ず位置も変わらず、`KC.Api.updateEvent` は呼ばれない（Network に PUT が出ない）

### AC-2: OFF でリサイズが始まらない

- Given: `dndEnabled=false`
- When: 終日バーの左右端・時間バーの上下端・月の時間スパン端をドラッグする
- Then: 期間は変わらず、PUT は発生しない

### AC-3: OFF でもクリックで編集ポップアップが開く

- Given: `dndEnabled=false`
- When: 予定をクリックする（わずかなドラッグ動作を含む）
- Then: 編集ポップアップが開く（`REQ_popup-behavior-fix.md` の動作を維持）

### AC-4: OFF でハンドル非表示・カーソル

- Given: `dndEnabled=false`
- Then: ルート要素に `kc-dnd-disabled` が付き、リサイズハンドルが見えず、予定上のカーソルが grab にならず pointer になる

### AC-5: ON（既定）では従来どおり

- Given: `dndEnabled=true`、または設定画面で一度も触れていない新規設定
- Then: 移動・リサイズ・楽観更新・重複ブロック等が従来どおり動作し、ハンドルと grab カーソルが表示される

### AC-6: 旧設定は ON

- Given: `fieldMapping` に `dndEnabled` キーが無い保存済み設定
- When: カレンダーを開く / 設定画面を開く
- Then: DnD は有効で、`#kc-dnd-enabled` はチェック ON で表示される

### AC-7: エクスポート → インポートで保持

- Given: `#kc-dnd-enabled` を OFF にして保存し、設定をエクスポートした
- When: そのファイルを別設定（または初期化後）にインポートする
- Then: `#kc-dnd-enabled` が OFF で反映され、保存後も OFF のまま。ON についても同様

### AC-8: 権限との独立性

- Given: `dndEnabled=true` で、あるユーザーの canEdit が不許可
- Then: そのユーザーは従来どおり DnD できない（本設定が ON でも権限は緩和されない）

---

## §5 検証項目・テストシナリオ

| ID | シナリオ | 期待 | 対応 AC |
|---|---|---|---|
| T1 | OFF 保存後に月ビューで終日バー・chip を DnD / リサイズ | 動かない・PUT なし | AC-1, AC-2 |
| T2 | OFF で週ビュー・日ビューの時間バーを DnD / 上下端リサイズ | 動かない・PUT なし | AC-1, AC-2 |
| T3 | OFF で予定クリック | 編集ポップアップが開く | AC-3 |
| T4 | OFF で DevTools によりクラス・カーソルを確認 | `kc-dnd-disabled`・ハンドル非表示・pointer | AC-4 |
| T5 | ON で全ビューの DnD・リサイズ | 従来どおり | AC-5 |
| T6 | `fieldMapping` から `dndEnabled` を削除した設定で起動 | ON 扱い | AC-6 |
| T7 | OFF→エクスポート→インポート→保存→再読込 | OFF が保持 | AC-7 |
| T8 | canEdit 不許可ユーザー＋ ON | DnD 不可のまま | AC-8 |
| T9 | OFF のままモバイルWi-Fi貸出管理アプリで編集ポップアップから期間変更・保存 | Customine の保存前チェックが走る | 背景 |

設定画面の確認は puppeteer ハーネス（出荷コード＋kintone スタブ）で自動化可能（T6・T7 の設定部分）。

---

## §6 想定 UX / シーケンス

```
[管理者: 設定画面 > 基本設定 > チェックを外して保存]
  → fieldMapping.dndEnabled = false が保存される
[利用者: カレンダーを開く / リロード]
  → loadFromPluginConfig: KC.Config.DND_ENABLED = false
  → ルート要素に kc-dnd-disabled が付く
[利用者: 予定をドラッグ]
  → start 系関数が先頭で return（ゴースト無し・PUT 無し）
[利用者: 予定をクリック]
  → 編集ポップアップが開く → 期間変更 → 保存
  → kintone の保存イベント経由 → Customine の保存前/後処理が走る
```

---

## §7 非機能要件

- 後方互換: 既存設定の動作を変えない（キー欠落は ON）。`version` 13 を維持し、新規マイグレーション段は追加しない（チェーン末尾の補完のみ）。
- 判定コスト: start 系の先頭で真偽値を 1 回参照するのみ。描画性能への影響なし。
- 保守性: 判定は `!== false` に統一し、判定箇所を `KC.Config.DND_ENABLED` の参照に集約する。
- `src/` 版（未使用・旧版）は対象外。プラグイン版のみ（`plugin/src/js/desktop.js`、`plugin/src/js/config.js` 相当、`plugin/src/css/desktop.css`）。

---

## §8 既知の制約

- ON/OFF は設定読み込み時に確定する。設定変更後は、開いているカレンダーのリロード（kintone 画面のハードリロード）が必要で、即時には反映されない。
- OFF は DnD 経由の保存だけを止める。クイック作成等、DnD 以外の REST 直接保存経路があれば本設定の対象外（本書の範囲外）。
- JS キャッシュにより反映されない場合はハードリロードが必要（plugin 更新後共通）。

---

## §9 検証状況

- node --check・`npm run build:plugin` 通過。reviewer レビュー指摘なし。
- 2026-10-19 本番（モバイルWi-Fi貸出管理アプリ 704、設定 OFF）で実機確認:
  - 読み込んだプラグイン JS に `DND_ENABLED` が含まれ、`#kc-root` に `kc-dnd-disabled` が付く ✓
  - 月ビューの予定バー: カーソル pointer、リサイズハンドル `display:none` ✓
  - 月ビューの終日バーで mousedown→mousemove(200px)→mouseup を合成イベントで実行: `body.kc-dnd-active` は付かず、レコード（REST 作成の [TEST] DND、2027-03-09〜10）の revision・日付は不変 ✓
  - 同じバーをクリック: 編集ポップアップ（show#record）が開き、× で閉じられる ✓
- 未実施: 週・日ビュー、月のチップ／日跨ぎ時間予定での同様の確認（同じ start 系ガードを通る）、設定画面の puppeteer 検証（保存・エクスポート／インポートの往復）、ON のままの他アプリでの従来動作。

---

## §10 未解決事項・リスク・前提

- 前提: モバイルWi-Fi貸出管理アプリは OFF で運用する（2026-10-19 決定）。他アプリは既定の ON のまま。
- 未解決: DnD 以外に REST で直接保存する操作の有無は未調査（§8 参照）。必要なら別要件で扱う。
- リスク: start 系の見落としにより一部経路で DnD が残る恐れがある。`_commitOptimistic` の二重防御で保存自体は止まるが、ゴーストは出る可能性がある。T1・T2 で全経路を確認する。

---

## §11 参照ファイル

| ファイル | 参照箇所 |
|---|---|
| `plugin/src/js/desktop.js` | `KC.Config.loadFromPluginConfig`、`KC.DnD`（start 系 8 関数・`_commitOptimistic`）、約 336〜338 行（`mailLoginUserDefault` 先例） |
| `plugin/src/css/desktop.css` | `.kc-dnd-disabled` 関連規則 |
| `requirements/REQ_popup-behavior-fix.md` | クリックで開く編集ポップアップの仕様 |
