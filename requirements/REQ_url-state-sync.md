# 要件定義書: URL 状態同期（ディープリンク化）

**文書番号**: REQ_url-state-sync
**作成日**: 2026-06-11
**最終更新日**: 2026-06-11（第 3 版: FR-7 全画面 URL セマンティクス反転）
**作成者**: designer (サブエージェント)
**ステータス**: 確定版 第 1 版（残存未確定事項: §10 Q-3〜Q-5 のみ）
**関連文書**:
- `plugin/src/js/desktop.js` — 実装対象
- `requirements/REQ_popup-behavior-fix.md` — KC.Popup（iframe モーダル）設計
- `requirements/REQ_month-overflow-popup.md` — +N more ポップオーバー設計
- `requirements/REQ_search-bar.md` — KC.SearchFilter / KC.SearchBar 設計
- `requirements/REQ_edit-permission-extension.md` — KC.Config スキーマ

---

## 目次

1. [背景・目的](#1-背景目的)
2. [現状分析](#2-現状分析)
3. [スコープと前提条件](#3-スコープと前提条件)
4. [URL 設計](#4-url-設計)
5. [機能要件](#5-機能要件)
6. [非機能要件](#6-非機能要件)
7. [実装設計](#7-実装設計)
8. [Phase 分割計画](#8-phase-分割計画)
9. [受入基準](#9-受入基準)
10. [未確定事項・リスク・前提](#10-未確定事項リスク前提)
11. [検証項目・テストシナリオ](#11-検証項目テストシナリオ)
12. [想定 UX / シーケンス](#12-想定-ux--シーケンス)

---

## 1. 背景・目的

### 1.1 背景

KC Calendar プラグインは現状、ページ URL が常に同一であり、カレンダーの表示状態（ビュー種別・表示月・フィルタ・検索キーワード等）が URL に反映されない。このため以下の問題が生じている:

- 特定の月のカレンダーや特定の予定を他のユーザーに URL で共有できない
- ページリロード後に前の表示状態が失われる（ビュー・日付・検索クエリがリセットされる）
- ブラウザの「戻る/進む」ボタンでカレンダー操作を遡れない
- 全画面モードやモーダル開閉状態がリロードで失われる

### 1.2 目的

カレンダーの画面状態を URL ハッシュフラグメント（`#kc:` プレフィクス）に同期することで、以下を実現する:

1. カレンダーの表示状態を URL として共有・ブックマーク可能にする（ディープリンク）
2. ページリロード時に前の表示状態を復元する
3. モーダル・ポップオーバーの開閉状態をブラウザ「戻る」で閉じられる UX を提供する

---

## 2. 現状分析

### 2.1 状態管理の現状（`plugin/src/js/desktop.js`）

現状のカレンダー状態は `KC.State` オブジェクトに格納される（`desktop.js:595–622`）:

| 状態 | フィールド | 現行の永続化 |
|---|---|---|
| ビュー種別 | `KC.State.view` (`'month'`/`'week'`/`'day'`) | なし（デフォルト `'month'`） |
| 表示日付 | `KC.State.current` (`Date` オブジェクト) | なし（デフォルト `new Date()`） |
| イベントフィルタ | `KC.State.eventFilter` (`'all'`/`'mine'`/`'others'`) | `localStorage` キー `kc-event-filter`（`desktop.js:7292–7324`） |
| 検索クエリ | `KC.SearchFilter.query` (文字列) | なし |
| 全画面状態 | `#kc-root` の CSS クラス `kc-expanded` の有無 | なし |
| モーダル開閉 | `KC.Popup._iframe` の有無 | なし |
| +N more ポップオーバー | `KC.OverflowPopup._anchorYMD` | なし |

### 2.2 history API の未使用

現状、`history.pushState` / `history.replaceState` は一切使用していない（`desktop.js` 内に `pushState` / `replaceState` の呼び出しなし）。`hashchange` イベントのリスナーも存在しない。

### 2.3 モーダル・ポップオーバーの実装

- **KC.Popup**（`desktop.js:1075–1598`）: `openCreate(options)` / `openEdit(recordId)` で iframe オーバーレイモーダルを開く。`_show(url)` で毎回 iframe を新規生成、`_close()` で DOM から削除する方式（REQ_popup-behavior-fix §3 案 B-1）
- **KC.OverflowPopup**（`desktop.js:6080–6458`）: +N more クリックで月ビューセルに対応するポップオーバーを表示する。`open(anchorEl, dateYMD, eventsList)` / `close()` が公開 API。現在表示中の日付は `_anchorYMD` に保持
- **KC.FilterDropdown**（`desktop.js:7287–7440`）: `_saveAndRefresh(value)` でフィルタ変更・localStorage 保存・再描画を行う
- **KC.SearchFilter**（`desktop.js:6487–7285`）: `setQuery(q)` で検索クエリを設定し再描画する
- **全画面ボタン**（`desktop.js:7757–7786`）: `_enterExpanded(root)` / `_exitExpanded(root)` で `.kc-root` に `.kc-expanded` クラスを付け外しする。month ビューの場合は `requestAnimationFrame` で `placeMonthEvents()` を再実行する
- **設定ポップアップ**（`desktop.js:7563–7565`）: `window.location.href = '/k/admin/app/.../plugin/config?pluginId=...'` でページ遷移する（kintone 管理画面へ遷移。カレンダー内ポップアップではないため URL 同期の対象外）

### 2.4 初期化フロー（`KC.Boot.init`）

`KC.Boot.init`（`desktop.js:7806`）の現行順序:

1. `KC.FilterDropdown.loadFilter()` — localStorage からフィルタ復元
2. `KC.Config.loadFromPluginConfig()` — プラグイン設定読み込み
3. `KC.Config.detectFields()` (await)
4. `KC.LoginContext.init()`
5. `KC.Config.detectAppName()` (await)
6. `_buildDOM()` — DOM 構築
7. ナビゲーションボタンイベントリスナー登録
8. `KC.Render.refresh()` + `loadEvents()` — 初回描画

---

## 3. スコープと前提条件

### 3.1 対象ファイル

- **実装対象**: `plugin/src/js/desktop.js`（プラグイン版のみ）
- **src 版（`src/kc-calendar.js`）は対象外（確定）**: src 版は現在未使用。本機能は plugin 版のみに実装する

### 3.2 前提条件（必须記載）

1. **kintone URL 部分（`?view=` / `?q=` 等のクエリパラメータ）には一切触れない**。カレンダーが読み取り・書き込みするのは `#kc:` プレフィクスを持つハッシュフラグメントのみとする
2. **kintone の一覧画面は独自のハッシュを使用しない**ことを実機で確認済み（2026-06-11、k/891 で実測）。kintone 一覧画面（`/k/891/`）の初期状態での `location.hash` は空文字であり、`history.replaceState` でハッシュを書き込んでもページ遷移・kintone 側の反応・DOM の変化は発生しないことを確認。ハッシュ付き URL（`/k/891/#kc:view=month&date=2026-06&filter=mine`）の直接読み込みでも kintone はハッシュを剥がさず保持し正常にロードする。この前提が成立するため `#kc:` プレフィクス設計を採用する。万一の競合への防衛策として「`#kc:` プレフィクスを持たないハッシュは無視する」ルールは引き続き維持する
3. kintone カスタマイズビューの `<div id="kc-root">` がマウントされるページであること
4. `KC.Popup._close()` / `KC.OverflowPopup.close()` 等の既存クローズ API を URL 更新と協調させる形で拡張すること（API の破壊的変更は不可）

### 3.3 セキュリティ / プライバシー注意（仕様として明記）

- URL ハッシュはサーバーに送信されないが、ブラウザの閲覧履歴・共有 URL に残る
- 検索キーワード（`#kc:q=...`）が URL として共有・履歴保存される。機密性の高いキーワードを入力したユーザーが URL を共有した場合、キーワードが漏洩するリスクがある
- レコード ID（`#kc:record=<id>`）が URL に含まれると、kintone アプリの権限設定によっては「存在するレコード ID」が間接的に漏洩しうる。ただし kintone の権限制御は REST API 側で行われるため、ID を知られても内容にはアクセスできない
- 上記を前提として、本機能では追加のマスキング・暗号化は行わない

---

## 4. URL 設計

### 4.1 ハッシュフォーマット

```
#kc:<key>=<value>[&<key>=<value>...]
```

- プレフィクス: `#kc:` で始まる（kintone 標準ハッシュとの衝突防止）
- パラメータ区切り: `&`（URL エンコード済み文字列を想定）
- 値: URL エンコード済み文字列（`encodeURIComponent` / `decodeURIComponent` を使用）

### 4.2 パラメータ仕様

| キー | 値の形式 | 例 | 更新方式 |
|---|---|---|---|
| `view` | `month` / `week` / `day` | `#kc:view=month` | `replaceState` |
| `date` | `YYYY-MM`（月）/ `YYYY-MM-DD`（週・日） | `#kc:date=2026-06` | `replaceState` |
| `filter` | `all` / `mine` / `others` | `#kc:filter=mine` | `replaceState` |
| `q` | URL エンコード済み文字列 | `#kc:q=%E4%BC%9A%E8%AD%B0` | `replaceState` |
| `record` | kintone レコード ID（数値文字列） | `#kc:record=123` | `pushState` |
| `new` | `YYYY-MM-DD` または `YYYY-MM-DDTHH:mm` | `#kc:new=2026-06-15T10:00` | `pushState` |
| `more` | `YYYY-MM-DD` | `#kc:more=2026-06-15` | `pushState` |
| `fs` | `0`（全画面解除状態）| `#kc:fs=0` | `replaceState` |
| `scroll` | `HH:mm` | `#kc:scroll=09:00` | `replaceState` |
| `settings` | `1`（設定ポップアップ）| `#kc:settings=1` | 対象外（§4.4 参照） |

### 4.3 組み合わせ例

```
#kc:view=week&date=2026-06-09&filter=mine&q=%E4%BC%9A%E8%AD%B0&scroll=09:00
#kc:view=month&date=2026-06&record=456
#kc:view=month&date=2026-06-15&more=2026-06-15
```

### 4.4 スコープ外パラメータの取り扱い

| 対象 | 理由 |
|---|---|
| `settings=1` | 設定ポップアップは kintone 管理画面への `window.location.href` ページ遷移であり、カレンダー内状態ではないため対象外 |
| kintone 標準クエリパラメータ (`?view=`, `?q=`, `$id` 等) | 触れない（§3.2 前提条件） |

---

## 5. 機能要件

### FR-1: ビュー種別・表示日付の URL 同期

- DnD でのビュー切替・prev/next ナビゲーション・today ボタン操作時に、`view` および `date` パラメータを `replaceState` で更新する
- `date` は月ビューは `YYYY-MM`、週・日ビューは `YYYY-MM-DD` 形式で書き込む
- 復元時: `view` + `date` を解析して `KC.State.view` と `KC.State.current` を設定した上で `KC.Render.refresh()` を呼ぶ

### FR-2: フィルタの URL 同期

- `KC.FilterDropdown._saveAndRefresh()` 呼び出し時に `filter` パラメータを `replaceState` で更新する
- **URL と localStorage の優先順位（確定）**: URL に `filter` パラメータが存在する場合は URL の値を優先する。存在しない場合は localStorage の値を使用する（既存動作を維持）
- 復元時: `KC.State.eventFilter` に値を設定し、`KC.FilterDropdown.loadFilter()` の後に URL 値で上書きする

### FR-3: 検索キーワードの URL 同期

- `KC.SearchFilter.setQuery(q)` 呼び出し時に `q` パラメータを `replaceState` で更新する。空文字の場合は `q` パラメータを URL から除去する
- 復元時: `KC.SearchFilter.setQuery(decodedQ)` を呼び出してクエリを復元する。検索バーの input 要素にも値を反映する（`KC.SearchFilter._syncClearBtn()` 相当）
- `searchTargets` が空（検索バー非表示）の場合は URL に `q=` が残っていても無視する

### FR-4: レコード編集モーダルの URL 同期

- `KC.Popup.openEdit(recordId)` 呼び出し時に `record=<id>` を `pushState` で追加する
- `KC.Popup._close()` 呼び出し時に `record` パラメータを URL から除去して `replaceState` する
- **復元時**: `KC.Api.getRecord(id)` 等でレコードの存在を確認してからモーダルを開く。レコードが存在しない（API エラー / 404 相当）場合は `KC.Banner.show('指定されたレコードが見つかりません')` を表示してモーダルは開かない
- `popstate` イベントで `record` パラメータが消えた場合（ブラウザ「戻る」操作）はモーダルを閉じる

### FR-5: 新規作成モーダルの URL 同期

- `KC.Popup.openCreate(options)` 呼び出し時に `new=<date>` を `pushState` で追加する。`options.date` + `options.hour` / `options.minute` から `YYYY-MM-DD` または `YYYY-MM-DDTHH:mm` 形式を生成する。`options.allday === true` の場合は日付のみ（`YYYY-MM-DD`）形式とする
- `KC.Popup._close()` 呼び出し時に `new` パラメータを URL から除去して `replaceState` する
- **復元時**: `#kc:new=YYYY-MM-DD(THH:mm)` を解析して `openCreate(options)` を呼び出す
- `popstate` イベントで `new` パラメータが消えた場合はモーダルを閉じる

### FR-6: +N more ポップオーバーの URL 同期

- `KC.OverflowPopup.open(anchorEl, dateYMD, eventsList)` 呼び出し時に `more=<YYYY-MM-DD>` を `pushState` で追加する
- `KC.OverflowPopup.close()` 呼び出し時に `more` パラメータを URL から除去して `replaceState` する
- **復元時**: カレンダーの描画完了後に、対象日付のセルに対応する `.kc-month-more` 要素が DOM 上に存在する場合のみポップオーバーを開く。月ビュー以外でアクセスした場合、または対象日付のセルが DOM に存在しない場合はパラメータを無視する（§7.3 参照）
- `popstate` イベントで `more` パラメータが消えた場合はポップオーバーを閉じる

### FR-7: 全画面モードの URL 同期

**セマンティクス（確定）**: KC Calendar の起動時は常に全画面状態がデフォルトである。そのため `fs` パラメータは「全画面を解除した状態」を記録する用途とする。

| 状態 | URL | 説明 |
|---|---|---|
| 全画面（デフォルト） | `fs` パラメータなし | 起動デフォルトと一致するため記録不要 |
| 全画面解除 | `#kc:fs=0` | 明示的に解除した状態を記録 |

- `KC.Boot._exitExpanded(root)` 呼び出し時に `fs=0` を `replaceState` で書き込む
- `KC.Boot._enterExpanded(root)` 呼び出し時に `fs` パラメータを URL から除去して `replaceState` する（全画面に戻ったのでデフォルト状態へ）
- **復元時**: `fs=0` のときのみ `KC.Boot._exitExpanded(root)` を呼び出す。`fs` パラメータがない場合は何もしない（起動デフォルトの全画面のまま維持）
- **実装上の注意（順序バグ対策）**: `KC.Boot.init` 冒頭で `_initialHash = window.location.hash` としてハッシュをキャッシュしておく。`KC.UrlState.restore()` はキャッシュ値（`_initialHash`）から `fs` を読む。init 処理中に `_enterExpanded` / `_exitExpanded` が呼ばれて `fs` が URL から除去・書き込みされても、キャッシュ値には影響しないため順序バグが発生しない

### FR-8: 週ビュースクロール位置の URL 同期

- `KC.TimeGrid.scrollToDefaultTime()` が呼ばれる時点（週・日ビューの初回描画後）でデフォルトスクロール位置（現行は `hourHeight * 6.5` = 約 6:30）を `scroll=HH:mm` として `replaceState` する
- ユーザーが `#kc-body` を手動スクロールした場合は `scroll` パラメータを更新する。更新はスクロール停止後（`scroll` イベントのデバウンス、約 500ms 後）に行う
- 復元時: `kc-body` の `scrollTop` を `HH:mm` から換算して設定する。設定は週・日ビューの `renderGrid` 完了後（`requestAnimationFrame` 内）に行う
- 月ビューでは `scroll` パラメータを無視する（月ビューはスクロール不要なレイアウト）

### FR-9: URL パラメータの組み合わせ

- 複数パラメータは 1 つのハッシュ文字列に `&` 区切りで連結する
- `replaceState` 更新時は現在のハッシュを解析して対象パラメータのみ書き換える（他のパラメータを消さない）

### FR-10: popstate によるブラウザ戻る/進む追従

- `window.addEventListener('popstate', handler)` を `KC.Boot.init` 内で登録する（`_buildDOM()` 完了後）
- `popstate` 発火時はハッシュを再パースして状態を差分更新する:
  - `record` / `new` パラメータが消えた → 対応モーダルを閉じる
  - `more` パラメータが消えた → ポップオーバーを閉じる
  - `view` / `date` が変わった → `KC.Render.refresh()` を呼ぶ

### FR-11: 無限ループ防止ガード

- カレンダー JS 自身が `replaceState` / `pushState` でハッシュを書き換えたことによる `hashchange` イベントを無視するガードを設ける
- 実装方法: `_isUpdatingHash` フラグ（boolean）を設け、`KC.UrlState.update()` 実行中は `true` に設定し、`hashchange` ハンドラの先頭で `if (_isUpdatingHash) return;` としてスキップする

### FR-12: 異常系処理

| ケース | 動作 |
|---|---|
| 存在しないレコード ID（`record=999999`） | `KC.Banner.show('指定されたレコードが見つかりません')` を表示。モーダルは開かない。`record` パラメータを URL から除去 |
| 不正な `view` 値（`view=foo`） | パラメータを無視。`KC.State.view` はデフォルト値（`month`）を維持 |
| 不正な `date` 値（`date=foo-bar`） | パラメータを無視。`KC.State.current` はデフォルト値（今日）を維持 |
| 不正な `filter` 値（`filter=xyz`） | パラメータを無視。`KC.State.eventFilter` は localStorage または `all` を維持 |
| 不正な `scroll` 値（`scroll=99:99`） | パラメータを無視。デフォルトスクロール位置を使用 |
| `#kc:` プレフィクスなしのハッシュ（`#record=1` 等） | ハッシュ全体を無視 |
| ハッシュ全体が空 | 何もしない（デフォルト初期表示） |
| `more=YYYY-MM-DD` だがその日のセルが月ビューに存在しない | パラメータを無視 |

---

## 6. 非機能要件

### NF-1: URL 更新のパフォーマンス

- `replaceState` はユーザー操作（ボタンクリック・DnD 確定・スクロール停止等）のイベントハンドラで呼ぶ。アニメーション中やレンダリングのたびに呼ばない
- `scroll` イベントのデバウンス: 500ms（スクロール停止後に `replaceState` を 1 回だけ呼ぶ）

### NF-2: 既存機能との後方互換

- ハッシュがない（空）状態でのアクセスは従来どおり動作する
- `localStorage` のフィルタ永続化は引き続き動作する（URL 優先という追加ルールが重なるだけ）
- `KC.Popup` / `KC.OverflowPopup` 等の既存 API シグネチャは変更しない（URL 同期はラッパーまたは呼び出しポイントへの追加として実装する）

### NF-3: 実装モジュール分離

- URL 読み書きロジックは `KC.UrlState` モジュールとして新設する（§7.1 参照）
- 各既存モジュール（`KC.Popup` / `KC.OverflowPopup` / `KC.FilterDropdown` / `KC.SearchFilter` / `KC.Boot`）は `KC.UrlState` への呼び出しを追加するのみで、独自に history API を直接呼ばない

---

## 7. 実装設計

### 7.1 KC.UrlState モジュール（新設）

`KC.UrlState` を `desktop.js` に新設する。主要 API:

```
KC.UrlState.parse(hash)          → Object（キー値マップ）
KC.UrlState.serialize(params)    → String（ハッシュ文字列）
KC.UrlState.get(key)             → String | null
KC.UrlState.update(key, value)   → void（replaceState）
KC.UrlState.push(key, value)     → void（pushState）
KC.UrlState.remove(key)          → void（replaceState でキー削除）
KC.UrlState.restore()            → void（init 完了後に一括復元）
```

#### parse / serialize の仕様

```
hash = "#kc:view=month&date=2026-06&filter=mine"
→ parse(hash) = { view: 'month', date: '2026-06', filter: 'mine' }

serialize({ view: 'month', date: '2026-06' }) = "#kc:view=month&date=2026-06"
```

- `#kc:` プレフィクスで始まらない hash は `{}` を返す
- 値は `decodeURIComponent` でデコードする（書き込み時は `encodeURIComponent`）

#### update の実装例

```javascript
update: function (key, value) {
  var params = this.parse(window.location.hash);
  params[key] = value;
  var newHash = this.serialize(params);
  _isUpdatingHash = true;
  history.replaceState(null, '', newHash);
  _isUpdatingHash = false;
}
```

### 7.2 各呼び出しポイント

| 操作 | 変更対象 | 呼び出し追加箇所 |
|---|---|---|
| prev/next/today ボタンクリック | `view`, `date` 更新（replaceState） | `desktop.js` ナビゲーションボタンのイベントハンドラ（`KC.Boot.init` 内）|
| ビュー切替ドロップダウン | `view`, `date` 更新（replaceState） | `KC.ViewSwitcher` 内または `KC.State.view` 変更ポイント |
| フィルタ変更 | `filter` 更新（replaceState） | `KC.FilterDropdown._saveAndRefresh()` 内 |
| 検索クエリ変更 | `q` 更新（replaceState） | `KC.SearchFilter.setQuery()` 内 |
| モーダル openEdit | `record` 追加（pushState） | `KC.Popup.openEdit()` 内 |
| モーダル openCreate | `new` 追加（pushState） | `KC.Popup.openCreate()` 内 |
| モーダル _close | `record` / `new` 削除（replaceState） | `KC.Popup._close()` 内 |
| +N more 開く | `more` 追加（pushState） | `KC.OverflowPopup.open()` 内 |
| +N more 閉じる | `more` 削除（replaceState） | `KC.OverflowPopup.close()` 内 |
| 全画面 ON（解除状態から再全画面化） | `fs` 削除（replaceState） | `KC.Boot._enterExpanded()` 内 |
| 全画面 OFF（解除） | `fs=0` 書き込み（replaceState） | `KC.Boot._exitExpanded()` 内 |
| 週・日ビュースクロール | `scroll` 更新（replaceState） | `#kc-body` の `scroll` イベント（デバウンス 500ms） |

### 7.3 復元処理（`KC.UrlState.restore()`）

`KC.Boot.init` の末尾（初回 `KC.Render.refresh()` の後）に `KC.UrlState.restore()` を呼ぶ。

復元順序と依存関係:

```
1. ビュー・日付の復元
   │  KC.State.view, KC.State.current を設定
   │  KC.Render.refresh() を呼ぶ（loadEvents も実行される）
   ↓
2. フィルタの復元
   │  KC.State.eventFilter = urlFilter（localStorage より優先）
   │  KC.Render.renderGrid() は refresh 済みのため不要
   ↓
3. 検索クエリの復元
   │  KC.SearchFilter.setQuery(decodedQ)
   │  input 要素に値を反映
   ↓
4. 全画面の復元（_initialHash キャッシュから読む）
   │  fs=0 のとき: KC.Boot._exitExpanded(root)
   │  fs なし（デフォルト全画面）: 何もしない
   ↓
5. スクロール位置の復元（週・日ビューのみ）
   │  renderGrid 完了後の requestAnimationFrame 内で kc-body.scrollTop を設定
   ↓
6. モーダル・ポップオーバーの復元（Phase 2）
   │  record: KC.Popup.openEdit(id)（存在確認 API 後）
   │  new:    KC.Popup.openCreate(options)
   │  more:   月ビュー描画完了後に KC.OverflowPopup.open(anchorEl, ymd, events)
   │          anchorEl = document.querySelector(`[data-date="${ymd}"] .kc-month-more`)
   │          DOM に .kc-month-more が存在しない場合はスキップ
```

### 7.4 pushState 系パラメータの popstate 処理

```javascript
window.addEventListener('popstate', function (e) {
  if (_isUpdatingHash) return;  // 自己書き換え無視
  var params = KC.UrlState.parse(window.location.hash);

  // モーダルが開いていて record/new パラメータが消えた → 閉じる
  if (!params.record && !params['new'] && KC.Popup._iframe) {
    KC.Popup._close();
  }
  // ポップオーバーが開いていて more パラメータが消えた → 閉じる
  if (!params.more && KC.OverflowPopup._anchorYMD) {
    KC.OverflowPopup.close();
  }
  // view/date が変わった → リフレッシュ
  var curView = KC.State.view;
  var curDate = KC.UrlState._dateToYMD(KC.State.current);
  if (params.view && params.view !== curView) {
    KC.State.view = params.view;
  }
  if (params.date && params.date !== curDate) {
    // date を KC.State.current に反映
    KC.UrlState._applyDate(params.date);
  }
  if ((params.view && params.view !== curView) || (params.date && params.date !== curDate)) {
    KC.Render.refresh();
  }
});
```

### 7.5 モーダル復元時のレコード存在確認

```
1. KC.UrlState.get('record') で ID を取得
2. kintone.api('/k/v1/record.json', 'GET', { app: appId, id: recordId }) を呼ぶ
3. 成功 → KC.Popup.openEdit(recordId)
4. 失敗（エラー） → KC.Banner.show('指定されたレコードが見つかりません')
                   KC.UrlState.remove('record')
```

### 7.6 既存機能との接続点の整理

| 既存機能 | 接続点 | 注意事項 |
|---|---|---|
| 全画面切替（FR-5: placeMonthEvents 再計算） | `_exitExpanded` に `KC.UrlState.update('fs', '0')` を追加。`_enterExpanded` に `KC.UrlState.remove('fs')` を追加 | 復元時（`_exitExpanded` 呼び出し時）も `requestAnimationFrame` で `placeMonthEvents` を実行する（既存動作を踏襲）。`restore()` は `_initialHash` キャッシュから `fs` を読む（順序バグ対策）|
| 検索 Phase 2 フローティング一覧（`#kc-search-dropdown`） | `KC.SearchFilter.setQuery()` に `KC.UrlState.update('q', encoded)` を追加 | `searchTargets` が空の場合は `q` パラメータを URL から除去する |
| iframe モーダル（REQ_popup-behavior-fix） | `KC.Popup.openEdit()` / `openCreate()` / `_close()` に `KC.UrlState.push()` / `remove()` を追加 | `_close()` は複数の経路（× ボタン・backdrop クリック・保存完了後の自動クローズ）から呼ばれるため、すべての経路で `remove()` が実行されることを確認する |
| +N more ポップオーバー（REQ_month-overflow-popup） | `KC.OverflowPopup.open()` / `close()` に `KC.UrlState.push()` / `remove()` を追加 | `close()` はリサイズ・外側クリック・ESC でも呼ばれるため、すべての経路で `remove()` が実行されることを確認する |

---

## 8. Phase 分割計画

実装規模が大きいため、以下の 2 Phase で分割して実装する。

### Phase 1: replaceState 系（ビュー/日付/フィルタ/検索/全画面/スクロール）

**スコープ**:
- `KC.UrlState` モジュールの新設（parse / serialize / get / update / remove）
- FR-1 〜 FR-3、FR-7、FR-8（`replaceState` のみ使用）
- `popstate` リスナーの基本登録（replaceState 系パラメータの差分更新）
- `KC.UrlState.restore()` の基本部分（ビュー/日付/フィルタ/検索/全画面/スクロール）
- 無限ループ防止ガード（FR-11）

**Phase 1 完了基準**:
- ページリロード後にビュー・日付・フィルタ・検索キーワード・全画面状態が復元される
- prev/next 操作で URL ハッシュが更新される（ブックマーク可能）
- フィルタ変更で URL ハッシュが更新される
- 検索キーワード入力で URL ハッシュが更新される

### Phase 2: pushState 系（モーダル/ポップオーバーの開閉 + 復元）

**スコープ**:
- FR-4、FR-5、FR-6（`pushState` を使用）
- `popstate` リスナーの拡張（record / new / more パラメータの消滅検知 → クローズ処理）
- `KC.UrlState.restore()` の Phase 2 部分（モーダル・ポップオーバー復元）
- FR-12 の異常系処理（存在しないレコード ID のバナー表示）

**Phase 2 完了基準**:
- 予定クリック → モーダル開 → URL に `record=N` が追加される
- ブラウザ「戻る」でモーダルが閉じる
- `#kc:record=N` を直接入力してアクセスするとモーダルが開く（存在するレコードの場合）
- `#kc:record=N`（存在しないレコード）でエラーバナーが表示される
- `#kc:more=YYYY-MM-DD` でポップオーバーが開く（月ビュー、対象日のセルが存在する場合）

---

## 9. 受入基準

### AC-1: ビュー・日付の URL 同期

- **Given**: 週ビューで 2026-06-09 を表示している状態で
- **When**: ページをリロードしたとき
- **Then**: `#kc:view=week&date=2026-06-09` が URL に存在し、リロード後も週ビュー・2026-06-09 表示が復元される

### AC-2: next ボタン操作で URL が更新される

- **Given**: 月ビュー 2026-06 を表示している状態で
- **When**: 「次の月」ボタンをクリックしたとき
- **Then**: URL ハッシュが `#kc:view=month&date=2026-07`（または同等の組み合わせ）に更新される
- **And**: ブラウザ履歴には追加されない（`replaceState`）

### AC-3: フィルタの URL 優先

- **Given**: localStorage に `kc-event-filter=mine` が保存されており、URL ハッシュに `#kc:filter=others` が存在する状態で
- **When**: ページをリロードしたとき
- **Then**: フィルタが `others`（URL 優先）で復元される

### AC-4: フィルタなし時 localStorage 使用

- **Given**: localStorage に `kc-event-filter=mine` が保存されており、URL ハッシュに `filter` パラメータが存在しない状態で
- **When**: ページをリロードしたとき
- **Then**: フィルタが `mine`（localStorage 値）で復元される

### AC-5: 検索キーワードの URL 同期

- **Given**: カレンダーで「会議室」と検索している状態で
- **When**: ページをリロードしたとき
- **Then**: 検索バーに「会議室」が復元され、フローティング一覧にマッチ予定が表示される

### AC-6: モーダル URL 同期（pushState）

- **Given**: カレンダーで予定クリック → レコード編集モーダルが開いている状態で
- **When**: URL を確認すると
- **Then**: `#kc:record=<id>` が含まれている（`pushState` で追加済み）

### AC-7: ブラウザ「戻る」でモーダルが閉じる

- **Given**: 予定クリック → モーダルが開いて `#kc:record=N` が URL に追加された状態で
- **When**: ブラウザの「戻る」ボタンをクリックしたとき
- **Then**: モーダルが閉じ、`record` パラメータが URL から消える

### AC-8: 存在しないレコード ID の異常系

- **Given**: URL に `#kc:record=999999`（存在しないレコード ID）が含まれている状態で
- **When**: ページをリロードしたとき
- **Then**: モーダルが開かず、エラーバナーが表示される
- **And**: `record` パラメータが URL から除去される

### AC-9: 不正パラメータを無視

- **Given**: URL ハッシュが `#kc:view=invalid&date=not-a-date` の状態で
- **When**: ページをリロードしたとき
- **Then**: カレンダーはデフォルトのビュー（月ビュー）・今日の日付で表示される（エラーにならない）

### AC-10: 全画面状態の URL 同期

- **Given**: 起動直後（全画面デフォルト状態）で `fs` パラメータが URL にない状態で
- **When**: ページをリロードしたとき
- **Then**: 全画面状態のまま表示される（`fs` なし = デフォルト全画面）

- **Given**: 全画面解除ボタンをクリックして通常表示にした状態で
- **When**: ページをリロードしたとき
- **Then**: `#kc:fs=0` が URL に存在し、リロード後も通常表示（非全画面）が復元される

- **Given**: `#kc:fs=0` が URL にある状態でページをリロードしたとき
- **When**: 全画面ボタンをクリックして全画面に戻したとき
- **Then**: URL から `fs` パラメータが除去される

### AC-11: +N more ポップオーバーの URL 同期

- **Given**: 月ビューで 2026-06-15 の `+N more` をクリックしてポップオーバーが開いている状態で
- **When**: URL を確認すると
- **Then**: `#kc:more=2026-06-15` が含まれている

### AC-12: ブラウザ「戻る」でポップオーバーが閉じる

- **Given**: `+N more` ポップオーバーが開いて `#kc:more=YYYY-MM-DD` が URL に追加された状態で
- **When**: ブラウザの「戻る」ボタンをクリックしたとき
- **Then**: ポップオーバーが閉じ、`more` パラメータが URL から消える

### AC-13: `#kc:` なしのハッシュを無視

- **Given**: kintone 標準画面等が `#record=1` のようなハッシュを設定している状態で
- **When**: `KC.UrlState.parse()` がそのハッシュを処理したとき
- **Then**: `{}` を返し、カレンダーの状態を変更しない

### AC-14: 無限ループが発生しない

- **Given**: `KC.UrlState.update('view', 'month')` を呼んだとき
- **When**: `hashchange` イベントが発火しても
- **Then**: カレンダーが無限に再描画されない（`_isUpdatingHash` ガードが機能している）

### AC-15: スクロール位置の URL 同期

- **Given**: 週ビューで `#kc-body` を手動スクロールして 09:00 付近を表示している状態で
- **When**: ページをリロードしたとき
- **Then**: スクロール位置が 09:00 付近に復元される（`#kc:scroll=09:00` が URL に存在する）

---

## 10. 未確定事項・リスク・前提

| ID | 内容 | 状態 |
|---|---|---|
| Q-1 | **`popstate` vs `hashchange` の使い分け**: kintone 一覧画面（`/k/891/`）が `hashchange` を使っていないことを実機確認済み（2026-06-11）。`history.replaceState` でハッシュを書き込んでも kintone 側に反応なし。実装は `popstate` を主リスナーとし `hashchange` は使用しない方針で確定 | **確認済み・解決**（2026-06-11）|
| Q-2 | **kintone のハッシュ競合**: `#kc:view=month&date=2026-06&filter=mine` をハッシュ付きで直接読み込み、kintone がハッシュを剥がさず保持しページを正常ロードすることを実機確認済み（2026-06-11、k/891）。`#kc:` プレフィクス設計の前提は成立。詳細は §3.2 前提条件 2 を参照 | **確認済み・解決**（2026-06-11）|
| Q-3 | **スクロール位置の `scroll` イベントデバウンス遅延**: 500ms を推奨しているが、体感的に遅い・早い場合は調整可。また `#kc-body` の scroll イベントが月ビューでも発火する可能性があるため、週・日ビューのみイベントを有効化するガードが必要（実装時に確認）| **builder 確認事項** |
| Q-4 | **`KC.Popup._close()` の呼び出し経路の網羅性**: `_close()` は `× ボタン` / `backdrop クリック` / `ESC` / `iframe 内保存完了後の自動クローズ` / `iframe 内許可外遷移での自動クローズ` の少なくとも 5 つの経路から呼ばれる（REQ_popup-behavior-fix 参照）。URL `remove()` の追加漏れがないか builder が全経路を確認すること | **builder 確認事項** |
| Q-5 | **Phase 2 の `record` 復元時の存在確認 API コスト**: `KC.Api.getRecord(id)` を init 時に追加呼び出しすると初期ロード時間が伸びる。`KC.Popup.openEdit()` 内の既存の `_show()` で iframe がロードされた際に kintone 側が 403/404 を返した場合のモーダル自動クローズ（REQ_popup-behavior-fix の許可 URL パターン外遷移検知）で代替できるか検討 | **builder 技術判断** |

### 10.1 TOCTOU 類似リスク（共有 URL でのレコード削除）

URL に含まれるレコード ID が共有後に削除された場合、復元時にエラーバナーが表示される。これは仕様どおりの動作であり、本機能で対処すべき問題ではない（FR-12 の異常系として定義済み）。

### 10.2 kintone の history スタックとの干渉

kintone アプリ内のページ遷移（一覧 → 詳細 → 編集）も history スタックを使用する。`KC.Popup` で iframe 内の `history.back()` が親ウィンドウの history スタックを遡ることは `sandbox` の `allow-top-navigation` 除外により防止済み（REQ_popup-behavior-fix §3.2.1）。本機能の `pushState` が kintone の遷移履歴と混在する可能性があるが、`#kc:` プレフィクスによるパターンマッチングで kintone 側のハッシュ変化とは区別される。

---

## 11. 検証項目・テストシナリオ

### T-1: Phase 1 基本シナリオ

1. カレンダーを開く（月ビュー・今日を表示）
2. 「次の月」を 2 回クリック
3. 確認: URL ハッシュに `#kc:view=month&date=YYYY-MM`（2 か月後）が含まれる（DevTools コンソールで `window.location.hash` を確認）
4. ページをリロード
5. 確認: 2 か月後の月ビューが表示される（AC-1）

### T-2: フィルタの URL 優先シナリオ

1. フィルタを「自分のみ」に変更
2. 確認: URL ハッシュに `filter=mine` が含まれる
3. 別タブで同じ URL（`filter=mine` 入り）を開く
4. 確認: フィルタが「自分のみ」で表示される（AC-3）
5. localStorage に `kc-event-filter=others` を手動設定し、`filter=` なしの URL でリロード
6. 確認: フィルタが `others` で表示される（AC-4）

### T-3: モーダルの pushState シナリオ（Phase 2）

1. 任意の予定をクリック → モーダルが開く
2. 確認: URL に `#kc:record=N` が追加される（DevTools）
3. ブラウザの「戻る」ボタンをクリック
4. 確認: モーダルが閉じ、`record` パラメータが URL から消える（AC-7）
5. ブラウザの「進む」ボタンをクリック
6. 確認: モーダルが再び開く（pushState の進む動作）

### T-4: 異常系シナリオ

1. URL ハッシュを手動で `#kc:record=999999999` に変更してリロード
2. 確認: エラーバナーが表示される（AC-8）
3. 確認: モーダルが開かない
4. URL ハッシュを `#kc:view=invalid` に変更してリロード
5. 確認: デフォルト表示（月ビュー・今日）になりエラーにならない（AC-9）

### T-5: +N more ポップオーバーシナリオ（Phase 2）

1. 月ビューで予定が 4 件以上ある日を確認
2. `+N more` をクリック → ポップオーバーが開く
3. 確認: URL に `#kc:more=YYYY-MM-DD` が追加される
4. ブラウザの「戻る」ボタンをクリック
5. 確認: ポップオーバーが閉じ、`more` パラメータが消える（AC-12）

### T-6: 複合パラメータシナリオ

1. 週ビューで 2026-06-09 を表示、フィルタ「自分のみ」、検索キーワード「会議」を入力（全画面はデフォルトのため `fs` なし）
2. 確認: URL に `view=week&date=2026-06-09&filter=mine&q=%E4%BC%9A%E8%AD%B0&scroll=HH:mm` が含まれる（`fs` パラメータは存在しない）
3. URL をコピーして別タブで開く
4. 確認: 同じ状態が復元される

### T-7: 無限ループ確認シナリオ

1. 週ビューに切り替える
2. 確認: `hashchange` または `popstate` イベントが無限ループしない（DevTools の Performance タブで確認、またはコンソールに無限ループのログが出ないこと）

---

## 12. 想定 UX / シーケンス

### 12.1 URL 共有フロー

```
ユーザー A: 特定の週ビュー（2026-07 第 3 週）を表示
→ URL に #kc:view=week&date=2026-07-13 が含まれる
→ URL をコピーしてユーザー B に Slack で共有
↓
ユーザー B: リンクをクリック
→ KC Calendar が起動
→ #kc: ハッシュを解析して 2026-07-13 週ビューを復元
→ ユーザー A と同じ画面を確認
```

### 12.2 予定 URL 共有フロー（Phase 2）

```
ユーザー A: 予定「定例会議」をクリック → モーダルが開く
→ URL に #kc:view=week&date=2026-07-13&record=456 が含まれる
→ URL をコピーして共有
↓
ユーザー B: リンクをクリック
→ カレンダーが 2026-07-13 週ビューで表示される
→ 続いてレコード 456 の存在確認 API を呼ぶ
→ 存在する → KC.Popup.openEdit(456) でモーダルが開く
→ 削除済みの場合 → エラーバナー表示、モーダルは開かない
```

### 12.3 ブラウザ「戻る」でモーダルを閉じるフロー

```
ユーザー: カレンダーを閲覧中
→ 予定をクリック → pushState → URL に record=N 追加 → モーダル表示
→ モーダル内を確認
→ ブラウザ「戻る」ボタンをクリック
→ popstate 発火 → record パラメータなし → KC.Popup._close() 呼び出し
→ モーダルが閉じる → カレンダーに戻る
```

---

*第 1 版（2026-06-11）: ユーザー確定事項（全ケース実装・plugin 限定・kc: プレフィクス・history API 使い分け・復元順序・Phase 分割）を反映して初版作成。未確定事項 Q-1〜Q-5 を §10 に整理。*
*第 2 版（2026-06-11）: Q-1（kintone の hashchange 不使用を実機確認）・Q-2（kintone のハッシュ競合なし・ハッシュ保持を実機確認）を解決済みに更新。§3.2 前提条件 2 に実機確認結果を明記。残存未確定事項は Q-3〜Q-5 のみ。*
*第 3 版（2026-06-11）: FR-7 全画面 URL セマンティクスを反転。デフォルト（fs なし）= 全画面、全画面解除 = `fs=0` に変更。restore() は `fs=0` のときのみ `_exitExpanded` を呼ぶ。init 冒頭で `_initialHash` キャッシュを取得して順序バグを防ぐ実装注意を追記。§4.2 パラメータ表・§4.3 組み合わせ例・§7.2 呼び出しポイント表・§7.3 復元順序・§7.6 接続点・AC-10・T-6 を更新。*
