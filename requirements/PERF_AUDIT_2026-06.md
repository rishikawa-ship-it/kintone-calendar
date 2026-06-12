# PERF_AUDIT_2026-06 — 処理効率化調査レポート

**対象ファイル:** `plugin/src/js/desktop.js`（9,200 行超）  
**調査日:** 2026-06-12  
**ステータス:** 初版（builder への実装委譲前）

---

## 1. 調査サマリ

`plugin/src/js/desktop.js` 全体を静的解析した結果、以下のカテゴリで改善候補を特定した。

| カテゴリ | 件数 |
|---|---|
| 初期化チェーン（直列 await） | 2 |
| レンダリング重複呼び出し | 3 |
| setInterval / ポーリング | 1 |
| API 呼び出しキャッシュ | 2 |
| データ処理 | 2 |
| URL 同期 replaceState 多重発行 | 1 |
| DOM クエリ繰り返し | 1 |
| console.log 本番残留 | 1 |
| その他（ResizeObserver 二重） | 1 |
| **合計** | **14** |

---

## 2. 改善候補一覧

| # | 対象（関数/機能） | 現状の処理 | 問題点・コスト | 改善案 | 期待効果 | リスク/工数 | 優先度 |
|---|---|---|---|---|---|---|---|
| P-1 | `KC.Boot.init` 初期化チェーン<br>`desktop.js:8833–8844` | `detectFields` と `detectAppName` を直列 `await`（計 2 API コール） | ページ初期表示まで余分な待機が発生。`detectFields` = `/k/v1/app/form/fields.json`、`detectAppName` = `/k/v1/app.json`。通信往復 2 回分（各 ~100–200ms）が直列になる | `Promise.all([KC.Config.detectFields(), KC.Config.detectAppName()])` で並列実行に変更。`detectAppName` は `calendarTitle` 設定済みならスキップ済みなので条件分岐を維持したまま並列化できる | 起動時間を最大 1 API ラウンドトリップ分（100–200ms）短縮 | `detectFields` の結果を `detectAppName` が参照しないか確認要（コードを確認した限り依存なし）。工数: 小 | 高 |
| P-2 | `KC.Boot.init`：`_loadRefTableDefs`<br>`desktop.js:8823–8828` | `searchTargets` に REFERENCE_TABLE があれば `_loadRefTableDefs` を `await`（`/k/v1/app/form/fields.json` を取得）。P-1 の `detectFields` も同じエンドポイントを叩く | `detectFields`（P-1）と `_loadRefTableDefs` が同一エンドポイントへ 2 回リクエスト。1 回は冗長 | `detectFields` のレスポンスを `_loadRefTableDefs` に渡すか、`detectFields` の結果を `KC.Config` 経由で共有して `_loadRefTableDefs` はそれを再利用。または P-1 並列化後に共通 promise でキャッシュ | API コール 1 回削減（ほぼ確実に重複している場合） | `detectFields` の返却スキーマが `_loadRefTableDefs` で必要な `type / referenceTable` プロパティを含むか確認要。工数: 中 | 中 |
| P-3 | `KC.Render.renderGrid` → `placeMonthEvents` 二重呼び出し（月ビュー・fullscreen 切替時）<br>`desktop.js:6115–6117`, `8756–8758`, `8773–8775` | `renderGrid` ファサードは月ビュー時に `requestAnimationFrame(() => placeMonthEvents())` をスケジュール。`_enterExpanded` / `_exitExpanded` も独立して `requestAnimationFrame(() => placeMonthEvents())` を呼ぶ | fullscreen 切替（`_enterExpanded` / `_exitExpanded`）は `renderGrid` を経由しないため、同一フレームで `placeMonthEvents` が 2 回実行される。DOM 計測（セル高取得など）が 2 倍になる | `_enterExpanded` / `_exitExpanded` からの直接 `placeMonthEvents` 呼び出しを削除し、`renderGrid` 経由（1 回のみ）に統一する。または `placeMonthEvents` 自身に「同フレーム内の重複呼び出しを無視するフラグ」を追加する | CPU/レイアウト計算コストを約半減。fullscreen 切替時のちらつき低減 | `renderGrid` を呼ばずに `placeMonthEvents` だけが必要なケース（例: ウィンドウリサイズ）を壊さないよう注意。リサイズハンドラは既に `renderGrid → rAF → placeMonthEvents` の順になっているため影響なし。工数: 小 | 高 |
| P-4 | リサイズハンドラ重複：`window.resize` + `ResizeObserver`<br>`desktop.js:8937–8958` | `window.addEventListener('resize', ...)` と `new ResizeObserver(...)` が両方登録され、どちらも `_setScrollbarVar()` を呼ぶ | ウィンドウリサイズ時に `_setScrollbarVar` が resize イベントと ResizeObserver の両方から発火。冗長な CSS 変数計算（軽微だが不要） | ResizeObserver 側（`kc-body` 監視）を `_setScrollbarVar` 専用とし、`window.resize` ハンドラからは `_setScrollbarVar` 呼び出しを削除して月ビュー再描画のみに絞る | 冗長な CSS 変数更新を除去（軽微） | `kc-body` が非表示のときに ResizeObserver がトリガーされるか確認要。工数: 小 | 低 |
| P-5 | `KC.Popup._show`：500ms setInterval による iframe URL ポーリング<br>`desktop.js:1752` | `setInterval(fn, 500)` を使って iframe の `contentWindow.location.href` を監視し、保存後リロードを検知 | 500ms ごとに cross-origin iframe への URL 取得試行が発生。モーダルが開いている間ずっと継続。kintone の iframe は同一オリジン（同ドメイン）だが、取得失敗時の catch コストも累積する | `MutationObserver` または kintone の `postMessage` 経由で保存完了を検知できるか調査。難しい場合はポーリング間隔を 1000ms に延ばしてコスト削減。あるいはイベント駆動（`hashchange` on iframe や `load` イベント）に切り替える | CPU 消費を最大 50% 削減（2× インターバル）または完全排除 | kintone 詳細画面の URL 変化パターンを実機検証要。`load` イベントで代替できない理由（iframe が同一オリジンか CORS か）を確認要。工数: 中〜大 | 中 |
| P-6 | `KC.SearchFilter.loadRelatedRecords`：ビュー切替・月送りのたびに全件再取得<br>`desktop.js:6087–6096`, `7116–7134` | `_refreshImmediate` 内で毎回 `loadRelatedRecords` を呼び、関連先アプリの全レコードをカーソル API で再取得してキャッシュを上書き | 月送りやビュー切替ごとに関連先アプリを全件再取得（関連レコードが多ければ数秒かかる可能性）。関連先アプリが更新されていなければ前回キャッシュで十分 | 一定時間（例: 5 分）または明示的な「再読み込み」操作まではキャッシュを再利用する TTL 方式を導入。`_relatedRecordsFetchedAt` タイムスタンプを持たせ、TTL 内ならスキップ | 月送り時の待ち時間を大幅削減（関連レコード数に依存するが数秒→ほぼゼロになるケースも） | キャッシュが古くなるリスク。「保存直後に関連先が更新されている」ケースへの対応方針を要確認。工数: 小 | 高 |
| P-7 | `KC.Api.loadEvents`：フィールドリスト構築が毎回実行<br>`desktop.js:812` 周辺（loadEvents 内） | `loadEvents` が呼ばれるたびに `fields` パラメータ（動的フィールドリスト）を毎回 `Array.push` / `Set` で構築 | 静的な Config 由来のフィールドリストを毎回再構築するのは冗長。Config が変わるのは `loadFromPluginConfig` の 1 回のみ | `loadFromPluginConfig` 完了後に `_cachedFieldList` を一度だけ構築しておき、`loadEvents` はそれを参照するだけにする | `loadEvents` のオーバーヘッドを微減（コール自体はネットワーク待機が支配的なため体感差は小） | `loadFromPluginConfig` の呼び出し順序に依存。工数: 小 | 低 |
| P-8 | `KC.UrlState.update` / `remove` の連続発行<br>`desktop.js:8753`, `8771`, 複数箇所 | `_enterExpanded` と `_exitExpanded` それぞれが `KC.UrlState.update/remove` を個別に呼ぶ。1 操作につき最大 2 回の `replaceState` が発行されることがある（例: fullscreen 解除 → `update('fs', '0')` + `renderGrid` 内の `syncViewDate`） | `replaceState` を 1 操作内で複数回呼ぶと History スタックが余分に積まれる（replaceState 自体はスタックを増やさないが、URL がバタバタ変わることによるデバッグ困難さ・パフォーマンス微劣化） | 1 操作内での複数 `update/remove` を `serialize` ベースで一括 `replaceState` するトランザクション API（`KC.UrlState.batch(fn)`）を追加 | URL 同期コードの見通し改善。replaceState 呼び出し回数削減 | `batch` の設計・テストが必要。現状の動作に影響しないようガード要。工数: 中 | 低 |
| P-9 | `KC.SearchFilter._computeMatchList`：全イベントに対するフルスキャン<br>`desktop.js:7237` | `events.filter(evt => _matchesTokens(evt, tokens))` で毎回全 KC.State.events を線形スキャン。`renderGrid` のたびに呼ばれる（月ビューは `placeMonthEvents` 後） | イベント件数が増えるほどコストが増大。kintone のデフォルト上限 500 件でも、フィールド数×トークン数のループが発生する | query が変わっていない場合はスキャンをスキップする「クエリキャッシュ」を追加（`_lastQuery` と `_lastMatchList` を持たせ、query 変化時のみ再計算） | 月送りやフィルタ変更後に不要な全スキャンを排除。queryが変わらなければ O(1) | events が新しくロードされた後にはキャッシュを無効化する必要あり（loadEvents 後のリセット要） 。工数: 小 | 中 |
| P-10 | `KC.Boot.init` 内で `document.querySelector` を毎回呼び出す複数箇所<br>`desktop.js:8791–8793`, `8866–8876` 等 | `_updateNavAriaLabels` 内で `document.querySelector('[data-action="prev"]')` などを毎回実行。`KC.State.refreshEls` 後に `KC.State.els` に prev/next/today が格納されているにもかかわらず未活用 | DOM ツリーのフルスキャンが毎回発生（軽微だが冗頻度が高い） | `_updateNavAriaLabels` を `KC.State.els.prevBtn` / `els.nextBtn` を参照するよう変更。refreshEls 時にこれらを格納済み（`els.prevBtn`, `els.nextBtn`） | DOM クエリコストを削減（体感差は軽微） | `refreshEls` のタイミングより前に呼ばれるパスがないか確認要。工数: 小 | 低 |
| P-11 | `console.log` 本番残留（71 件）<br>`desktop.js` 全体 | `console.log` が 71 行、`console.warn` が複数行にわたり残留（`[KC.Config] loadFromPluginConfig 完了`, `[KC.Holidays] loaded`, `[KC SearchFilter] _refTableDefs 取得完了` など） | 本番環境でブラウザコンソールにログが大量出力。特に初期化時の複数ログは毎回発火する | `KC_DEBUG` フラグ（または `process.env.NODE_ENV`）を設けて `console.log` を条件分岐。`console.warn` / `console.error` はそのまま維持（エラー系は本番でも必要） | コンソール汚染防止、起動時ログ出力コスト削減 | デバッグ時の利便性が低下するため、フラグで ON/OFF 切替できる仕組みにすること。工数: 小 | 中 |
| P-12 | `KC.Render._refreshImmediate`：`loadRelatedRecords` を `_searchTargets.length > 0` で無条件に毎回 await<br>`desktop.js:6087–6096` | `_searchTargets` にフィールドがあれば `loadRelatedRecords` を常に await。REFERENCE_TABLE がない（通常テキストフィールドのみ）場合でも呼び出す | REFERENCE_TABLE フィールドがない場合でも `loadRelatedRecords` 内の `refTargets` 判定まで進む（早期 return はあるが呼び出しコストは発生） | `_searchTargets` に REFERENCE_TABLE 型が存在するかを事前フラグ（`_hasRefTableTarget`）として持ち、なければ `loadRelatedRecords` 呼び出し自体をスキップ | 非 REFERENCE_TABLE 環境での不要な async 呼び出しを排除 | 工数: 小 | 低 |
| P-13 | `KC.Holidays.fetchHolidays`：取得完了後に `KC.Render.refresh()` で再描画<br>`desktop.js:8849–8853` | 祝日 API 取得完了時に `KC.Render.refresh()` を呼んで再描画。`refresh` は `loadEvents`（APIコール）を含む | 祝日データ取得完了のたびに `loadEvents` も実行される。祝日データの変化は UI 上は軽微（ヘッダーの色/テキスト変化のみ）なのに全イベントを再取得する | `KC.Render.renderGrid()` のみ呼ぶ（`loadEvents` を省略）。イベントデータは `KC.State.events` に既にキャッシュされているため再取得不要 | 起動直後に余分な loadEvents API コールを 1 回削減 | `renderGrid` だけで祝日が正しく反映されるかを確認（祝日データはグリッド描画関数内で `KC.Holidays.getName` を参照する実装なら問題なし）。工数: 小 | 中 |
| P-14 | `KC.UrlState.get`：呼ばれるたびに `parse(window.location.hash)` を実行<br>`desktop.js:7812–7814` | `get(key)` は毎回 `parse(window.location.hash)` を実行（ハッシュ文字列のパース）。`popstate` ハンドラや restore 内で複数 `get` が連続して呼ばれる箇所がある | 軽微だが、連続 `get` 呼び出しがある場合に同一ハッシュを複数回パース | 同一 JS イベントループ内（マイクロタスク内）でパース結果をメモ化する（`_parseCache = null` として次の `replaceState/pushState` で無効化） | ハッシュパース処理を削減（体感差は小） | キャッシュ無効化タイミングのミスによる古い値参照リスク。工数: 小 | 低 |

