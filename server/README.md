# Portfolio voice chat

本番環境はLambda版を使用します。構成・配置手順は [AWS音声API](aws/README.md) を参照してください。以下はローカル検証用の常駐Nodeサーバーについての説明です。

The static GitHub Pages site remains unchanged as a deployment platform. Voice sessions require this separate, long-lived Node 20.11+ service. The site connects with WebRTC; the permanent OpenAI key stays on the server. No audio or transcripts are written to disk by this application.

## Local setup

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` privately. Do not paste it into chat, HTML or Git.
2. Run `npm run voice` alongside the existing static preview on port 8765.
3. Click 話しかける, allow the microphone, then speak. Test interruption, mute, end, denied permission and tab switching on real Safari/iOS and Chrome/Android.

The default model is `gpt-realtime-2.1-mini` and voice is `alloy`, configurable by environment. Access must be available on your API project. A successful build or mocked test does not verify model access, actual voice quality, WebRTC connectivity or mobile microphone permissions.

## Deployment

Host `server/voice.mjs` with `src/works.json` on a persistent Node service with HTTPS, set `HOST=0.0.0.0` and the host's assigned `PORT`. Add the exact frontend origin `https://321ken.com` to `VOICE_ALLOWED_ORIGINS`. Set the public HTTPS server URL (no trailing path) in `<meta name="voice-api" content="…">` in `src/index.template.html`, then build the site. Leave this empty until a server is ready; public visitors will see the preparation message without being asked for microphone permission.

Do not use a short-lived/serverless runtime with this timer implementation. Each call receives a server-side hangup at 180 seconds, with retries if hangup fails. There are two concurrent slots and 20 session creation attempts per UTC day by default, shared across visitors. These counters are in memory, reset on restart, and are not shared across replicas. Use a single instance for this prototype. Before unrestricted public use, move counters and call deadlines to durable shared storage/jobs, add edge abuse protection and configure project spend monitoring. Origin checking prevents ordinary cross-origin browser requests, but is not user authentication and does not block scripts forging Origin. The admission caps are not a guaranteed monetary spending limit. Unexpected process death can lose call timers; the client also closes at 180 seconds but that is not a security boundary.

`POST /voice/session` accepts SDP only, keeps instructions/model on the server, and returns SDP plus an opaque capability token for ending that call. `POST /voice/end` accepts that token, never an arbitrary upstream call ID. `/voice/status` reveals only whether configuration exists. A server response does not log prompts, credentials, SDP or API error payloads.

The assistant uses existing project descriptions as reference, identifies itself as AI, permits light chat, and is instructed not to invent biographical facts. It has no external tools. The existing GLB has no mouth morph targets; speaking/listening gestures are head movements, not phoneme lip sync.

Official API references: https://developers.openai.com/api/docs/guides/voice-webrtc and https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup
