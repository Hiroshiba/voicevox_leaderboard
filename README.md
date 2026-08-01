# VOICEVOX Contribution Score

VOICEVOX Organization の GitHub 貢献を実データから試算するフロントエンドです。
関連 Issue が同じ PR を一つのワークストリームへまとめ、実装、レビュー、Issue と調査を一つの点数へ変換します。

この実装は指標を検証するためのプロトタイプです。
サーバーサイド処理とデータ保存はありません。

## 起動

Node.js 24 と pnpm 10 で動作を確認しています。

    pnpm install --frozen-lockfile
    pnpm dev

ブラウザで Organization、対象リポジトリ、開始日、終了日を指定して計算します。
リポジトリは Organization から候補を取得するか、名前を直接追加できます。

## GitHub token

画面の GitHub token 欄へ直接入力できます。
入力値はブラウザのメモリ内だけで使用し、保存しません。

開発サーバーの起動時に VITE_GITHUB_TOKEN を指定する方法もあります。

    VITE_GITHUB_TOKEN=github_pat_xxx pnpm dev

.env.local に書くこともできます。

    VITE_GITHUB_TOKEN=github_pat_xxx

Vite の環境変数はブラウザ向けの JavaScript へ埋め込まれます。
トークンを設定した状態で生成した dist を公開しないでください。
対象リポジトリだけに限定し、Metadata、Issues、Pull requests を Read-only にした fine-grained token を推奨します。

トークンを省略すると GitHub の公開 API を利用します。
未認証時はレート制限が低いため、対象を小さくしてください。

## 計算内容

計算式は [AI初期提案.md](docs/AI初期提案.md) を実装しています。

- 同じ主 Issue を参照するマージ済み PR を一つにまとめる
- 変更行、非生成ファイル数、リポジトリ数、Conventional Commits 補正から重要度を求める
- 重要度を実装 65%、レビュー 20%、Issue と調査 15%へ配分する
- 関連するマージ済み PR がない Issue に独立 Issue スコアを与える
- Bot の活動を除外する
- 各人とワークストリームの算出根拠を画面へ表示する

Issue とレビューの実質判定には、本文量に加えてコマンド、ログ、添付、参照、環境、測定値を使います。

## プロトタイプの制約

- 選択期間をまたぐ加点履歴は保存しない
- 期間内にコメントだけがあり、その後にも更新された Issue は GitHub Search API だけでは発見できない
- 独立 Issue と期間外のマージ済み PR の関連は追跡しない
- 古い Issue の本文編集日時は判定しない
- GitHub アカウントへ解決できない共同作者は配点しない
- GitHub Search API の上限を超えた場合は期間を狭める必要がある

## 検証

    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build