---

## 3. 既知の不具合（パフォーマンス関連）

### B-1: 月ビュー fullscreen 切替時の `placeMonthEvents` 二重呼び出し

P-3 の詳細。`_enterExpanded` / `_exitExpanded` が `renderGrid` を呼ばずに独立して `requestAnimationFrame(() => placeMonthEvents())` をスケジュールするため、同じフレームで 2 回計算が走る。現状では正常動作しているが、CPU コスト（DOM 計測）が 2 倍になっている。

**発生箇所:**
- `desktop.js:6115–6117`（renderGrid ファサード内）
- `desktop.js:8756–8758`（`_enterExpanded`）
- `desktop.js:8773–8775`（`_exitExpanded`）

### B-2: 月ビューリサイズ時の `renderGrid` → `placeMonthEvents` のフロー

`window.resize` ハンドラ（200ms debounce）は `KC.RenderMonth.renderGrid()` を直接呼び、その後 `requestAnimationFrame(() => placeMonthEvents())` をスケジュールする。このパスは `KC.Render.renderGrid` ファサードを経由しないため、ファサード側の `placeMonthEvents` スケジュールと競合しないように設計されている（問題なし）。ただし `KC.Render.renderGrid` と `KC.RenderMonth.renderGrid` の 2 系統のエントリポイントがあることで混乱を招きやすい。

