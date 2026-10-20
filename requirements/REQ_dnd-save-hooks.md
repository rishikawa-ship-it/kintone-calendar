# REQ_dnd-save-hooks — カレンダー側の DnD 保存フック（移行要件 FR-2 の実装要件）

ステータス: 第3版（実装・レビュー反映・DEV 実機テスト全項目合格、2026-10-20）
作成日: 2026-10-20
担当: designer
親要件: `REQ_customine-to-plugin-migration.md` の FR-2（および FR-6/FR-7、D-1/D-5/D-7/D-8、§7 段 0.5、§8）

表記: 【事実】は出典付き（行番号は 2026-10-20 時点の `plugin/src/js/desktop.js` の目安）。【提案】【推測】は裏取り前の設計判断。【決定】は石川さんの指示（2026-10-20「別プラグインは最悪 Customine でも実装できるので、DnD（カレンダープラグインに組み込む部分）を優先的に着手する」）。

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 草案 第1版 | 2026-10-20 | 初版。DnD の確定方法 `dndSaveMode`（direct / viaEdit）、イベント契約（direct のみ）、未導入時挙動 `dndRequireListener`、既定 OFF／従来互換の方針を定義 |
| 草案 第2版 | 2026-10-20 | 管理者修正。viaEdit で開く URL を `show#record={id}&mode=edit` に訂正（`/edit?record=ID` は kintone の「レコード再利用」で新規作成画面になるため不可）。U-5 を解消、U-7 に drag.type の値を記載 |
| 第3版 | 2026-10-20 | 実装・レビュー反映。U-2/U-3/U-6/U-8 を確定。裸の `false` もブロック扱い、`kc:after-save-failed` 受信時は再読み込み完了後にバナーを出し直す、`Banner.hide()` は購読者ありのときだけ呼ぶ、月 chip の `'move-month-chip'` も移動扱い、に修正 |

## §1 背景・目的

### 背景

- DnD は REST PUT 直書きで kintone の保存イベントを通らず、Customine の保存直前・直後処理が走らない。704 では 2026-10-19 に `dndEnabled=false` で回避した【事実: REQ_dnd-enable-setting §1】。
- 別プラグイン（KC オートメーション）が購読する CustomEvent 契約をカレンダー側に置くと定めた【事実: 移行要件 FR-2】。別プラグインは最悪 Customine でも代替できるため、カレンダーに組み込む部分を優先する【決定】。
- プラグイン版は全アプリ共通コードで、plugin.zip を上げると本番 704 も同じコードになる【事実: メモリ plugin-dnd-enable-setting】。

### 目的

1. DnD の確定方法を設定（`fieldMapping.dndSaveMode`）で選べるようにする。
   - `direct`: 従来どおり REST PUT。ここにイベント契約（FR-4）を載せる。
   - `viaEdit`: REST では保存せず、新しい日付入りの編集ポップアップを開く。保存は kintone 標準の保存イベントを通るので Customine の保存直前・直後処理がそのまま走り、オートメーションが無くても整合性が保たれる。Wi-Fi アプリで DnD を再有効化する最短ルート【提案】。
2. 購読者がいないときの挙動を設定にする（`fieldMapping.dndRequireListener`）。
3. 新機能はすべて既定 OFF／従来互換とし、本番 704 の挙動を変えない。

範囲外: 別プラグイン本体、`detail.addRequest()` による bulkRequest 一括（移行要件 FR-6。U-5 未確認のため契約に含めない）、モバイル、`src/` 版、DnD 以外の保存経路。

## §2 現状分析

