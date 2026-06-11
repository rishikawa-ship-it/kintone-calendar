# 要件定義書: DnD 重複予防ブロック（リソース競合チェック）

**文書番号**: REQ_dnd-overlap-block
**作成日**: 2026-06-11
**最終更新日**: 2026-06-11（第 6 版: §8.4 API 用語修正・§9B フィールド分離・Q-10 空キー値適用範囲明文化・FR-4 注記追加）
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 第 6 版（残存未確定事項: §10 Q-4・Q-9 のみ）
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
   - [9A. 通常フィールド方式（version 8）](#9a-通常フィールド方式version-8)
   - [9B. 関連レコード方式追加（version 9）](#9b-関連レコード方式追加version-9)
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
- 条件②-A（通常フィールド方式）: 指定した「リソースキーフィールド」の値が既存レコードと同一である
- 条件②-B（関連レコード方式）: 関連レコードテーブル経由で紐付く「リソース識別フィールド」の値集合が既存レコードと交差する

判定モード（A / B）はプラグイン設定で選択する。第 4 版でモード B を新規追加する。

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
- **注記（モード B での適用範囲）**: FR-4 のブロックは「API エラー等により判定処理自体が失敗した場合」に限る。自レコードのキー値が空（申請番号未記入）や自リソース集合が空（機器未紐付け）は「判定可能で重複なし」という正常ケースであり FR-4 は適用しない（FR-9 ステップ 2・4 で許可として処理する）。

### FR-5: 除外ステータス条件の適用

重複チェッククエリには、カレンダー一覧ビューの現在の絞り込み条件（`kintone.app.getQueryCondition()` で取得）を AND 合成して適用する。これはカレンダー表示用クエリ（`loadEvents`）が依存するのと同じ除外条件であり、ユーザー決定「カレンダーの表示除外と同じ」の実装解釈として確定する（`KC.Config.EXCLUDED_STATUSES` は廃止済みのため使用しない）。`getQueryCondition()` が `null` または空文字を返す場合は、この条件を AND 合成しない（フォールバック: 除外条件なし）。

### FR-6: 自レコード除外

移動元レコード自身は重複候補から除外する（`$id != 自レコードID`）。

### FR-8: 判定モードの選択（通常フィールド方式 / 関連レコード方式）

プラグイン設定画面で重複判定モードを選択できる:

- **モード A（通常フィールド方式）**: 第 3 版までの既存仕様。予約レコード自身のフィールド値でリソースを識別する
- **モード B（関連レコード方式）**: 新規追加。REFERENCE_TABLE フィールドで関連付けられた別アプリのレコードに保持されるフィールド値でリソースを識別する

モード A / B の設定は排他選択とする（両方同時に有効にすることは不可）。

モード B の設定項目（§8.4 参照）:
1. **REFERENCE_TABLE フィールド**: 対象の関連レコードテーブルフィールドコード（予約アプリ上の REFERENCE_TABLE フィールドを選択する。紐付け条件は kintone アプリ設定から自動取得する）
2. **リソース識別フィールド**: 関連先アプリ側の機器 ID 等のフィールドコード（関連先アプリのフィールド一覧から選択する）

### FR-9: 関連レコード方式の重複判定フロー（モード B）

DnD 確定時に以下の手順で重複を判定する。キャッシュは使用せず、DnD 1 回ごとに都度取得することで常に最新の状態を参照する（§10 Q-7 で設計判断を詳述）。

**ステップ 1: 期間重複候補の取得**

`kintone REST API GET /records.json` で期間重複する予約候補を取得する。クエリは §7.5 に詳述。このクエリにはリソースキー条件を含めない（モード A の `§7.2` クエリから `resource_key_field = ...` 条件を除いたもの）。自レコード除外（`$id != 自レコードID`）と `getQueryCondition()` AND 合成は維持する。

取得件数の上限は `limit 100` とする（超過時も取得範囲内で判定し許可: §10 Q-8 確定）。候補が 0 件の場合は重複なしとして即時 `updateEvent` を送信する（次のステップに進まない）。

**ステップ 2: 紐付けキー値の収集**

自レコードの紐付けキー値（`overlapRefTableJoinFieldCode` の値。例: 申請番号）を取得する。KcEvent に保持されていない場合は、モード A の案 A / 案 B に準じて取得する（§7.3 参照）。

**自レコードのキー値が空の場合（確定）**: 申請番号未記入等でキー値が空文字・null の場合は「リソース未確定」とみなし、ステップ 3 以降をスキップして `updateEvent` を許可する（Q-10 と同等扱い）。

候補レコードの紐付けキー値（同フィールド）も同様に収集し、自レコードの値を含む全キー値の集合を構築する。**候補側のキー値が空のレコードはキー値収集対象から除外する**（リソースなし扱い = ステップ 3 の `in` クエリに含めない）。

**ステップ 3: 関連先アプリへの一括照会**

収集したキー値集合を使い、関連先アプリに対して `GET /records.json` を 1 回発行する:

```
紐付けフィールド in ("キー値1","キー値2",...)
```

このクエリで申請番号ごとのリソース識別フィールド値（機器 ID 等）を取得し、「申請番号 → リソース集合」のマップを構築する。

`in` 演算子の値数・クエリ長の制約については §10 Q-9 を参照。

**ステップ 4: リソース集合の交差判定**

- 自レコードのリソース集合（自申請番号に紐づく機器 ID の集合）を取得する
- 各候補レコードのリソース集合と自レコードのリソース集合の積集合（交差）を確認する
- 交差があれば重複 → ブロック（FR-3 踏襲）
- すべての候補と交差がなければ重複なし → `updateEvent` 送信

自レコードのリソース集合が空（機器未紐付け）の場合（確定）: 交差なし = 重複なしとして `updateEvent` を許可する。なおキー値が空でステップ 2 でスキップ済みの場合も同様に許可される。

### FR-10: 関連レコード方式でのエラー処理

- 関連先アプリへの GET（ステップ 3）が API エラーで失敗した場合: FR-4 と同様にブロック扱い（安全側）
- 関連先アプリの閲覧権限がない場合（403 等）: ブロック扱い（安全側）。バナーには「重複チェック中にエラーが発生しました。関連先アプリの閲覧権限を確認してください。」を表示する
- ステップ 1 の候補取得が失敗した場合: FR-4 と同様にブロック扱い

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

- **モード A**: DnD 1 回の確定につき、重複チェッククエリは最大 1 回の `GET /records.json` を発行する
- **モード B**: DnD 1 回の確定につき、追加 GET は最大 2 回（ステップ 1: 候補取得 + ステップ 3: 関連先一括照会）。ステップ 1 の候補が 0 件の場合はステップ 3 の GET を省略できる
- チェックが有効な場合（いずれかのモードが設定済み）のみ追加 API コールが発生する

### NF-2: パフォーマンス

- **モード A**: 重複チェッククエリは `limit 1` で発行し、存在確認のみを行う
- **モード B**: ステップ 1 の候補取得は `limit 100`（§10 Q-8）。ステップ 3 の関連先照会は候補件数に応じたキー値を `in (...)` で 1 回発行する。`in` の値数が多くなる場合はクエリ長の制約に注意（§10 Q-9）

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
判定モードが未設定（overlapMode = 'none'）? → チェックスキップ → [送信フェーズ] へ
  ↓（モード A または B が設定あり）

[モード A: 通常フィールド方式]
重複チェッククエリ送信（GET /records.json, limit 1）
  ↓
成功 and records.length === 0?
  ├─ YES → [送信フェーズ] へ
  └─ NO（1件以上 or エラー） → [ブロックフェーズ] へ

[モード B: 関連レコード方式]
ステップ 1: 期間重複候補取得（GET /records.json, limit 100、リソースキー条件なし）
  ↓
候補数 === 0 → [送信フェーズ] へ
  ↓（1件以上 or エラー）
ステップ 2: 紐付けキー値を自レコード + 候補から収集
ステップ 3: 関連先アプリに一括照会（GET /records.json, 紐付けフィールド in (...)）
  ↓
ステップ 4: リソース集合の交差判定
  ├─ 交差あり → [ブロックフェーズ] へ
  ├─ 交差なし → [送信フェーズ] へ
  └─ エラー    → [ブロックフェーズ] へ

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

#### DATE 型フィールドのクエリパターン（確定）

start / end フィールドが DATE 型の場合、kintone の DATE 型は `YYYY-MM-DD` 文字列での比較を行い、`end` 値は **inclusive**（その日を含む）として格納されている（DATETIME 型の `end` が exclusive な 00:00 を格納するのとは異なる）。

重複チェッククエリは `loadEvents` のクエリと同一パターン（`-1 日処理なし`）を適用する:

```
(start_field < "qNewEnd") AND (end_field >= "qNewStart")
```

- `<` / `>=` の組み合わせ（DATETIME 型は `<` / `>` の strict 両側）
- `qNewStart` = 移動後の `newStart` を `YYYY-MM-DD` 形式に変換した文字列
- `qNewEnd` = 移動後の `newEnd` を `YYYY-MM-DD` 形式に変換した文字列

**DATE 型での隣接許容（AC-7）机上検証例**:

```
既存レコード: start=2026-06-10、end=2026-06-11（6/11 を含む 1 泊）
移動後:       newStart=2026-06-12、newEnd=2026-06-13
クエリ: (start < "2026-06-12") AND (end >= "2026-06-12")
既存 start=2026-06-10 < "2026-06-12" → true
既存 end  =2026-06-11 >= "2026-06-12" → false（2026-06-11 < 2026-06-12）
→ 不一致 → ヒットなし = 隣接は重複なし（AC-7 成立）

次の例（重複するケース）:
既存レコード: start=2026-06-10、end=2026-06-12（6/12 まで含む）
移動後:       newStart=2026-06-12、newEnd=2026-06-13
クエリ: (start < "2026-06-12") AND (end >= "2026-06-12")
既存 start=2026-06-10 < "2026-06-12" → true
既存 end  =2026-06-12 >= "2026-06-12" → true
→ ヒット = 重複（正しくブロック）
```

### 7.2 クエリ全文

```
(start_field < "newEnd")
AND (end_field > "newStart")
AND (resource_key_field = "resourceKeyValue")
AND ($id != "自レコードID")
AND {getQueryCondition() の結果を AND 合成}
order by $id asc limit 1
```

各プレースホルダーの解決:
- `start_field` / `end_field`: `KC.Config.FIELD.start` / `KC.Config.FIELD.end`
- `newEnd` / `newStart`: DnD 確定後の新しい日時（ISO 8601 文字列。DATE 型の場合は `YYYY-MM-DD` 形式に変換すること。変換ロジックは `loadEvents` の `qStart` / `qEnd` 算出と同様）
- `resource_key_field`: `KC.Config.OVERLAP_KEY_FIELD_CODE`
- `resourceKeyValue`: 対象 KcEvent のリソースキーフィールド値（後述 §7.3）
- `$id != "自レコードID"`: `ev.id` を文字列として使用
- **除外ステータス条件**: `kintone.app.getQueryCondition()` を呼び出し、空文字・`null` でなければクエリ末尾に ` AND (取得した条件文字列)` を AND 合成する。`getQueryCondition()` が `null` または空文字を返す場合はこの条件を省略する（フォールバック: 除外条件なし）。`KC.Config.EXCLUDED_STATUSES` は廃止済みであり、使用しない。

**除外ステータス条件を AND 合成したクエリ例**（`kintone.app.getQueryCondition()` の返値が `"status not in (\"返却済\",\"削除済\")"` の場合）:

```
(start_field < "2026-06-11T10:00:00Z")
AND (end_field > "2026-06-11T09:00:00Z")
AND (resource_field = "会議室A")
AND ($id != "123")
AND (status not in ("返却済","削除済"))
order by $id asc limit 1
```

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

### 7.5 モード B: 関連レコード方式のクエリ仕様

#### ステップ 1 クエリ（期間重複候補取得）

モード A の §7.2 クエリからリソースキー条件を除いたもの:

```
(start_field < "newEnd")
AND (end_field > "newStart")
AND ($id != "自レコードID")
AND {getQueryCondition() の結果を AND 合成}
order by $id asc limit 100
```

`fields` パラメータ: `$id`、タイトルフィールド（FR-3 のバナー用）、`overlapRefTableJoinFieldCode`（予約側の紐付けキーフィールド＝申請番号）を含める。

取得件数上限（`limit 100`）の超過時の扱い（確定）: 100 件を超える期間重複候補が存在する場合も、取得した 100 件の範囲内のみで判定を行い `updateEvent` を許可する。超過を理由とした無条件ブロックは行わない。

#### ステップ 3 クエリ（関連先アプリへの一括照会）

```
紐付けフィールドコード in ("キー値1","キー値2",...)
```

- `紐付けフィールドコード`: `overlapRefTableRelatedJoinFieldCode`（関連先側の紐付けフィールドコード＝`condition.relatedField`）を使用する
- `キー値...`: ステップ 2 で `overlapRefTableJoinFieldCode`（予約側フィールド）から収集した全紐付けキー値（自レコード分を含む）
- `fields` パラメータ: `overlapRefTableRelatedJoinFieldCode`（クエリフィールド兼レスポンス取り出しキー）+ `overlapResourceFieldCode`（リソース識別フィールド）のみ（最小限）
- `limit`: 取得する関連レコード数。紐付けキー値の数に応じて調整する（デフォルト 100。上限超過時は §10 Q-9 参照）

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

### 8.2 UI 構成（モード A: 通常フィールド方式）

```
【重複チェック設定】
┌─────────────────────────────────────────────────────────────────────┐
│ 判定モード                                                            │
│ ○ 無効（チェックなし）                                                │
│ ● 通常フィールド方式（モード A）                                       │
│ ○ 関連レコード方式（モード B）                                         │
│                                                                      │
│ [モード A 選択時のみ表示]                                              │
│ リソースキーフィールド                                                 │
│ [── フィールドを選択（未選択で無効） ──▼]                              │
│ ヒント: 未選択時は重複チェックが無効になります（現状動作）。            │
│         関連レコードテーブル（REFERENCE_TABLE）は選択できません。       │
│         関連付けに使用している実フィールドを選んでください。           │
└─────────────────────────────────────────────────────────────────────┘
```

#### 構成要素（モード A）

1. **セクション見出し** `<h3>` 「重複チェック設定」
2. **判定モード選択** `<select id="kc-overlap-mode">` または radio ボタン（`none` / `fieldKey` / `refTable`）
3. **フィールドプルダウン**（モード A 時のみ表示）`<select id="kc-field-overlap-key">`
   - 先頭: `<option value="">-- 未選択（無効）--</option>`
   - 取得対象型: `SINGLE_LINE_TEXT` / `NUMBER` / `DROP_DOWN` / `RADIO_BUTTON` / `CHECK_BOX` / `USER_SELECT` / `LOOKUP`（LOOKUP は実際の型を取得して表示）
   - 除外型: `REFERENCE_TABLE` / `MULTI_LINE_TEXT` / `RICH_TEXT` / `FILE` / `SUBTABLE` 等クエリ `=` が使えないもの
4. **説明文** ヒントテキスト（上記 UI 構成を参照）

### 8.4 UI 構成（モード B: 関連レコード方式）

```
【重複チェック設定】（モード B 選択時に表示）
┌─────────────────────────────────────────────────────────────────────┐
│ ① 関連レコードテーブルフィールド                                       │
│ [── REFERENCE_TABLE フィールドを選択 ──▼]                             │
│ ヒント: 選択すると紐付け条件のフィールドコードを自動取得します。         │
│                                                                      │
│ ② リソース識別フィールド（関連先アプリ）                               │
│ [── 関連先アプリのフィールドを選択 ──▼]                               │
│ ヒント: 機器 ID など、リソースを一意に識別するフィールドを選択します。   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 構成要素（モード B）

1. **REFERENCE_TABLE フィールド選択プルダウン** `<select id="kc-overlap-ref-table-field">`
   - 予約アプリの REFERENCE_TABLE 型フィールドのみを列挙する
   - 選択時に kintone アプリ設定 API（`/k/v1/app/form/fields.json`）から当該 REFERENCE_TABLE の紐付け条件を自動取得する。フィールド定義の `referenceTable.condition` プロパティ（単数）を参照し、`condition.field`（このアプリ＝予約側の紐付けフィールドコード）を `overlapRefTableJoinFieldCode` に、`condition.relatedField`（関連先側の紐付けフィールドコード）を `overlapRefTableRelatedJoinFieldCode` に保存する
2. **リソース識別フィールド選択プルダウン** `<select id="kc-overlap-resource-field">`
   - REFERENCE_TABLE フィールドが選択された際に、関連先アプリ（`relatedAppId`）のフィールド一覧を非同期取得して列挙する
   - 取得対象型: `SINGLE_LINE_TEXT` / `NUMBER` / `DROP_DOWN` / `RADIO_BUTTON` 等、値が一意性を持つ型
3. **説明文** ヒントテキスト（上記 UI 構成を参照）

### 8.3 config.js での処理

重複チェックフィールドの保存・読み込みは、独立した関数を新設せず、**既存の `collectFieldMapping()` / `applyFieldMapping()` 内に統合する**。

- **保存時**: 既存の `collectFieldMapping()` 内で以下を取得・保存する
  - `overlapMode`: 判定モード（`'none'` / `'fieldKey'` / `'refTable'`）
  - `overlapKeyFieldCode` / `overlapKeyFieldType`: モード A 用フィールドコードと型
  - `overlapRefTableFieldCode`: モード B 用 REFERENCE_TABLE フィールドコード
  - `overlapRefTableJoinFieldCode`: 予約側の紐付けフィールドコード（`condition.field`。アプリ設定から自動取得）
  - `overlapRefTableRelatedJoinFieldCode`: 関連先側の紐付けフィールドコード（`condition.relatedField`。同上）
  - `overlapRefTableRelatedAppId`: 関連先アプリ ID（同上）
  - `overlapResourceFieldCode`: リソース識別フィールドコード（関連先アプリ側）
- **読み込み時**: 既存の `applyFieldMapping()` 内で上記各フィールドをプルダウン・ラジオボタンに反映する。`overlapMode` に応じてモード A / B の設定 UI を表示切替する
- `collectFieldMapping()` / `applyFieldMapping()` は `config.js` の既存関数であり（現行 version 7）、他のフィールドマッピング項目と同じパターンで拡張する

---

## 9. プラグイン設定 JSON スキーマ

### 9A. 通常フィールド方式（version 8）

`fieldMapping` に `overlapKeyFieldCode` と `overlapKeyFieldType` を追加する（第 3 版で確定済み）。

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

#### version 7 → 8 マイグレーション

- `config.js` の `loadInitialConfig()` で `Number(parsed.version) < 8` を検出した場合、`overlapKeyFieldCode: ''` / `overlapKeyFieldType: ''` を補完して version を 8 に更新する
- 保存時の `finalConfig` の `version` を `8` に変更する

#### `desktop.js` での読み込み（version 8）

`KC.Config.loadFromPluginConfig()` に以下を追加する:

```javascript
KC.Config.OVERLAP_KEY_FIELD_CODE = (fm && fm.overlapKeyFieldCode) ? fm.overlapKeyFieldCode : '';
KC.Config.OVERLAP_KEY_FIELD_TYPE = (fm && fm.overlapKeyFieldType) ? fm.overlapKeyFieldType : '';
```

`KC.Config.OVERLAP_KEY_FIELD_CODE` の初期値は `''`（空文字 = 無効）とし、`desktop.js` のモジュール定義部で宣言する。

### 9B. 関連レコード方式追加（version 9）

第 4 版で追加。`fieldMapping` に判定モードおよびモード B 用フィールドを追加する。

```json
{
  "version": 9,
  "fieldMapping": {
    "fieldTitle":                    "string",
    "fieldStart":                    "string",
    "fieldEnd":                      "string",
    "fieldAllday":                   "string",
    "overlapMode":                   "none | fieldKey | refTable",
    "overlapKeyFieldCode":           "string",
    "overlapKeyFieldType":           "string",
    "overlapRefTableFieldCode":             "string",
    "overlapRefTableJoinFieldCode":         "string",
    "overlapRefTableRelatedJoinFieldCode":  "string",
    "overlapRefTableRelatedAppId":          "string",
    "overlapResourceFieldCode":             "string"
  },
  "permissionRules":  [ ...（version 8 と同一）],
  "fieldValueRules":  [ ...（version 8 と同一）],
  "searchTargets":    [ ...（version 8 と同一）],
  "views": { ...（version 8 と同一）}
}
```

各フィールドの意味:

| フィールド | 説明 |
|---|---|
| `overlapMode` | 判定モード。`'none'`（無効）/ `'fieldKey'`（モード A）/ `'refTable'`（モード B） |
| `overlapKeyFieldCode` | モード A: リソースキーフィールドコード |
| `overlapKeyFieldType` | モード A: リソースキーフィールドの型 |
| `overlapRefTableFieldCode` | モード B: 予約アプリ側の REFERENCE_TABLE フィールドコード |
| `overlapRefTableJoinFieldCode` | モード B: 予約側の紐付けフィールドコード（`condition.field`。Step1 の fields 指定・Step2 の値収集に使用。自動取得） |
| `overlapRefTableRelatedJoinFieldCode` | モード B: 関連先側の紐付けフィールドコード（`condition.relatedField`。Step3 の `in` クエリフィールドおよびレスポンス値の取り出しに使用。自動取得） |
| `overlapRefTableRelatedAppId` | モード B: 関連先アプリ ID（自動取得） |
| `overlapResourceFieldCode` | モード B: 関連先アプリ側のリソース識別フィールドコード |

#### version 8 → 9 マイグレーション

- `loadInitialConfig()` で `Number(parsed.version) < 9` を検出した場合、以下を補完して version を 9 に更新する:
  - `overlapMode`: version 8 で `overlapKeyFieldCode` が空文字でない場合は `'fieldKey'`、空文字の場合は `'none'` に設定（後方互換: 既存設定を引き継ぐ）
  - `overlapRefTableFieldCode` / `overlapRefTableJoinFieldCode` / `overlapRefTableRelatedJoinFieldCode` / `overlapRefTableRelatedAppId` / `overlapResourceFieldCode`: すべて `''` に初期化

#### `desktop.js` での読み込み（version 9）

```javascript
KC.Config.OVERLAP_MODE                    = (fm && fm.overlapMode) ? fm.overlapMode : 'none';
KC.Config.OVERLAP_KEY_FIELD_CODE          = (fm && fm.overlapKeyFieldCode) ? fm.overlapKeyFieldCode : '';
KC.Config.OVERLAP_KEY_FIELD_TYPE          = (fm && fm.overlapKeyFieldType) ? fm.overlapKeyFieldType : '';
KC.Config.OVERLAP_REF_TABLE_FIELD_CODE         = (fm && fm.overlapRefTableFieldCode) ? fm.overlapRefTableFieldCode : '';
KC.Config.OVERLAP_REF_TABLE_JOIN_FIELD         = (fm && fm.overlapRefTableJoinFieldCode) ? fm.overlapRefTableJoinFieldCode : '';
KC.Config.OVERLAP_REF_TABLE_RELATED_JOIN_FIELD = (fm && fm.overlapRefTableRelatedJoinFieldCode) ? fm.overlapRefTableRelatedJoinFieldCode : '';
KC.Config.OVERLAP_REF_TABLE_RELATED_APP        = (fm && fm.overlapRefTableRelatedAppId) ? fm.overlapRefTableRelatedAppId : '';
KC.Config.OVERLAP_RESOURCE_FIELD_CODE          = (fm && fm.overlapResourceFieldCode) ? fm.overlapResourceFieldCode : '';
```

---

## 10. 未確定事項・リスク・前提

| ID | 内容 | 状態 |
|---|---|---|
| Q-1 | **隣接予約の扱い**: `end` = 次の `start` が同値の場合（例: 9:00〜10:00 と 10:00〜11:00）は重複なし。`<` / `>` 厳密不等号で実現 | **確定**（2026-06-11）|
| Q-2 | **リソースキー値の取得方式（モード A）**: 案 A（`loadEvents` 時に KcEvent に保持）vs 案 B（DnD 確定時に単独 GET）。各案の判断基準は §7.3 に記載 | **builder 技術判断**（2026-06-11）|
| Q-3 | **ブロック時バナー文言**: 重複先の先頭 1 件タイトルを含める（例: 「「○○」と期間が重複しています」）。具体的文言・複数件の表現は実装時に調整可 | **確定**（2026-06-11）|
| Q-4 | **`CHECK_BOX` 型をリソースキーに使う場合の `in` 演算子（モード A）**: kintone クエリが `CHECK_BOX` 型に `in` 演算子を受け付けるか実機確認要。未確認なら設定画面で `CHECK_BOX` を選択対象から除外する判断もある | **実機確認推奨**（残存）|
| Q-5 | **src 版（GitHub Pages カスタマイズ JS）の対応**: src 版はプラグイン実装前の代替手段であり現在は運用していないため plugin 限定 | **確定: 対応不要**（2026-06-11）|
| Q-6 | **DATE 型フィールドの期間境界**: `loadEvents` と同一パターン（`-1 日処理なし、end >= qNewStart` の inclusive 比較）を使用することで確定。§7.1 に机上検証例を追記済み。実装時は `DATETIME` 型の `>` ではなく `>=` を使うことに注意 | **確定**（2026-06-11 第 3 版）|
| Q-7 | **モード B でキャッシュを使わない設計判断**: 検索 Phase 2（`KC.SearchFilter`）は関連レコードのメモリキャッシュ（`_relatedRecordsCache`）を持つが、モード B の重複判定では**このキャッシュを使用しない**。理由: ①重複チェックは予約の正確性に直結するため鮮度が最優先、②SearchFilter のキャッシュは検索対象フィールドのみを格納しておりリソース識別フィールドが含まれるとは限らない、③障害分離（SearchFilter の異常が重複チェックに波及しない）。この設計判断を実装コードにコメントで明記すること | **確定: キャッシュ不使用**（2026-06-11）|
| Q-8 | **モード B ステップ 1 の候補件数上限（limit 100）と超過時の扱い**: `limit 100` の範囲内で判定し `updateEvent` を許可する。超過を理由とした無条件ブロックは行わない（§7.5 に反映済み） | **確定**（2026-06-11）|
| Q-9 | **モード B ステップ 3 の `in` 演算子の値数上限**: kintone クエリの `in` 演算子は値を大量に渡す場合にクエリ長の制限（URL 長・クエリ文字列長）に抵触しうる。候補件数が多い場合は `in (...)` の値数を分割して複数回 GET するか上限で制御する方針が必要。実運用での申請番号の同時発生件数を踏まえて builder が判断すること | **builder 技術判断**（残存）|
| Q-10 | **モード B で自レコードのリソース集合が空（機器未紐付け）の場合の扱い**: 機器未紐付けの申請は重複なし扱いとして `updateEvent` を許可する（自リソース集合が空集合 → いかなる候補とも交差しない → 重複なし） | **確定: 許可**（2026-06-11）|
| Q-11 | **モード B で候補レコードと申請番号が同一のケース**: 1 申請 = 1 予約の運用であり、このケースは発生しない。追加ルール不要。ただし万一同一申請番号の候補が現れた場合、ステップ 3 で同一の機器集合が返るためリソース交差が生じブロックされる（仕様の自然な帰結として許容する） | **確定**（2026-06-11）|

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

- **Given**: `kintone.app.getQueryCondition()` がカレンダー一覧ビューで「返却済」を除外する絞り込み条件を返す状態で、同一リソース・重なる期間に「返却済」ステータスの予定のみが存在するとき
- **When**: その期間に予定を DnD 移動したとき
- **Then**: `getQueryCondition()` の条件が AND 合成されることで返却済レコードがクエリ結果から除外され、ブロックされない

### AC-7: 隣接予約は重複なし（確定）

- **Given**: 同一リソースで 9:00〜10:00 の予定が存在する状態で
- **When**: 別の予定を 10:00〜11:00 に DnD 移動したとき
- **Then**: 隣接（既存 `end = 10:00` = 移動先 `newStart = 10:00`）は重複なし判定となり、ブロックされない（`end_field > "newStart"` の不等号が `=` に一致しないため）

### AC-8: version 7 → 8 マイグレーション

- **Given**: version 7 形式のプラグイン設定が保存されている状態で
- **When**: 設定画面を開いたとき
- **Then**: `overlapKeyFieldCode` が空文字として初期化され、重複チェックが無効（既存動作）のまま設定画面が表示される

### AC-9: モード B — 同一リソース・期間重複でブロック

- **Given**: 申請 A（申請番号 `AP001`、機器 `機器X`）の予約が 10:00〜12:00 に存在し、プラグイン設定でモード B が選択されている状態で
- **When**: 申請 B（申請番号 `AP002`、機器 `機器X`）の予約を 11:00〜13:00 に DnD 移動したとき
- **Then**: ステップ 1 で申請 A が候補として取得され、ステップ 3 で `機器X` の交差が検出され、ブロックされる
- **And**: バナーに申請 A の予約タイトルを含むエラーメッセージが表示される

### AC-10: モード B — 同一期間・異なるリソースは許可

- **Given**: 申請 A（機器 `機器X`）の予約が 10:00〜12:00 に存在し、プラグイン設定でモード B が選択されている状態で
- **When**: 申請 B（機器 `機器Y`）の予約を 10:00〜12:00 に DnD 移動したとき（期間完全重複・機器は異なる）
- **Then**: ステップ 4 でリソース集合の交差なし（`{機器X}` ∩ `{機器Y}` = 空集合）と判定され、ブロックされず `updateEvent` が送信される

### AC-11: モード B — 候補 0 件は許可

- **Given**: 期間重複する予約が存在しない状態で、プラグイン設定でモード B が選択されている状態で
- **When**: 予定を DnD 移動したとき
- **Then**: ステップ 1 の候補が 0 件でありステップ 3 を省略して `updateEvent` が送信される（API コールは +1 のみ）

### AC-12: モード B — 関連先アプリアクセスエラーはブロック

- **Given**: 関連先アプリへの GET が 403 等のエラーで失敗する状態で、プラグイン設定でモード B が選択されている状態で
- **When**: 予定を DnD 移動したとき
- **Then**: FR-10 に従いブロック扱いとなり、権限エラーを示すバナーが表示される

### AC-13: version 8 → 9 マイグレーション

- **Given**: version 8 形式のプラグイン設定で `overlapKeyFieldCode` に値が設定されている状態で
- **When**: 設定画面を開いたとき
- **Then**: `overlapMode` が `'fieldKey'`（モード A）として初期化され、既存のモード A 設定が引き継がれる
- **And**: モード B のフィールドはすべて空文字として初期化される

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

### シナリオ T-8: モード B — 同一機器・期間重複でブロック

1. テスト用アプリで以下を用意する:
   - 予約アプリに「申請番号」フィールド（SINGLE_LINE_TEXT）と REFERENCE_TABLE「貸与機器一覧」（関連条件: 申請番号同士）を設定
   - 機器管理アプリに「申請番号」（紐付けキー）と「機器 ID」（リソース識別）フィールドを設定
   - 機器管理アプリに `{申請番号: AP001, 機器ID: 機器X}` / `{申請番号: AP002, 機器ID: 機器X}` の 2 レコードを作成
   - 予約アプリに `{申請番号: AP001, 開始: 10:00, 終了: 12:00}` / `{申請番号: AP002, 開始: 14:00, 終了: 16:00}` を作成
2. プラグイン設定でモード B を選択し、REFERENCE_TABLE フィールド・リソース識別フィールドを設定して保存
3. AP002 の予約を 11:00〜13:00 に DnD 移動（AP001 と期間重複）
4. 確認: ステップ 1 で AP001 の予約が候補として取得される（DevTools）
5. 確認: ステップ 3 で `申請番号 in ("AP001","AP002")` のクエリが発行される（DevTools）
6. 確認: ブロックされてバナーが表示される（AC-9）

### シナリオ T-9: モード B — 異なる機器・期間重複は許可

1. 上記 T-8 の環境で `{申請番号: AP003, 機器ID: 機器Y}` を機器管理アプリに追加
2. 予約アプリに `{申請番号: AP003, 開始: 10:00, 終了: 12:00}` を作成
3. AP003 の予約をそのままの位置（10:00〜12:00）に DnD（AP001 と同時刻だが機器が異なる）
4. 確認: ステップ 4 で `{機器X}` ∩ `{機器Y}` = 空集合 → 重複なし → `updateEvent` が送信される（AC-10）

### シナリオ T-10: モード B — 候補 0 件時の省略確認

1. 期間重複する予約が存在しない日時に任意の予約を DnD 移動
2. 確認: ステップ 1 の GET のみ発行され（候補 0 件）、ステップ 3 の GET は発行されない（DevTools）
3. 確認: `updateEvent` が送信される（AC-11）

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

**モード A（通常フィールド方式）**:
```
1. プラグイン設定画面を開く
2. 「共通設定」セクションの「重複チェック設定」を確認
3. 判定モードで「通常フィールド方式」を選択
4. 「リソースキーフィールド」プルダウンから対象フィールドを選択
   （例: 「会議室」「機器名」「場所」など）
5. 「保存」または「保存して更新」で保存
6. 以降のカレンダー DnD 操作で重複チェックが有効になる
```

**モード B（関連レコード方式）**:
```
1. プラグイン設定画面を開く
2. 「共通設定」セクションの「重複チェック設定」を確認
3. 判定モードで「関連レコード方式」を選択
4. 「関連レコードテーブルフィールド」プルダウンから REFERENCE_TABLE フィールドを選択
   （選択後、紐付けフィールドコードと関連先アプリ ID が自動取得される）
5. 「リソース識別フィールド（関連先アプリ）」プルダウンから機器 ID 等のフィールドを選択
6. 「保存」または「保存して更新」で保存
7. 以降の DnD 操作で関連レコードを経由した機器単位の重複チェックが有効になる
```

---

*第 1 版（2026-06-11）: ユーザー確定事項（目的・スコープ・判定キー・除外条件・UX・エラー時挙動）を反映して初版作成。未確定事項 Q-1〜Q-6 を §10 に整理。*
*第 2 版（2026-06-11）: Q-1（隣接は重複なし・厳密不等号）、Q-3（重複先タイトル含む文言）、Q-5（src 版対応不要）をユーザー確認により確定。Q-2 を builder 技術判断に委ねる形式に変更し判断基準を §7.3 に追記。§3.2 スコープ・§7.1 クエリ不等号の説明・§7.2 fields パラメータ・AC-7 の条件書き・§13.2 バナー文言を更新。残存未確定事項は Q-4（CHECK_BOX 実機確認）および Q-6（DATE 型実装時注意）のみ。*
*第 3 版（2026-06-11）: FR-5・§7.2 の除外ステータス条件を `KC.Config.EXCLUDED_STATUSES`（廃止済み）から `kintone.app.getQueryCondition()` AND 合成方式に変更。AC-6 の Given を getQueryCondition() 依存に修正。§7.1 に DATE 型クエリパターン（end >= qNewStart、inclusive）と隣接許容の机上検証例を追記。§8.3 を独立関数指定から既存の `collectFieldMapping()` / `applyFieldMapping()` への統合方針に変更。Q-6 を確定済みに更新。残存未確定事項は Q-4（CHECK_BOX 実機確認）のみ。*
*第 4 版（2026-06-11）: 関連レコード方式（モード B）の重複判定を追加（FR-8〜FR-10・§7.5・§8.4・§9B・AC-9〜AC-13・T-8〜T-10）。背景: 検証アプリでリソース（機器）が REFERENCE_TABLE 経由でのみ識別可能な実態に対応。判定モード選択（A: 通常フィールド / B: 関連レコード）・4 ステップ判定フロー・キャッシュ不使用の設計判断（Q-7 確定）・候補件数上限（Q-8）・in 演算子値数上限（Q-9）・自リソース集合空の扱い（Q-10）・同一申請番号ケース（Q-11）を新規追加。プラグイン設定スキーマを version 9 に更新（§9B）。残存未確定事項は Q-4・Q-8〜Q-11。*
*第 5 版（2026-06-11）: Q-8（limit 100 範囲内判定・超過時許可）、Q-10（自リソース集合空 = 許可）、Q-11（1 申請 1 予約運用で発生しない・万一の帰結を注記）をユーザー確認により確定。§7.5 の超過時記述・FR-9 ステップ 4 の空集合記述を確定仕様に更新。残存未確定事項は Q-4（CHECK_BOX 実機確認）・Q-9（in 値数上限、builder 技術判断）のみ。*
*第 6 版（2026-06-11）: ①§8.4 の API 用語誤り修正（`relatedConditions` → `referenceTable.condition`、`condition.field` / `condition.relatedField` の意味を明記）。②§9B スキーマに `overlapRefTableRelatedJoinFieldCode`（関連先側紐付けフィールド）を追加し 2 フィールドに分離。§7.5 ステップ 1〜3・§8.3・マイグレーション・KC.Config 読み込みに各フィールドの使い分けを反映。③FR-9 ステップ 2 に自レコードのキー値空（申請番号未記入）= 許可・候補側キー値空 = 除外の扱いを追記。FR-4 に「空キー値・空リソース集合は正常ケースであり FR-4 ブロック対象外」の注記を追加。残存未確定事項は Q-4・Q-9 のみ（変更なし）。*
