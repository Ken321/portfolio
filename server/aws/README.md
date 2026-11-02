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

前提：Node.js 22推奨、npm、AWS CLI v2、zip。リポジトリ直下で実行します。対象はdefaultプロファイル、東京リージョン、スタック名portfolio-voiceです。AWS_PROFILE / AWS_REGIONで変更できます。

AWSコンソールのログインを使う場合は、AWS CLI 2.32以降で`aws login --profile portfolio-console --region ap-northeast-1`を実行し、以降は`AWS_PROFILE=portfolio-console`を設定します。既存のSSO設定は変更しません。

```sh
aws sso login --profile default
aws sts get-caller-identity --profile default
npm ci --prefix server/aws
node scripts/package-voice.mjs
aws cloudformation validate-template --template-body file://server/aws/template.json --region ap-northeast-1 --profile default
```

ローカル.envのAPIキーを、画面・引数・一時ファイルに出さずに登録します。既存キーは上書きしません。更新時だけ末尾に`--overwrite`を付けます。

```sh
node --env-file=.env scripts/put-voice-key.mjs
```

変更セットを作成して内容を確認します。この時点で専用の非公開配布バケットとZIPは作成されます。

```sh
node scripts/deploy-voice.mjs
```

確認後、AWSリソースを作成します。初期状態では会話開始が無効です。

```sh
node scripts/deploy-voice.mjs --execute
```

テスト時は実際のローカル表示元も許可し、有効化します。

```sh
VOICE_ENABLED=true VOICE_ALLOWED_ORIGINS=https://321ken.com,http://127.0.0.1:8765 node scripts/deploy-voice.mjs --execute
```

出力ApiBaseUrlの末尾の`/`を除き、`src/index.template.html`の`meta[name="voice-api"]`へ設定して`npm run build`。ブラウザで接続、手動終了、3分での終了、タブを閉じた後のサーバー終了を確認します。CloudWatchのINIT_REPORT/REPORTとsession_startedのdurationMsで初回起動と受付時間を確認してください。

公開時は許可元を本番に戻します。

```sh
VOICE_ENABLED=true node scripts/deploy-voice.mjs --execute
```

GitHub Pagesは生成済みindex.html/assets/buildを含めてmainへpushすると更新されます。デプロイスクリプトはgit commit/pushを行いません。

## 必要なAWS権限

デプロイ担当には、専用バケットへのS3操作、CloudFormationスタック・変更セット操作、このテンプレートのLambda/IAMロール・ポリシー（iam:PassRole含む）/DynamoDB/SQS/CloudWatch Logs/Alarm作成更新、SSM PutParameter権限が必要です。AWS OrganizationsのSCPなどがある場合は管理者に確認してください。

実行時のIAMロールはテンプレートが生成します。対象テーブル、対象キュ－、対象ログ、指定されたSSMパラメータ1件に限定します。キーはAWS管理KMSキーで暗号化し、コード・Lambda環境変数・GitHubに含めません。

## 運用

- 1回180秒はブラウザでも終了。SQSの遅延は厳密な時刻保証ではなく、AWS障害・再試行時は終了が遅れます。
- 開始前に210秒の予備終了ジョブを保存し、開始後に180秒の通常終了ジョブを保存。重複処理は安全です。
- 会話作成時の通信断など、OpenAI側の成否が不明な場合は枠を保持して新規課金の連鎖を防ぎます。終了に失敗した枠も保持します。
- DLQアラームはコンソール上に作られます。`AWS_NOTIFICATION_EMAIL`を指定してデプロイするとSNSメール通知を追加します。届いた確認メールのConfirm subscriptionを開くと有効になります。AWS Budgetsの通知は別途設定してください。予算通知は支出の強制停止ではありません。
- DLQに入ったら、call行のidで終了を確認し、再処理してください。pending行にidがない場合はOpenAI側の状態を確認してから関連call/slot行を解放します。稼働中の枠を安易に削除しないでください。
- 会話本文、SDP、APIキー、終了トークンはログに出しません。
- Origin制限はブラウザのアクセス制御であり認証ではありません。開始試行数は全訪問者共有で、攻撃者が上限を使い切る可能性があります。公開APIへの大量リクエストによるAWS費用を完全に抑止するものでもありません。
- 緊急停止はVoiceEnabled=falseで再デプロイします。既存会話の終了ワーカーは動き続けます。
- DynamoDBテーブルはスタック削除時にも保持。APIキーと配布バケットも自動削除しません。

## 検証

```sh
node --test tests/voice-aws.test.mjs tests/voice.test.mjs
npm test
```

ローカルテストは依存を差し替えて課金なしで失敗経路を検証します。IAM、CloudFormation、SQS配信、実際の音声と終了時刻はAWS配置後に確認が必要です。
