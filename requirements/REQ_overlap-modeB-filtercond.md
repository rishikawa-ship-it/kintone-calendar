# 要件定義書: DnD 重複チェック モードB 誤ブロック修正（関連先アプリ filterCond 連動）

**文書番号**: REQ_overlap-modeB-filtercond
**作成日**: 2026-07-07
**作成者**: designer（サブエージェント）
**ステータス**: 緊急バグ修正・確定版（実データで原因確定済み、未解決事項なし）
**関連文書**:
- `requirements/REQ_dnd-overlap-block.md` — DnD 重複予防ブロックの元要件（モード A/B の設計）
- `plugin/src/js/config.js` — 設定画面スクリプト（現行 version 11）
- `plugin/src/js/desktop.js` — 実装対象（プラグイン版・重複チェック本体）

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状の問題（実データ再現）](#2-現状の問題実データ再現)
3. [原因分析](#3-原因分析)
4. [要件](#4-要件)
5. [config version・マイグレーション方針](#5-config-versionマイグレーション方針)
6. [受入基準](#6-受入基準)
7. [検証項目・テストシナリオ](#7-検証項目テストシナリオ)
8. [想定 UX / シーケンス](#8-想定-ux--シーケンス)
9. [リスク・留意点・未解決事項](#9-リスク留意点未解決事項)

---

## 1. 背景・目的

### 1.1 背景

KC Calendar には DnD（ドラッグ＆ドロップ）による日時変更時のリソース競合チェック機能があり、判定モードとして「モード A（通常フィールド方式）」と「モード B（関連レコード識別方式）」を選択できる（`requirements/REQ_dnd-overlap-block.md` §9B）。

モード B は、予約アプリの REFERENCE_TABLE フィールド経由で関連先アプリ（機器明細アプリ等）のレコードを参照し、リソース識別フィールド（機器コード等）の値集合同士の交差判定でリソース競合を検出する方式である。

今回、実運用データにおいて **本来重複しないはずの予約が「〜と期間が重複しています」と誤ブロックされる** バグが発生した。原因は既に実データで確定済みであり、本書は追加調査を行わず、確定した修正方針を要件として記述するものである。

### 1.2 目的

モード B のステップ3クエリ（関連先アプリへの一括照会）に、関連先アプリ側の絞り込み条件（`filterCond`。既に予約アプリの REFERENCE_TABLE フィールド定義に設定済みで、関連テーブルの表示にも使われている条件）を連動させることで、削除済・無効化された関連先レコードを誤って交差判定に含めないようにし、誤ブロックを解消する。

---

## 2. 現状の問題（実データ再現）

### 2.1 対象アプリ・フィールド

| 項目 | 値 |
|---|---|
| 予約アプリ（カレンダー本体） | app 704 |
| 予約アプリの主要フィールド | `KC_start` / `KC_end`（DATE 型）, `KC_status`, `KC_title`, 申請番号 |
| 関連先アプリ（申請＝機器明細アプリ） | app 831（1申請番号に対し複数の機器明細レコードが存在） |
| 予約アプリの REFERENCE_TABLE フィールド | 「貸与機器一覧」（relatedApp=831, condition: 申請番号 ↔ 申請番号） |
| REFERENCE_TABLE の既存 filterCond | `貸出ステータス in ("貸出予定", "貸出中", "返却期限超過", "返却済")`（削除済を除外） |

### 2.2 再現手順・実データ

1. 予約 id=293「てすてす【M03】」（申請番号 `PRO-0000074`、2026-09-07 単日、デバイス検索=22（=M03））を DnD で移動しようとする。
2. これが誤って「id=280『北原さん申請分【M01、M02】』（申請番号 `PRO-0000060`、2026-06-30〜2026-10-30、貸出中）と期間が重複しています」とブロックされる。
3. app 831（申請番号 `PRO-0000060`）の明細レコードを確認すると3件存在する:
   - M01（デバイス検索20、貸出ステータス=貸出予定）
   - M02（デバイス検索21、貸出ステータス=貸出予定）
   - **M03（デバイス検索22、貸出ステータス=削除済）**
4. `PRO-0000074`（自分側）の明細はデバイス検索22（M03、貸出予定）の1件のみ。
5. 「削除済」の M03（デバイス22）が交差判定に混入した結果、`PRO-0000060` がまだデバイス22を保持しているとみなされ、自分のデバイス集合 `{22}` と交差 → 誤ブロックが発生した。
6. 一方、予約アプリ(704)の関連テーブル「貸与機器一覧」の**画面表示**では、既存の filterCond により削除済の M03 は表示されない（表示上は正しく `{20, 21}` のみに見える）。

---

## 3. 原因分析

### 3.1 該当コード

`plugin/src/js/desktop.js` の `checkOverlapQueryModeB`（1225〜1373行）は、ステップ3で関連先アプリ(831)へ以下のクエリのみを送信している（1307行）:

```javascript
var step3Query = '(' + relatedJoinField + ' in (' + inList + '))';
```

このクエリには関連先アプリ側の絞り込み条件が一切含まれない。そのため、関連先アプリの「貸出ステータス=削除済」であるレコードも無条件に取得され、ステップ4（1326〜1339行）のリソース集合構築で削除済レコードのリソース値（デバイス検索22）まで `resourceMap` に混入する。

### 3.2 決め手となった事実

予約アプリ(704)の REFERENCE_TABLE フィールド「貸与機器一覧」には既に以下の filterCond が設定されている:

```
貸出ステータス in ("貸出予定", "貸出中", "返却期限超過", "返却済")
```

これは kintone の関連テーブル表示機能が内部的に使用している絞り込み条件であり、削除済レコードを除外する。**この filterCond をステップ3クエリに AND 連結すれば、画面表示と同じ基準でモード B のリソース集合が構築され、誤検知が解消する。**

検証済み: filterCond を適用すると record（M03, 削除済）が除外され、`PRO-0000060` のデバイス集合は `{20, 21}` となる。自分のデバイス集合 `{22}` と交差しないため、ブロックされない（期待通りの動作）。

### 3.3 影響範囲

- モード B のみに影響する。モード A（fieldKey 方式）は本問題と無関係で変更対象外。
- モード B であっても、対象の REFERENCE_TABLE フィールドに filterCond が設定されていないケース（filterCond 未設定）では、現行のステップ3クエリと同一の挙動を維持する（filterCond が空なら AND 連結しないため、影響なし）。

---

## 4. 要件

### 4.1 config.js（設定画面スクリプト）

#### 4.1.1 概要

モード B 設定において、REFERENCE_TABLE フィールドの選択・復元時に、既存で自動取得している以下の値と**同じ仕組み・同じタイミング**で `referenceTable.filterCond` も取得し、新しい fieldMapping キー `overlapRefTableFilterCond`（string, 空文字デフォルト）として保存する。

既存で同様に扱われている値（本要件の実装パターンの雛形）:
- `overlapRefTableJoinFieldCode`（予約側 condition.field）
- `overlapRefTableRelatedJoinFieldCode`（関連先側 condition.relatedField）
- `overlapRefTableRelatedAppId`（関連先アプリ ID）

これらはいずれも「設定画面 UI に入力欄を持たず、REFERENCE_TABLE フィールド選択時に kintone フィールド定義から自動取得し、内部変数 → fieldMapping に保存」というパターンで扱われている。`overlapRefTableFilterCond` もこのパターンに追従する。**設定画面へのUI入力欄の追加は不要。**

#### 4.1.2 変更箇所詳細

| # | 箇所 | 現状 | 変更内容 |
|---|---|---|---|
| 1 | ファイル先頭のフォーマットコメント（1〜30行付近、特に 12〜16行の fieldMapping 型定義コメント） | `overlapRefTableRelatedAppId` までの記載 | `overlapRefTableFilterCond`（モード B: REFERENCE_TABLE の filterCond, 自動取得）の行を追記。version 表記も更新（§5 参照） |
| 2 | 内部変数宣言（264〜266行付近、`_overlapRefJoinFieldCode` 等と同じ場所） | `_overlapRefJoinFieldCode` / `_overlapRefRelatedJoinFieldCode` / `_overlapRefRelatedAppId` の3変数 | `_overlapRefFilterCond`（初期値 `''`）を追加宣言 |
| 3 | REFERENCE_TABLE の選択肢構築（loadFields 内、2975〜3005行、data 属性設定 2988〜3001行） | `opt.dataset.relatedAppId` / `relatedAppCode` / `joinFieldCode` / `relatedJoinFieldCode` を `fieldDef.referenceTable` から設定 | 同じ `refTable` オブジェクトから `refTable.filterCond`（未設定時は `''`）を取得し、`opt.dataset.filterCond = refTable.filterCond || '';` を追加 |
| 4 | REFERENCE_TABLE change ハンドラ（3829〜3886行） | `selOpt.dataset` から `joinFieldCode` / `relatedJoinFieldCode` / `relatedAppId` を読み取り、不足時は API フォールバック（3855〜3878行）で `kintone.api('/k/v1/app/form/fields')` から再取得 | data 属性から `filterCond = selOpt.dataset.filterCond \|\| ''` を読み取り `_overlapRefFilterCond` に保持。選択解除時（3835〜3847行）は `_overlapRefFilterCond = ''` にリセット。API フォールバック分岐（3856〜3877行）でも `refTable.filterCond` を取得して `_overlapRefFilterCond` に格納 |
| 5 | `collectFieldMapping`（573〜597行、返却オブジェクト） | `overlapRefTableJoinFieldCode` 等を `_overlapRef*` 変数から返却 | 返却オブジェクトに `overlapRefTableFilterCond: _overlapRefFilterCond` を追加 |
| 6 | `applyFieldMapping`（2400〜2412行、保存値からの復元） | `_overlapRefJoinFieldCode` 等を `fieldMapping.overlapRefTable*` から復元 | `_overlapRefFilterCond = fieldMapping.overlapRefTableFilterCond \|\| '';` を追加（他の3変数と同じ行群に併記） |
| 7 | マイグレーション（version 8→9, 2779〜2794行） | `overlapRefTableJoinFieldCode` 等が `undefined` なら `''` で補完 | 同ブロックに `if (fm8.overlapRefTableFilterCond === undefined) { fm8.overlapRefTableFilterCond = ''; }` を追加。ただし本要件は version 9→12（後述 §5）の新規マイグレーションブロックとして実装してもよい。既存の v8→v9 ブロックに一律追記する場合、旧バージョンからの一気通貫マイグレーションにも対応できる利点があるため、実装時はどちらか一貫した方針で対応する |

#### 4.1.3 kintone REFERENCE_TABLE フィールド定義における filterCond の位置

kintone REST API のフィールド定義では、REFERENCE_TABLE フィールドの絞り込み条件は `fieldDef.referenceTable.filterCond`（文字列、クエリ形式）に格納される。既存コードが `fieldDef.referenceTable.relatedApp` / `fieldDef.referenceTable.condition` を参照している箇所（2991〜3001行、3862〜3869行）と同じ `referenceTable` オブジェクトの兄弟プロパティとして取得できる。

### 4.2 desktop.js（重複チェック本体）

#### 4.2.1 KC.Config への読み込み

`loadFromPluginConfig`（212行〜、DnD 重複チェック設定の読み込みは 327〜340行に集約）に以下を追加する:

```javascript
KC.Config.OVERLAP_REF_TABLE_FILTER_COND = fm9.overlapRefTableFilterCond || '';
```

既存の `OVERLAP_REF_TABLE_FIELD_CODE` 等と同じ行群（336〜340行）に追記する。

また、`KC.Config` の初期値宣言（398〜438行、`OVERLAP_REF_TABLE_FIELD_CODE` 等の JSDoc 付き初期化ブロック）に、`KC.Config.OVERLAP_REF_TABLE_FILTER_COND = '';` を JSDoc コメント付きで追加する:

```javascript
/**
 * モード B: 関連先アプリ側の絞り込み条件（REFERENCE_TABLE の referenceTable.filterCond）
 * loadFromPluginConfig で上書きされる。空文字 = 絞り込みなし（後方互換デフォルト・現行動作維持）
 * checkOverlapQueryModeB のステップ3クエリに AND 連結される。
 * @type {string}
 */
KC.Config.OVERLAP_REF_TABLE_FILTER_COND = '';
```

#### 4.2.2 checkOverlapQueryModeB のステップ3クエリ変更

`checkOverlapQueryModeB`（1225〜1373行）冒頭の変数取得部（1229〜1232行）に以下を追加:

```javascript
var refFilterCond = KC.Config.OVERLAP_REF_TABLE_FILTER_COND;
```

ステップ3クエリ組み立て（1307行）を以下のように変更する:

```javascript
// 変更前（1307行）
var step3Query = '(' + relatedJoinField + ' in (' + inList + '))';

// 変更後
var step3Query = '(' + relatedJoinField + ' in (' + inList + '))';
if (refFilterCond) {
  step3Query += ' and (' + refFilterCond + ')';
}
```

- `refFilterCond` が空文字の場合は現行と同一のクエリになり、動作は変わらない（後方互換）。
- `refFilterCond` が非空の場合は、関連先アプリ(831)側のフィールド（例: 貸出ステータス）に対する絞り込みとして有効に機能する（filterCond は関連先アプリのフィールドを参照する文字列のため、関連先アプリへの GET リクエストで問題なく評価される）。
- 括弧で囲んで AND 結合すること（filterCond 内部に `or` が含まれる場合の演算子優先順位事故を防ぐため）。

#### 4.2.3 設定不備判定（1235〜1240行）への影響

既存の設定不備チェック（`if (!joinField || !relatedJoinField || !relatedAppId || !resourceField)`）に `refFilterCond` を追加しないこと。`refFilterCond` は空文字が正常値（絞り込みなし）であり、必須パラメータではないため、不備判定の対象に含めない。

---

## 5. config version・マイグレーション方針

### 5.1 version 判断

新規 fieldMapping キー `overlapRefTableFilterCond` を追加するため、**config version を現行 11 → 12 に上げる**。

理由:
- 過去のマイグレーション実績（version 8→9 で `overlapRefTable*` 系キーを追加した際も version を上げている、2779〜2794行）と一貫性を取る。
- 既存 config に `overlapRefTableFilterCond` が存在しないケースを確実に検出し、空文字で補完するため、version 番号によるマイグレーション判定が必要。

### 5.2 マイグレーション処理

`version 11 → 12` マイグレーションブロックを既存のマイグレーション群（2770〜2808行付近、`if (Number(parsed.version) < N)` のパターン）に追加する:

```javascript
// version 11 → 12 マイグレーション（overlapRefTableFilterCond 追加）
if (Number(parsed.version) < 12) {
  console.log('[KC Config] version 11 → 12 へマイグレーション実行');
  if (!parsed.fieldMapping) { parsed.fieldMapping = {}; }
  if (parsed.fieldMapping.overlapRefTableFilterCond === undefined || parsed.fieldMapping.overlapRefTableFilterCond === null) {
    parsed.fieldMapping.overlapRefTableFilterCond = '';
  }
  parsed.version = 12;
}
```

- ファイル先頭のバージョンコメント（1〜30行）に「v12 変更点」の節を追加し、本要件（本文書番号）を明記する。
- `desktop.js` 側の `fm9.overlapRefTableFilterCond || ''` フォールバック（§4.2.1）により、config.js のマイグレーションが万一漏れていても desktop.js 側で安全側（空文字＝現行動作維持）に倒れる二重防御構成とする。

### 5.3 既存 config への影響

- 既存 config（`overlapRefTableFilterCond` 未保存）は、マイグレーションにより空文字で補完される。空文字の場合、`checkOverlapQueryModeB` は現行動作（filterCond 連結なし）を維持する。
- **本修正の恩恵（誤ブロック解消）を実際に受けるには、対象アプリのプラグイン設定画面を開いて再保存する必要がある**（REFERENCE_TABLE フィールドの change ハンドラ経由で `filterCond` が自動取得され、保存時に `overlapRefTableFilterCond` へ格納されるため）。マイグレーションによる空文字補完だけでは filterCond の実際の値は入らない。これは §9 リスクにも明記する。

---

## 6. 受入基準

Given/When/Then 形式で記述する。

### AC-1: 実データ再現ケースでの誤ブロック解消（メインケース）

- **Given**: 予約アプリ(704)の「貸与機器一覧」フィールドに filterCond `貸出ステータス in ("貸出予定", "貸出中", "返却期限超過", "返却済")` が設定されており、プラグイン設定を再保存済み（`overlapRefTableFilterCond` に上記文字列が格納されている）。かつ app 831 の `PRO-0000060` に M01(貸出予定,20)/M02(貸出予定,21)/M03(削除済,22) の明細が存在し、`PRO-0000074` にはM03相当(貸出予定,22)のみが存在する。
- **When**: 予約 id=293（申請番号 `PRO-0000074`、デバイス検索=22）を DnD で 2026-09-07 に移動する。
- **Then**: 「〜と期間が重複しています」のブロックは発生せず、DnD による日時変更が確定する。

### AC-2: filterCond 非空時のリソース集合絞り込み

- **Given**: モード B が有効で `overlapRefTableFilterCond` が非空。
- **When**: `checkOverlapQueryModeB` のステップ3クエリが関連先アプリへ送信される。
- **Then**: 送信されるクエリ文字列は `(relatedJoinField in (...)) and (filterCond)` の形式であり、filterCond に合致しない関連先レコード（例: 削除済ステータス）はステップ3のレスポンスに含まれない。

### AC-3: filterCond 未設定時の後方互換

- **Given**: `overlapRefTableFilterCond` が空文字（未設定または既存 config のマイグレーション直後で再保存前）。
- **When**: `checkOverlapQueryModeB` が実行される。
- **Then**: ステップ3クエリは `(relatedJoinField in (...))` のみで、現行（修正前）と同一の挙動になる（AND 連結されない）。

### AC-4: モード A への非影響

- **Given**: プラグイン設定でモード A（fieldKey 方式）が選択されている。
- **When**: DnD による日時変更を行う。
- **Then**: モード A の重複チェック処理（`checkOverlapQueryModeA` 相当、本要件の変更対象外）は変更前と同一の挙動を示す。

### AC-5: 本来重複すべきケースのブロック継続

- **Given**: filterCond が設定・反映済みで、かつ本当にリソースが競合する2予約（同一デバイスを指す明細が両方とも「貸出予定」等の有効ステータス）が存在する。
- **When**: 片方を DnD で他方と重複する期間に移動する。
- **Then**: 従来通り「〜と期間が重複しています」でブロックされる（誤って抑制されないことを確認する回帰確認）。

### AC-6: config マイグレーション

- **Given**: version 11 以前の既存プラグイン設定（`overlapRefTableFilterCond` キーが存在しない）。
- **When**: 設定画面を開く。
- **Then**: 内部的に version 12 へマイグレーションされ、`fieldMapping.overlapRefTableFilterCond` に空文字が補完される。保存を実行すると REFERENCE_TABLE フィールドの現在の filterCond 値が自動取得されて保存される。

---

## 7. 検証項目・テストシナリオ（実機）

**前提**: 実運用はプラグイン版のみ（src 版は未使用）。検証は `plugin.zip` を kintone に手動アップロードして行う必要がある（自動テスト不可）。

### 7.1 検証シナリオ一覧

| # | シナリオ | 手順 | 期待結果 |
|---|---|---|---|
| S-1 | 誤ブロック解消の実機確認（メイン） | 1. plugin.zip をビルド・アップロードし、app 704 のプラグイン設定画面を開く（モード B・「貸与機器一覧」選択済みであることを確認） 2. 設定画面をそのまま保存（再保存トリガー、`overlapRefTableFilterCond` が自動取得され保存される） 3. カレンダー画面で予約 id=293「てすてす【M03】」を 2026-09-07 へ DnD 移動 | ブロックされずに移動が確定する。ブラウザ console に `[KC.Api.checkOverlapQueryModeB]` 系の警告が出ないこと |
| S-2 | 再保存前（filterCond 空文字）の現行動作確認 | S-1 の設定再保存を行わず（version 12 マイグレーション直後・filterCond 未反映の状態）、同じ DnD 操作を行う | 修正前と同様に誤ブロックが発生する（＝マイグレーションのみでは解消しないことの確認。再保存の必要性を裏付ける） |
| S-3 | ステップ3クエリの内容確認 | ブラウザ開発者ツールの Network タブで `checkOverlapQueryModeB` 実行時の `/k/v1/records.json`（app=831 宛）リクエストの `query` パラメータを確認 | `and (貸出ステータス in (...))` が付与されていること（S-1 の状態） |
| S-4 | 本来ブロックすべきケースの回帰確認 | 実データ中の本当にリソース競合する2予約（同一デバイス・有効ステータスの明細を持つ2件）を用意し、片方を他方の期間に重ねて DnD | 従来通りブロックされる（誤って解除されていないこと） |
| S-5 | モード A の非影響確認 | app 704 または別アプリでモード A 設定のカレンダーを開き、通常の DnD 重複チェックを実施 | 修正前と同一の挙動（ブロック/非ブロックの判定結果に変化なし） |
| S-6 | filterCond 未設定の REFERENCE_TABLE でのモード B 確認 | filterCond を設定していない別の REFERENCE_TABLE フィールドをモード B に選定したカレンダーで DnD 重複チェックを実施 | ステップ3クエリに AND 連結が付与されず、現行動作と同一 |
| S-7 | config マイグレーション確認 | version 11 の既存設定 JSON を持つカレンダーのプラグイン設定画面を開き、保存する | console に「version 11 → 12 へマイグレーション実行」ログが出力される。保存後の設定に `overlapRefTableFilterCond` キーが存在する |

---

## 8. 想定 UX / シーケンス

### 8.1 修正後のステップ3処理フロー（テキストシーケンス）

```
DnD mouseup（新しい start/end 確定）
  ↓
checkOverlapQueryModeB(ev, newStart, newEnd)
  ├─ ステップ1: 予約アプリ(704)へ期間重複候補を GET（変更なし）
  ├─ ステップ2: 候補レコードの joinVal（申請番号）集合を構築（変更なし）
  ├─ ステップ3: 関連先アプリ(831)へ GET
  │     query = "(relatedJoinField in (joinVal集合)) and (filterCond)"  ← filterCond が非空の場合のみ AND 追加
  │     → 削除済等、filterCond に合致しない明細レコードが除外された状態で取得される
  ├─ ステップ4: リソース集合（デバイス検索値等）の交差判定（変更なし、ただし入力データが絞り込まれているため誤検知が消える）
  └─ hasOverlap: true/false を返却
       ↓
     false の場合 → _commitOptimistic 実行、日時変更確定
     true  の場合 → ブロック通知（「〜と期間が重複しています」）
```

### 8.2 設定画面での挙動（ユーザー視点）

- 設定画面 UI に変更は一切ない（新規入力欄なし）。
- 管理者は「貸与機器一覧」（REFERENCE_TABLE フィールド）を選択し直す、または既存選択のまま保存し直すだけで、裏側で filterCond が自動取得・保存される。
- 管理者が REFERENCE_TABLE フィールド定義側（kintone アプリ設定）で filterCond を変更した場合は、プラグイン設定画面を再度開いて保存し直す必要がある（自動追従はしない。§9 参照）。

---

## 9. リスク・留意点・未解決事項

### 9.1 留意点（確定事項）

- filterCond のフィールド（例: 貸出ステータス）は関連先アプリ(831)のフィールドであり、ステップ3クエリの宛先アプリと一致するため、そのままクエリに使用できる。
- filterCond は **config 保存時点のスナップショット** である。kintone アプリ側で関連テーブルの絞り込み条件（filterCond）だけを後から変更した場合、プラグイン設定側は自動追従しない。この修正の効果を維持するには、REFERENCE_TABLE フィールド定義の filterCond 変更時にプラグイン設定の再保存が必要（運用上の制約として明記）。
- 既存 config（`overlapRefTableFilterCond` 未保存、または version 12 マイグレーション直後で再保存前）は空文字フォールバックにより現行動作（修正前の挙動）を維持する。**この修正の恩恵を受けるには、対象アプリのプラグイン設定を一度再保存する必要がある。** 自動的に恩恵を受けるわけではない点を運用担当者へ周知すること。
- filterCond の文字列は kintone が生成した正規のクエリ条件（フィールド定義から取得した値）であるため、サニタイズは不要。ただし他の条件と結合する際の演算子優先順位事故を避けるため、括弧で囲んで AND 結合する（§4.2.2 で規定済み）。
- モード A（fieldKey方式）、およびモード B で filterCond が未設定（空文字）のケースには一切影響を与えない設計とする（§4.2.2, §4.2.3 で担保）。

### 9.2 リスク

- **再保存の周知漏れ**: マイグレーションだけでは filterCond が反映されないため、対象アプリの設定を再保存しないまま「直ったはず」と誤認するリスクがある。デプロイ後、対象アプリ(704)の設定画面を必ず開いて保存し直す運用手順をデプロイ手順に含める必要がある（`DEPLOY_GUIDE.md` への追記は本要件の対象外だが、管理者への申し送り事項とする）。
- **filterCond の記法変化への追従漏れ**: 将来 kintone 側の REFERENCE_TABLE 定義の filterCond 構文が変わった場合（現状想定なし）、自動取得ロジックの見直しが必要になる可能性がある。現時点ではリスクとして低い。

### 9.3 未解決事項

なし。実データによる原因確定済みであり、修正方針・検証方法とも確定している。

### 9.4 検証環境上の制約

- 実運用はプラグイン版のみ（`src/` 版は未使用、`MEMORY.md` 記載事項）。検証は必ず `plugin/dist/plugin.zip` を手動でビルド・アップロードして実施する。自動テストでの代替はできない。