| # | 事実 | 出典 |
|---|---|---|
| E-1 | `_commitOptimistic(origEv, newStart, newEnd)` は先頭で `DND_ENABLED` を確認し、`origEv.start/end` を退避、State を楽観更新して再描画、重複チェック（モード A/B。失敗は fail-closed）、`KC.FieldLink.resolveForDnd`、`KC.Api.updateEvent` の順に進む。呼び出しは 3 か所（3026/3571/4027 付近）で、いずれも移動・リサイズ共用 | desktop.js:2704-2855 |
| E-2 | PUT 成功後は `currentEv.rev` を更新し、`KC.Workflow.notifyRecordSave('recordUpdate', id)` を fire-and-forget で呼ぶ。失敗は `alert` ＋ `KC.Render.refresh()` | desktop.js:2834-2854 |
| E-3 | `updateEvent` は DATE 型のとき start を日付 10 桁、end を「1 日戻した日付」で書く。DATETIME は ISO のまま。`revision: ev.rev` を付けて PUT。なお DnD で終日フラグは変わらない（`allday: false` 固定、2812-2818 付近） | desktop.js:1561-1617 |
| E-5 | `KC.Banner.show(message, {hideReload})` / `hide()` が存在する。シングルトンで `#kc-root` 先頭に表示 | desktop.js:7446-7514 |
| E-6 | `KC.Popup.openCreate` は `sessionStorage` に `KC_CREATE_CONTEXT` / `KC_FIELD_CONFIG` / `KC_START_FIELD_TYPE` / `KC_ALLDAY_LABEL` / `KC_MAIL_LOGIN_USER_DEFAULT` を書いてから `/k/{appId}/edit` を iframe で開く。`_mode='create'` | desktop.js:2458-2489 |
| E-7 | iframe 側は `app.record.create.show` で `KC_CREATE_CONTEXT` を読み、**即 `removeItem`**（1 回使ったら消す）。保存済み `KC_FIELD_CONFIG` を優先して `record[F.start].value` 等へ値をセットし `return event` | desktop.js:12162-12245 |
| E-8 | `KC.Popup.openEdit(recordId)` は **詳細画面** `/k/{appId}/show#record={id}` を開く。編集画面を直接開く経路は無い。先頭で `+N more` を閉じ、URL ハッシュ `record` を push、`_mode='edit'` | desktop.js:2496-2522 |
| E-9 | iframe は `dataset.kcModal='1'`。許可 URL は `/k/{appId}/edit`（query/hash 任意）を含み、`/edit?record=ID` も許可されるが、これは kintone の「レコード再利用」URL（新規作成）なので viaEdit には使わない。iframe 内キャンセルボタンは `_attachCancelHandler` で検知しモーダルを閉じる | desktop.js:2059-2076、1748-1790、2192 |
| E-10 | 保存ガード（改訂1）: 保存クリックで `_savePending`、90 秒上限。`_show()` は保存中なら案内のみで return。成功検知は URL が詳細画面へ遷移したとき。成功後もモーダルは自動で閉じず、閉じるときに `KC.Render.refresh()` | REQ_popup-behavior-fix 改訂1、desktop.js:1965,2156-2161,2448 |
| E-11 | Customine の保存直前チェックは iframe 内でも動く。失敗は input-error のみで、保存ガードが検知する | REQ_popup-behavior-fix 改訂1、メモリ plugin-popup-save-guard |
| E-12 | `dndEnabled` の流儀: `KC.Config.DND_ENABLED = !(fm.dndEnabled === false)`（341 行、既定 true は 407 行）。設定画面は `#kc-dnd-enabled`（config.html:162）。保存時・エクスポート時に `fieldMapping` へマージ（config.js:6310-6313、6543-6546）、インポート時に再反映（6832-6834）、読み込み時に反映（7140）、マイグレーション末尾で boolean でなければ補完（5482-5485）。`version` は 13 のまま | desktop.js、config.js、REQ_dnd-enable-setting FR-1〜4 |
| E-13 | 開発環境: 貸出管理 654／サブテーブル 832／台帳 652／Slack 通知用 307。654 の Customine は通知先に本番 ITサポート ch が直書きのため、通知が出る操作を DEV で行わない。plugin.zip は手動アップロード＋ハードリロード | メモリ dev-env-wifi-setup、plugin-js-cache-hardrefresh |

## §3 機能要件

### FR-1 設定項目

| キー（`fieldMapping`） | 型・値 | 既定 | 判定・読み込み |
|---|---|---|---|
| `dndSaveMode` | `'direct'` / `'viaEdit'` | `'direct'` | `KC.Config.DND_SAVE_MODE = (fm.dndSaveMode === 'viaEdit') ? 'viaEdit' : 'direct'`。キー欠落・未知値・null は `direct` |
| `dndRequireListener` | boolean | false | `KC.Config.DND_REQUIRE_LISTENER = (fm.dndRequireListener === true)`。`direct` のときだけ参照 |

- `version` は 13 のまま。新規マイグレーション段は作らず、チェーン末尾で `dndSaveMode` が文字列でなければ `'direct'`、`dndRequireListener` が boolean でなければ false を補う（E-12 と同方式）。
- `dndEnabled=false` のときは `dndSaveMode` / `dndRequireListener` を参照しない（DnD 自体が起きない）。

### FR-2 設定画面

- 基本設定タブの「カレンダー上のドラッグで予定の移動・期間変更を許可する」（`#kc-dnd-enabled`）の直下に追加する。
  - ラジオ `name="dndSaveMode"`（`#kc-dnd-save-mode-direct` / `#kc-dnd-save-mode-viaEdit`）。ラベル「変更を直接保存する（従来どおり）」「編集画面を開いて保存する（保存前チェック・保存後処理を通す）」。ヒント文で `viaEdit` は保存ボタンを 1 回押す手間が増えることを明記する。
  - チェックボックス `#kc-dnd-require-listener`「保存前チェックを行う拡張が見つからないときは保存を止める」。`direct` 選択時のみ有効。
- `#kc-dnd-enabled` が OFF のとき、上記ラジオ・チェックボックスを `disabled`（グレー表示）にする。値は保持し、保存・エクスポートでは DOM の `checked` を読む（disabled でも `checked` は読める）。`viaEdit` 選択時は `#kc-dnd-require-listener` を `disabled` にする。
- 保存・エクスポート・インポート・初期表示は `dndEnabled` と同じ流儀（E-12）。インポート時は部分キーのみの JSON も受け付ける（NFR-3 維持）。

### FR-3 `viaEdit`: 編集ポップアップを初期値付きで開く【今回の目玉】

