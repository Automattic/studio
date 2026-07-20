# Chat image attachments: auto-resize + per-provider limits

Working notes for a feature spec / Linear issue. Branch: `auto-resize-chat-image-attachments`
(worktree at `.claude/worktrees/auto-resize-chat-images`, branched from trunk).

## Problem

The composer rejects images over 5 MB with a toast ("Images must be 5 MB or smaller"),
caps attachments at 4 images / 12 MB total, and applies those numbers identically for
every model. The numbers shipped in #3697 with no recorded rationale and were
parity-ported to the agentic UI in #3782. They are stale and stricter than any
provider requires, and rejection is the wrong UX — every comparable client resizes
instead of blocking.

## Research findings (July 2026)

### Provider limits — official docs

| | Anthropic (direct API) | OpenAI |
|---|---|---|
| Per image | 10 MB **base64-encoded** (5 MB on Bedrock/Vertex) | none stated |
| Images/request | 600 (100 for 200k-context models) | 1,500 |
| Total request | 32 MB | 512 MB |
| Dimensions | 8000×8000; **>20 image blocks → ~2000 px per-side rule** | model-dependent detail scaling |
| Server downscale | 1568 px long edge (standard models) / 2576 px (high-res: Fable 5, Opus 4.8, Sonnet 5) | 2048 px (high detail, GPT-5.5/5.4); none for GPT-5.6 `original` |
| Formats | PNG, JPEG, GIF, WebP (first frame only for animations) | PNG, JPEG, WebP, non-animated GIF |

- Limits are **not discoverable programmatically**. Anthropic `/v1/models` exposes
  `image_input.supported` only; OpenAI `/v1/models` exposes nothing. Every client
  hardcodes a table — so will we, keyed by `AiModelFamily`.
- Anthropic measures the limit against the **base64 payload** (~1.33× the binary),
  so a "5 MB" limit is really ~3.75 MB of file. lobe-chat shipped this exact bug.

### Prior art

- **Claude Code**: resizes pastes client-side to ≤2000 px (sharp); replaces
  unprocessable history images with text placeholders; evicts oldest images to stay
  under the 32 MB request cap.
