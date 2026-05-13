# 要件定義書: 軽量化 Phase 1

**文書番号**: REQ_perf-phase1
**作成日**: 2026-05-13
**作成者**: designer (サブエージェント)
**ステータス**: 確定版

---

## 1. フィルタ切替で API 再呼出をスキップ

### 1.1 背景・現状

`KC.FilterDropdown._saveAndRefresh`（`src/kc-calendar.js:4166`）は、フィルタ値を保存した後に `KC.Render.refresh()` を呼び出す。`KC.Render.refresh`（同:3855）は `_pickModule().refresh()` を経由し、各ビューの `refresh` 関数で `KC.Api.loadEvents` による API フェッチを毎回実行する。

フィルタ処理は `KC.EventFilter.apply`（同:4125）がクライアント側で `KC.State.events` を絞り込む純粋なクライアント処理であり、APIから再取得した結果は変わらない。フィルタ切替のたびに API リクエストが発生するのは不要なオーバーヘッドである。

### 1.2 改善方針

`_saveAndRefresh` 内の `KC.Render.refresh()` を `KC.Render.renderGrid()` に変更する。

`KC.Render.renderGrid`（同:3876）は `_pickModule().renderGrid()` を呼び、API フェッチを行わずに `KC.State.events` から再描画のみを行う。フィルタは `renderGrid` の中で `KC.EventFilter.apply` が適用されるため、変更後も表示内容は正しく絞り込まれる。

### 1.3 対象コード (file:line)

- `src/kc-calendar.js:4166–4173` — `KC.FilterDropdown._saveAndRefresh` 関数全体
- 変更箇所: `4173` 行の `KC.Render.refresh();` → `KC.Render.renderGrid();`
- `src/docs/kc-calendar.js` — src と同内容に同期必須（CLAUDE.md 規約）

### 1.4 受け入れ条件

**AC1.1 (実機確認必須)**
フィルタドロップダウンで「自分のみ」「他人のみ」「すべて」を切り替えたとき、DevTools の Network タブに `/k/v1/records/cursor.json` への新規リクエストが発生しないこと。

**AC1.2 (静的確認可能)**
`_saveAndRefresh` 内で `KC.Render.refresh` の呼び出しが消え、`KC.Render.renderGrid` の呼び出しに置き換えられていること。

**AC1.3 (実機確認必須)**
週ビュー・月ビュー・日ビューの各ビューでフィルタを切り替えたとき、フィルタ適用後に表示されるイベント一覧が `KC.EventFilter.apply` の仕様（mine: 自分のみ / others: 他人のみ / all: 全件）と一致すること。

**AC1.4 (実機確認必須)**
フィルタ切替後に画面を手動リロードしたとき、`localStorage` に保存されたフィルタ値が復元され、表示が一致すること（localStorage 永続化が破壊されていないこと）。

### 1.5 スコープ外・注意事項

- ページ初回ロード時・ナビゲーション（前週/翌週等）時は引き続き `KC.Render.refresh()` が呼ばれる。これは変更しない。
- ポップアップクローズ後の再フェッチ（`src/kc-calendar.js:676`, `697`）は変更しない（記録変更を反映するため API 再取得が必要）。
- DnD 楽観的更新のエラー時ロールバック処理（同:893）の `KC.Render.refresh()` は変更しない。

---

## 2. isLightColor / _toRgba15 メモ化

### 2.1 背景・現状

`KC.Lanes.isLightColor`（`src/kc-calendar.js:2040`）と `KC.RenderMonth._toRgba15`（同:3022）はいずれも canvas 1px を毎回生成して色情報を取得する。

- `isLightColor`: `document.createElement('canvas')` → `getContext('2d')` → `fillRect` → `getImageData` の 4 ステップ
- `_toRgba15`: 同様の canvas 操作で RGB 値を取得し rgba 文字列を生成

月ビューに N 件のイベントがあると、`renderGrid` のたびに両関数合計で 2N〜3N 回の canvas 操作が発生する。イベントの色は設定値またはユーザー入力から決まり、描画のたびに変わるものではないため、初回計算後は結果を再利用できる。

### 2.2 改善方針

`KC.Lanes` の IIFE 内に `var _colorCache = {};` を導入し、`color` 文字列をキーとして `{ isLight: boolean, rgba15: string }` をキャッシュする。

- `isLightColor(color)` 呼び出し時: `_colorCache[color]` が存在すれば `isLight` を返し、canvas 操作をスキップする
- `_toRgba15(color)` は `KC.RenderMonth` の IIFE 内に存在するため、同様に `KC.RenderMonth` の IIFE 内に専用キャッシュ `var _rgba15Cache = {};` を導入する
- キャッシュのスコープは各 IIFE のモジュールスコープ（ページ滞在中は累積される）

