# REQ_popup-behavior-fix — 予定クリック時ポップアップ背面落ち問題の解決

ステータス: 確定版 第3版（iframe 遷移監視によるモーダル自動クローズを追加）
作成日: 2026-05-27
更新日: 2026-05-27（iframe 遷移監視・許可 URL パターン・受入基準 AC-9/AC-10 追加）
担当: designer

---

## 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| ドラフト 第1版 | 2026-05-27 | 初版作成・3案比較・案 A 推奨 |
| 確定版 第1版 | 2026-05-27 | 案 B（独自モーダル化）採用確定。B-1/B-2 詳細設計追加。受入基準・未確定事項更新 |
| 確定版 第2版 | 2026-05-27 | ユーザー確定事項を反映。表示方式 B-1（iframe）採用・B-2 不採用（将来代替案）。モーダルサイズ中央レスポンシブ確定。backdrop 外クリックで閉じる確定。受入基準を具体化。未確定事項を CSP 実機確認と iframe ヘッダー処理の 2 点に絞り込み |
| 確定版 第3版 | 2026-05-27 | iframe 遷移監視による許可外遷移でのモーダル自動クローズ要件を追加（FR-3・AC-9・AC-10）。許可 URL パターン（正規表現）・load イベント監視ロジック設計を §8.7 に追加。未確定事項 Q3 に編集 URL 差異の実機確認を追記 |

---

## §1 背景・目的

### 問題の概要

kintone-calendar プラグインで予定をクリックすると、kintone レコード詳細画面が別ウィンドウ（小窓）で開く。この小窓は、親ウィンドウをクリックした瞬間に背面に隠れ、タスクバーを操作しないと前面に戻せない。

全画面モード（`.kc-root.kc-expanded`）で使用した場合、親ウィンドウが `z-index: 9999` の `position: fixed` で画面全体を覆うため、ポップアップが背面に回ると視覚的に「消えた」ように見え、ユーザーが操作不能に陥る。

### 目的

- 予定クリックで開く画面が「背面に隠れる」事象を解消する
- 全画面モードとの相性を確保する
- 案 B（独自モーダル化）の詳細設計を確定し、実装に入れる状態にする

---

## §2 現状分析

### 2.1 KC.Popup モジュールの実装

**ファイル:** `plugin/src/js/desktop.js`

`KC.Popup._openWindow`（893–912行）の実装:

```javascript
_openWindow: function (url) {
  var width  = Math.min(1400, Math.floor(window.screen.availWidth * 0.8));
  var height = Math.min(900, Math.floor(window.screen.availHeight * 0.85));
  var left   = Math.max(0, Math.floor((window.screen.availWidth - width) / 2));
  var top    = Math.max(0, Math.floor((window.screen.availHeight - height) / 2));
  var features = 'width=' + width + ',height=' + height +
                 ',left=' + left + ',top=' + top +
                 ',scrollbars=yes,resizable=yes';
  return window.open(url, 'kc_edit', features);
},
```

`KC.Popup.openEdit`（942–960行）:

- `recordId` を受け取り `/k/{appId}/show#record={recordId}` を `_openWindow` で開く
- **レコード詳細表示専用**。ポップアップが閉じられたら `KC.Render.refresh()` を呼ぶ（500ms ポーリング）

`KC.Popup.openCreate`（914–939行）:

- `{ date, hour, minute, allday }` を受け取り `/k/{appId}/edit` を `_openWindow` で開く
- **新規作成専用**。開く前に `sessionStorage` へ複数のコンテキスト情報を書き込む（ポップアップ側で参照）
- ポップアップが閉じられたら `KC.Render.refresh()` を呼ぶ（500ms ポーリング）

`KC.Popup.openEdit` と `KC.Popup.openCreate` は **別メソッド** で役割が分かれており、実装範囲は「編集」と「新規作成」の両対応が必要。

### 2.2 KC.Popup の呼び出し箇所

コード全体を Grep した結果、`KC.Popup` は以下の合計 8 箇所から呼ばれている。

| 箇所 | メソッド | 発火条件 |
|---|---|---|
| `desktop.js:2751` | `openEdit` | 週ビュー 終日イベントクリック |
| `desktop.js:3316` | `openEdit` | 週ビュー 時間イベントクリック |
| `desktop.js:3727` | `openEdit` | 月ビュー 終日イベントクリック |
| `desktop.js:3787` | `openEdit` | 月ビュー chip クリック |
| `desktop.js:3876` | `openEdit` | 月ビュー 時間イベントクリック |
| `desktop.js:4638` | `openEdit` | （追加の時間イベント表示箇所） |
| `desktop.js:5004` | `openCreate` | 週ビュー 時間スロットクリック（新規作成） |
| `desktop.js:5019` | `openCreate` | 週ビュー 終日セルクリック（新規作成） |