- **LibreChat** (#7909), **Open WebUI** (#6848 et al.), **lobe-chat** (#13224, #14711):
  all converged on client-side canvas downscale/re-encode before send.
- **Nobody splits attachments across multiple messages** — count limits are generous
  enough that bytes, not counts, are the binding constraint. Idea dropped.
- **In-repo**: auto-resize was already built and orphaned — commit `841c734fd`
  (branch `origin/claude/fervent-knuth-u6wbfu`) adds `packages/common/ai/image-fit.ts`
  (canvas, 2000 px cap, transparency-aware PNG/JPEG output, tests) wired into
  `composer-attachments.ts`. Never PR'd. Used as the starting point here.

### Studio architecture facts

- Flat constants live in `packages/common/ai/chat-images.ts`; enforced model-blind in
  three places: composer (`composer-attachments.ts`), main-process IPC validate,
  CLI session resume.
- The `pi-ai` SDK does no resizing or limit enforcement; oversized images fail at the
  provider with a raw 400.
- The pi runtime already strips images from older turns before resending history
  (`strip-stale-images.ts`) — only the newest image-bearing turn rides in full, so
  raising per-message limits does not compound across a session.
- The composer knows the selected model → per-family validation at attach time is
  feasible; images normalized by resize fit *any* family, so a family switch only
  needs a count re-check.
- **Default route is the wpcom AI proxy** (`public-api.wordpress.com/wpcom/v2/ai-api-proxy`,
  feature slugs `studio-assistant[-anthropic]`). Its body-size cap and upstream
  (direct API vs Bedrock-style 5 MB/20 MB) were unknown → empirical test below.

### Proxy probe results (July 18, 2026)

Sent minimal `max_tokens: 1` requests with valid but incompressible noise PNGs
directly to `public-api.wordpress.com/wpcom/v2/ai-api-proxy/v1/messages` with a
valid Studio OAuth token and the `studio-assistant-anthropic` feature header:

- **The proxy's nginx front rejects request bodies over 20 MiB** with a 413
  (19.35 MiB passes, 20.35 MiB doesn't → `client_max_body_size 20m`). This — not
  Anthropic's 32 MB — is the effective total request ceiling for both families,
  and it makes OpenAI's 512 MB payload allowance irrelevant behind the default
  wpcom provider.
- Requests under the cap returned **403 `rest_forbidden`** at the app layer: the
  REST permission callback rejects hand-rolled requests even with a valid token
  (Studio's in-app requests clearly pass, so it gates on something beyond
  bearer + feature header — not investigated further). Consequence: **could not
  empirically confirm whether the proxy's Anthropic upstream is the direct API
  (10 MB/image) or a Bedrock-style deployment (5 MB/image)**. The design below is
  safe under either.
- Practical budget: with ~20 MiB body cap and room for prompt/history/tool JSON,
  total encoded image payload should stay ≤ ~16 MB per request.

## Design

1. **Auto-resize at attach time (renderer, canvas).** Revive `image-fit.ts` and extend
   it: downscale to ≤2000 px, pick PNG vs JPEG by output size (keep PNG when
   transparent), walk JPEG quality down until the encoded size fits the byte budget.
   Animated GIFs over budget fall back to their first frame (providers only read the
   first frame anyway). The "too large" toast only survives for undecodable files.
2. **Per-family limits table** in `chat-images.ts` replacing the flat constants:
   `{ maxImages, maxImageEncodedBytes, maxTotalEncodedBytes, maxDimension }` keyed by
   `AiModelFamily`. Budgets expressed in encoded (base64) bytes. Model-blind callers
   fall back to the strictest family.
3. **Raised counts/totals.** 4 → 20 images (claude.ai parity); totals raised with
   headroom under Anthropic's 32 MB request cap. Resize target stays ~4.5 MB encoded
   per image until the proxy upstream is confirmed ≥ direct-API limits, so raised
   limits are safe under the worst-case upstream.

## Implementation log

All landed on `explore-site-centric-conversation-chrome` (uncommitted), July 18 2026:

- [x] Proxy probe (results above; scripts were throwaway, in the session scratchpad)
- [x] `packages/common/ai/image-fit.ts` — revived from orphaned commit `841c734fd` and
  extended: dimension fit (≤2000px) → PNG-if-transparent → JPEG quality ladder
  (0.9→0.6, white-matted when alpha is dropped) → dimension steps (×0.75, floor
  320px) until the *encoded* size fits 4.5 MB. Returns the original untouched when
  it already fits or can't be decoded; never throws.
- [x] `packages/common/ai/chat-images.ts` — flat constants replaced by
  `STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY` (anthropic: 20 images / 4.75 MB encoded per
  image / 16 MB total; openai: 40 images / 16 MB / 16 MB), with
  `getStudioChatImageLimits( family? )` (strictest without a family) and
  `getLoosestStudioChatImageLimits()`. All budgets are measured in **base64 bytes**
  (the unit providers actually enforce). `validateStudioChatImages()` is now an
  explicit model-blind *backstop* against the loosest limits — no signature change,
  so `ipc-handlers.ts` and the CLI resume path needed no edits.
- [x] `packages/common/ai/composer-attachments.ts` — images (and site-preview clips)
  run through `fitImageFileWithinLimits()` before validation; quota checks take a
  `limits` object and count encoded bytes.
- [x] Both composer hooks (`apps/ui` + legacy `apps/studio` Studio Code) accept the
  session's model family and pass family-precise limits through; "Images must be
  5 MB or smaller." became "This image is too large to attach." (fires only for
  undecodable/unshrinkable files). Both composers pass `getAiModelFamily( model )`.
- [x] Tests (27 in common/ai incl. new image-fit suite, 33 composer), eslint,
  `npm run typecheck` — all passing.

## Known gaps / follow-ups

- **Family switch with excess attachments**: switching a compose-in-progress from
  OpenAI (40-image cap) to a Claude model (20) doesn't trim already-attached images.
  Harmless in practice — Anthropic accepts up to 600 blocks and every attached image
  is already ≤2000px (the constraint behind our 20 cap), and total bytes share one
  16 MB budget — so no guard was added.
- **The wpcom proxy's Anthropic upstream is unconfirmed** (couldn't authenticate
  hand-rolled requests past the REST permission callback). If someone confirms it
  relays to the direct API, `anthropic.maxImageEncodedBytes` can go 4.75 MB → ~9.5 MB
  in the one table entry. Worth an ask to the proxy team; also worth asking whether
  the 20 MiB nginx cap can be raised.
- **New/changed UI strings** need the usual GlotPress translation cycle.
- Animated GIFs over the budget collapse to their first frame (providers only read
  the first frame regardless); under-budget GIFs pass through untouched.
- Session storage still persists full-size images twice (known pre-existing issue,
  flagged in #3782) — untouched here, but resized inputs shrink it in practice.
