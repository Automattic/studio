# Local AI providers (OpenAI-compatible)

## Overview

The Studio CLI AI agent (`studio code`) can be pointed at a **local model server** — anything that exposes an OpenAI-compatible API, such as vLLM, Apfel (Apple's on-device FoundationModels), LM Studio, Ollama, or llama.cpp. This is the `openai-compatible` provider.

The agent runs on the **pi runtime** (`@earendil-works/pi-*`, `apps/cli/ai/runtimes/pi/`), which speaks the OpenAI chat/completions wire protocol natively and manages its own conversation compaction. Because of that, this provider is thin: it points pi at the user's endpoint and tells it which model to use and how large that model's context window is. No translation layer or bespoke compaction is involved.

Relevant code:

- `apps/cli/ai/providers.ts` — the `openai-compatible` provider definition and its dynamic-model hooks.
- `apps/cli/ai/openai-compatible.ts` — endpoint model/context-window discovery.
- `apps/cli/ai/runtimes/pi/index.ts` — the runtime hook that builds an `openai-completions` model for the local endpoint.
- `apps/cli/ai/slash-commands.ts` — the `/openai-config` and `/model` commands.
- `apps/cli/lib/cli-config/core.ts` — the persisted endpoint config.
- `packages/common/ai/models.ts` — the model catalog and the widened `SelectedModelId` type.

## Providers

Three providers are available (`AI_PROVIDERS` in `providers.ts`):

| Provider            | ID                  | Configuration                                          |
| ------------------- | ------------------- | ------------------------------------------------------ |
| WordPress.com       | `wpcom`             | WordPress.com OAuth (`/login`)                         |
| Anthropic · API key | `anthropic-api-key` | Anthropic API key (`/api-key`)                         |
| OpenAI-compatible   | `openai-compatible` | Local endpoint + model (`/openai-config`)              |

Switch with `/provider`. Configure the local endpoint with `/openai-config`, which prompts for a base URL and optional API key, then lists the endpoint's models (from `GET /v1/models`) so the user picks one. Selection can be changed later with `/model`.

## Models are dynamic, not from the built-in catalog

Studio ships a fixed model catalog (`AI_MODELS` in `packages/common/ai/models.ts`) whose ids form the `AiModelId` union. A local endpoint serves arbitrary models not in that list, so:

- `SelectedModelId = AiModelId | ( string & {} )` — the type used wherever a *selected* model id is held (`currentModel`, session context, the pi turn config). It accepts any string while preserving autocomplete for the built-in ids.
- `getAiModelFamily()` / `getAiModelLabel()` tolerate unknown ids: family defaults to `'openai'` (local endpoints speak OpenAI), and the label falls back to the id itself.
- The `openai-compatible` provider implements two dynamic hooks on `AiProviderDefinition`: `listDynamicModels()` (used by `/model` to show the endpoint's live models instead of the catalog) and `resolveDefaultModel()` (used when switching to the provider — the saved selection, or the first discovered model).

The **desktop app** (`apps/studio`, `apps/ui`) intentionally does not expose this provider; its model picker stays on the built-in catalog. When it opens a CLI-created session that used a local model, it narrows the display back to a known id (`isAiModelId( … ) ? … : DEFAULT_MODEL`).

## Endpoint configuration

Stored in `cli.json` under `openAiCompatibleEndpoints` — an **array**, though only the first entry (the active endpoint) is used today. Modeling it as a list leaves room for multiple endpoints later without a breaking migration.

```jsonc
"openAiCompatibleEndpoints": [
  {
    "baseUrl": "http://localhost:11435/v1",
    "apiKey": "…",          // optional
    "selectedModel": "…",   // chosen via /openai-config or /model
    "contextWindow": 8192   // optional override; otherwise auto-discovered
  }
]
```

Access via `getActiveOpenAiCompatibleEndpoint()` / `saveActiveOpenAiCompatibleEndpoint()`.

## Discovery (`openai-compatible.ts`)

`discoverOpenAiCompatibleModels( baseUrl, apiKey )` does a `GET {baseUrl}/models` (short timeout, `Bearer` auth when a key is set) and returns `{ id, contextWindow? }[]`, reading the context window from whichever field the server uses: `context_window` (Apfel), `max_model_len` (vLLM), or `max_context_length`. It never throws — an unreachable or unexpected endpoint yields `[]`, so discovery failure degrades gracefully. `resolveOpenAiCompatibleContextWindow()` prefers an explicit override, else the discovered value for the selected model.

## Runtime wiring (`runtimes/pi/index.ts`)

The provider's `resolveEnv` sets:

- `OPENAI_BASE_URL` = the endpoint base URL, `OPENAI_API_KEY` = the key (or `'local'`; pi's openai path rejects an empty key, and local servers usually ignore it).
- `STUDIO_OPENAI_COMPLETIONS=1` and `STUDIO_OPENAI_COMPLETIONS_CONTEXT_WINDOW=<n>` — markers read by the runtime.

`resolveCredentials` reads those markers into `ResolvedCredentials.openaiApi` (`'completions'` vs the wpcom/OpenAI `'responses'` path) and `contextWindow`. `buildModel` then, for the `openai` family with `openaiApi === 'completions'`, builds a `Model<'openai-completions'>` pointed at the endpoint, with `reasoning: false` and the discovered `contextWindow` (falling back to `DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 8192`). Output tokens are scaled under the window to avoid pi clamping them to an invalid value on small local windows.

## Compaction is pi's job

pi compacts conversations itself, driven by the model's declared `contextWindow` together with `STUDIO_COMPACTION_SETTINGS` (`enabled: true`). Declaring the local model's real window is therefore all that's needed to keep long conversations within a small local context — e.g. a 4K-window model compacts far sooner than a 64K one. There is no Studio-side compaction for this provider.

## Choosing a model: minimum context window

Compaction only trims *conversation history*. The **system prompt is fixed overhead it cannot shrink** — `buildSystemPrompt()` (`apps/cli/ai/system-prompt.ts`) produces roughly **4.5K tokens**, and the pi runtime adds tool JSON-schemas and any active skills on top of that. So there is a hard floor on usable models:

- A model whose context window is at or below ~5K tokens (e.g. Apple's on-device `apple-foundationmodel` via Apfel, at 4096) **cannot run this agent** — the endpoint rejects the very first turn with a `context_length_exceeded` error before the conversation starts. This is a model-capability limit, not a Studio bug.
- Practically, pick a model with a context window of **at least 16K tokens**, and larger (32K–64K+) for real multi-step work with tool output. Local servers like vLLM (e.g. a 64K window) are a comfortable fit; tiny on-device models are not.

The window is auto-discovered from `/v1/models`, so an under-sized model isn't blocked at configuration time — it simply fails on first use. If you hit `context_length_exceeded` immediately, the model is too small.

## Testing

Automated:

```bash
nvm use            # matches .nvmrc (Node 24.x / npm 11)
npm test -- apps/cli/ai packages/common/ai
npm run typecheck
```

Relevant suites: `packages/common/ai/tests/models.test.ts` (family/label fallbacks for unknown ids), `apps/cli/ai/tests/openai-compatible.test.ts` (discovery field-name handling and graceful failure), `apps/cli/ai/tests/auth.test.ts` (provider list).

Manual:

```bash
npm run cli:build && node apps/cli/dist/cli/main.mjs
```

`/openai-config` against a small-context endpoint (e.g. Apfel at `http://localhost:11435/v1`, model `apple-foundationmodel`, ~4K window): confirm `/model` lists the endpoint's models, a normal chat works, and a long conversation keeps responding rather than erroring at the context limit — i.e. pi's native compaction fires at the discovered window. Against a larger endpoint (e.g. a vLLM server, ~64K window) everyday chats are untouched.
