# @studio/providers

The services Studio holds an account with: WordPress.com (`wpcom`) and Anthropic (`anthropic`). Each provider describes itself and implements what it offers, so the CLI, the apps and the agent never hardcode one. The architecture and its rules are in `docs/design-docs/providers.md`.

```
index.ts         the entry surfaces read: descriptors, models, ids, errors and types
descriptors.ts   PROVIDER_IDS, getProviderDescriptor, the stored ids
models.ts        getAiModel( provider, id ), getAiModelProviders( id ), defaults
types.ts         ProviderDescriptor, Provider, AiConnection, AiModel
errors.ts        ProviderNotReadyError, InvalidCredentialError
services.ts      the implementations: getProvider( id )
wpcom/           descriptor, config, AI connection, image generation
anthropic/       descriptor, config, AI connection, API key validation
```

## Two entries

- **`@studio/providers`** is what surfaces read: each provider's label, models and config schema, model lookup, and the provider ids. `apps/ui` imports only this.
- **`@studio/providers/services`** holds the implementations: connecting an account, connecting to a model, generating images. The CLI, the apps' backends and the agent import it. It runs in Node and in the page, where Studio on the web runs the agent.

```ts
import { getDefaultAiModel } from '@studio/providers';
import { getProvider } from '@studio/providers/services';

const model = getDefaultAiModel( 'wpcom' );
const ai = await getProvider( 'wpcom' ).ai!.connect( config, model, { sessionId } );
// The runtime registers `ai` with pi and runs the turn on it.
```

## Providers own no storage

A provider never reads or writes a file. It defines its config (`config.ts`, a zod schema), and every call takes that config, or `undefined` when there is none. Studio stores the configs in `shared.json` through `@studio/common/lib/provider-config.ts`, and the selected chat provider through `@studio/common/lib/ai-settings.ts`. A call without a usable config throws `ProviderNotReadyError`; the CLI turns it into a message that says how to connect.

## Ids

Provider ids and model ids are stored, so they never change. Builds before the `anthropic` id stored `anthropic-api-key`: readers go through `normalizeProviderId`, and writers store `toStoredProviderId( id )`, so older builds keep the user's choice. The same model id in two providers is the same model.

## Adding a provider

Add a folder with its `descriptor.ts`, `config.ts` and implementations, add its id to `ProviderId` and `ProviderConfigs` in `types.ts`, and register it in `descriptors.ts` and `services.ts`. Studio then needs to store its config (`provider-config.ts`) and, in the CLI, ask the user for what it needs (`apps/cli/ai/auth.ts`).

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- The package imports no other workspace package: Studio passes in what a provider needs.
- It uses no Node APIs, since the agent runs it in the page too.
- The files the `@studio/providers` entry is made of import only each other.
- `apps/ui` imports only `@studio/providers`, and `@studio/common` never imports `@studio/providers/services`.

## Tests

Tests sit next to their code, in each folder's `tests/`. `npm test -- packages/providers` runs them.
