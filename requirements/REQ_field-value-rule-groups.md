# REQ_field-value-rule-groups — フィールド値ルールの条件グループ化（AND/OR 入れ子）と DnD の権限ガード二重化

ステータス: 第2版（実装・レビュー反映・DEV 実機テスト合格、2026-10-21）
作成日: 2026-10-21
担当: designer
関連要件: `REQ_edit-permission-extension.md`（FR-8 権限フィールド設定、FR-9 優先順位）、`REQ_default-permission.md`、`REQ_dnd-enable-setting.md`、`REQ_dnd-save-hooks.md`

表記: 【事実】は出典付き（行番号は 2026-10-21 時点の `plugin/src/js/desktop.js` / `config.js` / `html/config.html` の目安。researcher 調査）。【提案】【推測】は裏取り前の設計判断。【決定】は石川さんの指示（2026-10-20〜21）。

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 草案 第1版 | 2026-10-21 | 初版。fieldValueRules を条件グループ（and/or 入れ子）＋結果の形に拡張、演算子・型一覧、v13→v14 マイグレーション、設定画面の入れ子ビルダー、DnD ガード二重化、403 文言分岐を定義 |
| 草案 第2版 | 2026-10-21 | 石川さん判断を反映。深さ制限なし（動作保証は3段まで）、相対日付採用、ORGANIZATION_SELECT/GROUP_SELECT 条件採用（所属は User API 起動時1回取得の設計を【提案】）、クリックで開く編集画面には適用しない、色は行単位・保存時検証で停止・未取得値は false＋警告を確定、旧形式空値行は旧挙動維持（builder 確認）。U-6 のみ未解決 |

## §1 背景・目的

### 背景

- DnD はレコードの編集権限に従わせたい【決定 2026-10-20〜21】。
- kintone 固有の権限（レコード ACL・フィールド ACL 等）は、`viaEdit` モードでは kintone の編集画面が保存時に止める。したがって**プラグイン側で kintone ACL を評価する仕組みは作らない**【決定】。`direct` モードの REST PUT が 403 で失敗したときに、原因が分かる文言を出す程度にとどめる【提案として FR-7 に含める】。
- 現行の「権限フィールド設定」（`fieldValueRules`）は 1 行 = 1 フィールド × 1 値の完全一致（CHECK_BOX は包含）しか書けない。「貸出中・返却済・削除済のいずれか」「開始日が今日以前」「A かつ B」「A または B」のような**フィールド値に応じた制限**を表現できない。
- フィールド値に応じた制限は、**条件グループを入れ子にして AND/OR を複合できる**形に拡張する【決定】。
- DnD の可否ゲートは描画側の配線のみで、`KC.DnD` の start 系 8 関数と `_commitOptimistic` は `KC.Config.DND_ENABLED` しか見ていない。配線漏れがあると権限のないレコードが動かせてしまう【事実。§2 E-5】。

### 目的

1. `fieldValueRules` の各行を「条件グループ（and/or、入れ子可）＋結果（permission, bgColor, textColor）」に拡張する。
2. 条件で比較できるフィールド型・演算子を整理し、数値・日付（今日基準の相対値を含む）・複数選択を扱えるようにする。
3. 既存設定（単一値ルール）を壊さず移行する（version 13 → 14）。
4. DnD の canEdit 確認を start 系と `_commitOptimistic` にも置き、配線漏れを塞ぐ。
5. 直接保存モードの 403 を「編集権限がありません」と区別して通知する。

範囲外: kintone ACL のプラグイン側評価、営業日判定（Customine が保存時に止める。§3 FR-2）、`permissionRules`（権限ユーザー設定）と `defaultPermission` の仕様変更、`src/` 版（未使用・旧版）、モバイル。

## §2 現状分析