1. `_commitOptimistic` の先頭（`DND_ENABLED` 二重防御の直後、**State の楽観更新より前**）で `DND_SAVE_MODE === 'viaEdit'` なら、`KC.Popup.openEdit(recordId, { editContext })` を呼んで return する。REST は呼ばない。
2. 呼び出し元から `source`（`'dnd'`＝移動、`'resize'`＝リサイズ）を受け取る。呼び出し 3 か所は移動・リサイズ共用のため、`_drag.type` から導出して `_commitOptimistic` に引数追加する。`_drag.type` は `'move'` / `'move-allday'` / `'move-month-chip'` が移動、`'resize-left'` / `'resize-right'` / `'resize-top'` / `'resize-bottom'` / `'resize-left-timed-span'` / `'resize-right-timed-span'` がリサイズ【事実: desktop.js 2900-2904, 3426-3428】。
3. `KC.Popup.openEdit(recordId, opts)` は `opts.editContext` があるとき、`sessionStorage` に次を書く。キー名と値の流儀は E-6 に揃える。
   - `KC_EDIT_CONTEXT` = JSON `{ v:1, appId, recordId, source, start, end, allday, createdAt }`（start/end は新しい日時。形式は KcEvent と同じ ISO 8601。DATE 型への変換は FR-3-6）
   - `KC_FIELD_CONFIG` / `KC_START_FIELD_TYPE` / `KC_ALLDAY_LABEL`（E-6 と同じ値。iframe 側の検出未完了の補完）
   - 開く URL は編集モードの詳細画面 `/k/{appId}/show#record={id}&mode=edit`（許可 URL に該当、E-9。保存成功は `show#record={id}` への遷移として既存の `_isSaveSuccessUrl` が検知する、E-10）。**`/k/{appId}/edit?record={id}` は使わない**（kintone の「レコード再利用」URL で、新規レコード作成画面が開く）。`_mode='edit'`。URL ハッシュ `record` の push は従来どおり。
4. 保存中（`KC.Popup._isSaving()`）は書き込みも開きもしない。`_show` のガードで案内のみ表示される（E-10）。**sessionStorage に残骸を作らない**よう、書き込み前に判定する。
5. iframe 側（`app.record.edit.show`。新規ハンドラ）:
   - `window.frameElement.dataset.kcModal === '1'`（カレンダーのモーダル内）のときだけ適用する。標準画面での直接編集には適用しない。
   - `KC_EDIT_CONTEXT` を読み、**適用有無にかかわらず `removeItem`** する（1 回使ったら消す。E-7 踏襲）。
   - `ctx.appId` と `event.appId`、`ctx.recordId` と `event.recordId` が一致し、`createdAt` から 60 秒以内（案）のときだけ適用する。不一致・期限切れは何もしない。
   - 適用内容: `record[F.start].value` / `record[F.end].value` に新しい値をセットし、`return event`（`event.record` の書き換え。`kintone.app.record.set` でも可。builder 判断）。DnD は終日フラグを変えない（E-3）ため `allday` フィールドには触れない。
6. 値の形式（E-3 と同じ規則）: DATE 型は start を日付 10 桁、end を「ISO の end を 1 日戻した日付」。DATETIME 型は ISO のまま。変換は `updateEvent` の規則を共通ヘルパーに切り出して共有する【提案】。
7. ゴーストは編集画面を開いた時点で元に戻す。State は更新しない（楽観更新しない）。ゴースト・薄表示クラスの除去と `KC.Render.renderGrid()` を行う。除去が mouseup 側で既に済んでいるか（`kc-dnd-active` 等）は未確認【推測】、builder が確認する。
8. 保存、キャンセル、閉じる、保存ガードは既存挙動のまま。キャンセルまたは閉じたら何も変わらない。保存成功後、モーダルを閉じたときの `KC.Render.refresh()` でカレンダーに反映される（E-10）。
9. `viaEdit` では、カレンダー側の重複チェック（モード A/B）、`KC.FieldLink.resolveForDnd`、`kc:*` イベントを実行・発火しない。保存時の検証は kintone の保存イベント（Customine 等）に任せる【提案。U-8 参照】。

### FR-4 `direct`: イベント契約

`direct` のときだけ発火する。dispatch 先は `document`、`CustomEvent`、`bubbles` 不要、`cancelable` 不要。イベント名・detail の形・発火タイミングはコードのコメントにも固定する（移行要件 FR-2-4）。

| イベント | 発火タイミング | 購読者の返し方 |
|---|---|---|
| `kc:before-save` | 楽観更新・重複チェックの後、`resolveForDnd` と PUT の前（移行要件 FR-2-1。重複チェックが無効なときは楽観更新の直後） | `detail.waitUntil(promise)` を**ハンドラ内で同期的に**呼ぶ |
| `kc:after-save` | PUT 成功後（`currentEv.rev` 更新後）。`KC.Workflow.notifyRecordSave` は従来どおり維持 | 返り値なし。fire-and-forget（カレンダーは待たない） |
| `kc:after-save-failed` | 購読者（別プラグイン）が保存後処理の失敗を知らせるために dispatch する逆方向イベント。カレンダーが購読する | カレンダーが `KC.Banner.show` で表示 |

#### detail の形（契約。値の型は固定）