また月ビューの空白セルクリック（`desktop.js:3581`）も `openCreate` を呼ぶ。

すべての呼び出し元で `KC.Popup._openWindow` による `window.open` が実行される。**モーダル化に際してはこれらすべての呼び出し元の動作を確認する必要がある。** ただし呼び出しシグネチャ（引数・戻り値）は変えず、`KC.Popup.openEdit` / `KC.Popup.openCreate` の内部実装を差し替える方針とする（呼び出し元への手戻りを最小化）。

### 2.3 全画面モードとの相性

`plugin/src/css/desktop.css:740–749` の実装:

```css
.kc-root.kc-expanded {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
  background: #fff;
}
```

既存の z-index 体系（同 CSS ファイルより）:

| 要素 | z-index |
|---|---|
| `.kc-root.kc-expanded`（全画面モード） | 9999 |
| `.kc-event--ghost`（DnD ゴースト） | 9999 |
| `.kc-search-dropdown`（検索ドロップダウン） | 1000 |
| `.kc-overlay`（時間グリッドオーバーレイ） | 20 |

モーダルの backdrop と本体は **z-index: 10000 以上** に設定する必要がある。

### 2.4 背面落ちの原因（再掲・略）

ブラウザのウィンドウ管理仕様により `window.open` で開いた別ウィンドウへのフォーカス維持は JavaScript から制御できない。案 B（同一 DOM 内モーダル）により根本解消する。

### 2.5 設計意図の確認

`DESIGN.md §8` では `Dialog.openEdit(event)` と記述されているが、現実装は `KC.Popup.openEdit` であり設計書との乖離がある。プラグイン化時に外部ウィンドウ方式に変更されたと推定されるが経緯は文書化されていない。今回の案 B 実装により、設計書の意図（同一ページ内ダイアログ）に近い形に戻ることになる。

---

## §3 機能要件

### FR-1: モーダル表示（window.open 廃止）

`KC.Popup.openEdit` / `KC.Popup.openCreate` による `window.open` を廃止し、同一ページ内のオーバーレイモーダル（iframe 埋め込み方式）に置き換える。

### FR-2: モーダルを閉じる操作（3通り）

以下のいずれかの操作でモーダルを閉じ、`KC.Render.refresh()` を呼んでカレンダーを再描画する。

- ×ボタンクリック
- ESC キー押下
- backdrop（モーダル外の半透明領域）クリック

### FR-3: iframe 遷移監視によるモーダル自動クローズ

iframe 内のページが **許可 URL パターン外** に遷移しようとした場合、モーダルを自動的に閉じる。

**許可 URL パターン（モーダルを維持する範囲）:**

対象アプリ ID は `kintone.app.getId()` で取得した値に限定する。他アプリの同種画面は許可しない。

| 画面 | URL パターン |
|---|---|
| レコード詳細 | `/k/{appId}/show` + `hash` に `record=` を含む |
| レコード編集（show#mode=edit 形式） | `/k/{appId}/show` + `hash` に `record=` かつ `mode=edit` を含む |
| レコード編集（/edit 形式） | `/k/{appId}/edit` + `?record=` または `#record=` を含む |
| 新規作成 | `/k/{appId}/edit`（クエリなし・ハッシュなしも含む） |
| アプリ設定全般 | `/k/admin/app/{appId}/` 以下のすべてのパス |
| アプリのフロー設定 | `/k/admin/app/flow` + `?app={appId}` を含む |

**許可外となる主なケース:**

- kintone ポータル（`/k/`）
- 他アプリのレコード画面（`/k/{otherId}/...`）
- レコード一覧トップ（`/k/{appId}/` のみ・パス末尾が appId で終わる）
- スペース・ピープル・その他 kintone 機能ページ
- ログイン画面（`/login` 等、セッション切れ時）

**検知方式:**

iframe が same-origin（`*.cybozu.com`）であるため、`iframe.addEventListener('load', ...)` 内で `iframe.contentWindow.location` を読み取り、上記許可パターンと照合する。不一致の場合はモーダルを閉じる（`KC.Popup._close()` 呼び出し）。

**エッジケース:**

- 初回ロード（`iframe.src` セット直後の load イベント）は許可パターン内のため閉じない
- 保存後に kintone が詳細画面へ自動遷移するケースは許可パターン内のため閉じない
- ログイン切れで `/login` 等に飛んだ場合は許可外のため閉じる

---

## §3a 解決方針（確定）

### 採用: 案 B — 独自モーダル化（方式 B-1: iframe 埋め込み）