### B-3: `KC.Popup` iframe URL ポーリング（setInterval 500ms）

P-5 の詳細。kintone の詳細/編集画面を iframe に表示し、URL の変化（保存後のリダイレクト）を 500ms ごとに監視する。モーダルを開いている全期間にわたって継続するため、長時間開いたままにする用途では無視できないコストになる。`_close` で `clearInterval` されるため leakは発生しない。

---

## 4. Builder 提案事項（実装時検討候補）

以下は調査中に派生的に発見した改善候補。要件定義の対象外だが builder に伝達しておく。

| # | 内容 | 根拠 |
|---|---|---|
| B-P1 | `KC.State.els` に `prevBtn` / `nextBtn` / `todayBtn` が格納されているにもかかわらず、`_updateNavAriaLabels` が `document.querySelector` で毎回取得し直している。`els` 参照に統一する | `desktop.js:8791–8793` |
| B-P2 | `KC.Render.refresh` の debounce 間隔（300ms）と resize debounce（200ms）が混在。どちらかに統一することで予測可能性が上がる | `desktop.js:6058–6061`, `8939–8953` |
| B-P3 | `restore` 関数内に `_dateToParam` と同等のロジックがインラインで再実装されている（`_dateToParamLocal`）。`_dateToParam` 関数（同スコープ内に定義済み）を呼び出すよう統一する | `desktop.js:8124–8130` |
| B-P4 | `_computeMatchList` がクエリが空の場合でも `_renderDropdown()` を呼ぶ。クエリ空判定の早期 return 時は `_renderDropdown` 不要ならスキップできる | `desktop.js:7216–7221` |