| # | 事実 | 出典 |
|---|---|---|
| E-1 | 編集可否はプラグイン独自判定 `KC.LoginContext.getPermission(evt)`。canEdit は `_permLevel(perm) >= 2`。根拠は permissionFields（USER_SELECT の `value[].code`）と valueFields | desktop.js:4570-4614、4494-4499、4545、4581、4600、1017-1070 |
| E-2 | 設定 UI は「権限・色分け」タブ。権限フィールド設定（= fieldValueRules）、権限ユーザー設定（= permissionRules）、デフォルト権限設定の 3 カード。既定値は config.js:364-372 | config.html:41-42、268-378（278-306 / 308-338 / 341-377）、config.js:364-372 |
| E-3 | fieldValueRules の行形式は `{fieldCode, fieldType($status は STATUS), value(単一文字列), permission(既定 view), bgColor, textColor}`。収集は config.js:2110-2141。対象型は DROP_DOWN / RADIO_BUTTON / CHECK_BOX / STATUS | config.js:2110-2141、config.html:279-283 |
| E-4 | 判定は上から順に最初に一致した行の権限と色を採用。値一致は CHECK_BOX が配列包含、それ以外は完全一致。permissionRules は USER_SELECT にログインユーザー code が含まれるか（組織・グループ未対応）、複数該当は最高権限、色は最初の該当行。defaultPermission は enabled=true かつ非一致時に適用（両配列が空なら全員 edit、設定ありで非一致なら view）。優先順位は fieldValueRules > permissionRules > defaultPermission | desktop.js:4574-4588、4529-4534、4480-4487、4591-4607、4507-4519、4541-4560、REQ_edit-permission-extension FR-9（233-240） |
| E-5 | DnD の可否ゲートは描画側の配線のみ。KC.DnD の start 系 8 関数（`startMoveAllday` / `startResizeAllday` / `startMove` / `startResize` / `startMoveAlldayMonth` / `startResizeAlldayMonth` / `startMoveMonthChip` / `startResizeMonthTimedSpan`）と `_commitOptimistic` は `KC.Config.DND_ENABLED` しか見ない | 配線: desktop.js:4838-4843、4879-4904、5375-5522、6151-6218、6243-6288、6517-6547。start 系: 3360、3547、3906、3955、4138、4175、4361、4394。`_commitOptimistic`: 2979 |
| E-6 | `KC.Api.updateEvent` は try/catch なし。呼び出し側は 403 と 409 を区別せず `alert('予定の更新に失敗しました: '+msg)` | desktop.js:1601-1652、3149-3176 |
| E-7 | 設定 `version` は 13。設定のエクスポート／インポートは寛容パース（部分キー可）。設定画面は 7 タブで、非選択パネルは hidden のみ（DOM から外さない。収集・書き出しが全パネルを読む）。puppeteer ハーネスで設定画面の自動検証が可能 | メモリ session-2026-07-31-config-tabs、config-screen-puppeteer-harness、backlog-config-export-import |
| E-8 | プラグインは kintone 全体で 1 版。アップロードすると本番 704 も同じコードになる。新機能は既定で従来互換にする | メモリ src-version-deprecated、REQ_dnd-save-hooks §1 |
| E-9 | 現行 Wi-Fi アプリ（本番 704／開発 654）のフィールド: `KC_status`（DROP_DOWN: 貸出予定 / 貸出中 / 返却期限超過 / 削除済 / 返却済）、`KC_start` / `KC_end`（DATE）、デバイスの種類（RADIO）、借りたい個数（NUMBER）、残数（NUMBER）、`KC_account`（USER_SELECT）等 | researcher 調査 2026-10-21 |
| E-10 | クリックで開く編集画面（`KC.Popup.openEdit`）にはユーザー制限がない（現状） | researcher 調査、REQ_dnd-save-hooks E-8 |
| E-11 | 直接保存モードの REST PUT は kintone 側の権限で 403 になり得る。viaEdit は kintone 編集画面が保存時に止める | 石川さん決定（§1）、kintone-rules.md「REST API での更新は Customine を一切通らない」 |

> 行番号は実装中の変動があり得るため目安。実装後の正は `plugin/src/js/desktop.js`・`config.js`・`html/config.html` を参照。

## §3 機能要件

### FR-1 データ構造

`fieldValueRules` の各行を次の形にする【提案】。

```json
{
  "when": {
    "logic": "or",
    "conditions": [
      { "logic": "and", "conditions": [
          { "fieldCode": "KC_status", "fieldType": "DROP_DOWN", "operator": "in", "value": ["貸出予定"] },
          { "fieldCode": "KC_start",  "fieldType": "DATE", "operator": "gt",
            "value": { "mode": "today", "offsetDays": 0 } }
      ] },
      { "fieldCode": "デバイスの種類", "fieldType": "RADIO_BUTTON", "operator": "in", "value": ["ホームルーター"] }
    ]
  },
  "permission": "edit",
  "bgColor": "#1976d2",
  "textColor": "#ffffff"
}
```

- **条件**: `{ fieldCode, fieldType, operator, value }`。`fieldType` は設定時のフィールド型（`$status` は `STATUS`）。
- **グループ**: `{ logic: 'and'|'or', conditions: [条件 | グループ, ...] }`。要素が条件かグループかは、`conditions` 配列を持つかで判別する。
- **行**: `when`（ルートのグループ）＋結果（`permission` は `'edit'`|`'view'`、既定 `view`。`bgColor`、`textColor`）。結果は行単位のまま（グループごとの色は持たない。U-4）。
- **入れ子の深さ**: **制限なし**【決定 U-1】。深さを理由とする保存拒否・インポート拒否・追加ボタンの非表示はしない。ただし**動作保証（AC・テスト）はルートを深さ 1 として 3 段まで**。4 段以上も評価・保存・復元は再帰で動くが、検証対象外（§8）。
- 空グループ（`conditions` が空）は**一致しない**（false）として評価する。空の AND が常に真になって全レコードが一致する事故を防ぐ【提案】。
- 旧キー（`fieldCode` / `fieldType` / `value` を行直下に持つ形）は v14 の正規形には残さない（FR-4 で変換）。

### FR-2 演算子と対象フィールド型