色の種類はユーザー設定値またはレコード固有の固定値から決まるため、種類数は有限かつ少ない。無制限なメモリ消費は発生しない。

### 2.3 対象コード (file:line)

- `src/kc-calendar.js:2032–2151` — `KC.Lanes` IIFE 内
  - `2040–2049` — `isLightColor` 関数にキャッシュロジックを追加
- `src/kc-calendar.js:3022–3035` — `_toRgba15` 関数にキャッシュロジックを追加（`KC.RenderMonth` IIFE 内）
- `src/docs/kc-calendar.js` — 同期必須

### 2.4 受け入れ条件

**AC2.1 (静的確認可能)**
`KC.Lanes` IIFE 内に `var _colorCache = {};` が宣言されていること。`isLightColor` 関数が `_colorCache[color]` を参照し、存在する場合は canvas 生成処理（`document.createElement('canvas')`）をスキップして返すこと。

**AC2.2 (静的確認可能)**
`KC.RenderMonth` IIFE 内（または `_toRgba15` と同スコープ）に rgba15 用キャッシュ変数が宣言されていること。`_toRgba15` 関数がキャッシュヒット時は canvas 生成をスキップすること。

**AC2.3 (実機確認必須)**
同一の色文字列（例: `#e63946`）を `isLightColor` に 2 回渡したとき、1 回目と 2 回目で同じ boolean 値が返ること。`_toRgba15` も同様。

**AC2.4 (静的確認可能)**
キャッシュの型は `var _colorCache = {};` の Object 形式で、IIFE の外部（グローバルスコープ）に露出していないこと。

### 2.5 スコープ外・注意事項

- キャッシュのクリア機能（手動リセット等）は本 Phase 1 の対象外。ページリロードでリセットされる挙動で十分。
- `isLightColor` は `KC.Lanes` の公開 API として `return` されているため、シグネチャ（引数・戻り値の型）を変えないこと。

---

## 3. buildTimeSlots event delegation 化

### 3.1 背景・現状

`KC.TimeSlots.buildTimeSlots`（`src/kc-calendar.js:3991`）は、24 時間 × 列数（週ビュー 7 列）× 2（30 分単位）= 最大 336 個の `.kc-time-slot` 要素それぞれに個別 click リスナを `addEventListener` で登録する（同:4021）。

`renderGrid` のたびに既存スロットを削除して再生成するため（同:4013）、336 個のリスナ着脱が毎回発生する。

### 3.2 改善方針

各列（cell）または行（row）単位の親要素、あるいは `.kc-rows`（`KC.State.els.rows`）に対して 1 つの click リスナを登録し、イベント委譲（event delegation）で対象を特定する方式に変更する。

クリックイベント発火時に `event.target.closest('.kc-time-slot')` で `.kc-time-slot` 要素を取得し、既存の `_onTimeSlotClick` ロジックを再利用する。

委譲先の親要素の選択基準:
- `.kc-rows`（`id="kc-rows"`）を推奨。renderGrid の再生成で DOM が差し替えられる場合は、差し替えられない上位要素を選ぶ必要がある。builder は実際の DOM 構造を確認して最適な委譲先を決定すること。

`_onTimeSlotClick`（同:4056）は `e.currentTarget` を参照しているため、委譲後は `e.target.closest('.kc-time-slot')` を渡すよう修正が必要。

### 3.3 対象コード (file:line)

- `src/kc-calendar.js:3991–4026` — `buildTimeSlots` 関数
  - `4006–4025` — 各スロットへの個別リスナ登録ループ
- `src/kc-calendar.js:4056–4071` — `_onTimeSlotClick` 関数（`e.currentTarget` → 受け取ったスロット要素への参照変更）
- `src/docs/kc-calendar.js` — 同期必須

### 3.4 受け入れ条件

**AC3.1 (静的確認可能)**
`buildTimeSlots` 内の各 `.kc-time-slot` に対する `addEventListener('click', ...)` の呼び出しが消えていること。

**AC3.2 (静的確認可能)**
`.kc-time-slot` の親となる要素（委譲先）に対して click リスナが 1 件（または列数分の少数件）登録されていること。委譲先が `renderGrid` の都度再生成される要素でないことをコードで確認できること。

**AC3.3 (実機確認必須)**
週ビューで任意の時間スロットをクリックしたとき、`KC.Popup.openCreate` が正しい `{ date, hour, minute, allday: false }` を受け取り、新規予定作成ポップアップが表示されること。

**AC3.4 (実機確認必須)**
終日 DnD（ドラッグ&ドロップ）動作中に誤ってスロットのクリックイベントが発火しないこと。`_onTimeSlotClick` の `e.stopPropagation()` が委譲後も正しく機能すること。