| プロパティ | before-save | after-save | after-save-failed（購読者が送る） | 内容 |
|---|---|---|---|---|
| `appId` | ○ | ○ | ○ | 文字列 |
| `recordId` | ○ | ○ | ○ | 文字列 |
| `source` | ○ | ○ | ○ | `'dnd'`（移動）または `'resize'` |
| `op` | ○ | ○ | ○ | `'update'` 固定 |
| `before` | ○ | ○ | 任意 | `{ start, end, allday }`。変更前（KcEvent と同じ ISO 8601。`allday` は boolean） |
| `after` | ○ | ○ | 任意 | `{ start, end, allday }`。変更後 |
| `record` | ○ | ○ | - | PUT 前の KcEvent のコピー（楽観更新前に取る。kintone レコード形式ではない。必要なら購読者が GET する）【提案】 |
| `revision` | PUT 前の rev | PUT 成功後の rev | - | 文字列 |
| `waitUntil(promise)` | ○ | - | - | 複数回呼べる |
| `message` | - | - | ○ | バナー表示文言（必須） |
| `cause` | - | - | 任意 | 原因の文字列（ログ用。バナーには出さない） |

#### `kc:before-save` の判定（fail-closed）
| 購読者の結果 | カレンダーの動作 |
|---|---|
| 全 promise が resolve し、値が `undefined`／`null`／`true`／`{ok:true}`（`ok` が false でないオブジェクト） | 続行（`resolveForDnd` → PUT） |
| いずれかが `{ok:false, message}` または裸の `false` を返す | ブロック。`message` を採用（複数ある場合は先頭。`false` は既定文言） |
| いずれかが reject | ブロック。文言は「保存前チェックでエラーが発生しました。再度操作してください。」 |
| 全体が 10 秒以内に完了しない（案） | ブロック。文言は「保存前チェックがタイムアウトしました。再度操作してください。」 |

- ブロック時は既存の重複ブロックと同じ巻き戻し: `currentEv.start/end` を退避値へ戻し、`renderGrid()`、`KC.Banner.show(文言)`、PUT しない。
- バナー: `waitUntil` を登録した購読者が 1 件以上あるときだけ、待機前に `KC.Banner.hide()`。購読者なしの従来経路には差分を出さない（FR-7）。`message` が空なら「保存前チェックでブロックされました。」

### FR-5 未導入時の挙動（`dndRequireListener`）

- `kc:before-save` の dispatch 後、`waitUntil` が 1 件も登録されなかった場合を「購読者なし」とする（移行要件 FR-2-5）。
- `dndRequireListener=false`（既定）: そのまま保存する【決定 D-8】。
- `dndRequireListener=true`: ブロック。巻き戻し＋バナー「保存前チェックを行う拡張が見つかりません」。
- 購読者はいるが `waitUntil` を呼ばなかった場合も「購読者なし」扱い。`kc:after-save` は購読者の有無にかかわらず発火する。

### FR-6 `kc:after-save-failed` の受信

- カレンダーは起動時（`dndEnabled=true` のときのみ）に 1 回だけ `document` へリスナーを登録する。受信したら `KC.Banner.show('保存後処理に失敗しました: ' + message)` を表示し、`KC.Render._refreshImmediate()` で実状態へ再読み込みしたあと、バナーを出し直す（各ビューの refresh が `Banner.hide()` を呼ぶため）。
- 主レコードは PUT 済みで、巻き戻しは行わない。D-5（DnD は主 PUT と後処理を bulkRequest で一括し全巻き戻し）は、別プラグインが `detail.addRequest()` を使う段階で改めて要件化する（U-5 未確認のため本書の対象外）。
- `message` が文字列でないイベントは無視し、`console.warn` に残す。

### FR-7 既定 OFF／従来互換（共通コードの制約）

| 設定の組み合わせ | 動作 |
|---|---|
| `dndEnabled=false`（本番 704 の現状） | 何も起きない。新機能は一切動かない（FR-1 の参照もしない） |
| `dndEnabled=true` かつ `dndSaveMode` 欠落／`direct` かつ購読者なし かつ `dndRequireListener` 欠落／false | 従来どおり。差は `kc:before-save` / `kc:after-save` が dispatch されるだけ（購読者がいなければ副作用なし） |
| `dndEnabled=true` かつ `viaEdit` | FR-3 |
| `dndEnabled=true` かつ `direct` かつ `dndRequireListener=true` | FR-5 |

- 本番 704 の設定は変更しない（plugin.zip を上げても挙動不変）。`dndEnabled=ON`・`viaEdit` にするのは開発環境 654 だけ【決定 D-7】。

## §4 受け入れ基準（Given/When/Then）