| 区分 | 対象フィールド型 | 演算子（`operator` の値） | `value` の形 |
|---|---|---|---|
| 文字列 | SINGLE_LINE_TEXT / MULTI_LINE_TEXT / LINK | `eq`（等しい）、`ne`（等しくない）、`contains`（含む）、`notContains`（含まない）、`isEmpty`、`isNotEmpty` | 文字列（isEmpty/isNotEmpty は不要） |
| 単一選択 | DROP_DOWN / RADIO_BUTTON | `in`（いずれか）、`notIn`（いずれでもない）、`isEmpty`、`isNotEmpty` | 選択肢の配列（1 件以上） |
| 複数選択 | CHECK_BOX / MULTI_SELECT | `contains`（いずれかを含む）、`notContains`（いずれも含まない）、`isEmpty`、`isNotEmpty` | 選択肢の配列 |
| ステータス | STATUS（`$status`） | `in`、`notIn` | ステータス名の配列 |
| 数値 | NUMBER | `eq`（=）、`ne`（≠）、`gt`（>）、`gte`（≥）、`lt`（<）、`lte`（≤）、`isEmpty`、`isNotEmpty` | 数値（文字列で保持し、評価時に数値化） |
| 日付・日時 | DATE / DATETIME / CREATED_TIME / UPDATED_TIME | `eq`、`ne`、`lt`（より前）、`lte`（以前）、`gt`（より後）、`gte`（以後）、`isEmpty`、`isNotEmpty` | 固定値 `{mode:'fixed', date:'YYYY-MM-DD'}` または相対値 `{mode:'today', offsetDays:N}`（N は整数、負で過去） |
| ユーザー | USER_SELECT | `containsLoginUser`（ログインユーザーを含む）、`notContainsLoginUser` | なし |
| 組織・グループ | ORGANIZATION_SELECT / GROUP_SELECT | `containsLoginUser`（ログインユーザーの所属組織／所属グループを含む）、`notContainsLoginUser`（含まない） | なし。**採用**【決定 U-3】。所属の取得は下記 |

- ORGANIZATION_SELECT / GROUP_SELECT の所属取得【提案】: kintone User API の `/v1/user/organizations.json?code=<loginCode>` と `/v1/user/groups.json?code=<loginCode>` を、**カレンダー起動時に 1 回だけ**取得してキャッシュし、評価はキャッシュを参照する（評価のたびに API を呼ばない）。条件に ORGANIZATION_SELECT / GROUP_SELECT が 1 つも無い設定では取得しない（API 呼び出し数の増加を避ける）。
  - これらの API の仕様（レスポンス形、組織・グループのコードとフィールド値 `value[].code` の対応、`kintone.api` からの呼び出し可否、必要な権限）は【推測】。**builder と DEV テストで裏取りする**。
  - 取得失敗（権限不足・通信エラー等）のときは、該当条件を **false** とし、コンソールに警告を出す（`notContainsLoginUser` も false。未取得と空を区別するため FR-3 と同じ扱い）。
  - 組織の階層（親組織を含めるか）は v1 では扱わない。API が返す直接の所属のみ【提案】。

- 旧仕様との対応: DROP_DOWN / RADIO_BUTTON の完全一致 = `in` の 1 要素、CHECK_BOX の包含 = `contains` の 1 要素。
- 「選択肢系」の `in` / `notIn` / `contains` / `notContains` は、配列内の**いずれか 1 つ**に当てはまれば真（`in`・`contains`）、**どれにも当てはまらなければ**真（`notIn`・`notContains`）。
- 相対日付（今日／今日から ±N 日）は**採用**【決定 U-2】。
- 日付・日時の比較は**日付単位**（ブラウザのローカル日付 = JST 運用）で行う【提案】。DATETIME は値をローカル日付へ変換して比較する。時刻まで含む比較は v1 では行わない。「今日」は評価時点のブラウザ日付。
- 営業日（土日祝を除く日数）の条件は**対象外**。営業日判定は Customine が保存時に止める【決定】。
- フィールド型は設定時に固定して保存する。設定後にアプリ側でフィールド型が変わった場合、型が一致しない条件は評価時に false（警告をコンソールに 1 回）。
- テーブル（サブテーブル）内フィールド、ルックアップ・計算（CALC）フィールドは v1 の対象外【提案。§8】。

### FR-3 評価

- 行は上から順に評価し、**最初に一致した行**の権限と色を採用する（既存踏襲。E-4）。fieldValueRules が一致しなければ従来どおり permissionRules → defaultPermission へ進む（優先順位は変えない）。
- グループは再帰評価する。`and` は全要素が真、`or` は 1 つ以上が真。短絡評価してもしなくてもよい（結果が同じため builder の判断）。
- 評価に使う値は **DnD 開始時点のレコード値**（State にあるイベントの値）。サーバー最新値の再取得はしない。
- **値が取得されていないフィールド**: カレンダーのレコード取得時の `fields` 指定に、設定中の全ルールの条件ツリーに現れる `fieldCode` を**自動で追加する**（現行の valueFields 収集 desktop.js:1028-1070 を、ツリー走査に拡張）【提案】。それでも値が `undefined` の場合、その条件は **false** とし、コンソールに警告を 1 回出す【決定 U-9】（negative 系の演算子 `ne` / `notIn` / `notContains` / `notContainsLoginUser` も false。値が無いことと値が空であることを区別するため）。
- 数値比較: 値が空文字・非数値のとき、`isEmpty` 以外の演算子は false、`ne` のみ true【提案】。
- 評価は純関数（レコード値・ログインユーザー・今日を引数にとる）として切り出し、単体テストできる形にする【提案】。

