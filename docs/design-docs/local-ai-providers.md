# Local AI providers (OpenAI-compatible gateway)

## Overview

This document describes how the Studio CLI AI agent can be pointed at a **local, self-hosted model server** instead of WordPress.com or the Anthropic API, and how the gateway that makes this possible keeps conversations within the local model's context window.

The AI agent is built on the Claude Agent SDK, which speaks only Anthropic's native Messages API wire protocol. Local model servers (vLLM, Ollama, LM Studio, llama.cpp, Apple's on-device FoundationModels via Apfel, etc.) almost always expose the **OpenAI** `/chat/completions` wire format instead. The `openai-compatible` provider bridges that gap with a small local translation gateway, and layers context-window-aware compaction on top so that long conversations don't overflow the (typically much smaller) context window of a local model.

Relevant code:

- `apps/cli/ai/providers.ts` — provider registry, config resolution, `/openai-config` setup flow.
- `apps/cli/ai/openai-compat-gateway.ts` — the translation gateway and compaction logic.
- `apps/cli/ai/slash-commands.ts` — the `/openai-config` and `/provider` slash commands.
- `apps/cli/ai/tests/openai-compat-gateway.test.ts` — unit tests for discovery and compaction.

## Providers

The agent supports three providers (`AI_PROVIDERS` in `providers.ts`):

| Provider            | ID                  | Auth / config                                                        |
| ------------------- | ------------------- | -------------------------------------------------------------------- |
| WordPress.com       | `wpcom`             | WordPress.com OAuth token (`/login`)                                 |
| Anthropic · API key | `anthropic-api-key` | Anthropic API key (`/api-key`)                                       |
| OpenAI-compatible   | `openai-compatible` | Base URL + optional API key + model name (`/openai-config`)          |

Switch providers with `/provider`. Configure the OpenAI-compatible endpoint with `/openai-config`, which prompts for:

- **Base URL** — e.g. `http://localhost:11435/v1` (Apfel) or `http://<host>:8000/v1` (a vLLM server on your network).
- **API key** — optional; sent as `Authorization: Bearer <key>` when present.
- **Model name** — must match the server's advertised model id, e.g. `apple-foundationmodel`.

These persist to the CLI config as `openAiCompatibleBaseUrl`, `openAiCompatibleApiKey`, and `openAiCompatibleModel`.

## The translation gateway

When the `openai-compatible` provider is activated, `ensureOpenAiCompatibleGateway()` starts a Node `http` server bound to `127.0.0.1` on an OS-assigned ephemeral port. The agent's environment is then pointed at it via `ANTHROPIC_BASE_URL`, so the SDK sends ordinary Anthropic Messages API calls to the local gateway, unaware anything unusual is happening.

The gateway:

1. Accepts `POST /v1/messages` (Anthropic wire format).
2. Runs the request through **compaction** (see below).
3. Translates it to an OpenAI `/chat/completions` request (`toOpenAiChatRequest`).
4. Forwards it to the configured `baseUrl`, streaming or buffered as requested.
5. Translates the response back to Anthropic format (`fromOpenAiCompletion` / `streamOpenAiToAnthropic`).

Only one gateway runs at a time. If the config changes, the previous gateway is closed and a new one is started. Scope is **text and tool-calling only** — image content blocks are replaced with a placeholder, since local models used with this provider are typically text-only.

## Context-window-aware compaction

### The problem

The Claude Agent SDK assumes Claude's large context window and has no knowledge of the local backend's real limit. A local model may only offer 4K–64K tokens, so as a conversation grows the SDK will eventually send a request larger than the backend can accept — producing an opaque `context_length_exceeded` error mid-conversation. The gateway solves this by discovering the real limit and proactively shrinking the transcript before forwarding it.

Two design decisions shaped the implementation:

- **Strategy: summarize-then-trim.** Mirroring Claude Code's own `/compact`, the oldest chunk of the conversation is summarized (by the local model itself) into a single synthetic note, and the recent tail is kept verbatim.
- **Limit source: auto-discovery via `/v1/models`.** The backend is queried once for the model's advertised context window, rather than requiring the user to configure it by hand.

### Context-window discovery

`discoverContextWindow(config)` issues a `GET {baseUrl}/models` (with the same `Bearer` auth as the forwarding call and a 3-second `AbortSignal.timeout`), finds the `data[]` entry whose `id` matches the configured model, and reads the first present of:

- `context_window` — Apfel's field name
- `max_model_len` — vLLM's field name
- `max_context_length` — an additional common alias

If none is a positive number — or the endpoint is slow, missing, unauthorized, or malformed — it falls back to `DEFAULT_CONTEXT_WINDOW` (8192). Discovery **never throws**: a discovery failure must not block the provider from working. The result is cached once per gateway instance (in `GatewayState.contextWindow`), not re-fetched per request.

### Token estimation