`window.open` によるポップアップウィンドウをやめ、同一ページ内のオーバーレイモーダルでレコード詳細・編集・新規作成を表示する。

**2026-05-27 ユーザー確定:** 方式 B-1（iframe 埋め込み）で実機確認を行う。方式 B-2 は不採用（将来の代替案として §3.2 に記録）。案 A（新規タブ化）・案 C（focus 維持）は不採用。

### 3.1 方式 B-1: iframe 埋め込み（採用）

kintone 標準のレコード詳細 URL（`/k/{appId}/show#record={id}`）または編集 URL（`/k/{appId}/edit`）を `<iframe>` に埋め込み、オーバーレイモーダルに表示する。

**構造:**

```html
<!-- モーダル全体 -->
<div id="kc-modal-backdrop" class="kc-modal-backdrop">
  <div id="kc-modal" class="kc-modal" role="dialog" aria-modal="true">
    <button class="kc-modal-close" aria-label="閉じる">×</button>
    <iframe id="kc-modal-iframe" class="kc-modal-iframe" src=""></iframe>
  </div>
</div>
```

**表示フロー（openEdit の場合）:**

1. `KC.Popup.openEdit(recordId)` 呼び出し
2. `<iframe src="/k/{appId}/show#record={recordId}">` に URL を設定
3. backdrop を表示（`display: block`）
4. iframe がロードされ、kintone 標準レコード詳細が表示される
5. ユーザーが編集・保存などを標準 UI で操作
6. 閉じる操作（×ボタン / ESC / backdrop クリック）で backdrop を非表示
7. モーダルを閉じるタイミングで `KC.Render.refresh()` を呼ぶ

**表示フロー（openCreate の場合）:**

1. `KC.Popup.openCreate(options)` 呼び出し
2. `sessionStorage` へのコンテキスト書き込みは既存ロジックをそのまま維持
3. `<iframe src="/k/{appId}/edit">` に URL を設定して backdrop 表示
4. 閉じるタイミングで `KC.Render.refresh()` を呼ぶ

**メリット:**

- kintone 標準の編集フォーム・バリデーション・権限制御・削除などを丸投げできる
- `openCreate` の sessionStorage コンテキスト渡しも既存ロジックを流用できる
- 実装量が最小（DOM 生成・iframe src 設定・開閉制御のみ）
- 将来のフィールド追加・変更にも自動追従する

**デメリット:**

- iframe 内に kintone 標準ヘッダー（ナビゲーション・アプリ選択バーなど）が表示される。CSS で `pointer-events: none` や非表示にする必要があるが、**kintone の DOM 構造が変わると崩れる可能性がある**
- iframe ロード中のローディング表示が必要
- iframe 内の保存・キャンセル操作の完了をモーダル側が検知する手段が限定的（§3.3 参照）

**same-origin 制約について:**

kintone は `https://{subdomain}.cybozu.com` ドメインで動作し、カスタマイズ JS・iframe の src も同一ドメインとなる。同一オリジンであれば `X-Frame-Options: SAMEORIGIN` の制約には抵触しない。**ただし kintone が `Content-Security-Policy: frame-ancestors` を設定している場合は別途制約を受ける可能性があり、実機で要確認。**

---

### 3.2 方式 B-2: REST 取得 + 独自描画（不採用・将来の代替案として記録）

> **2026-05-27 確定:** 方式 B-2 は不採用。ただし B-1 が CSP 制約により実機でブロックされた場合の代替案として設計を記録する。

kintone REST API（`GET /k/v1/record.json`）でレコードデータを取得し、モーダル内に独自の HTML フォームを描画する。編集・保存・削除も REST API で独自実装する。

**構造:**

```html
<div id="kc-modal-backdrop" class="kc-modal-backdrop">
  <div id="kc-modal" class="kc-modal" role="dialog" aria-modal="true">
    <button class="kc-modal-close" aria-label="閉じる">×</button>
    <div id="kc-modal-body" class="kc-modal-body">
      <!-- JS でフィールドを動的描画 -->
    </div>
  </div>
</div>
```

**必要な実装範囲:**

| 機能 | 実装コスト |
|---|---|
| レコード詳細表示（読み取り専用） | 低〜中（フィールドを `<dl>` 等で表示） |
| 編集フォーム（フィールド型別入力 UI） | 大（テキスト/日時/チェックボックス/ドロップダウン/ユーザー選択 等） |
| バリデーション | 大（kintone の必須・値制限を再現） |
| 保存（PUT `/k/v1/record.json`） | 中 |
| 新規作成（POST `/k/v1/record.json`） | 中 |
| 削除（DELETE `/k/v1/record.json`） | 小 |
| 権限制御（閲覧専用ユーザーへの対応） | 大 |

**メリット:**