### FR-4 後方互換・マイグレーション

- 設定 `version` を **13 → 14** にする。マイグレーションチェーンに v14 段を追加し、`fieldValueRules` の旧形式行を新形式へ変換する。
  - `{fieldCode, fieldType, value, permission, bgColor, textColor}` →
    `{when:{logic:'and', conditions:[{fieldCode, fieldType, operator, value:[value]}]}, permission, bgColor, textColor}`。
  - `operator`: DROP_DOWN / RADIO_BUTTON / STATUS は `in`、CHECK_BOX は `contains`。`value` は 1 要素の配列。
  - `value` が空文字の旧行（未入力行）は、**旧実装の挙動を維持**する【決定 U-8】。旧実装で空値行が一致するか否かは、builder が現行の判定コード（desktop.js:4529-4534、4574-4588）を確認して合わせる（一致しなかった場合の変換先は「空の AND グループ」＝一致しない、が候補）。
- 変換は**冪等**にする（すでに `when` を持つ行は触らない）。
- **インポート**は旧形式・新形式の両方を受け付ける。1 つのファイルに旧行と新行が混在してもよい。部分キーのみの JSON は従来どおり可（E-7）。未知の `operator`・型不一致の行は（深さは理由にしない）取り込まず、取り込み結果に警告として表示する【提案】。
- 動作互換: 移行後も、旧設定のレコードの判定結果（権限と色）が移行前と一致すること（AC-9）。

### FR-5 設定画面（権限フィールド設定カードの入れ子ビルダー化）

「権限・色分け」タブ内の権限フィールド設定カード（config.html:278-306）を置き換える。権限ユーザー設定・デフォルト権限設定のカードは変更しない。

- 1 ルール = 1 枚のブロック。ブロックは「条件ツリー（ルートグループ）」と「結果（権限・背景色・文字色）」と「削除」「並び替えハンドル」を持つ。ルールの並び順 = 評価の優先順（既存の行 DnD 並び替えを踏襲）。
- 入れ子の深さは任意。階層はインデントと枠線で表現し、深さに応じて幅が足りなくなる場合は横スクロールまたは折り返しで崩れないようにする（検証は 3 段まで）。
- **グループ**の表示: 先頭に `すべて満たす（AND）` / `いずれかを満たす（OR）` の切替（セレクトまたはトグル）、インデントと枠線で階層を表す。右上に「グループを削除」。
- **操作**: 各グループに「条件を追加」「グループを追加」ボタン。「グループを追加」は深さに関わらず常に使える（上限なし）。ルートグループを削除する操作は無し（ルール自体の削除のみ）。
- **条件行**: `フィールド` セレクト → `演算子` セレクト → `値` 入力、削除ボタン。
  - フィールドセレクトの選択肢は FR-2 の対象型のみ。選択変更で演算子と値入力を作り直す（`fieldType` を保持）。
  - 演算子は型に応じて出し分ける（FR-2 の表）。選択肢系の値は、フィールド定義の選択肢を使った複数選択（チェックボックス列または複数セレクト）。STATUS は `$status` のステータス名一覧。
  - `isEmpty` / `isNotEmpty` / `containsLoginUser` / `notContainsLoginUser` では値入力を隠す。
  - 日付・日時の値入力: 「固定日」（日付ピッカー）と「今日基準」を切り替えるセレクト。「今日基準」では整数入力（`今日 + N 日`。負数可、0 = 今日）と、`今日 / 今日から N 日後 / N 日前` の説明テキスト。
- 設定画面の保存時・エクスポート時: DOM を再帰的に読み、FR-1 の形で収集する。**非選択タブのパネルは hidden のみで DOM から外さない**（E-7）。
- 保存時の検証【決定 U-7。保存を止める】: 値が必須の演算子で値が空、フィールド未選択、条件ゼロのグループがある場合は、該当ブロックを赤枠で示し、保存を止めてメッセージを出す（空グループは一致しない仕様のため、意図せず空のまま保存されることを防ぐ）。
- 設定画面は puppeteer ハーネスで検証する（§5 T-C 系）。出荷コード＋kintone スタブでグループ追加・条件追加・削除・切替・保存・エクスポート／インポートの往復を確認する。

### FR-6 DnD ガードの二重化

- start 系 8 関数の**先頭**で、対象イベントの `KC.LoginContext.getPermission(ev).canEdit` が false なら即 return する。`DND_ENABLED` のガードの直後、`preventDefault` / `stopPropagation` より**前**に置き、mousedown 後のクリックで編集ポップアップを開く既存動作を妨げない（`REQ_dnd-enable-setting` FR-5 と同じ位置関係）。
- `_commitOptimistic` の先頭（`DND_ENABLED` 二重防御の直後。`viaEdit` 分岐・楽観更新より前）でも同じ確認を行い、不許可なら return する（保存も楽観更新もしない。`console.warn` を 1 行出す）。
- 描画側の配線（E-5）は残す（見た目のためのハンドル非表示等）。ガードは配線漏れの最終防衛線という位置づけ。
- 評価コスト: mousedown ごとに 1 回の評価のみ。許容【提案】。