**AC3.5 (実機確認必須)**
時間予定 DnD 系の既存イベントハンドラ（mousedown / mousemove 等）と click 委譲が干渉しないこと。
（注: 時間予定 DnD は Phase 2 未検証域のため、コード上の競合がないことを静的確認で代替可）

### 3.5 スコープ外・注意事項

- `bindAllDayBoxes`（同:4029）は対象外。すでにガード処理（`data-kcClickBound`）を持つ別関数。
- `.kc-time-slot` 要素の `data-date`・`data-hour`・`data-half` 属性の付与ロジックは変更しない。
- Phase 2 未検証域（時間予定 DnD / 日跨ぎ）には触らない。

---

## 4. loader.js キャッシュバスター版数固定

### 4.1 背景・現状

`docs/loader.js`（`docs/loader.js:14`）で `var V = Date.now();` によりキャッシュバスターを毎回生成している。ページ読み込みのたびに `kc-calendar.js?v=<timestamp>` と `kc-calendar.css?v=<timestamp>` が異なる URL となり、ブラウザキャッシュが常に無効化されて本体 JS/CSS が毎回フルダウンロードされる。

### 4.2 改善方針

`var V = Date.now();` を固定文字列に変更する。バージョン文字列は `'YYYY-MM-DD-<識別子>'` 形式を推奨する（例: `var V = '2026-05-13-perf1';`）。

これにより、同じバージョンの loader.js を 2 回目以降ロードする際はブラウザキャッシュが有効になり、本体 JS/CSS のダウンロードが `304 Not Modified` で完了する。

本体 JS/CSS を更新してデプロイする際は、`V` の値を手動で更新することで古いキャッシュを強制的に無効化する運用とする。

### 4.3 対象コード (file:line)

- `docs/loader.js:14` — `var V = Date.now();` を固定文字列に変更

`loader.js` は `src/` に存在しない（`docs/` 直置きのファイル）。同期不要。

### 4.4 受け入れ条件

**AC4.1 (静的確認可能)**
`docs/loader.js` 内に `Date.now()` の呼び出しが存在しないこと。

**AC4.2 (静的確認可能)**
`var V` に固定文字列が代入されていること。文字列は空でなく、デプロイ識別子として意味のある値（日付を含む形式等）であること。

**AC4.3 (実機確認必須)**
kintone カレンダーページを同一ブラウザで 2 回ロードしたとき（2 回目はキャッシュあり状態）、DevTools の Network タブで `kc-calendar.js` および `kc-calendar.css` のリクエストが `304 Not Modified`（またはキャッシュヒット）になること。
（注: GitHub Pages のキャッシュ制御ヘッダー（`Cache-Control`）の設定によって 304 が返るかは実機未検証。GitHub Pages 側で `no-cache` ヘッダーが付与されている場合はこの改善が無効になる可能性がある）

**AC4.4 (運用確認)**
`DEPLOY_GUIDE.md` に「本体 JS/CSS を更新してデプロイする際は `docs/loader.js` の `var V` を新しい値に更新すること」が追記されていること。

### 4.5 スコープ外・注意事項

- `V` の自動インクリメント（ビルドスクリプト等）は本 Phase 1 の対象外。手動更新運用で対応する。
- `loader.js` を kintone カスタマイズに再アップロードする必要はない（URL に `?v=` は含まれていないため、loader.js 自体のキャッシュは kintone の通常ルールに従う）。
- GitHub Pages のキャッシュ動作は実機確認が必要（推測のみで動作を断言しない）。

---

## 5. cursor GET の 50ms 待機を条件化

### 5.1 背景・現状

`KC.Api.loadEvents`（`src/kc-calendar.js:453`）の cursor GET ループ（同:509–517）では、各ページ取得後に `hasNext` の値に関わらず 50ms の sleep が無条件で挿入されていた。

現状のコード（調査時点）は既に `if (hasNext)` による条件化が適用されている（同:514）。

```
// 調査時点のコード（src/kc-calendar.js:513-517）
// レート制限緩衝: 次の GET まで 50ms 待機（req: §3.10）
if (hasNext) {
  await new Promise(function (r) { setTimeout(r, 50); });
}
```

上記の通り、静的解析の時点では既に `hasNext === true` の場合のみ待機する実装になっている。

### 5.2 改善方針

現状コードを確認した結果、`hasNext` による条件化は実装済みである。

builder は以下を確認すること:
1. `src/kc-calendar.js:509–517` 付近の cursor GET ループで `if (hasNext)` ガードが存在することをコードで確認する
2. 確認済みの場合、本 §5 の実装作業は不要（対応済みと記録する）
3. 万一 `if (hasNext)` ガードが存在しない箇所が別に見つかった場合は追加修正対象とする