- kintone ヘッダーが表示されず、モーダル内 UI を完全制御できる
- 保存タイミングをモーダル側で確実に検知できる（保存後即 `KC.Render.refresh()`）

**デメリット:**

- 編集フォームをフィールド型ごとに自前実装する必要があり、実装量が極めて大きい
- kintone の権限制御・バリデーション・添付ファイル対応などを独自に再現しなければならない
- フィールド追加・変更のたびにモーダル側も修正が必要
- 実装品質リスクが高く、バグが混入しやすい

---

### 3.3 iframe 保存完了の検知方法（B-1 の重要課題）

B-1 において、iframe 内でユーザーが保存・キャンセルを行った後にカレンダーを再描画するための検知方法として以下の選択肢がある。

**方法 X: モーダルを閉じるタイミングで再描画（最もシンプル）**

- ユーザーが×ボタンや ESC で閉じた時に `KC.Render.refresh()` を呼ぶ
- 保存したか否かに関わらず再描画するが、差分がなければ視覚的変化はない
- **推奨。** 実装が単純で確実

**方法 Y: iframe の URL 変化を監視**

- `iframe.contentWindow.location` の変化をポーリングで監視する
- 同一オリジンなら `contentWindow.location.href` を読める（実機要確認）
- 保存後に kintone が詳細画面に戻る URL 変化を検知して再描画できる
- 実装複雑度：中

**方法 Z: `postMessage`**

- iframe 内のカスタマイズ JS から `parent.postMessage()` で通知する
- iframe 内にも別のカスタマイズが必要になるため、このプロジェクトの現構成では実現困難
- 採用しない

**採用方針:** 方法 X（閉じる時に再描画）を基本とする。実機確認で問題なければ方法 Y の追加も検討する。

---

## §4 受入基準

> **2026-05-27 更新:** ユーザー確定事項（B-1 採用・中央レスポンシブ・backdrop クリックで閉じる）を受けて具体化。

### AC-1: 通常モードでのモーダル表示

- **Given:** カレンダービューが通常表示（全画面モード OFF）で表示されている
- **When:** ユーザーが予定をクリックする
- **Then:** 同一ページ内にオーバーレイモーダルが開き、レコード詳細が iframe 内に表示される。親ウィンドウを操作しても詳細が「消えない」

### AC-2: 全画面モードでのモーダル表示

- **Given:** カレンダービューが全画面モード（`.kc-expanded` 適用中、z-index: 9999）で表示されている
- **When:** ユーザーが予定をクリックする
- **Then:** モーダルが全画面レイヤーより前面（z-index: 10000 以上）に表示される。backdrop が `z-index: 10000`、モーダル本体が `z-index: 10001` 以上に設定されており、全画面カレンダーの上にモーダルが重なって確認できる

### AC-3: モーダルのサイズと配置（中央レスポンシブ）

- **Given:** モーダルが開いている
- **Then:** モーダルは画面中央に配置される。幅は `min(90vw, 1000px)`、高さは `min(90vh, 800px)` を基準としたレスポンシブサイズで表示される（小画面では縮小、大画面では上限値で固定）

### AC-4: モーダルを閉じる操作（3通り確定）

- **Given:** モーダルが開いている
- **When:** ①×ボタンをクリックする
- **Then:** モーダルが閉じ、`KC.Render.refresh()` が呼ばれてカレンダーが再描画される

- **Given:** モーダルが開いている
- **When:** ② ESC キーを押す
- **Then:** モーダルが閉じ、`KC.Render.refresh()` が呼ばれてカレンダーが再描画される

- **Given:** モーダルが開いている
- **When:** ③ backdrop（モーダル外の半透明領域）をクリックする
- **Then:** モーダルが閉じ、`KC.Render.refresh()` が呼ばれてカレンダーが再描画される（**外クリックで閉じる**を確定採用）

### AC-5: 閉じた後のカレンダー再描画と編集内容の反映

- **Given:** モーダルで kintone レコードを編集・保存し、その後モーダルを閉じた
- **When:** モーダルが閉じられる（×ボタン・ESC・backdrop クリックいずれでも）
- **Then:** `KC.Render.refresh()` が呼ばれ、カレンダー表示が自動的に更新される。保存した変更内容（日時・タイトル等）がカレンダーに反映される

### AC-6: 新規作成フロー

- **Given:** カレンダーの空白セル（時間スロット・終日セル）をクリックした
- **When:** モーダルが開く
- **Then:** kintone の新規作成フォームが日時・終日フラグ等のコンテキスト（sessionStorage 経由）付きで iframe 内に表示される

### AC-7: 連続クリック時の挙動

