# @studio/providers

The services Studio holds an account with: WordPress.com (`wpcom`), Anthropic (`anthropic`) and Spacefast (`spacefast`). Each provider describes itself and implements what it offers, so the CLI, the apps and the agent never hardcode one. The architecture and its rules are in `docs/design-docs/providers.md`.

```
index.ts         the entry surfaces read: descriptors, models, ids, errors and types
descriptors.ts   PROVIDER_IDS, AI_PROVIDER_IDS, getProviderDescriptor, the stored ids
models.ts        getAiModel( provider, id ), getAiModelProviders( id ), defaults
connection.ts    getConnectionMethods( provider ), getConnectFields( provider, method ), getRedirectUrl( provider, options )
types.ts         ProviderDescriptor, Provider, AiConnection, AiModel, SitesService
errors.ts        ProviderNotReadyError, InvalidCredentialError, RemoteSiteError
services.ts      the implementations: getProvider( id ), and the WordPress.com client
wpcom/           descriptor, config, OAuth URL, sign-in, REST client, AI connection, image generation
wpcom/site.ts    its remote site (`SyncSite`) and sync options, which surfaces read
wpcom/sites/     push and pull: site list, upload, remote import and backup, Reprint exporter
anthropic/       descriptor, config, API key and subscription token forms and validation, AI connection
spacefast/       descriptor, config, device sign-in, its Spaces, and publishing a static export to one
```

## Two entries

- **`@studio/providers`** is what surfaces read: each provider's label, models and config schema, model lookup, and the provider ids. `apps/ui` imports only this.
- **`@studio/providers/services`** holds the implementations: connecting an account, connecting to a model, generating images, pushing and pulling sites. The CLI, the apps' backends and the agent import it. It runs in Node and in the page, where Studio on the web runs the agent.

```ts
import { getDefaultAiModel } from '@studio/providers';
import { getProvider } from '@studio/providers/services';

const model = getDefaultAiModel( 'wpcom' );
const ai = await getProvider( 'wpcom' ).ai!.connect( config, model, { sessionId } );
// The runtime registers `ai` with pi and runs the turn on it.
```

## Connecting an account

A descriptor says how its account connects (`connection`), and the provider's `connect( input )` turns what the user gave into the config Studio stores. Studio never looks inside the input or the config.

- **A form** (`kind: 'form'`): `input()` returns a zod object of string fields, whose metadata (`.meta()`) gives each field's `title`, `description` and `examples`; `writeOnly: true` marks a secret. `getConnectFields( provider )` reads it for any surface: the settings panel renders it as a form, `studio code` as prompts. Anthropic asks for an API key this way.
- **A redirect** (`kind: 'redirect'`): `redirectUrl( options )` is where the user approves access. The app receives the redirect its own way (Desktop's `wp-studio://auth` deep link, `studio ui`'s callback page, Studio on the web's page, or the token the CLI user pastes) and passes its parameters to `connect`. WordPress.com connects this way, and connecting it is signing in to Studio.
- **A device sign-in** (`kind: 'device'`): the provider's `startConnect()` returns a code and the page where the user approves it. Studio shows both, then passes the code back to `connect`, which resolves once the user approves. Spacefast connects this way.
- **Several methods**: `connection` is a list, each entry one of the kinds above with a stable `id` and a `label`. `getConnectionMethods( provider )` lists them for the user to pick (empty for a provider with one way), `getConnectFields( provider, method )` reads the chosen one's form, and `connect` receives its id as `input.method` (the first method without one). The config records the method, which `getConnectedMethod( provider, config )` reads back. Anthropic takes an API key or a `claude setup-token` token this way.

`disconnect( config )` lets a provider clean up before Studio removes the config, as WordPress.com revokes its token. `summarize( config )` is what the settings show for a connected account, never the credential.

## Providers own no storage

A provider never reads or writes a file. It defines its config (`config.ts`, a zod schema), and every call takes that config, or `undefined` when there is none. Studio stores the configs in `shared.json` through `@studio/common/lib/provider-config.ts`, and the selected chat provider through `@studio/common/lib/ai-settings.ts`. A call without a usable config throws `ProviderNotReadyError`; the CLI turns it into a message that says how to connect.

## Ids

Provider ids and model ids are stored, so they never change. Builds before the `anthropic` id stored `anthropic-api-key`: readers go through `normalizeProviderId`, and writers store `toStoredProviderId( id )`, so older builds keep the user's choice. The same model id in two providers is the same model.

## Adding a provider

Add a folder with its `descriptor.ts` (with its `connection`), `config.ts` and implementations, add its id to `ProviderId` and `ProviderConfigs` in `types.ts`, and register it in `descriptors.ts` and `services.ts`. Studio then needs to know where to store its config (`provider-config.ts`); a form provider then shows up in the settings and in `studio code`'s `/provider` on its own. A provider with remote sites also adds its site to `ProviderSites`, and Studio a place to store its connections (`remote-sites.ts`).

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- The package imports no other workspace package: Studio passes in what a provider needs.
- It uses no Node APIs, since the agent runs it in the page too.
- The files the `@studio/providers` entry is made of import only each other.
- `apps/ui` imports only `@studio/providers`, and `@studio/common` never imports `@studio/providers/services`.

## Tests

Tests sit next to their code, in each folder's `tests/`. `npm test -- packages/providers` runs them.