なお、50ms 待機はkintone-rules.md が定めるレート制限（同時接続 10 まで）への配慮であり、複数ページ取得時は引き続き有効に機能する必要がある。

### 5.3 対象コード (file:line)

- `src/kc-calendar.js:509–517` — cursor GET ループの sleep 処理（現状確認対象）
- 対応済みの場合はコード変更なし

### 5.4 受け入れ条件

**AC5.1 (静的確認可能)**
`KC.Api.loadEvents` の cursor GET ループ内で `await new Promise(...)` による sleep が `if (hasNext)` または等価な条件節で囲まれていること。無条件 sleep が存在しないこと。

**AC5.2 (実機確認必須)**
表示対象レコードが 500 件未満（1 ページで完了する取得）の場合、`KC.Api.loadEvents` が cursor 取得完了後に遅延なく完了すること（50ms の余分な待機が発生しないこと）。

**AC5.3 (静的確認可能)**
`if (hasNext)` 内の sleep ブロックに「kintone API レート制限への配慮」を示すコメントが記載されていること（kintone-rules.md §1 および security-rules.md の同時接続 10 制限への準拠）。

### 5.5 スコープ外・注意事項

- 50ms という待機時間自体の変更は本 Phase 1 の対象外。
- 複数ページ取得時の待機は廃止しない（レート制限への配慮として維持）。
- 現状コードで既に対応済みの場合、本 §5 は「確認のみ、変更なし」として完了する。

---

## 6. 全体スコープ

### 6.1 対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/kc-calendar.js` | §1〜§3, §5 の実装変更 |
| `docs/kc-calendar.js` | `src/` との同期（CLAUDE.md 規約必須） |
| `docs/loader.js` | §4 キャッシュバスター変更 |
| `DEPLOY_GUIDE.md` | §4 の AC4.4 として `var V` 更新手順を追記 |

`src/kc-calendar.css` / `docs/kc-calendar.css` への変更はなし。

### 6.2 src/docs 同期ルール (CLAUDE.md 準拠)

- `src/kc-calendar.js` を編集したら `docs/kc-calendar.js` に同内容を同期してからコミットする
- `docs/loader.js` は `src/` に対応ファイルが存在しないため同期不要
- 差分が残ったまま push しない（CLAUDE.md §編集ルール）

### 6.3 検証観点 (DevTools Network・コンソール・実機操作)

**DevTools Network タブで確認する項目**
- §1: フィルタ切替時に `/k/v1/records/cursor.json` への新規リクエストが発生しないこと
- §4: 2 回目ロード時に `kc-calendar.js` / `kc-calendar.css` が 304 またはキャッシュヒットになること

**コンソールで確認する項目**
- §1〜§5 の変更後に `console.error` / `console.warn` が新たに出力されないこと
- §2: キャッシュ導入後も `isLightColor` と `_toRgba15` の戻り値が変更前と一致すること（ブレークポイントで値を比較）

**実機操作で確認する項目**
- §1: 週ビュー・月ビュー・日ビュー各ビューでフィルタ切替が正しく反映されること
- §3: 週ビューの任意の時間スロットをクリックしてポップアップが開くこと
- §4: キャッシュバスター変更後にデプロイして、新しい JS/CSS が反映されること
- §5: 500 件未満のレコード取得で、目視で体感できる遅延（50ms）が消えること

### 6.4 リスク・前提

**Phase 2 未検証域に触らない**
HANDOVER.md §4 に記載の Phase 2 未検証事項（時間予定 DnD・日跨ぎ表示、バグ A〜E、commit 219d720）は本 Phase 1 の対象外。
§3（event delegation 化）の委譲先親要素選定は Phase 2 の DnD 実装と干渉しないよう、builder がコードを精査した上で決定すること。

**ビュー切替リファクタとの独立性**
本 Phase 1 の各改善は `REQ_view-switch-refactor.md` が存在する場合のビュー切替リファクタとは独立した変更として実装する。共有モジュール（`KC.Render.refresh` / `renderGrid`）の変更は行わない。

**loader.js の GitHub Pages キャッシュ挙動（未確認）**
GitHub Pages が `Cache-Control: no-cache` ヘッダーを付与している場合、§4 の改善効果が得られない可能性がある。実機確認結果を DEPLOY_GUIDE.md に追記すること。

**§5 対応済みの可能性**
静的解析では `hasNext` 条件化が既に実装されている。builder が `src/kc-calendar.js` を確認し、対応済みであれば §5 の実装作業は不要で確認のみ完了とする。

**src / docs 同期忘れのリスク**
§1〜§3 と §5 は `src/kc-calendar.js` の変更であり、必ず `docs/kc-calendar.js` と同期すること。同期漏れがあると GitHub Pages 経由の本番実行ファイルが古いままになる。
