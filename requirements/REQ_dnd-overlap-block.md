# 要件定義書: DnD 重複予防ブロック（リソース競合チェック）

**文書番号**: REQ_dnd-overlap-block
**作成日**: 2026-06-11
**最終更新日**: 2026-06-11（第 2 版: Q-1〜Q-3・Q-5 をユーザー確認により確定）
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 第 2 版（残存未確定事項: §10 Q-4・Q-6 のみ）
**関連文書**:
- `requirements/REQ_event-drag-resize.md` — DnD の楽観的更新フロー（§3.10）
- `requirements/REQ_cursor-error-and-notify.md` — バナー通知 UI（KC.Banner）
- `requirements/REQ_edit-permission-extension.md` — 権限設定・プラグイン設定スキーマ
- `plugin/src/js/desktop.js` — 実装対象（プラグイン版）
- `plugin/src/js/config.js` — 設定画面スクリプト（現行 version 7）
- `plugin/src/html/config.html` — 設定画面 HTML

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析](#2-現状分析)
3. [スコープと棲み分け](#3-スコープと棲み分け)
4. [機能要件](#4-機能要件)
5. [非機能要件](#5-非機能要件)
6. [チェックフロー設計](#6-チェックフロー設計)
7. [クエリ仕様](#7-クエリ仕様)
8. [設定画面仕様](#8-設定画面仕様)
9. [プラグイン設定 JSON スキーマ](#9-プラグイン設定-json-スキーマ)
10. [未確定事項・リスク・前提](#10-未確定事項リスク前提)
11. [受入基準](#11-受入基準)
12. [検証項目・テストシナリオ](#12-検証項目テストシナリオ)
13. [想定 UX / シーケンス](#13-想定-ux--シーケンス)

---

## 1. 背景・目的

### 1.1 背景

KC Calendar は kintone レコードを Google Calendar 風に表示し、DnD（ドラッグ＆ドロップ）で予定の日時を直接変更できる。現状、DnD による日時変更は既存レコードとの期間重複を一切チェックせず、kintone REST API に無条件で PUT を送信する。

これにより、「会議室（機器・設備）等のリソースを予約するカレンダー」として運用する場合に、同じリソース（会議室 A など）に対して同時刻帯の予約が重なって登録されてしまう問題が発生しうる。

kintone アプリ側では Customine による保存前チェックを別途実装済みであり、フォーム保存（新規作成・編集ダイアログ経由）はそちらで保護されている。DnD 経由の日時変更は kintone の保存イベント（`app.record.*.submit`）をバイパスするため、カレンダー JS 側での独立したチェックが必要である。

### 1.2 目的

カレンダー上で DnD による日時変更を行う際、以下の AND 条件に該当する既存レコードが存在する場合に変更をブロックし、ユーザーに通知する。

- 条件①: 移動先の期間（新しい start〜end）が既存レコードの期間と重なる
- 条件②: 指定した「リソースキーフィールド」の値が既存レコードと同一である

---

## 2. 現状分析

### 2.1 DnD 保存経路（`src/kc-calendar.js` および `plugin/src/js/desktop.js` 共通）

DnD による日時変更は `KC.DnD` モジュール内の `_commitOptimistic` 関数（`src/kc-calendar.js:1400–1433`）が担う。

```
mouseup
  ↓
drag.newStart !== drag.ev.start or drag.newEnd !== drag.ev.end を確認
  ↓
_commitOptimistic(drag.ev, drag.newStart, drag.newEnd)
  ├─ KC.State.events をインプレース更新（即時 UI 反映）
  ├─ KC.Render.renderGrid()（即時再描画）
  └─ KC.Api.updateEvent(payload) を await せず非同期送信
       ├─ 成功: 戻り値の $revision を KC.State に反映
       └─ 失敗: alert(err.message) + KC.Render.refresh() でロールバック
```

この `_commitOptimistic` の直前に重複チェックが存在しない（src/kc-calendar.js:1590–1592 / plugin/src/js/desktop.js:1797–1801）。

呼び出し箇所は以下の 4 か所（plugin 版の行番号基準）:
- `_onMouseUpAllday`（終日予定 移動・リサイズ共用）: desktop.js 約 1796–1801 行
- `_onMouseUpTime`（時間予定 移動・リサイズ共用）: desktop.js 約 2338–2341 行
- 月ビュー chip `_onMouseUpMonthChip`: desktop.js 約 2721–2726 行

### 2.2 重複チェックの非存在

`src/kc-calendar.js` および `plugin/src/js/desktop.js` の双方において、以下のいずれも存在しない:
- 期間重複チェックのクエリ発行
- リソースキーフィールドの値比較
- 重複検出時の保存ブロック

### 2.3 `$revision` 楽観ロックとの区別

`KC.Api.updateEvent` は `revision: ev.rev` を PUT パラメータに含め（desktop.js 約 902 行）、**同一レコードの同時編集**による 409 競合を検出する。これは「自分が編集を開始してから別ユーザーが同じレコードを先に更新した」場合の防衛であり、「別レコード間の期間重複」チェックとは全く異なる仕組みである。本機能はそれとは独立して実装する。

### 2.4 既存のバナー通知 UI

`KC.Banner` モジュール（desktop.js 約 5356–5439 行）が既に実装済みである（REQ_cursor-error-and-notify の成果物）。`KC.Banner.show(message)` / `KC.Banner.hide()` でカレンダー上部に固定バナーを表示・消去できる。本機能の通知はこのバナーを再利用する。

---

## 3. スコープと棲み分け

### 3.1 本機能のスコープ（カレンダー JS が担う範囲）

**対象: DnD（移動・リサイズ）による日時変更のみ**

| 保存経路 | 本機能の対象 | 理由 |
|---|---|---|
| DnD 移動（終日・時間・月ビュー） | **対象** | `_commitOptimistic` 前でチェックを挿入できる |
| DnD リサイズ（終日左右・時間上下） | **対象** | 同上 |
| タイムスロットクリック → iframe 新規作成 | **対象外** | Customine で実装済み。iframe 内は JS 介入不可 |
| イベントクリック → iframe 編集 | **対象外** | 同上 |
| kintone 直接編集（カレンダー非経由） | **対象外** | カレンダー JS が完全に介在できない。Customine で対応済み |

この棲み分けを README 相当のコメントとして実装コードにも明記すること。

### 3.2 対象ファイル

- **実装対象**: `plugin/src/js/desktop.js`（プラグイン版）
- **設定画面**: `plugin/src/js/config.js` / `plugin/src/html/config.html`
- **src 版（GitHub Pages カスタマイズ JS）は対象外（確定）**: src 版はプラグイン実装前の代替手段であり現在は運用していない。本機能は plugin 版のみに実装する。`src/kc-calendar.js` および `docs/` の修正は不要。

---

## 4. 機能要件

### FR-1: リソースキーフィールドの設定

- プラグイン設定画面でリソースキーフィールドを 1 つ選択できる
- 選択可能な型: kintone クエリの `=` 演算子および `in` 演算子が使用できるフィールド
  - 含む型: `SINGLE_LINE_TEXT` / `NUMBER` / `DROP_DOWN` / `RADIO_BUTTON` / `CHECK_BOX` / `LOOKUP`（ルックアップ元フィールドとして存在する型）/ `USER_SELECT`
  - 除外する型: `REFERENCE_TABLE`（kintone クエリ不可のため。設定画面に「関連レコードテーブル自体は選択不可。関連付けに使うキーフィールドを選んでください」という説明文を表示する）/ `MULTI_LINE_TEXT` / `RICH_TEXT` / `FILE` 等
- 未選択時は本機能無効（現状動作を維持）
- フィールド未選択（空文字）の場合: 重複チェックをスキップし、従来どおり即時 `updateEvent` を送信する

### FR-2: 重複判定クエリ

DnD 確定時、kintone REST API `GET /records.json` で重複候補レコードを取得して判定する。クエリ仕様は §7 に詳述。

### FR-3: ブロック時の動作

- 重複レコードが 1 件以上検出された場合: `KC.Api.updateEvent` を**送信せず**、楽観更新（インプレース更新済みの `KC.State.events` および UI）を元の値に巻き戻す
- バナーを表示する: 重複先の先頭 1 件のタイトルを含むメッセージを表示する（§7.2 参照）。例: 「「会議室 A の定例会議」と期間が重複しています」。複数件ヒット時は先頭 1 件のタイトル + 件数を表示する（例: 「「会議室 A の定例会議」ほか N 件と期間が重複しています」）。具体的な文言や件数表現は実装時に調整可
- 0 件の場合: 従来どおり `KC.Api.updateEvent` を送信する

### FR-4: チェック API エラー・タイムアウト時の動作（安全側）

- 重複チェッククエリ（GET /records.json）が API エラー・タイムアウト等で失敗した場合: ブロック扱いとする（安全側）
- 楽観更新を巻き戻し、バナーを表示する: `KC.Banner.show('重複チェック中にエラーが発生しました。再度操作してください。')`

### FR-5: 除外ステータス条件の適用

重複チェッククエリには、カレンダー表示クエリと同じ除外ステータス条件（`KC.Config.EXCLUDED_STATUSES`）を適用する。「返却済」「削除済」は重複候補から除外する。

### FR-6: 自レコード除外

移動元レコード自身は重複候補から除外する（`$id != 自レコードID`）。

### FR-7: フロー変更（楽観更新との整合）

現行の `_commitOptimistic`（REQ_event-drag-resize §3.10.1）は「State 更新 → renderGrid → await しない updateEvent 送信」の順で動作する。本機能の導入により、フローを以下のとおり変更する:

1. State をインプレース更新し `renderGrid` で即時 UI 反映（既存どおり）
2. 重複チェッククエリを **await で待つ**
3. 0 件: `KC.Api.updateEvent` を送信（以降は従来どおり）
4. 1 件以上 or エラー: `updateEvent` を送信せず、State を元の値に巻き戻し、`renderGrid` 再実行、バナー表示

この変更により、重複チェック中（ステップ 2）はユーザーが楽観的反映後の状態をカレンダー上で見ることになる（数百ミリ秒〜1 秒程度）。チェック完了後にブロックが確定した場合のみ元に戻る。この UX を「楽観先行 + 後巻き戻し方式」と呼ぶ。

---

## 5. 非機能要件

### NF-1: チェック API コール数

- DnD 1 回の確定につき、重複チェッククエリは最大 1 回の `GET /records.json` を発行する
- チェックが有効な場合（リソースキーフィールド設定済み）のみ追加 API コールが発生する

### NF-2: パフォーマンス

- 重複チェッククエリは `limit 1` で発行し、存在確認のみを行う（全件取得不要）
- 1 件以上 or 0 件の 2 値判定で済むため、応答サイズを最小化する

### NF-3: 後方互換

- リソースキーフィールドが未設定（空文字・未設定）の場合、重複チェックを完全にスキップし、既存の `_commitOptimistic` フローと同一動作を維持する
- プラグイン設定 JSON のバージョンを 7 → 8 に更新する。version 7 以前の設定には `overlapKeyFieldCode` が存在しないため空文字として初期化し、重複チェック無効（既存動作）が維持される

---

## 6. チェックフロー設計

### 6.1 フロー概要（FR-7 の詳細）

```
[mouseup: DnD 確定操作]
  ↓
drag.newStart と drag.newEnd が変化しているか確認
  │ 変化なし: 何もしない
  │ 変化あり:
  ↓
-- 楽観先行フェーズ --
State.events のターゲットイベントを { start: newStart, end: newEnd } に更新
KC.Render.renderGrid()  ← 即時 UI 反映（ユーザーには移動後が見える）

-- チェックフェーズ（await）--
overlapKeyFieldCode が空文字? → チェックスキップ → [送信フェーズ] へ
  ↓（設定あり）
重複チェッククエリ送信（GET /records.json, limit 1）
  ↓
成功 and records.length === 0?
  ├─ YES → [送信フェーズ] へ
  └─ NO（1件以上 or エラー） → [ブロックフェーズ] へ

-- 送信フェーズ --
KC.Api.updateEvent(payload)  ← await なし（従来の楽観送信）
  ├─ 成功: $revision 更新
  └─ 失敗: alert + KC.Render.refresh()

-- ブロックフェーズ --
State.events のターゲットイベントを元の { start: origStart, end: origEnd } に戻す
KC.Render.renderGrid()  ← 巻き戻し後の再描画
KC.Banner.show(errorMessage)
return（updateEvent は送信しない）
```

### 6.2 `_commitOptimistic` への影響

現行の `_commitOptimistic` 関数は同期的な処理（State 更新 + renderGrid）と非同期 PUT（await しない）で構成されている。本機能の挿入後は、`_commitOptimistic` を `async function` に変更し、重複チェッククエリを `await` で待つ。

呼び出し側（`_onMouseUpAllday` / `_onMouseUpTime` / `_onMouseUpMonthChip`）はいずれもイベントハンドラであり、`_commitOptimistic` を `await` する必要はない（未処理の Promise rejection を防ぐため `.catch` は付与する）。

---

## 7. クエリ仕様

### 7.1 重複チェッククエリ（期間重複の定義）

2 つの期間 `[A_start, A_end)` と `[B_start, B_end)` が重なる条件（開区間表現、**隣接は重複なし: 確定**）:

```
A_start < B_end  AND  A_end > B_start
```

ここで A = 既存レコードの期間、B = 移動後の新しい期間（newStart〜newEnd）とすると、kintone クエリ条件は:

```
(start_field < "newEnd") AND (end_field > "newStart")
```

**隣接の扱い（確定: Google 準拠）**: 前のレコードの `end` = 次のレコードの `start` が同値の場合（連続予約例: 9:00〜10:00 と 10:00〜11:00）は**重複なし**とみなす。`<` および `>` の厳密不等号を使用することでこの判定が自然に実現される。隣接境界（`end = newStart` または `start = newEnd`）の同値ケースはいずれの不等号にも一致しないためヒットしない。

### 7.2 クエリ全文

```
(start_field < "newEnd")
AND (end_field > "newStart")
AND (resource_key_field = "resourceKeyValue")
AND ($id != "自レコードID")
AND (status_field not in ("返却済","削除済"))
order by $id asc limit 1
```

各プレースホルダーの解決:
- `start_field` / `end_field`: `KC.Config.FIELD.start` / `KC.Config.FIELD.end`
- `newEnd` / `newStart`: DnD 確定後の新しい日時（ISO 8601 文字列。DATE 型の場合は `YYYY-MM-DD` 形式に変換すること。変換ロジックは `loadEvents` の `qStart` / `qEnd` 算出と同様）
- `resource_key_field`: `KC.Config.OVERLAP_KEY_FIELD_CODE`
- `resourceKeyValue`: 対象 KcEvent のリソースキーフィールド値（後述 §7.3）
- `$id != "自レコードID"`: `ev.id` を文字列として使用
- `status_field not in (...)`: `KC.Config.EXCLUDED_STATUSES` を参照。`KC.Config.FIELD.status` が空文字の場合はこの条件を省略

**`fields` パラメータ**: FR-3 の「重複先タイトルをバナーに表示する」要件に対応するため、クエリの `fields` には `$id` とタイトルフィールド（`KC.Config.FIELD.title`）を最低限含める。`limit 1` で先頭 1 件のみ取得し、そのタイトル値を `firstTitle` としてバナーメッセージを構成する。複数件の件数は `records.length` では判定できない（`limit 1` のため）が、「1 件以上確認」という表現で充足する（実装時に「ほか N 件」表現を追加する場合は `limit` 値の調整が必要）。

### 7.3 リソースキー値の取得

DnD 対象の KcEvent にはリソースキーフィールドの値が格納されていない可能性がある（`_recordToEvent` の変換対象外のフィールドのため）。

2 つのアプローチが考えられる:

**案 A: `loadEvents` 取得時に `KC.Config.OVERLAP_KEY_FIELD_CODE` を `fieldList` に追加し、KcEvent の拡張フィールドとして保持する**（推奨）

- `loadEvents` の `fieldList` 構築ブロック（`src/kc-calendar.js:557–577` 相当）に `OVERLAP_KEY_FIELD_CODE` を追加する
- `_recordToEvent` で `rawOverlapKeyValue` として KcEvent に格納する（または `extraFields` 汎用マップに格納する）
- DnD 確定時に `ev.rawOverlapKeyValue` を参照してクエリを組む

**案 B: DnD 確定時に単独 GET（`/k/v1/record.json?app=...&id=ev.id`）でリソースキー値だけ取得する**

- 追加 API コールが 1 回増えるが、KcEvent 変換処理の変更が最小限
- 取得失敗時はブロック扱い（FR-4 と同様）

どちらの案を採用するかは **builder の技術判断に委ねる**（§10 Q-2）。判断基準として以下を明記する:

- **案 A が適切な場合**: すでに `loadEvents` の `fieldList` を動的構築するパターン（権限ユーザーフィールドや `fieldValueRules` フィールドの追加）が確立されており、同じ仕組みを踏襲する場合。既存実装との整合性が高い。
- **案 B が適切な場合**: `_recordToEvent` の変更を最小限にとどめたい場合、またはリソースキー値が更新後に変化しうる（別ユーザーが編集済みの可能性がある）場合に最新値を取得したいとき。ただし追加 API コールが 1 回増える。

いずれの案でも FR-4（チェック失敗時ブロック）は同様に適用される。

### 7.4 USER_SELECT 型の場合の値構造

リソースキーフィールドが `USER_SELECT` 型の場合、値は `value[].code` 配列となる。kintone クエリの `in` 演算子を使い、値配列の各要素に対して OR 判定する。

```
(resource_user_select_field in ("userCode1","userCode2"))
```

単一選択のケースが多いと想定されるが、複数ユーザーが選択されている場合も `in` で対応できる。`DROP_DOWN` / `SINGLE_LINE_TEXT` 等は `=` を使用する。

使用すべき演算子はフィールドの型によって分岐する。設定画面でフィールド型も一緒に保存し（`overlapKeyFieldType`）、実行時にクエリ演算子を切り替える。

---

## 8. 設定画面仕様

### 8.1 設定項目の追加位置

`plugin/src/html/config.html` の「共通設定 (フィールドマッピング)」セクション（`<section class="kc-config-section">` 第 1 ブロック）内、既存の任意フィールド群の末尾に追加する。

### 8.2 UI 構成

```
【重複チェック設定】
┌─────────────────────────────────────────────────────────────────────┐
│ リソースキーフィールド                                                │
│ [── フィールドを選択（未選択で無効） ──▼]                              │
│ ヒント: 未選択時は重複チェックが無効になります（現状動作）。            │
│         関連レコードテーブル（REFERENCE_TABLE）は選択できません。        │
│         関連付けに使用している実フィールドを選んでください。           │
└─────────────────────────────────────────────────────────────────────┘
```

#### 構成要素

1. **セクション見出し** `<h3>` 「重複チェック設定」
2. **フィールドプルダウン** `<select id="kc-field-overlap-key">`
   - 先頭: `<option value="">-- 未選択（無効）--</option>`
   - 取得対象型: `SINGLE_LINE_TEXT` / `NUMBER` / `DROP_DOWN` / `RADIO_BUTTON` / `CHECK_BOX` / `USER_SELECT` / `LOOKUP`（LOOKUP は実際の型を取得して表示）
   - 除外型: `REFERENCE_TABLE` / `MULTI_LINE_TEXT` / `RICH_TEXT` / `FILE` / `SUBTABLE` 等クエリ `=` が使えないもの
3. **説明文** ヒントテキスト（上記 UI 構成を参照）

### 8.3 config.js での処理

- **保存時**: `collectOverlapKeyField()` で `<select id="kc-field-overlap-key">` の値（フィールドコード文字列）と、選択されたフィールドの型を取得して `overlapKeyFieldCode` / `overlapKeyFieldType` として `currentConfig.fieldMapping` に保存する
- **読み込み時**: `applyOverlapKeyField()` で `config.fieldMapping.overlapKeyFieldCode` をプルダウンに反映する

---

## 9. プラグイン設定 JSON スキーマ

### 9.1 変更内容（version 7 → 8）

`fieldMapping` に `overlapKeyFieldCode` と `overlapKeyFieldType` を追加する。

```json
{
  "version": 8,
  "fieldMapping": {
    "fieldTitle":          "string",
    "fieldStart":          "string",
    "fieldEnd":            "string",
    "fieldAllday":         "string",
    "overlapKeyFieldCode": "string",
    "overlapKeyFieldType": "string"
  },
  "permissionRules":  [ ...（version 7 以前と同一）],
  "fieldValueRules":  [ ...（version 7 以前と同一）],
  "searchTargets":    [ ...（version 7 以前と同一）],
  "views": { ...（version 7 以前と同一）}
}
```

`overlapKeyFieldCode` が空文字または存在しない場合: 重複チェック無効（既存動作）。

### 9.2 version 7 → 8 マイグレーション

- `config.js` の `loadInitialConfig()` で `Number(parsed.version) < 8` を検出した場合、`overlapKeyFieldCode: ''` / `overlapKeyFieldType: ''` を補完して version を 8 に更新する
- 保存時の `finalConfig` の `version` を `8` に変更する

### 9.3 `desktop.js` での読み込み

`KC.Config.loadFromPluginConfig()` に以下を追加する:

```javascript
KC.Config.OVERLAP_KEY_FIELD_CODE = (fm && fm.overlapKeyFieldCode) ? fm.overlapKeyFieldCode : '';
KC.Config.OVERLAP_KEY_FIELD_TYPE = (fm && fm.overlapKeyFieldType) ? fm.overlapKeyFieldType : '';
```

`KC.Config.OVERLAP_KEY_FIELD_CODE` の初期値は `''`（空文字 = 無効）とし、`desktop.js` のモジュール定義部で宣言する。

---

## 10. 未確定事項・リスク・前提

| ID | 内容 | 状態 |
|---|---|---|
| Q-1 | **隣接予約の扱い**: `end` = 次の `start` が同値の場合（例: 9:00〜10:00 と 10:00〜11:00）は重複なし。`<` / `>` 厳密不等号で実現 | **確定**（2026-06-11）|
| Q-2 | **リソースキー値の取得方式**: 案 A（`loadEvents` 時に KcEvent に保持）vs 案 B（DnD 確定時に単独 GET）。各案の判断基準は §7.3 に記載 | **builder 技術判断**（2026-06-11）|
| Q-3 | **ブロック時バナー文言**: 重複先の先頭 1 件タイトルを含める（例: 「「○○」と期間が重複しています」）。具体的文言・複数件の表現は実装時に調整可 | **確定**（2026-06-11）|
| Q-4 | **`CHECK_BOX` 型をリソースキーに使う場合の `in` 演算子**: kintone クエリが `CHECK_BOX` 型に `in` 演算子を受け付けるか実機確認要。未確認なら設定画面で `CHECK_BOX` を選択対象から除外する判断もある | **実機確認推奨**（残存）|
| Q-5 | **src 版（GitHub Pages カスタマイズ JS）の対応**: src 版はプラグイン実装前の代替手段であり現在は運用していないため plugin 限定 | **確定: 対応不要**（2026-06-11）|
| Q-6 | **DATE 型フィールドの期間境界**: `_recordToEvent` で `end` を翌日 0:00 UTC に内部変換しているが、重複チェッククエリには RAW 値（`YYYY-MM-DD`）で比較する必要がある。`loadEvents` の `qStart` / `qEnd` 算出（`src/kc-calendar.js:526–530`）と同様の分岐を重複チェッククエリにも適用すること | **実装時注意**（残存）|

### 10.1 TOCTOU 競合（設計上の根本的限界）

本機能はチェック後・updateEvent 送信前の間に他ユーザーが同一リソースに別の予定を保存した場合（TOCTOU 競合: Time-of-Check to Time-of-Use）を完全には防ぐことができない。この競合は最終的に Customine によるサーバー側バリデーションが防衛線となる。本機能はあくまで「DnD 操作時のベストエフォートな事前チェック」として位置付ける。この制約を実装コードのコメントにも明記すること。

### 10.2 カレンダー JS 以外の保存経路

上述のとおり、フォーム保存（iframe モーダル経由・kintone 直接編集）は Customine で保護されており、本機能のスコープ外である。

---

## 11. 受入基準

### AC-1: リソースキーフィールド未設定時の無効化

- **Given**: プラグイン設定で「リソースキーフィールド」が未選択（空文字）の状態で
- **When**: 任意の予定を DnD 移動して mouseup を発生させたとき
- **Then**: 重複チェッククエリ（`GET /records.json`）が発行されず、従来どおり `updateEvent` が送信される

### AC-2: 重複なし → updateEvent 送信

- **Given**: 移動先の期間・リソースに重複する予定が存在しない状態で
- **When**: 予定を DnD 移動して mouseup を発生させたとき
- **Then**: 重複チェッククエリの結果が 0 件であり、`KC.Api.updateEvent` が呼ばれる
- **And**: バナーが表示されない

### AC-3: 重複あり → ブロック + 巻き戻し + バナー

- **Given**: 同一リソース・重なる期間に別の予定が存在する状態で
- **When**: その期間に予定を DnD 移動して mouseup を発生させたとき
- **Then**: 重複チェッククエリの結果が 1 件以上であり、`KC.Api.updateEvent` が呼ばれない
- **And**: 楽観更新が巻き戻され、予定が元の日時に戻る
- **And**: `KC.Banner.show()` が呼ばれ、重複エラーメッセージが表示される

### AC-4: チェック API エラー時 → ブロック + 巻き戻し + バナー

- **Given**: 重複チェッククエリが API エラーで失敗する状態で
- **When**: 予定を DnD 移動して mouseup を発生させたとき
- **Then**: `KC.Api.updateEvent` が呼ばれない
- **And**: 楽観更新が巻き戻される
- **And**: `KC.Banner.show()` が呼ばれ、エラーバナーが表示される

### AC-5: 自レコード除外

- **Given**: 予定 A が 10:00〜12:00 に存在し、同一リソースフィールド値を持つ状態で
- **When**: 予定 A 自体を同日 11:00〜13:00 に DnD 移動したとき（期間変更）
- **Then**: 重複チェッククエリで予定 A 自身（`$id != 自レコードID`）が除外され、他に重複がなければブロックされない

### AC-6: 除外ステータス除外

- **Given**: 同一リソース・重なる期間に「返却済」ステータスの予定のみが存在する状態で
- **When**: その期間に予定を DnD 移動したとき
- **Then**: 返却済レコードがクエリから除外され、ブロックされない

### AC-7: 隣接予約は重複なし（確定）

- **Given**: 同一リソースで 9:00〜10:00 の予定が存在する状態で
- **When**: 別の予定を 10:00〜11:00 に DnD 移動したとき
- **Then**: 隣接（既存 `end = 10:00` = 移動先 `newStart = 10:00`）は重複なし判定となり、ブロックされない（`end_field > "newStart"` の不等号が `=` に一致しないため）

### AC-8: version 7 → 8 マイグレーション

- **Given**: version 7 形式のプラグイン設定が保存されている状態で
- **When**: 設定画面を開いたとき
- **Then**: `overlapKeyFieldCode` が空文字として初期化され、重複チェックが無効（既存動作）のまま設定画面が表示される

---

## 12. 検証項目・テストシナリオ

### シナリオ T-1: 正常系 — 重複なし

1. テスト用アプリで会議室フィールド（例: DROP_DOWN「会議室 A / B」）を持つ予定を 2 件用意する
   - 予定 1: 会議室 A、10:00〜12:00
   - 予定 2: 会議室 A、14:00〜16:00（期間が重ならない）
2. プラグイン設定で「リソースキーフィールド」に会議室フィールドを選択して保存
3. 予定 2 を 12:00〜14:00 に DnD 移動
4. 確認: 重複チェッククエリが 1 回発行される（ブラウザ DevTools ネットワークタブ）
5. 確認: クエリが `limit 1` であること
6. 確認: `updateEvent` PUT リクエストが発行される（日時変更が保存される）
7. 確認: バナーが表示されない（AC-2）

### シナリオ T-2: ブロック系 — 重複あり

1. テスト用アプリで以下の予定を用意する
   - 予定 1: 会議室 A、10:00〜12:00
   - 予定 2: 会議室 A、14:00〜16:00
2. 予定 2 を 11:00〜13:00 に DnD 移動（予定 1 と重なる）
3. 確認: 楽観更新後にカレンダーが 11:00〜13:00 の位置に一時表示される
4. 確認: 重複チェッククエリ後にブロックされ、予定 2 が 14:00〜16:00 に戻る（AC-3）
5. 確認: `updateEvent` PUT が発行されない（DevTools）
6. 確認: バナーに重複エラーメッセージが表示される（AC-3）

### シナリオ T-3: 自レコード除外

1. 予定 A（会議室 A、10:00〜12:00）を 11:00〜13:00 に DnD リサイズ（終了時刻を伸ばす）
2. 確認: クエリに `$id != 予定AのID` が含まれる（DevTools）
3. 確認: 他に重複がなければブロックされない（AC-5）

### シナリオ T-4: 除外ステータス

1. 会議室 A の期間に「返却済」ステータスの予定を作成
2. 別の予定（会議室 A、重なる期間）を DnD 移動
3. 確認: ブロックされない（返却済が除外されている）（AC-6）

### シナリオ T-5: API エラー時のブロック

1. ブラウザ DevTools でオフライン状態にする（またはプロキシでエラーを返す）
2. 任意の予定を DnD 移動
3. 確認: バナーにエラーメッセージが表示される（AC-4）
4. 確認: 予定が元の位置に戻る（AC-4）
5. 確認: `updateEvent` が発行されない（AC-4）

### シナリオ T-6: リソースキー未設定時の無効化

1. プラグイン設定でリソースキーフィールドを「未選択」に設定して保存
2. 任意の予定を DnD 移動
3. 確認: 重複チェッククエリが発行されない（AC-1）
4. 確認: `updateEvent` が即時発行される（既存動作）

### シナリオ T-7: バナーの再利用確認

1. 重複が発生するシナリオで DnD 移動 → バナーが表示される
2. その後に正常な DnD 移動（重複なし）を実行
3. 確認: 正常移動成功後にバナーが消える（`KC.Banner.hide()` が呼ばれる）

---

## 13. 想定 UX / シーケンス

### 13.1 重複なし（正常系）

```
ユーザー: 予定を DnD で移動して放す（mouseup）
  ↓
[即時] カレンダー上で予定が移動先に表示される（楽観先行）
  ↓
[数百ms〜1秒程度] 重複チェッククエリを待つ（ユーザーには特に何も見えない）
  ↓
0 件 → updateEvent PUT 送信（await なし）
  ↓
[完了] 日時変更がサーバーに保存される
```

### 13.2 重複あり（ブロック系）

```
ユーザー: 予定を DnD で移動して放す（mouseup）
  ↓
[即時] カレンダー上で予定が移動先に表示される（楽観先行）
  ↓
[数百ms〜1秒程度] 重複チェッククエリを待つ
  ↓
1 件以上 → updateEvent 送信せず
  ↓
[即時] 予定が元の位置に戻る（巻き戻し）
  ↓
カレンダー上部にバナー: 「「○○（重複先タイトル）」と期間が重複しています」
  ↓
ユーザー: バナーの × ボタンで閉じる or 別の日時に移動し直す
```

### 13.3 設定フロー（管理者）

```
1. プラグイン設定画面を開く
2. 「共通設定」セクションの「重複チェック設定」を確認
3. 「リソースキーフィールド」プルダウンから対象フィールドを選択
   （例: 「会議室」「機器名」「場所」など）
4. 「保存」または「保存して更新」で保存
5. 以降のカレンダー DnD 操作で重複チェックが有効になる
```

---

*第 1 版（2026-06-11）: ユーザー確定事項（目的・スコープ・判定キー・除外条件・UX・エラー時挙動）を反映して初版作成。未確定事項 Q-1〜Q-6 を §10 に整理。*
*第 2 版（2026-06-11）: Q-1（隣接は重複なし・厳密不等号）、Q-3（重複先タイトル含む文言）、Q-5（src 版対応不要）をユーザー確認により確定。Q-2 を builder 技術判断に委ねる形式に変更し判断基準を §7.3 に追記。§3.2 スコープ・§7.1 クエリ不等号の説明・§7.2 fields パラメータ・AC-7 の条件書き・§13.2 バナー文言を更新。残存未確定事項は Q-4（CHECK_BOX 実機確認）および Q-6（DATE 型実装時注意）のみ。*