- **Given:** 1件目の予定をクリックしてモーダルが開いている
- **When:** カレンダー上で別の予定をクリックする（モーダルが開いたままの状態）
- **Then:** 既存モーダルが新しいレコードの内容で更新される（iframe.src の差し替えによるリロード）。ユーザーが操作不能にならない

### AC-8: モーダルと全画面モードの共存

- **Given:** 全画面モード中にモーダルが開いている
- **When:** モーダル内の操作（スクロール・入力・ボタンクリック）を行う
- **Then:** 全画面レイヤーの操作と干渉せず、モーダルが正常に機能する

### AC-9: 許可外 URL への遷移でモーダルが自動クローズする

- **Given:** モーダルが開いており、iframe 内にレコード詳細・編集・新規作成・アプリ設定画面が表示されている
- **When:** iframe 内のページが許可外の URL（kintone ポータル・他アプリ・レコード一覧トップ・スペース・ピープル・ログイン画面 等）に遷移する
- **Then:** モーダルが自動的に閉じられ、カレンダー画面に戻る。ユーザーがモーダル内に閉じ込められることはない

### AC-10: 許可 URL パターン内の遷移ではモーダルが維持される

- **Given:** モーダルが開いており、iframe 内に対象アプリのレコード詳細が表示されている
- **When:** ① ユーザーが「編集」ボタンをクリックして編集画面に遷移する、または ② 保存後に kintone が自動的に詳細画面へ遷移する
- **Then:** モーダルは閉じられず、引き続き iframe 内に遷移後の画面（編集フォームまたは詳細画面）が表示される

---

## §5 方式比較表（B-1 vs B-2）

| 評価軸 | B-1: iframe 埋め込み | B-2: REST + 独自描画 |
|---|---|---|
| 実装コスト | 低〜中（DOM 生成・開閉制御のみ） | 極大（フォーム・バリデーション全自前） |
| 実装期間（目安） | 1〜2日 | 1〜2週間以上 |
| kintone 標準 UI の保持 | 完全（標準画面をそのまま表示） | なし（独自 UI を全設計） |
| 権限制御 | kintone に委譲（自動） | 独自実装が必要（漏れリスク大） |
| フィールド変更への追従 | 自動追従 | 都度修正が必要 |
| 保存後の再描画検知 | 「閉じる時に再描画」で代替（シンプル） | 保存時に即時検知可能 |
| ヘッダー表示 | iframe 内に kintone ヘッダーが出る（CSS 対応必要） | 出ない（完全制御） |
| same-origin 制約 | 同一ドメインなら問題なし（実機要確認） | 制約なし（REST API） |
| 実装リスク | 低（iframe CSS 対応が外れるリスク） | 高（フォーム再現の品質リスク） |
| 保守性 | 高（kintone 仕様変更に自動追従） | 低（フィールド追加のたびに修正） |
| UX（背面落ち解消） | 完全解消 | 完全解消 |
| 全画面モード共存 | 良（z-index 制御のみ） | 良（z-index 制御のみ） |

---

## §6 採用方式（確定）

**採用: 方式 B-1（iframe 埋め込み）**

**2026-05-27 ユーザー確定。** まず B-1 で実機確認を行う。CSP によって iframe がブロックされた場合は §7 の方針変更フローに従う。

理由は以下の通り。

**1. 実装コストの圧倒的な差**

B-2（REST + 独自描画）は、kintone のフォーム UI をフィールド型ごとに再実装する必要がある。現在のアプリには `SINGLE_LINE_TEXT`・`DATETIME`・`CHECK_BOX`・`DROP_DOWN`・`USER_SELECT` など複数のフィールド型が存在し（`FIELD_REFERENCE.md` 参照）、それぞれの入力 UI・バリデーション・保存ロジックを網羅するコストは極めて大きい。B-1 は DOM 生成と開閉制御のみで実装が完結する。

**2. kintone 標準 UI の保持**

権限制御・バリデーション・必須項目チェック・プロセス管理などの業務ロジックは kintone 標準のフォームに任せることで、再実装リスクを排除できる。B-1 はこれを自然に実現する。

**3. 保守性の高さ**

フィールド追加・変更・削除はアプリ設定側で行えば B-1 のモーダルには影響しない。B-2 は毎回モーダル側の修正も必要になる。

**4. リスクの低さ**

B-1 のリスクは「iframe 内 CSS 調整が kintone DOM 変更で外れること」だが、影響は見た目のみ（ヘッダーが表示される）であり機能は維持される。B-2 のリスクは「フォーム再現の品質不足でデータ不整合・権限漏れが発生すること」であり、影響が業務データに及ぶ。

**5. 段階的改善の余地**