| ID | 内容 |
|---|---|
| AC-1 | Given: `dndSaveMode`／`dndRequireListener` キーが無い保存済み設定 When: カレンダー・設定画面を開く Then: `direct`／false 扱い。ラジオは `direct` が選択、チェックは OFF |
| AC-2 | Given: `dndEnabled=false` When: 設定画面を開く Then: `dndSaveMode` のラジオと `dndRequireListener` が disabled。ON に戻すと有効化され、値は保持されている |
| AC-3 | Given: `viaEdit` When: 予定を DnD で移動する Then: REST PUT は発生せず（Network に PUT なし）、編集ポップアップ（`/k/{appId}/show#record={id}&mode=edit`）が開き、開始・終了に移動後の値が入っている。カレンダー上のゴーストは消え、予定は元の位置のまま |
| AC-4 | Given: `viaEdit` When: リサイズ（終日の左右端、時間予定の上下端、月の時間スパン端）を確定する Then: AC-3 と同じ。時間予定のリサイズも同経路 |
| AC-5 | Given: AC-3 の編集画面 When: 保存する Then: Customine の保存直前チェックが走る。超過なら input-error でブロックされ、保存ガードが解除される（モーダルは維持）。成功なら保存直後処理が走り、詳細画面へ遷移する |
| AC-6 | Given: AC-3 の編集画面 When: ×・ESC・backdrop・キャンセルで閉じる Then: レコードは不変で、カレンダーは元のまま。`KC_EDIT_CONTEXT` は残っていない |
| AC-7 | Given: `KC_EDIT_CONTEXT` が残っている（recordId 不一致、または 60 秒超過） When: 別レコードの編集画面を開く／標準画面で直接編集する Then: 値は適用されず、キーは削除される |
| AC-8 | Given: 保存処理中のポップアップがある When: DnD する Then: 新たに開かず保存中案内のみ表示され、`KC_EDIT_CONTEXT` は書かれない |
| AC-9 | Given: `viaEdit` When: DnD する Then: `kc:before-save`／`kc:after-save`／`kc:after-save-failed` はいずれも発火しない。カレンダー側の重複チェックも走らない |
| AC-10 | Given: `direct`、購読者なし、`dndRequireListener=false` When: DnD する Then: 従来どおり PUT され、成功後に再描画される。バナーは出ない |
| AC-11 | Given: `direct`、購読者が `waitUntil(Promise.resolve({ok:true}))` を登録 When: DnD する Then: PUT される。`kc:after-save` が 1 回発火し、detail が §3 FR-4 の表どおり |
| AC-12 | Given: `direct`、購読者が `{ok:false, message:'X'}` を返す When: DnD する Then: PUT されず、予定が元の位置に戻り、バナーに「X」が出る |
| AC-13 | Given: `direct`、購読者が reject する／10 秒超えて解決しない When: DnD する Then: 同様にブロックされ、FR-4 の既定文言のバナーが出る |
| AC-14 | Given: `direct`、購読者なし、`dndRequireListener=true` When: DnD する Then: PUT されず巻き戻り、バナー「保存前チェックを行う拡張が見つかりません」 |
| AC-15 | Given: 購読者が `kc:after-save-failed`（message あり）を dispatch When: 受信する Then: バナー「保存後処理に失敗しました: …」が出て、カレンダーが再読み込みされる |
| AC-16 | Given: `dndEnabled=false`（本番 704 相当） When: 全操作 Then: 従来どおり DnD は始まらず、クリックで編集ポップアップが開く。イベントは発火しない |
| AC-17 | Given: 設定をエクスポート When: 別設定へインポートする Then: `dndSaveMode`／`dndRequireListener` が復元される。部分キーのみの JSON も取り込める |

## §5 検証項目・テストシナリオ

前提: 開発環境 654／832／652（段 0.5 整備済み）。654 に plugin.zip を手動アップロードし、ハードリロード、前面タブで実施する【事実: E-13】。654 の予約テストデータは段 1 で作成する（現状 0 件）。**Customine の DEV 登録分は通知先が本番チャンネル直書きのため、通知が出る操作（貸出予定の保存で台数・期間が変わる操作）を行う前に、DEV の通知系ページを無効化する。** 無効化しない場合は、通知が出ない操作（台数・開始・終了が変わらない保存）に限る【事実: メモリ dev-env-wifi-setup】。

| ID | シナリオ | 期待 | 対応 AC |
|---|---|---|---|
| T1 | 654 を `dndEnabled=ON`・`viaEdit` にする。予約を 1 件作り、月ビューで終日バーを別日へ DnD | 編集ポップアップに新日付。PUT なし。バー位置は元のまま | AC-3 |
| T2 | T1 で保存（残数に余裕がある期間） | Customine の台数チェック（ページ 8）が走り成功。ページ 10 で 832 の行の期間が追随。詳細画面へ遷移し、閉じるとカレンダーが新日付 | AC-5 |
| T3 | T1 で、残数を超える期間へ DnD して保存 | 「貸与可能台数を超えています…」でブロック。保存ガードが解除される。レコード不変 | AC-5 |
| T4 | 週・日ビューの時間予定を DnD、上下端をリサイズ。月の chip・時間スパン端も | すべて編集ポップアップが開き値が入る | AC-3, AC-4 |
| T5 | T1 の編集画面を ×／ESC／backdrop／キャンセルで閉じる | レコード不変。DevTools で `sessionStorage` に `KC_EDIT_CONTEXT` なし | AC-6 |
| T6 | `KC_EDIT_CONTEXT` を手動セット（別 recordId／古い createdAt）して別レコードの編集画面を開く。保存処理中に別予定を DnD | 値は入らずキー削除。保存中は開かず案内のみ・残骸なし | AC-7, AC-8 |
| T7 | `direct`・購読者なし・require=false で DnD | 従来どおり PUT。バナーなし | AC-10 |
| T8 | `direct` で、コンソールから `document.addEventListener('kc:before-save', e => e.detail.waitUntil(Promise.resolve({ok:true})))` を登録して DnD | PUT。`kc:after-save` を別リスナーで受け、detail の型を確認 | AC-11 |
| T9 | T8 のリスナーを `{ok:false,message:'X'}`／`Promise.reject()`／`new Promise(()=>{})`（10 秒）に替えて DnD | ブロック・巻き戻し・文言どおり | AC-12, AC-13 |
| T10 | `direct`・購読者なし・require=true で DnD | ブロックとバナー | AC-14 |
| T11 | `document.dispatchEvent(new CustomEvent('kc:after-save-failed',{detail:{message:'Y'}}))` | バナー「保存後処理に失敗しました: Y」と再読み込み | AC-15 |
| T12 | `dndEnabled=false` の設定（704 の設定控えと同じ）で全操作 | 従来どおり | AC-16 |
| T13 | 設定画面（puppeteer ハーネス、メモリ config-screen-puppeteer-harness）で、保存・エクスポート・インポートの往復、`dndEnabled` 連動 disabled | 値が保持される | AC-1, AC-2, AC-17 |
| T14 | 654 に Customine ページ 15 相当（前営業日の無効化）が有効な状態で、`viaEdit` の編集画面を開く | 値の適用と保存の可否を確認（U-4） | U-4 |


