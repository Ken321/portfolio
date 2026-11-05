# Public note article reference validation

- Base: `e6ef7c837f1e552eb55092d2053890f349b4bb4c` (production main on 2026-11-05).
- Source: https://note.com/ken321; all 8 public articles, 2020-04-23 to 2025-01-28.
- Snapshot: 22,855 body characters. Full text, headings, source URLs and publication dates are retained. All 8 bodies, titles, URLs and dates were compared with the collected source and match exactly. No image OCR, video/audio transcription, external-page text, comments, paid sections or drafts are included.
- Private snapshot SHA-256: `53b137cc59aca3a5a5cff9923331850636750ff75a9c1adb851e65f08acfffcb`. The snapshot is deliberately Git-ignored and packaged only with the voice API.

## Design and cost

Only an article catalog and read tool are added to initial session instructions. The model reads the full text of 1–2 relevant articles as needed. Previously read text stays in conversation history and can be reused. The endpoint accepts only known article IDs and an active opaque session token, and permits up to 12 reads per session, atomically enforced across Lambda instances. It performs no paid model requests itself and creates no new cloud resources.

Using `tiktoken 0.14.0 / o200k_base` as an **estimate**, baseline instructions are 2,799 tokens and the new instructions plus tool definition are 3,682 tokens (+883). Article results are about 792–3,330 tokens per article. Full-text-in-instructions would be about 19,734 tokens and was rejected because of the separately documented Realtime instruction/tool budget. These estimates are not the Realtime service's measured token usage.

Official rate checked 2026-11-05: gpt-realtime-2.1-mini text input USD 0.60/million tokens, cached text USD 0.06/million. Thus the 883-token catalog/tool increase is about USD 0.00053 per uncached response, and one article's input is about USD 0.00048–0.0020. This excludes audio, model tool-selection/continuation, outputs, repeated history, AWS and tax. Caching is best effort, not guaranteed. No actual billable model session was run in this cloud validation.

Sources: https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/guides/voice-latency-cost ; https://developers.openai.com/blog/realtime-api

## Checks completed

- All 85 automated tests passed, including existing avatar, interaction, voice and AWS cleanup tests.
- New coverage: full-text preservation, malformed/foreign/duplicate articles, size limits, tool success/failure, duplicate tool event, interrupted/ended lookup, active-session authorization, 12-read cap, expired sessions and old-client compatibility.
- Final static build and `git diff --check` passed.
- Lambda ZIP generated and its runtime imported offline with no credential lookup or API call. ZIP contains only runtime, voice modules, public article snapshot and existing works data.
- Existing public page copy/styles/effects are unchanged. Lazy voice JS increases from 11,774 to 13,299 bytes, or 4,269 to 4,850 bytes under gzip (+581 bytes). App entry size is unchanged; article bodies are not in the static bundle.

## Deployment and remaining verification

Update the AWS voice API first, keeping its current settings, account, origins, model and credentials. Then publish the matching generated static site. Only clients sending `?references=note-v1` get reference tools, so older cached pages keep their portfolio-only behavior. Refresh the page to enable the new feature.

Confirm the exact deployed code/commit, session creation and article tool use, cancellation/interruption, the existing three-minute termination and actual response usage/latency on the deployed service. Real audio, real AWS conditional writes, production billed usage and real-device browsers remain unverified by this report. Do not equate unit tests with production acceptance. Updates to note articles require a new reviewed snapshot and voice API deployment; no automatic synchronization was added.