B-1 で最小コストに実装し、iframe ヘッダーの見た目問題が許容できなければ CSS 調整で対応する。将来的に B-2 相当の独自フォームが必要になった場合も、B-1 のモーダル骨格を流用できる。

---

## §7 未確定事項・残課題

以下の2点が残課題。実機確認後に builder が対応方針を決定する。Q1〜Q3 はユーザー確定済みのため削除。

### 残課題 1（最重要）: CSP frame-ancestors の実機確認

kintone（bushiroad-group.cybozu.com）が `Content-Security-Policy: frame-ancestors` を設定している場合、同一ドメインであっても iframe が拒否される可能性がある。

**確認手順:**

1. kintone のカレンダーページ上でブラウザ開発ツールを開く
2. コンソールに以下を貼り付けて iframe の表示を試みる
   - `https://{appId}.cybozu.com/k/{appId}/show#record={id}` を `src` に設定した `<iframe>` を DOM に追加
3. Console / Network タブで CSP エラーが出ないかを確認する

**結果に応じた方針変更:**

| 確認結果 | 対応方針 |
|---|---|
| iframe が正常に表示される | B-1 のまま実装を進める |
| CSP エラーで iframe がブロックされる | B-2（REST + 独自描画、§3.2）または案 A（新規タブ化）に方針変更。管理者へ報告して指示を仰ぐ |

### 残課題 2: iframe 内 kintone ヘッダー/メニューの表示制御

iframe 内には kintone 標準のナビゲーションヘッダー・アプリ選択バーなどが表示される。**隠す方向を推奨**するが、実機で UI の見栄えを確認してから最終判断する。

**実装候補（CSS）:**

```css
/* iframe 内の kintone ヘッダー類を非表示にする（DOM 構造依存・実機要確認） */
#kc-modal-iframe {
  /* 同一オリジンなら contentDocument で CSS 挿入も可能 */
}
```

**判断基準:**

- ヘッダーが表示されてもモーダルとして許容できる → CSS 非表示対応を省略（最小実装）
- ヘッダーが邪魔で UX を損なう → CSS で非表示化（kintone DOM 構造に依存するため変更リスクあり）

> **注意:** kintone の DOM 構造は将来変わる可能性があり、CSS 非表示化が外れることがある。その場合の影響は「ヘッダーが見える」のみで機能には影響しない。

### 残課題 3（新規）: kintone バージョン差による編集 URL の形式確認

kintone のバージョン（クラウド更新タイミング）によって、レコード編集画面の URL 形式が異なる可能性がある。

**確認が必要なパターン:**

| パターン | URL 形式 | 備考 |
|---|---|---|
| 旧形式 | `/k/{appId}/show#record={id}&mode=edit` | ハッシュに mode=edit が含まれる |
| 新形式 | `/k/{appId}/edit?record={id}` | クエリパラメータ形式 |

**確認手順:**

1. 実機（bushiroad-group.cybozu.com）でレコード詳細画面を開く
2. 「編集」ボタンをクリックして URL がどの形式に変化するか確認する
3. 確認結果を §8.7 の許可 URL パターンに反映する

**結果に応じた対応:**

- 旧形式のみ: `ALLOWED_URL_PATTERNS` の編集パターンを旧形式に限定
- 新形式のみ: `ALLOWED_URL_PATTERNS` の編集パターンを新形式に限定
- 両形式: 現在の設計（両形式を OR 条件で許可）のまま対応

### 確定済み事項（参考）

| 項目 | 確定値 | 確定日 |
|---|---|---|
| 表示方式 | B-1（iframe 埋め込み）で実機確認 | 2026-05-27 |
| backdrop 外クリック | モーダルを閉じる | 2026-05-27 |
| モーダルサイズ | 中央レスポンシブ（`width: min(90vw, 1000px)`, `height: min(90vh, 800px)`） | 2026-05-27 |

---

## §8 詳細設計（方式 B-1 前提）

### 8.1 モーダル DOM 構造

```html
<!-- body 直下（または #kc-root の外）に配置 -->
<div id="kc-modal-backdrop" class="kc-modal-backdrop" hidden>
  <div id="kc-modal" class="kc-modal" role="dialog" aria-modal="true" aria-label="レコード詳細">
    <div class="kc-modal-header">
      <button id="kc-modal-close" class="kc-modal-close" aria-label="閉じる">×</button>
    </div>
    <div class="kc-modal-body">
      <div class="kc-modal-loading" id="kc-modal-loading">読み込み中...</div>
      <iframe id="kc-modal-iframe" class="kc-modal-iframe" src="" title="レコード詳細"></iframe>
    </div>
  </div>
</div>
```

### 8.2 CSS z-index 設計・モーダルサイズ（確定）

**z-index:**