### §5.1 実機テスト結果（2026-10-20、開発環境 654、plugin.zip 278,331 バイト）

テストレコード: 654 レコード 722「DnDテスト viaEdit」（申請番号 PRO-TEST901、11/10〜11/12、832 行 id 5 デバイス 90）。本番 704 の設定は未変更。654 に kintone Webhook は無いため REST 操作は Customine を起動しない。

| ID | 結果 | 備考 |
|---|---|---|
| T1 | 合格 | 月ビュー終日バーを 1 週下へドラッグ → `show#record=722&mode=edit` の iframe が開き、開始 11/17・終了 11/19 が入力済み。PUT なし。`kc:*` 発火なし。`KC_EDIT_CONTEXT` は削除済み。Customine の edit.show（残数表示）は新日付で再計算された（832 への GET が 11/17〜19 で発行。U-4 は懸念なし） |
| T2 | 合格 | （Customine DEV 側を整備後に実施）viaEdit で 11/10〜12 → 11/17〜19 へ移動し、ポップアップで保存。Customine 保存直前チェック通過、保存成功で iframe が詳細画面へ遷移（保存ガード成功検知）、ページ 10 の転記で 832 行 id5 も 11/17〜19 に追随。通知は 307 に 1 件（使用者向け「予約変更を承りました」、通知先は使用者=石川さん自身の ch）。IT サポート向け通知は条件非該当で発生せず。× で閉じると KC.Render.refresh でバーが 11/17 行へ移動 |
| T3 | 合格 | 希望台数を REST で 99 にして 11/24〜26 へ移動 → ポップアップ表示時点で Customine が超過表示。保存を押すと input-error「貸与可能台数を超えています…」でブロック、iframe は編集モードのまま、レコード不変（rev 8）、保存ガード（`kc-modal-close--saving`・保存中案内）は解除済み |
| T4 | 合格 | 右端リサイズ → 開始 11/10 のまま終了 11/14 で編集画面が開く。週・日ビューの時間予定は本アプリが DATE 型のため対象外 |
| T5 | 合格 | ×・キャンセルの両方でモーダルが閉じ、レコード不変（rev 変わらず）、残骸なし |
| T6 | 合格（条件付き） | 詳細画面 → 編集ボタンで recordId 不一致の `KC_EDIT_CONTEXT` を置いた場合、値は適用されずキー削除。**観察**: `show#record=N&mode=edit` を直接リロードしたケースではキーが残った（値は不適用）。Customine のエラーがハンドラ連鎖に影響した可能性。実害は小さい（キーは openEdit が直前に書き直す） |
| T7 | 合格 | direct・購読者なし → PUT 1 回、rev 1→2。`kc:before-save`（rev 1）と `kc:after-save`（rev 2）が source 'dnd'、after の ISO 値つきで発火。バナーなし |
| T9 | 合格 | `{ok:true}` → PUT、after-save 発火（rev 3→4） |
| T10 | 合格 | `{ok:false,message:'X'}` → バナー「X」。reject → 「保存前チェックでエラーが発生しました。再度操作してください。」。10 秒ハング → 約 10 秒後に「保存前チェックがタイムアウトしました。再度操作してください。」、バーが元位置へ巻き戻り。裸の `false` → 「保存前チェックでブロックされました。」。いずれも PUT なし |
| T11 | 合格 | `dndRequireListener=true`・購読者なし → PUT なし、バナー「保存前チェックを行う拡張が見つかりません」 |
| T12 | 合格 | `kc:after-save-failed`（message 'Y'）→ バナー「保存後処理に失敗しました: Y」が表示され、654 の records GET（再読み込み）が発行 |
| T13 | 合格 | 本番 704（dndEnabled=false）は `#kc-root.kc-dnd-disabled` のまま、140 バー描画正常 |
| T14 | 合格 | 設定画面: dndEnabled OFF 時はラジオ・CB が disabled、ON で有効化、viaEdit 選択で CB が disabled。保存後の getConfig で version 13・値が保持。builder の puppeteer 19 件も通過 |
| T15 | 合格 | ページ 15（前営業日編集禁止、Claude（2026-10-20）版）が有効な状態で T2/T3 を実施。viaEdit の値適用後に保存まで通り、ブロックも機能 |