No real tokenizer is available for an arbitrary backend, so a heuristic is used: `estimateTokens(text) = ceil(text.length / 4)` (~4 characters per token), applied to a serialized form of each message — text content, `JSON.stringify`'d tool-call input, and tool-result text — plus a small fixed per-message overhead. `estimateRequestTokens()` sums the system prompt, the (fixed, non-trimmable) tool definitions, and every message.

This is deliberately conservative rather than exact; the safety margin constants below absorb the imprecision.

### Budget and the fast path

For each request, `compactMessagesIfNeeded()` computes:

```
budget = contextWindow − (request.max_tokens ?? DEFAULT_MAX_TOKENS_RESERVE) − SAFETY_MARGIN_TOKENS
```

If the estimated request already fits within `budget`, the request is returned **unchanged** — the common case, so most turns incur no extra work and no extra model call.

### Splitting (pairing-safe)

When over budget, the gateway keeps the largest recent suffix of messages that fits within `recentBudget = budget − SUMMARY_RESERVE_TOKENS` (reserving room for the summary itself). `findSplitIndex()` walks backward from the end accumulating estimated tokens, then `stabilizeSplitIndex()` pulls the boundary further back if it would fall between a `tool_use` message and the `tool_result` that answers it — the backend requires every `tool_use` to be immediately followed by its result, so such a pair is never separated across the old-chunk / recent-tail boundary.

If nothing can be trimmed without breaking a pair (`splitIndex <= 0`), the request is forwarded as-is — graceful degradation, never an error.

### Rolling summary

Because the SDK resends the full conversation every turn, re-summarizing the entire old chunk on each over-budget request would be wasteful. The gateway keeps per-gateway `CompactionState { coveredMessages, summary }` and, in `resolveSummary()`, chooses one of three paths:

1. **Reuse** — the cached `coveredMessages` exactly equals the new old chunk → reuse the cached summary, no model call.
2. **Incremental update** — the cached `coveredMessages` is an exact prefix of the new old chunk → summarize only the newly-added portion, folding it into the existing summary ("update this summary with these additional turns").
3. **Full re-summarize** — the conversation has diverged from the cached prefix (e.g. after `/clear` starts a fresh session) → summarize the whole old chunk from scratch.

Prefix matching (`isPrefixOf` / `messagesEqual`) uses per-message `JSON.stringify` deep-equality.

### The summarization call

`summarizeConversation()` makes a plain, non-streaming, non-tool `POST {baseUrl}/chat/completions` against the same configured model, reusing the same auth-header pattern as the main forwarding call. The old chunk is serialized to readable text (tool calls rendered as `Called <name> with <args>`, results as `Result: <text>`), capped at `SUMMARY_MAX_TOKENS`. If the call fails or returns empty, it falls back to the previous summary (or a placeholder string) so a broken summarization call never crashes the request.

### Applying the result

The summary is appended to the **system** prompt as a clearly marked block:

```
<original system text>

[Summary of earlier conversation, condensed to fit the local model's context window]
<summary>
```

`messages` is then replaced with the recent tail. Injecting into the system prompt (rather than as a synthetic user/assistant message) sidesteps role-alternation edge cases entirely.

### Constants

Defined at the top of `openai-compat-gateway.ts`:

| Constant                     | Value | Purpose                                                            |
| ---------------------------- | ----- | ------------------------------------------------------------------ |
| `DEFAULT_CONTEXT_WINDOW`     | 8192  | Fallback when discovery yields nothing usable                      |
| `DEFAULT_MAX_TOKENS_RESERVE` | 1024  | Assumed output reservation when the request omits `max_tokens`     |
| `SAFETY_MARGIN_TOKENS`       | 500   | Headroom absorbing token-estimate imprecision                      |
| `SUMMARY_RESERVE_TOKENS`     | 800   | Space reserved in-budget for the injected summary                  |
| `SUMMARY_MAX_TOKENS`         | 500   | Output cap on the summarization call                               |
| `CHARS_PER_TOKEN_ESTIMATE`   | 4     | Characters-per-token heuristic                                     |

## Testing

Automated (`apps/cli/ai/tests/openai-compat-gateway.test.ts`, `fetch` stubbed via `vi.stubGlobal`):

```bash
nvm use            # matches .nvmrc (Node 24.x / npm 11)
npm test -- apps/cli/ai/tests/openai-compat-gateway.test.ts
npm run typecheck
```

Coverage: discovery field-name handling (`context_window`, `max_model_len`) and fallback; budget math triggering compaction only when over budget; `tool_use`/`tool_result` pairs never split across the boundary; rolling-summary reuse / incremental-update / divergence-reset.

Manual (black-box, most telling): configure `/openai-config` against a **small-context** backend (e.g. Apfel at `http://localhost:11435/v1`, 4096 tokens), then hold a long conversation. It should keep responding coherently rather than erroring with `context_length_exceeded` once the history exceeds the window — older context is represented by the injected summary while recent turns stay verbatim. Against a large-context backend (e.g. a vLLM server with a 65536-token window), everyday short conversations are untouched; compaction engages only near the limit.