```
z-index 10000: .kc-modal-backdrop（半透明黒、全画面モードの 9999 より上）
z-index 10001: .kc-modal（白いモーダル本体）
```

既存の `.kc-event--ghost`（z-index: 9999）・`.kc-root.kc-expanded`（z-index: 9999）の上に重なる。

**モーダルサイズ（確定値: 中央レスポンシブ）:**

```css
.kc-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(90vw, 1000px);
  height: min(90vh, 800px);
  z-index: 10001;
}
```

**backdrop 外クリックで閉じる（確定）:**

backdrop（`.kc-modal-backdrop`）へのクリックイベントで `KC.Popup._close()` を呼ぶ。モーダル本体（`.kc-modal`）へのクリックは伝播を止めて閉じない。

### 8.3 KC.Popup モジュールの置き換え設計

既存の `_openWindow`・`openEdit`・`openCreate` を以下のように再設計する。**呼び出し元（8箇所 + セルクリック等）のシグネチャは変えない。**

```
KC.Popup = {
  _modal: null,       // モーダル DOM（初期化後にキャッシュ）
  _backdrop: null,    // backdrop DOM
  _iframe: null,      // iframe DOM
  _refreshOnClose: false,  // 閉じる時に refresh するか

  _init()             // DOM を生成して body に追加（初回呼び出し時に一度だけ実行）
  _show(url)          // iframe.src をセットして backdrop を表示
  _close()            // backdrop を非表示にし、必要なら KC.Render.refresh()
  _onKeydown(e)       // ESC キーでの閉じる処理

  openEdit(recordId)  // 旧: _openWindow → 新: _show('/k/{appId}/show#record={id}')
  openCreate(options) // 旧: _openWindow → 新: sessionStorage 書き込み後 _show('/k/{appId}/edit')
}
```

### 8.4 開閉フロー（シーケンス）

```
[ユーザー: 予定クリック]
  → KC.Popup.openEdit(recordId) 呼ばれる
  → KC.Popup._init() （初回のみ: DOM 生成、イベントリスナー登録）
  → iframe.src = '/k/{appId}/show#record={recordId}'
  → backdrop を表示（hidden 属性除去 or display:block）
  → ローディング表示
  → iframe onload で ローディング非表示
  → [ユーザー: kintone 標準 UI で編集・保存]
  → [ユーザー: ×ボタン / ESC キー / backdrop クリック（いずれも閉じる・確定）]
  → KC.Popup._close()
  → iframe.src = '' （次回 open 時の残留を防ぐ）
  → backdrop を非表示
  → KC.Render.refresh() を呼ぶ
```

### 8.5 連続クリック時の挙動

同一モーダルを使い回す（`_modal` はシングルトン）。

- モーダルが既に開いている状態で `openEdit` が再呼び出しされた場合: `iframe.src` を新しい URL に差し替えてリロード
- `openCreate` が再呼び出しされた場合: sessionStorage を上書きして `iframe.src` を差し替え

### 8.6 アクセシビリティ

- モーダル表示時: `document.body` に `overflow: hidden` を付与してスクロールを防止
- モーダル非表示時: `overflow` をリセット
- `role="dialog"` / `aria-modal="true"` を設定
- 閉じるボタンに `aria-label="閉じる"` を設定
- ESC キーで閉じる（`keydown` リスナーをモーダル表示中のみ有効化）

### 8.7 iframe 遷移監視ロジック（FR-3 実装設計）

#### 8.7.1 許可 URL パターン（正規表現案）

`kintone.app.getId()` の戻り値を `appId` として、以下の正規表現で許可範囲を定義する。

```
// レコード詳細・編集（show + hash 形式）
// hash が #record=<数字> を含む（mode=edit の有無を問わない）
/^\/k\/<appId>\/show(#.*record=\d+.*)?$/

// レコード編集（/edit?record=<数字> 形式）
/^\/k\/<appId>\/edit(\?.*record=\d+.*)?(#.*record=\d+.*)?$/

// 新規作成（/edit のみ、クエリ・ハッシュなしも含む）
/^\/k\/<appId>\/edit([\?#].*)?$/

// アプリ設定全般（/k/admin/app/<appId>/ 以下すべて）
/^\/k\/admin\/app\/<appId>(\/.*)?$/

// フロー設定（/k/admin/app/flow?app=<appId>）
/^\/k\/admin\/app\/flow(\?.*app=<appId>.*|$)/
```

> 上記の `<appId>` は文字列リテラルではなく、正規表現生成時に `kintone.app.getId()` の実値で置換する。

**まとめた許可判定関数（疑似コード）:**