---

## 5. 優先度 Top 5 サマリ

| 順位 | # | 対象 | 優先理由 |
|---|---|---|---|
| 1 | P-1 | `KC.Boot.init` の `detectFields` / `detectAppName` 並列化 | 初期表示レイテンシに直結。工数が小さく効果が確実 |
| 2 | P-3 | fullscreen 切替時の `placeMonthEvents` 二重呼び出し除去 | 毎回 DOM 計測が 2 回走る既知バグ的挙動。工数小・リスク低 |
| 3 | P-6 | `loadRelatedRecords` への TTL キャッシュ導入 | 月送りのたびに数 API コールが発生するケースで UX に直結。工数も小さい |
| 4 | P-13 | `KC.Holidays.fetchHolidays` 完了後の `refresh` → `renderGrid` 変更 | 起動直後に不要な `loadEvents` を 1 回削減。確認と修正が容易 |
| 5 | P-9 | `_computeMatchList` のクエリキャッシュ追加 | イベント増加時のスキャンコスト削減。実装パターンが単純 |

---

## 6. 調査メモ・前提

- **leakなし確認済み:** DnD の `mousemove/mouseup` リスナーは `mousedown` 時に登録し `mouseup/cancel` 時に解除済み。`KC.Popup` の `MutationObserver` は `_close` で `disconnect` 済み。`setInterval`（`_urlWatcher`）は `_close` で `clearInterval` 済み。
- **`loadEvents` の in-flight ガード:** `_loading` フラグによる重複リクエスト防止は正常機能している。
- **`KC.UrlState._isUpdatingHash` ガード:** `replaceState/pushState` 呼び出し中は `_isUpdatingHash = true` となり `popstate` ハンドラ内で無視される。ロジックは正常。
- **`_initialParams` の設計:** IIFE 評価時点（KC.Boot.init より前）でハッシュをキャッシュしているため、init 内の URL 書き換えによる汚染なし。設計として適切。
- **console.log 71 件:** 実装時のデバッグ用ログが本番コードに残留している。エラー系 (`console.error`) は維持すべきだが、正常系の `console.log` は DEBUG フラグで制御することを推奨。
