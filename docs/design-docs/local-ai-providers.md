# Local AI providers (OpenAI-compatible)

## Overview

The Studio CLI AI agent (`studio code`) can be pointed at a **local model server** — anything that exposes an OpenAI-compatible API, such as vLLM, Apfel (Apple's on-device FoundationModels), LM Studio, Ollama, or llama.cpp. This is the `openai-compatible` provider.

The agent runs on the **pi runtime** (`@earendil-works/pi-*`, `apps/cli/ai/runtimes/pi/`), which speaks the OpenAI chat/completions wire protocol natively and manages its own conversation compaction. Because of that, this provider is thin: it points pi at the user's endpoint and tells it which model to use and how large that model's context window is. No translation layer or bespoke compaction is involved.

Relevant code:

- `apps/cli/ai/providers.ts` — the `openai-compatible` provider definition and its dynamic-model hooks.
- `apps/cli/ai/openai-compatible.ts` — endpoint model/context-window discovery.
- `apps/cli/ai/runtimes/pi/index.ts` — the runtime hook that builds an `openai-completions` model for the local endpoint.
- `apps/cli/ai/slash-commands.ts` — the `/openai-config` and `/model` commands.
- `packages/common/lib/shared-config.ts` — the persisted endpoint config.
- `packages/common/ai/models.ts` — the model catalog and the widened `SelectedModelId` type.

## Providers

Three providers are available. The ids and labels live in
`packages/common/ai/providers.ts` (`AI_PROVIDER_IDS`, `AI_PROVIDER_LABELS`) so the CLI
and both UIs can't drift; `apps/cli/ai/providers.ts` re-exports the labels as
`AI_PROVIDERS` and adds the CLI's behavioral hooks.

| Provider          | ID                  | Configuration                             | Offered in app UI |
| ----------------- | ------------------- | ----------------------------------------- | ----------------- |
| WordPress.com     | `wpcom`             | WordPress.com OAuth (`/login`)            | yes               |
| Anthropic API     | `anthropic-api-key` | Anthropic API key (`/api-key`)            | yes               |
| OpenAI-compatible | `openai-compatible` | Local endpoint + model (`/openai-config`) | no — CLI only     |

Switch with `/provider`. Configure the local endpoint with `/openai-config`, which prompts for a base URL and optional API key, then lists the endpoint's models (from `GET /v1/models`) so the user picks one. Selection can be changed later with `/model`.

## Models are dynamic, not from the built-in catalog

Studio ships a fixed model catalog (`AI_MODELS` in `packages/common/ai/models.ts`) whose ids form the `AiModelId` union. A local endpoint serves arbitrary models not in that list, so:

- `SelectedModelId = AiModelId | ( string & {} )` — the type used wherever a *selected* model id is held (`currentModel`, session context, the pi turn config). It accepts any string while preserving autocomplete for the built-in ids.
- `getAiModelFamily()` / `getAiModelLabel()` tolerate unknown ids: family defaults to `'openai'` (local endpoints speak OpenAI), and the label falls back to the id itself.
- The `openai-compatible` provider implements two dynamic hooks on `AiProviderDefinition`: `listDynamicModels()` (used by `/model` to show the endpoint's live models instead of the catalog) and `resolveDefaultModel()` (used when switching to the provider — the saved selection, or the first discovered model).

## The app UIs display it but don't offer it

Every agent turn runs inside the CLI (`runStudioAgentTurn`), so a session pinned to
`openai-compatible` runs normally in the Desktop app and the browser UI. Only
*configuration* is CLI-only. The UIs therefore report the pin rather than hiding it:

- `UI_AI_PROVIDER_IDS` / `isUiSelectableProvider()` (`packages/common/ai/providers.ts`)
  list the providers a picker may offer. `openai-compatible` is excluded, so the
  provider switcher is hidden for a session pinned to it instead of rendering a
  selection that matches no option.
- `getEffectiveSessionProvider()` drops a pin only for `anthropic-api-key` with no key
  saved. Other pins survive — silently reporting a local session as WordPress.com would
  be a lie about where the user's prompts are going.
- `resolveSessionModelForProvider()` returns `SelectedModelId` and keeps the recorded id
  verbatim when the provider has no built-in catalog, so the composer pill shows
  `Local · <model id>` and the model menu shows that model read-only.

## Endpoint configuration

Stored in `shared.json` under `openAiCompatibleEndpoints` — an **array**, though only the first entry (the active endpoint) is used today. Modeling it as a list leaves room for multiple endpoints later without a breaking migration.

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

Access via `getActiveOpenAiCompatibleEndpoint()` / `saveActiveOpenAiCompatibleEndpoint()`
(`packages/common/lib/shared-config.ts`), which write under `lockSharedConfig()`.

It lives in `shared.json` rather than the CLI-owned `cli.json` even though only the CLI
writes it today: Desktop can't write `cli.json`, so an app-side editor would have meant a
config migration later. Placing it here costs nothing now and leaves that door open.

## Discovery (`openai-compatible.ts`)

`discoverOpenAiCompatibleModels( baseUrl, apiKey )` does a `GET {baseUrl}/models` (short timeout, `Bearer` auth when a key is set) and returns `{ id, contextWindow? }[]`, reading the context window from whichever field the server uses: `context_window` (Apfel), `max_model_len` (vLLM), or `max_context_length`. It never throws — an unreachable or unexpected endpoint yields `[]`, so discovery failure degrades gracefully. `resolveOpenAiCompatibleContextWindow()` prefers an explicit override, else the discovered value for the selected model.

## Runtime wiring (`runtimes/pi/index.ts`)

The provider's `resolveEnv` sets:

- `OPENAI_BASE_URL` = the endpoint base URL, `OPENAI_API_KEY` = the key (or `'local'`; pi's openai path rejects an empty key, and local servers usually ignore it).
- `STUDIO_OPENAI_COMPLETIONS_CONTEXT_WINDOW=<n>` — the discovered window, read by the runtime.

The `openai` model family belongs to this provider alone: the built-in tiers ride the
`studio` family through the wpcom proxy, so no flavor flag is needed to tell them apart.
`resolveCredentials` reads `OPENAI_BASE_URL` and the context-window marker into
`ResolvedCredentials`; `buildModel` then builds a `Model<'openai-completions'>` pointed at
the endpoint, with `reasoning: false` and the discovered `contextWindow` (falling back to
`DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 8192`). Output tokens are scaled under the
window to avoid pi clamping them to an invalid value on small local windows.

## Compaction is pi's job

pi compacts conversations itself, driven by the model's declared `contextWindow` together with `STUDIO_COMPACTION_SETTINGS` (`enabled: true`). Declaring the local model's real window is therefore all that's needed to keep long conversations within a small local context — e.g. a 4K-window model compacts far sooner than a 64K one. There is no Studio-side compaction for this provider.

## Choosing a model: minimum context window

Compaction only trims *conversation history*. The **system prompt is fixed overhead it cannot shrink** — `buildSystemPrompt()` (`apps/cli/ai/system-prompt.ts`) produces roughly **4.5K tokens**, and the pi runtime adds tool JSON-schemas and any active skills on top of that. So there is a hard floor on usable models:

- A model whose context window is at or below ~5K tokens (e.g. Apple's on-device `apple-foundationmodel` via Apfel, at 4096) **cannot run this agent** — the endpoint rejects the very first turn with a `context_length_exceeded` error before the conversation starts. This is a model-capability limit, not a Studio bug.
- Practically, pick a model with a context window of **at least 16K tokens**, and larger (32K–64K+) for real multi-step work with tool output. Local servers like vLLM (e.g. a 64K window) are a comfortable fit; tiny on-device models are not.

The window is auto-discovered from `/v1/models`, so an under-sized model isn't blocked at configuration time — it simply fails on first use. If you hit `context_length_exceeded` immediately, the model is too small.

## Analytics

`studio_code_message_sent` reports `provider` (so `openai-compatible` appears alongside
`wpcom` and `anthropic-api-key`) and `model_family` (`openai` for a local model). The
`model` property is sent only when the id is a built-in catalog id — a local endpoint
names its own models, and servers like vLLM report the filesystem path they were launched
with, so anything else is reported as `local`. See `docs/design-docs/analytics-tracks.md`.

## Testing

Automated:

```bash
nvm use            # matches .nvmrc (Node 24.x / npm 11)
npm test -- apps/cli/ai packages/common/ai
npm run typecheck
```

Relevant suites: `packages/common/ai/tests/models.test.ts` (family/label fallbacks for
unknown ids), `packages/common/ai/tests/providers.test.ts` (pin survival, UI selectability,
verbatim local model ids), `apps/cli/ai/tests/openai-compatible.test.ts` (discovery
field-name handling and graceful failure), `apps/cli/ai/tests/auth.test.ts` (provider list).

Manual:

```bash
npm run cli:build && node apps/cli/dist/cli/main.mjs
```

`/openai-config` against a small-context endpoint (e.g. Apfel at `http://localhost:11435/v1`, model `apple-foundationmodel`, ~4K window): confirm `/model` lists the endpoint's models with their discovered context windows, and that the first turn fails with `context_length_exceeded` — the expected outcome below the ~5K floor above, not a regression.

Against a model with a usable window (e.g. a 32K–64K model on vLLM or Ollama): confirm a normal chat works and a long conversation keeps responding rather than erroring at the context limit — i.e. pi's native compaction fires at the discovered window. Screenshots are not offered on a local model: an id outside the built-in catalog is assumed text-only, so `take_screenshot` isn't registered.
