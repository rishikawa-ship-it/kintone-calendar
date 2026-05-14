# 設定画面ローカル開発環境

kintone にアップロードせずに `plugin/src/html/config.html` / `config.js` / `config.css` の動作確認ができます。

## 使い方

```bash
npm install        # serve がない場合のみ
npm run dev:config
```

起動後、ブラウザで以下を開く:

```
http://localhost:3000/dev/
```

## 何ができるか

- 設定画面の見た目確認
- フィールドプルダウンのモック表示 (test-app の 11 フィールド + 標準フィールドが入っている)
- バリデーション動作 (必須項目チェック等)
- 保存ボタン → localStorage に保存 (`kc-dev-plugin-config` キー)
- キャンセルボタン → `history.back()` (ブラウザ標準動作)
- 「ビューを作成 / 更新」ボタン → モックビュー一覧の更新確認
- 上書き確認ダイアログ (既存ビュー選択時)

## モックの制約

- 実 kintone の挙動とは差異あり
  - 保存 → 即時成功 (実際のネットワーク遅延なし)
  - ビュー作成 → モックビュー一覧に反映されるがリロードで初期化
  - フィールド一覧はハードコード (実 kintone のフィールド構成変更には追従しない)
- 設定値リセット: ブラウザ DevTools Console で `__kcDevReset()` を実行
- 完成後は `npm run build:plugin` で plugin.zip を生成して kintone にアップロード

## 同期メンテナンス

`plugin/dev/index.html` は `plugin/src/html/config.html` の body 部分をコピーした構造です。
config.html を変更した場合は dev/index.html も更新してください。
