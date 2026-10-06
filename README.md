# ポケット家計簿

自分用のシンプルな家計簿アプリ（Android / Web）。

- レシートの写真から合計・日付・店名・品目を読み取り（端末内のOCR、Google レンズの共有、Claude）
- カード明細CSVの取り込み（楽天e-NAVI、Vpass、MyJCB など）
- 記録はすべて端末の中だけに保存。このリポジトリにはアプリ本体のファイルだけが置かれ、個人のデータは一切含まれません。

## 構成

- `www/` … アプリの画面とロジック。インストール済みのアプリは起動時に `www/version.json` を確認し、変わったファイルだけを取り込みます（SHA-256で検証）。
- `dist/PocketKakeibo.apk` … 最新のAPK
- `src/` … ソース（`app/` が画面、`android/` がAndroidの外側）

OCR: [Tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）