### FR-7 直接保存モードの 403 の文言分岐

- `direct` モードの `KC.Api.updateEvent`（呼び出し側 3149-3176 付近）で、REST PUT が権限エラー（HTTP 403 相当）で失敗した場合、`alert` の文言を「このレコードを編集する権限がありません。」に分岐する【提案】。それ以外（409 リビジョン競合等）は従来どおり `予定の更新に失敗しました: …`。
- 失敗時は従来どおり楽観更新を巻き戻し、`KC.Render.refresh()` で実状態へ戻す。
- 403 の判定方法（`kintone.api` の reject オブジェクトのどのプロパティで判別できるか）は未確認【推測】。**DEV で編集権限のないユーザーとして実際に失敗させ、エラーオブジェクトの形を確認してから実装する**（§5 T-F2、§9 U-6）。
- `viaEdit` モードは kintone の編集画面が保存時に止めるため、本項の対象外。

## §4 受け入れ基準

### AC-1: 単一条件（選択肢のいずれか）で閲覧のみ

- Given: ルール「`KC_status` が 貸出中・返却済・削除済 のいずれか → 閲覧のみ」を設定している（そのルールより上に一致する行はない）
- When: `KC_status` = 貸出中 / 返却済 / 削除済 のレコードを DnD する。および `KC_status` = 貸出予定 のレコードを DnD する
- Then: 前者は DnD が始まらない（ゴースト無し・PUT 無し）。後者は DnD できる

### AC-2: 相対日付

- Given: ルール「`KC_start` が 今日 以前（`lte`, today+0）→ 閲覧のみ」を設定している
- When: `KC_start` が昨日・今日・明日のレコードを DnD する
- Then: 昨日・今日は DnD 不可、明日は DnD 可（日付が変わった後に画面を開き直すと判定が追従する）

### AC-3: 入れ子（AND の中に OR 相当）

- Given: ルール「(`KC_status` が 貸出予定 かつ `KC_start` が 今日より後) または `デバイスの種類` が ホームルーター → 編集可」を設定し、権限ユーザー設定・デフォルトでは編集不可になるようにしてある
- When: (貸出予定・開始が明日・ルーター以外)、(貸出予定・開始が昨日・ホームルーター)、(貸出中・開始が明日・ルーター以外) の 3 レコードを DnD する
- Then: 1 件目・2 件目は DnD 可、3 件目は不可

### AC-4: 最初に一致した行が採用される

- Given: 上の行が「条件 X → 編集可」、下の行が「条件 Y → 閲覧のみ」で、あるレコードが X・Y の両方に一致する
- Then: そのレコードは編集可（上の行の権限と色を採用）。行を並び替えると結果が入れ替わる

### AC-5: 空グループ・未取得値は一致しない

- Given: 条件ゼロのグループを持つルール（インポート等で入り込んだ場合）、または `fields` に含まれないフィールドを参照する条件
- Then: 該当条件・グループは false として扱われ、レコードが誤って一致することはない。後者は自動取得の追加（FR-3）により通常は発生せず、発生時はコンソール警告が 1 回出る

### AC-6: 数値・文字列・複数選択・ユーザーの演算子

- Given: 借りたい個数 ≥ 3、文字列の含む／含まない、CHECK_BOX の含む／含まない、`KC_account` にログインユーザーを含む、を使った各ルール（個別に設定）
- Then: それぞれ FR-2 の定義どおりに一致・不一致が決まる（値が空の場合の挙動は FR-3 のとおり）

### AC-7: 設定画面ビルダー

- Given: 権限・色分けタブ
- When: ルールの追加、グループ追加（深さ 3 段まで検証。深さによる拒否は無い）、条件追加、AND/OR 切替、条件・グループ削除、フィールド変更による演算子・値入力の切替、相対日付入力を行い、保存する
- Then: 保存した設定を再読み込みすると同じ構造が復元される。どの深さでも「グループを追加」が使える。検証エラー（FR-5）があるときは保存されず該当ブロックが赤枠になる

### AC-8: エクスポート／インポート

- Given: 入れ子ルールを設定してエクスポートした
- When: 別設定（または初期化後）にインポートする
- Then: 同じ構造・同じ結果が復元される。旧形式のみのファイル、新旧混在のファイルも取り込める。不正な行は取り込まれず警告が出る

### AC-9: マイグレーション互換

- Given: version 13 の保存済み設定（単一値ルール複数行。CHECK_BOX と STATUS を含む）
- When: 新版プラグインで設定画面とカレンダーを開く
- Then: 設定画面に条件 1 つのグループとして表示され、カレンダーの各レコードの権限・色が移行前と同一。保存後の設定は version 14

### AC-10: DnD ガードの二重化

- Given: 権限ルールにより canEdit が false になるレコード。描画側の配線を通らない呼び出し（コンソールから `KC.DnD.startMove` 等を直接呼ぶ、または配線漏れ経路）
- When: start 系 8 関数のそれぞれ、および `_commitOptimistic` を呼ぶ
- Then: いずれも即 return し、ゴーストなし・楽観更新なし・PUT なし。canEdit が true のレコードは従来どおり動く

