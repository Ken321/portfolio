# AWS音声API

サイト本体はGitHub Pages、音声接続の受付と終了だけをAWSで処理します。ブラウザとOpenAI間のWebRTC通信はLambdaを経由しません。既存のローカル音声サーバーはそのまま使えます。

## 構成

- Node.js 22 / arm64 Lambda ×2、Function URL（HTTPS）
- DynamoDBオンデマンド：UTC日付ごとの開始試行数（20/日）、同時会話2枠、終了用トークン
- SQS：180秒の遅延終了、失敗時再試行、5回失敗でDLQ
- Parameter Store Standard SecureString：OpenAI APIキー
- CloudWatch：ログ14日保存、DLQ件数のアラーム
- 専用の非公開S3バケット：配布ZIPのみ。サイトやAPIキーは格納しない

常時起動・NAT Gateway・API Gateway・Provisioned Concurrencyは使いません。利用量による費用に加え、CloudWatchアラーム等の少額費用が発生し得ます。無料を保証する構成ではありません。

## デプロイ

前提：Node.js 22推奨、npm、AWS CLI v2、zip。リポジトリ直下で実行します。現在のスクリプトは既存 `portfolio-voice` スタックの2関数のコード更新専用です。初期構築や設定・権限・APIキーの更新は行いません。

別途承認・設定された `portfolio-voice-update` SSOプロファイル（`PortfolioVoiceUpdater`、1時間）だけを使います。既存の読み取り用 `portfolio-voice-read` とAmplify用プロファイルは変更しません。rootやコンソールログインで権限拒否を回避しないでください。

```sh
aws sso login --profile portfolio-voice-update
aws sts get-caller-identity --profile portfolio-voice-update
npm ci --prefix server/aws
node scripts/package-voice.mjs
AWS_PROFILE=portfolio-voice-update node scripts/deploy-voice.mjs --execute
```

実行前にアカウント・東京リージョン・SSOロール・既存スタックを確認します。既存バケットの `voice/<SHA256>.zip` にAES256暗号化でZIPを新規保存し、以前のテンプレートと全パラメータを維持したUPDATE変更セットを作成します。変更するパラメータはCodeKeyだけです。Api/CleanupのModify、置換なし、CodeKeyによるCodeプロパティ変更だけであることを検査し、対象外・不明確な差分は実行しません。環境変数VOICE_ENABLED、VOICE_ALLOWED_ORIGINS、AWS_NOTIFICATION_EMAILによる設定変更は受け付けません。

`--execute` を省略すると検査済み変更セットを作成するところで停止します。各試行は `.aws-build/deploy-<SHA256>.json` に段階と変更セット名を保存します。同じZIPの再試行は停止するため、通信断・権限拒否・検査失敗の後は、この記録とAWSの現状を確認してください。記録を消して再実行するだけの対応は避けてください。自動再試行・バケット設定変更・権限追加は行いません。

実行開始は公開成功を意味しません。UPDATE_COMPLETE、2関数のCodeSha256、設定の維持と実動作を確認してから、生成済みindex.html/assets/buildを含めてGitHub mainへpushします。スクリプトはサイトの公開やgit commit/pushを行いません。

## 必要なAWS権限

更新用SSO許可セットは既存スタックと名前付き変更セット、2関数、既存2実行ロールのLambda限定PassRole、既存バケットのvoice/*.zip読み書きだけに限定します。読み取り専用セットは別に維持します。関数の直接更新権限も含むため、このスクリプトのコード限定検査をIAM自体が強制するわけではありません。更新コードは実行ロールに既に許された秘密へアクセスし得ます。

実行時のIAMロール・APIキー・モデル・音声・制限・通知先は今回の更新で変更しません。秘密やnote記事本文をGitHubへ含めないでください。

## 運用

- 1回180秒はブラウザでも終了。SQSの遅延は厳密な時刻保証ではなく、AWS障害・再試行時は終了が遅れます。
- 開始前に210秒の予備終了ジョブを保存し、開始後に180秒の通常終了ジョブを保存。重複処理は安全です。
- 会話作成時の通信断など、OpenAI側の成否が不明な場合は枠を保持して新規課金の連鎖を防ぎます。終了に失敗した枠も保持します。
- DLQアラームはコンソール上に作られます。SNSメール通知の追加には別途承認された構成変更が必要です。届いた確認メールのConfirm subscriptionを開くと有効になります。AWS Budgetsの通知は別途設定してください。予算通知は支出の強制停止ではありません。
- DLQに入ったら、call行のidで終了を確認し、再処理してください。pending行にidがない場合はOpenAI側の状態を確認してから関連call/slot行を解放します。稼働中の枠を安易に削除しないでください。
- 会話本文、SDP、APIキー、終了トークンはログに出しません。
- Origin制限はブラウザのアクセス制御であり認証ではありません。開始試行数は全訪問者共有で、攻撃者が上限を使い切る可能性があります。公開APIへの大量リクエストによるAWS費用を完全に抑止するものでもありません。
- 緊急停止には別途承認された構成変更でVoiceEnabled=falseへ更新します（このコード専用スクリプトの対象外）。既存会話の終了ワーカーは動き続けます。
- DynamoDBテーブルはスタック削除時にも保持。APIキーと配布バケットも自動削除しません。

## 検証

```sh
node --test tests/voice-aws.test.mjs tests/voice.test.mjs
npm test
```

ローカルテストは依存を差し替えて課金なしで失敗経路を検証します。IAM、CloudFormation、SQS配信、実際の音声と終了時刻はAWS配置後に確認が必要です。