```
function isAllowedUrl(href, appId) {
  var pathname = new URL(href).pathname;
  var hash     = new URL(href).hash;
  var search   = new URL(href).search;

  // 詳細・編集（show 形式）: /k/{appId}/show で hash に record= を含む
  if (pathname === '/k/' + appId + '/show' && /record=\d+/.test(hash)) return true;

  // 編集・新規作成（/edit 形式）: /k/{appId}/edit（クエリ・ハッシュ任意）
  if (pathname === '/k/' + appId + '/edit') return true;

  // アプリ設定全般: /k/admin/app/{appId}/ 以下
  if (pathname.startsWith('/k/admin/app/' + appId + '/')) return true;
  if (pathname.startsWith('/k/admin/app/' + appId) && pathname.length === ('/k/admin/app/' + appId).length) return true;

  // フロー設定: /k/admin/app/flow?app={appId}
  if (pathname === '/k/admin/app/flow' && search.includes('app=' + appId)) return true;

  return false;
}
```

#### 8.7.2 load イベント監視ロジック

`_init()` 内（または `_show()` 呼び出し時）に iframe の `load` イベントリスナーを登録する。

```
_initNavigationGuard: function () {
  var self = this;
  var appId = String(kintone.app.getId());

  self._iframe.addEventListener('load', function () {
    // モーダルが非表示の場合は何もしない
    if (!self._isOpen) return;

    var href;
    try {
      href = self._iframe.contentWindow.location.href;
    } catch (e) {
      // cross-origin になった場合（想定外）は安全のためクローズ
      self._close();
      return;
    }

    if (!isAllowedUrl(href, appId)) {
      self._close();
    }
  });
},
```

**注意事項:**

- `_show(url)` で `iframe.src` をセットした直後の load イベントは `url` 自体が許可パターン内のため `isAllowedUrl` が `true` を返し、クローズされない
- load イベントは src セット後と iframe 内リンク遷移後の両方で発火する。監視に setTimeout ポーリングは不要
- cross-origin に遷移した場合（同一ドメインを離れた場合）は `contentWindow.location` アクセス時に SecurityError が投げられる。`try-catch` で捕捉してクローズする（実機では同一ドメイン内での遷移のため通常発生しない）

#### 8.7.3 KC.Popup への追加メソッド・プロパティ

```
KC.Popup = {
  // （既存プロパティ省略）
  _isOpen: false,   // モーダルが表示中かどうかを追跡

  _initNavigationGuard()  // load イベントリスナー登録（_init() から呼ぶ）
  // isAllowedUrl() は KC.Popup スコープ外のユーティリティ関数として定義可
}
```

`_close()` 内で `_isOpen = false` にセット、`_show()` 内で `_isOpen = true` にセットする。

---

## §9 各案の最終比較表（参考）

| 評価軸 | 案 A: 新規タブ化 | 案 B-1: iframe モーダル | 案 B-2: REST モーダル | 案 C: ポップアップ前面維持 |
|---|---|---|---|---|
| 実装コスト | 最小（数行） | 低〜中（1〜2日） | 極大（1〜2週間以上） | 小〜中（効果不確実） |
| UX（背面落ち解消） | 完全解消 | 完全解消 | 完全解消 | ブラウザ依存（不確実） |
| 全画面モード共存 | 良（タブが独立） | 最良（同一 DOM・z-index 制御） | 最良（同一 DOM・z-index 制御） | 不良（ポップアップが消える） |
| kintone 標準 UI 保持 | 完全 | 完全（iframe 経由） | なし（独自実装） | 完全 |
| 編集後の自動再描画 | 維持可能（closed ポーリング） | 容易（閉じる時に再描画） | 容易（保存時に再描画） | 維持可能（closed ポーリング） |
| 保守性 | 高 | 高 | 低 | 低 |
| 実装リスク | 最小 | 低 | 高 | 高 |

---

## §10 参照ファイル

| ファイル | 参照箇所 |
|---|---|
| `plugin/src/js/desktop.js:893–912` | `KC.Popup._openWindow` 実装 |
| `plugin/src/js/desktop.js:914–939` | `KC.Popup.openCreate` 実装 |
| `plugin/src/js/desktop.js:941–960` | `KC.Popup.openEdit` 実装 |
| `plugin/src/js/desktop.js:2751,3316,3727,3787,3876,4638` | `openEdit` の全呼び出し元 |
| `plugin/src/js/desktop.js:5004,5019,3581` | `openCreate` の全呼び出し元 |
| `plugin/src/css/desktop.css:740–749` | `.kc-root.kc-expanded` スタイル（z-index: 9999） |
| `plugin/src/css/desktop.css:562–568` | `.kc-event--ghost` スタイル（z-index: 9999） |
| `DESIGN.md §8` | イベント処理仕様（`KC.Popup` の記載なし） |