テスト後の状態: 654 の設定は dndEnabled=ON・viaEdit・require=false。レコード 722 は 11/17〜11/19・希望台数 1（rev 9）、832 行 id5 も 11/17〜19 で残置。

#### Customine DEV 側の整備（2026-10-20、T2/T3 の前提）

- 原因: 「kintone アプリ ID を取得できません」は、ページ 15 のアクション 232/321 が参照する「カレンダーマスタ、営業日、祝日管理」（本番 219）に開発環境アプリが無いため（Deploit は 1 アプリ 1 環境で、219 を DEV に紐付け不可）。サブテーブル（開発 832／本番 831）は対応済みで問題なし。
- 対処（石川さん決定）: ページ 15 を複製して Claude（2026-10-20）版を作り、取得元アプリを「アプリIDで直接指定」開発=219／本番=219 に変更（本番の挙動は同一）。アプリ変更で検索条件が消えるため条件ビルダーで `(日付 <= "${KC_start}") and (営業日フラグ = 1) order by 日付 desc` を再構築。
- 通知先（石川さん決定「環境で異なる値を送れる仕組みを使う」）: 「gusuku環境に応じた値を設定する」アクション（開発=テスト ch C01ST2Q7JDR／本番=C0B93CJHE3Z、条件: 追加画面・編集画面を表示した時）をページ 15 版（591）とページ 9 版（657）に追加し、通知の「レコードを追加する」マッピングの通知先を `= $591` / `= $657` に変更（対象: 旧 209/225 → 569/585、旧 477/488 → 640/651）。
- 旧ページ 9・15 は【アーカイブ】…【Claude経由 2026-10-20】に改名して無効化、末尾へ移動。現在 1〜16 有効、17〜26 無効。
- **開発環境 654 のみ登録。本番 704 は未登録**（次回の本番登録でこの版が反映される。挙動は同一の想定だが、登録前に石川さんの確認を要する）。
- 追記（同日、石川さん指示）: ページ 10（延長ボタン）・11（デバイス手動変更）・14（コメント管理者へ）も同方式で環境別化。新ページ「📤️延長ボタン Claude（2026-10-20）」（環境値 767、通知 725/736/746/761）、「📤️デバイス手動変更 Claude（2026-10-20）」（703、通知 696）、「📤️コメント（管理者へ） Claude（2026-10-20）」（668、通知 663）。環境値アクションの条件は「追加画面・編集画面・詳細画面のいずれかを表示した時」。旧ページは【アーカイブ】…【Claude経由 2026-10-20】で無効化し末尾へ。現在 1〜16 有効、17〜29 無効。開発環境 654 に再登録済み（本番 704 は未登録）。これで有効ページの通知先直書きは解消。

## §6 想定 UX / シーケンス

```
[viaEdit] ドロップ → _commitOptimistic が viaEdit 分岐 → ゴースト除去（State 不変）
  → KC.Popup.openEdit(id,{editContext}) → sessionStorage に KC_EDIT_CONTEXT
  → iframe /k/{appId}/show#record={id}&mode=edit → app.record.edit.show で開始・終了をセット → removeItem
  → 利用者が「保存」→ Customine 保存直前（ブロック時 input-error）→ 保存 → 保存直後 → 詳細へ遷移
  → モーダルを閉じる → KC.Render.refresh()（閉じる/キャンセルだけなら何も変わらない）
[direct] ドロップ → 楽観更新 → 重複チェック（既存）→ dispatch kc:before-save
  → 購読者なし: require=false 続行／true 巻き戻し。ブロック・reject・10 秒超過は巻き戻し＋バナー
  → FieldLink 解決 → PUT → 成功: rev 更新 → dispatch kc:after-save（待たない）
  → 購読者が失敗を検知 → dispatch kc:after-save-failed → バナー＋再読み込み
```

## §7 非機能要件

- NFR-1 後方互換: `version` 13 を維持。新キーは追加のみ。キー欠落・未知値は従来動作（FR-7）。
- NFR-2 性能: `viaEdit` は `_commitOptimistic` 先頭で分岐するだけ。`direct` で購読者なしの追加コストは dispatch 1 回。
- NFR-3 契約の固定: イベント名・detail・タイミングをコメントに固定し、別プラグインと独立してバージョンを上げられるようにする（移行要件 FR-2-4）。契約の破壊的変更時は `detail.contractVersion` を加える（現行は 1。追加は後方互換）【提案】。
- NFR-4 保守性: 判定は `KC.Config.DND_SAVE_MODE` / `DND_REQUIRE_LISTENER` の参照に集約。DATE 変換は `updateEvent` と共有ヘルパーにして二重実装を避ける。
- NFR-5 安全性: `sessionStorage` の値は読んだら必ず消す。検証（appId・recordId・期限）に通らなければ適用しない。値はレコード ID と日付のみで、レコード内容は含めない。
- NFR-6 配布: plugin.zip 更新後はハードリロード必須（検証手順に含める）。
- NFR-7 対象は `plugin/src/` の `desktop.js`・`config.js`・`config.html`（必要なら `desktop.css`）。`src/` 版は対象外。