### AC-11: ガードはクリックを妨げない

- Given: canEdit が false のレコード
- When: そのレコードをクリックする
- Then: mousedown 後の click で詳細または編集ポップアップが開く動作は従来と変わらない。クリックで開く編集画面（`openEdit`）にはガードを適用しない【決定 U-5】（kintone の編集画面が最終的に保存時に止める）

### AC-12: 403 の文言（direct モード）

- Given: `dndSaveMode='direct'`。kintone の編集権限が無いユーザーが、プラグイン側では canEdit=true になっているレコードを DnD する
- Then: 「このレコードを編集する権限がありません。」と表示され、レコードは元の位置に戻る。409 等は従来文言

### AC-13: 従来互換（既定）

- Given: fieldValueRules が空の設定、または単一値ルールだけの設定
- Then: 判定結果・色・DnD 挙動が従来と同じ（AC-9 と合わせて確認）

## §5 検証項目・テストシナリオ

| ID | シナリオ | 期待 | 対応 AC |
|---|---|---|---|
| T-A1 | 評価関数の単体テスト（node）: 演算子 × 型の表、空値・未定義、空グループ、入れ子 | FR-2/3 の定義どおり | AC-5, AC-6 |
| T-A3 | 組織・グループ条件の評価（所属キャッシュを差し替えたスタブ）と、User API 取得失敗時に該当条件が false＋警告になること | FR-2 のとおり | AC-6 |
| T-E1 | DEV 654 で User API（`/v1/user/organizations.json` / `groups.json`）の実レスポンス・必要権限を確認（一般ユーザーで呼べるか）。ORGANIZATION_SELECT / GROUP_SELECT 条件ルールで DnD 可否が所属どおりになること | 仕様の裏取り完了 | AC-6 |
| T-A2 | 日付の境界: 昨日・今日・明日、`offsetDays` ±N、DATETIME の日付変換（JST 0 時付近） | 日付単位で正しく比較 | AC-2 |
| T-B1 | 旧形式ルール（DROP_DOWN / CHECK_BOX / STATUS）の v13→14 変換と再実行（冪等） | 構造が FR-4 のとおり、2 回目は無変化 | AC-9 |
| T-B2 | 旧形式・新形式・混在・不正行のインポート | 取り込み可否と警告が FR-4 のとおり | AC-8 |
| T-C1 | puppeteer: グループ・条件の追加／削除、AND/OR 切替、3 段までの入れ子の追加・保存・復元（4 段目を作っても保存拒否されないことの確認を含む） | 構造が収集 JSON に反映 | AC-7 |
| T-C2 | puppeteer: フィールド変更で演算子・値入力が切り替わる（型ごと）、相対日付入力 | FR-2/5 の表どおり | AC-7 |
| T-C3 | puppeteer: 保存→再読み込み→構造復元、エクスポート→インポート、非選択タブでも収集される | 往復で同一 | AC-7, AC-8 |
| T-C4 | puppeteer: 検証エラー（未選択・値空・空グループ）で保存が止まる | 赤枠＋メッセージ | AC-7 |
| T-D1 | DEV 654 で AC-1〜AC-4 のシナリオ（下記データ） | 期待どおり | AC-1〜4 |
| T-D2 | DEV 654 でコンソールから start 系 8 関数と `_commitOptimistic` を直接呼ぶ | 即 return、PUT なし | AC-10 |
| T-D3 | DEV 654 で旧設定（version 13 の設定ファイルをインポート）を開く | 判定が移行前と一致 | AC-9, AC-13 |
| T-D4 | blocked レコードをクリック | ポップアップが開く | AC-11 |
| T-F1 | direct モードで、権限ルールは編集可・kintone 側権限なしのユーザーとして DnD（DEV。レコード ACL でそのユーザーを除外して再現） | 「編集権限がありません」 | AC-12 |
| T-F2 | 上記の失敗時、`kintone.api` の reject オブジェクトの形（`code` / `message` / ステータス情報）を記録 | 判別方法が確定 | FR-7 |
| T-F3 | 409（別タブで先に更新してから DnD）は従来文言のまま | 従来どおり | AC-12 |

### DEV 654 のテストデータ（案）

- `KC_status` = 貸出予定・貸出中・返却済・削除済 の各レコード、`KC_start` を昨日・今日・明日にしたもの、デバイスの種類 = ホームルーター／それ以外。
- DEV 654 の Customine は通知先が本番 ITサポート ch に直書きのため、通知が出る操作（保存）を行わない。本件の検証は DnD の開始可否と、`direct` の 403 失敗確認が中心【事実: メモリ dev-env-wifi-setup、customine-dev-env-fix-2026-10-20（環境別化済みのページ以外は要確認）】。
- 本番 704 には T-D 系を実施しない。プラグインの検証は開発環境で行う【事実: メモリ wifi-app-prod-test-records】。
- プラグインは zip 手動アップロード＋**ハードリロード必須**【事実: メモリ plugin-js-cache-hardrefresh】。


### §5.1 実機テスト結果（2026-10-21、開発環境 654、plugin.zip 300,589 バイト）

