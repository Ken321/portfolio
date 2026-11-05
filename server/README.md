# Portfolio voice chat

本番環境はLambda版を使用します。構成・配置手順は [AWS音声API](aws/README.md) を参照してください。以下はローカル検証用の常駐Nodeサーバーについての説明です。

The static GitHub Pages site remains unchanged as a deployment platform. Voice sessions require this separate, long-lived Node 20.11+ service. The site connects with WebRTC; the permanent OpenAI key stays on the server. No audio or transcripts are written to disk by this application.

## Local setup

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` privately. Do not paste it into chat, HTML or Git.
2. Run `npm run voice` alongside the existing static preview on port 8765.
3. Click 話しかける, allow the microphone, then speak. Test interruption, mute, end, denied permission and tab switching on real Safari/iOS and Chrome/Android.

The default model is `gpt-realtime-2.1-mini` and voice is `echo`, configurable by environment. Access must be available on your API project. A successful build or mocked test does not verify model access, actual voice quality, WebRTC connectivity or mobile microphone permissions.

## Deployment

Host `server/voice.mjs` with `src/works.json` on a persistent Node service with HTTPS, set `HOST=0.0.0.0` and the host's assigned `PORT`. Add the exact frontend origin `https://321ken.com` to `VOICE_ALLOWED_ORIGINS`. Set the public HTTPS server URL (no trailing path) in `<meta name="voice-api" content="…">` in `src/index.template.html`, then build the site. Leave this empty until a server is ready; public visitors will see the preparation message without being asked for microphone permission.

Do not use a short-lived/serverless runtime with this timer implementation. Each call receives a server-side hangup at 180 seconds, with retries if hangup fails. There are two concurrent slots and 20 session creation attempts per UTC day by default, shared across visitors. These counters are in memory, reset on restart, and are not shared across replicas. Use a single instance for this prototype. Before unrestricted public use, move counters and call deadlines to durable shared storage/jobs, add edge abuse protection and configure project spend monitoring. Origin checking prevents ordinary cross-origin browser requests, but is not user authentication and does not block scripts forging Origin. The admission caps are not a guaranteed monetary spending limit. Unexpected process death can lose call timers; the client also closes at 180 seconds but that is not a security boundary.

`POST /voice/session` accepts SDP only, keeps instructions/model on the server, and returns SDP plus an opaque capability token for ending that call. `POST /voice/end` accepts that token, never an arbitrary upstream call ID. `/voice/status` reveals only whether configuration exists. A server response does not log prompts, credentials, SDP or API error payloads.

The assistant uses existing project descriptions and a reviewed snapshot of Ken's public note articles as reference, identifies itself as AI, permits light chat, and is instructed not to invent biographical facts. Its only reference tool reads the local public article snapshot; it has no live browsing or action tools. Published dates are retained so older articles are not presented as current project status.

## Public note reference

Place the reviewed snapshot at `server/data/note-articles.json`. The file is intentionally ignored by Git and is not included in the static website, JavaScript bundles or images. Its schema is `{profileUrl:"https://note.com/ken321", retrievedAt:"ISO timestamp", articles:[{title,url,publishedAt,body}]}`. Use complete publicly readable article text including headings, not search excerpts. Preserve the article URL and publication date. Do not add drafts, paid sections, comments, image OCR or video transcripts without a separate review. Validate all profile articles have been included; do not silently treat the first page as the complete collection.

The snapshot is loaded once at server startup. Only the dated article catalog and tool definition enter the initial Realtime session instructions. The model can call `read_note_articles` for the full text of one or two articles, and the browser relays this to `POST /voice/articles` with the existing opaque session token. The local server and Lambda both verify an active session and allow at most 12 reads during its lifetime. Lambda uses an atomic DynamoDB condition to enforce that cap across instances. Results are supplied back to OpenAI as function outputs, not instructions. Completed references can be reused in subsequent turns. Ending a call aborts pending lookups, and an older lookup does not restart speech over a newer user turn. It is not new training or a permanent model memory. No new database, search service, embedding API or live note.com request is used. A relevant article question adds one existing-Lambda lookup and model continuation, which must be measured in a real voice session. The snapshot is included only in the private Lambda deployment ZIP; Realtime session configuration may still be visible to a connected visitor, so only public material belongs here.

`node scripts/package-voice.mjs` fails if the snapshot is missing or invalid. Local development without a snapshot keeps the portfolio-only behavior. Update the snapshot and redeploy the voice API to incorporate new or edited articles; there is no scheduled sync.

Before each update, measure the combined instructions, catalog and tool definitions against the model's instruction budget, and ensure individual article responses remain comfortably bounded. The 100,000-byte reference guard is a coarse safety limit, not a token-limit guarantee. Keep comfortable room below the Realtime instructions/tools limit. The current implementation already retrieves articles instead of inserting all full text into instructions; if an individual article grows too long, add explicit section retrieval rather than silently truncating it. A local tokenizer is an estimate, not billing evidence. Confirm actual input/cached token usage and startup latency in a real session before claiming a production cost or latency result.

Text input is billed for each response, with automatic best-effort caching. At the checked 2026-11-05 rate for `gpt-realtime-2.1-mini`, text input is USD 0.60 per million tokens or USD 0.06 per million cached tokens. Audio and output, existing infrastructure and any tax are separate. For example, 10,000 additional text tokens cost USD 0.006 per uncached response, or USD 0.0006 if all those tokens are cached. This is not a per-session quote or a guarantee of cache hits. See [pricing](https://developers.openai.com/api/docs/pricing) and [Realtime cost details](https://developers.openai.com/api/docs/guides/voice-latency-cost#realtime-api-costs).

Official API references: https://developers.openai.com/api/docs/guides/voice-webrtc and https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup

Deployment order: update the voice API first, then the static frontend. New clients opt in with `POST /voice/session?references=note-v1`. Older clients that omit this capability continue with the portfolio-only prompt and no tools, so cached pages cannot be left waiting for a tool they do not implement. Old frontend sessions will gain article access after the page is refreshed. This query does not authenticate a caller; the existing session admission and opaque token checks still apply.