## §8 既知の制約

- `viaEdit` は 1 回のドラッグにつき保存ボタンを 1 回押す手間が増える。時間予定のリサイズも同じ経路。
- 保存成功後、モーダルを閉じるまでカレンダーに反映されない（自動では閉じない【事実: E-10】）。
- `viaEdit` では、カレンダー側の重複チェック（モード A/B）は開く前に走らない。保存時の検証に委ねる。
- 保存ガードは最長 90 秒。それを超える処理や iframe 外のタブ閉じは防げない【事実: 改訂1】。
- 設定変更は開いているカレンダーのリロードまで反映されない。モバイル非対応は従来どおり。
- `direct` の `kc:before-save` は TOCTOU を防げない。PUT は revision 付きで 409 に任せる（E-3）。ブラウザ実行の限界は移行要件 §8 と同じ。

## §9 未解決事項・リスク・前提

### 未解決事項

| ID | 内容 | 扱い |
|---|---|---|
| U-1 | `viaEdit` で編集画面を開いている間に別ユーザーが更新した場合。kintone の編集画面は保存時に競合エラー（revision 不一致）を出すと想定するが、本プラグインでは検証していない【推測】 | kintone の標準競合エラーに任せる案で進める。T2 の後に別ユーザー更新を挟んで実機確認する |
| U-2 | （確定）`kc:before-save` のタイムアウトは固定 10 秒（`DND_BEFORE_SAVE_TIMEOUT_MS`）。Customine の保存直前は実測 9〜13 秒の例があるため、別プラグインの購読者が重い場合は設定化を再検討する | 第3版で確定 |
| U-3 | （確定）ブロック・タイムアウト・reject・`after-save-failed` 受信は `console.warn`、それ以外は既存 `_log`（`KC_DEBUG` 時のみ） | 第3版で確定 |
| U-4 | （実機で懸念なし。T1 で残数が新日付で再計算された）Customine ページ 15（前営業日は KC_start/KC_end を無効化）が有効な編集画面で、プログラムから日付を入れた場合に保存まで通るか。また Customine の edit.show（残数表示）と本ハンドラの実行順が不定で、残数の計算が適用前の日付で行われる可能性【推測】。保存直前チェックは走るため整合性は保たれる見込み | T14 で実機確認。結果次第で再計算の誘発（値セット後の change 相当）を検討 |
| U-5 | （解消）編集画面は `show#record=ID&mode=edit` で開く。キャンセルは kintone が同一ページ内で `show#record=ID` へ戻すため履歴の懸念はない。T5 で念のため確認する | 第2版で解消 |
| U-6 | （確定）`viaEdit` では FieldLink / Workflow を走らせない | 第3版で確定 |
| U-7 | （解消）`_drag.type` を使う。値は FR-3-2 に記載 | 第2版で解消 |
| U-8 | （確定）`viaEdit` では重複チェックを走らせない（FR-3-9） | 第3版で確定 |
| U-9 | `direct` で `kc:before-save` を待つ最大 10 秒の間、同じ予定を再度ドラッグできる。巻き戻しは退避値へ戻すだけなので 2 回目の結果を上書きしうる（レビュー指摘） | T10 の 10 秒ケースで観察。問題があれば待機中は DnD を抑止する |

### リスク

| リスク | 対策 |
|---|---|
| 共通コードのため本番 704 に影響する | FR-7。704 は `dndEnabled=false` のまま。plugin.zip 更新後の 704 で T12 を確認 |
| `KC_EDIT_CONTEXT` の残骸で別レコードに誤適用 | recordId・appId・期限の照合＋適用有無にかかわらず削除（AC-7、AC-8） |
| DEV の Customine が本番 Slack チャンネルへ通知する | §5 前提どおり通知系を無効化、または通知の出ない操作に限定 |
| 契約が別プラグインと食い違う | NFR-3 でコメント固定。detail の型は FR-4 の表を正とする |

### 前提

- Wi-Fi アプリの DnD 再有効化は移行要件 D-2 により第 2 段のゲートまで維持される。`viaEdit` が実機合格した場合にゲートの代替とするかは石川さん判断（本書では決めない）。
- 実装は管理者経由で builder へ。`viaEdit` は別プラグインが無くても単独で成立する。

## §10 参照

- `requirements/`: `REQ_customine-to-plugin-migration.md`（FR-2/6/7、D-1/5/7/8、§7 段 0.5、§8）、`REQ_dnd-enable-setting.md`、`REQ_dnd-overlap-block.md`、`REQ_popup-behavior-fix.md`（改訂1）
- `plugin/src/js/desktop.js`（行番号は §2）、`plugin/src/js/config.js`、`plugin/src/html/config.html`（行番号は E-12）
- メモリ: dev-env-wifi-setup / plugin-popup-save-guard / plugin-dnd-enable-setting / plugin-js-cache-hardrefresh / config-screen-puppeteer-harness