前提: 654 は dndEnabled=ON・viaEdit。旧形式 2 ルール（返却期限超過→view 赤、返却済→view 灰）を持つ v13 設定を新版の設定画面で開き、移行表示を確認後、テスト用 4 ルールを「書き出し・取り込み」から取り込んで保存（version 14）。ログインユーザーは管理者（所属組織に「システム管理チーム」）。テストレコード 654/722。

| 項目 | 結果 |
|---|---|
| 移行表示（AC-9） | 旧 2 ルールが「KC_status いずれか [返却期限超過]」「[返却済]」として表示され、色・権限も保持 |
| 取り込み（AC-8） | 新形式 4 ルール（入れ子 2 段を含む）を部分キー JSON から取り込み、ビルダーに正しく展開。保存後の getConfig で version 14・4 ルール |
| 入れ子ルール一致（AC-3） | 722（貸出予定・11/17）が (ステータス=貸出予定 and 開始日>今日) or デバイス=ホームルーター に一致 → 青・grab・ハンドルあり。ドラッグで編集ポップアップが 11/24〜26 で開く |
| 選択肢で閲覧のみ（AC-1） | ステータスを貸出中に変更 → 灰(#bdbdbd)・pointer・ハンドルなし。ドラッグしてもポップアップは開かず残骸なし。クリックでは詳細ポップアップが開く（AC-11） |
| 相対日付（AC-2） | 開始日 10/20（今日 10/21 以前）→ 灰(#e0e0e0)・閲覧のみ。ドラッグは始まらずレコード不変 |
| 組織条件（AC-6） | 使用部署=システム管理チーム（ログインユーザーの所属）→ 先頭ルールに一致して緑・編集可。ドラッグで編集ポップアップが開く |
| 従来互換（AC-13） | 本番 704 はルール未設定の挙動と同じ（plugin.zip 更新後も dndEnabled=false のまま） |
| 403 文言（AC-12） | 未実施（権限なしユーザー未用意。文言分岐は実装済み、CB_NO02 は未検証） |
| 一般ユーザーでの User API | 未実施（管理者で実測のみ） |

テスト後: 722 は貸出予定・11/17〜19・使用部署空に復元。654 の 4 ルールは残置（DEV の見本として利用可）。

## §6 想定 UX / シーケンス

```
[管理者: 設定画面 > 権限・色分け > 権限フィールド設定]
  ルール追加 → ルートグループ（AND）
   ├ 条件: KC_status / いずれか / [貸出中][返却済][削除済]
   └ 結果: 閲覧のみ・灰色
  入れ子: [グループを追加] → OR グループ → 条件を追加 …
  保存 → fieldValueRules（version 14）

[利用者: カレンダーを開く]
  → 条件に使うフィールドが fields に自動追加された状態でレコードを取得
[利用者: 予定をドラッグ]
  → 描画側の配線 → start 系関数の先頭 → getPermission(ev) を評価
      ルール 1（上から順）の when を再帰評価 → 一致 → permission=view
      → canEdit=false → 即 return（クリックは従来どおり）
  → 一致しなければ permissionRules → defaultPermission
[direct の PUT が 403]
  → 楽観更新を巻き戻し、「このレコードを編集する権限がありません。」
[viaEdit]
  → kintone 編集画面が保存時に ACL を評価（プラグインは関与しない）
```

## §7 非機能要件

- 後方互換: version 14 で旧形式を自動変換し、判定結果を変えない（FR-4、AC-9）。新機能は既定で従来互換（ルールが無ければ従来の判定）。
- パフォーマンス: ルール数 × 条件数の再帰評価のみ。描画時の色決定でも同じ評価を行うため、ルール 20 行 × 条件 10 件程度で体感差が出ないこと（評価結果をイベント単位でメモ化するかは builder 判断）。取得フィールドの追加により取得量が増える点に留意する。
- 保守性: 評価ロジックは 1 か所の関数に集約し、描画・DnD ガード・色決定から共通利用する。演算子表は定数テーブルとして設定画面と本体で共有できる形にする。
- 設定画面: 非選択パネルは hidden のみ（E-7）。入れ子ビルダーは収集・書き出しを再帰で実装し、DOM 構造に依存して取りこぼさない。
- プラグイン版のみが対象（`plugin/src/js/desktop.js`、`config.js`、`html/config.html`、`css`）。`src/` 版は対象外。
- 変更範囲が大きいため、設定画面（config.js）は puppeteer ハーネスで自動検証してから実機へ進める。

## §8 既知の制約

- 営業日条件は作れない。営業日を要する制限は Customine の保存前チェックに任せる【決定】。
- `viaEdit` の保存可否は kintone（レコード ACL・Customine）が決める。プラグインの canEdit は「ドラッグ操作を始めてよいか」の判定にとどまり、kintone 権限と一致する保証はない（プラグイン側で canEdit=true でも kintone 側で拒否され得る）。
- 日付の「今日」はブラウザの日付。画面を開いたまま日付が変わった場合、再読み込みまで評価が追従しない可能性がある（評価ごとに今日を取得する実装なら追従する。builder 判断）。
- サブテーブル内フィールド、ルックアップ、計算（CALC）フィールド、時刻のみ（TIME）フィールドは v1 では条件にできない。
- 色は行単位のまま。グループごとの色分けはできない【確定 U-4】。
- 入れ子の深さは無制限だが、動作保証・検証は 3 段まで。4 段以上は評価ロジックが再帰のため動く想定だが、UI 幅・可読性・性能は保証しない。
- ORGANIZATION_SELECT / GROUP_SELECT 条件は、所属を起動時に 1 回取得したキャッシュで評価する。起動後に所属が変わっても再読み込みまで反映されない。
- 設定変更後はカレンダーのハードリロードが必要（plugin 更新後共通）。

## §9 未解決事項・リスク・前提

### 確定した判断（石川さん・管理者、2026-10-21）

| ID | 内容 | 結論 |
|---|---|---|
| U-1 | 入れ子の深さ | 【決定】制限なし。動作保証（AC・テスト）は 3 段まで。深さによる保存拒否はしない |
| U-2 | 相対日付 | 【決定】採用 |
| U-3 | USER_SELECT／ORGANIZATION_SELECT／GROUP_SELECT 条件 | 【決定】3 型とも採用。所属の取得方法（User API を起動時 1 回）は【提案】、API 仕様・権限は【推測】で builder・T-E1 で裏取り。取得失敗は false＋警告 |
| U-4 | 色 | 【確定】行単位のまま |
| U-5 | 権限ガードの適用範囲 | 【決定】クリックで開く編集画面には適用しない（DnD のみ） |
| U-7 | 設定画面の保存時検証 | 【確定】保存を止める |
| U-8 | 旧形式の空値行の移行先 | 【決定】旧挙動を維持。builder が旧実装を確認して合わせる |
| U-9 | 未取得値 | 【確定】false＋警告 |

### 未解決事項

| ID | 内容 | 扱い |
|---|---|---|
| U-6 | 403 の判別方法（`kintone.api` の reject オブジェクトに HTTP ステータスが含まれるか） | DEV 654 で kintone 編集権限のないユーザーを用意して実際に失敗させる必要がある。**石川さん依頼事項**（権限なしテストユーザーの用意）。確認後に判別方法を確定（T-F1/F2）。判別できない場合は `code` の値で分岐する |
| U-10 | User API の仕様 | **2026-10-21 DEV 654 で実測（管理者ユーザー）**: `kintone.api(kintone.api.url('/v1/user/organizations', true), 'GET', {code})` は `.json` が補完され、レスポンスは `{organizationTitles:[{organization:{code,name}, title}]}`、groups は `{groups:[{code,name}]}`。組織コードは ORGANIZATION_SELECT の `value[].code` と同じ体系（例: システム管理チーム）。**一般ユーザー（非管理者）で自分の所属を取得できるかは未確認**（kintone の User API は本人分の取得を許可する仕様の想定。T-E1 で一般ユーザー確認が残る） |

### リスク・前提

- 前提: 本番 704 と開発 654 は同一プラグイン版。既定で従来互換（ルール未設定・旧形式は同じ判定）とし、本番への影響は version 14 移行の変換結果のみ（AC-9 で担保）。
- リスク: 旧設定の自動変換の誤りは本番の権限を変え得る。T-B1・T-D3 を必ず実施し、リリース前に本番 704 の現行設定をエクスポートして保全する（ロールバック基準）。
- リスク: 取得フィールドの自動追加の実装漏れで未取得値が発生すると、条件が false になりルールが効かない（制限が掛からない側に倒れる）。AC-5・T-D1 で確認し、警告ログで気付けるようにする。
- リスク: 設定画面の入れ子ビルダーは config.js への改修量が大きい。設定画面の自動検証（puppeteer）を先に整備してから実装する。
- 推測: `_drag` / イベント取得から対象 KcEvent を start 系関数内で参照できる（recordId からの State 検索を含む）。参照方法は builder が確認する。
- 推測: DATETIME のローカル日付変換は JST ブラウザ前提。他タイムゾーンは対象外。

## §10 参照

| ファイル | 参照箇所 |
|---|---|
| `plugin/src/js/desktop.js` | `KC.LoginContext.getPermission`（4480-4614）、valueFields/permissionFields 収集（1017-1070）、DnD start 系 8 関数（3360 ほか）、`_commitOptimistic`（2979）、`KC.Api.updateEvent`（1601-1652）と呼び出し側（3149-3176）、描画側の DnD 配線（4838-6547） |
| `plugin/src/js/config.js` | fieldValueRules の収集（2110-2141）、既定値（364-372）、マイグレーションチェーン、インポート／エクスポート |
| `plugin/src/html/config.html` | 権限・色分けタブ（41-42、268-378） |
| `requirements/REQ_edit-permission-extension.md` | FR-8（権限フィールド設定）、FR-9（優先順位）、§5.10 |
| `requirements/REQ_default-permission.md` | デフォルト権限（非一致時の挙動） |
| `requirements/REQ_dnd-enable-setting.md` | `DND_ENABLED` ガードの位置・方式（FR-5） |
| `requirements/REQ_dnd-save-hooks.md` | `viaEdit`／`direct` モード、`_commitOptimistic` の構成 |
| `claude-shared-rules/kintone-rules.md` | REST 更新は Customine を通らない、テスト方針 |
