# @studio/providers

The services Studio holds an account with: WordPress.com (`wpcom`), Anthropic (`anthropic`), OpenAI (`openai`), Google Gemini (`gemini`) and Spacefast (`spacefast`). Each provider describes itself and implements what it offers, so the CLI, the apps and the agent never hardcode one. The architecture and its rules are in `docs/design-docs/providers.md`.

```
index.ts         @studio/providers: what surfaces read
services.ts      @studio/providers/services: what hosts run, getProviderServices( id )
wpcom.ts         @studio/providers/wpcom: the Studio sign-in URL, and WordPress.com sync's sites and options
registry.ts      the provider ids, getProvider( id ), the stored ids, remote-site names
models.ts        findAiModel( id ), getDefaultAiModel( provider )
connection.ts    getConnectMethod( provider, id ), getConnectFields( method )
types.ts         Provider, ProviderServices, ConnectMethod, AccountDetails, AiConnection, …
errors.ts        NotConnectedError, ConnectError, RemoteSiteError
<provider>/      descriptor.ts (its Provider and connect forms), config.ts, services.ts (its
                 ProviderServices), account.ts, and api.ts, ai.ts and sites.ts or folders of them
```

## Two halves of each provider

- **`getProvider( id )`** (`@studio/providers`) is the provider as data: its label, description and icon, its `account` (config schema, connect methods, what to show of a connected account), its `ai` models and its `sites` presentation. Calling it never reaches a service. `apps/ui` imports only this entry, and `@studio/providers/wpcom`.
- **`getProviderServices( id )`** (`@studio/providers/services`) is what the provider does, in the same groups: `account` (start, connect, refresh, disconnect), `ai` (a model connection, image generation) and `sites` (list, create, push, pull). The CLI, the apps' backends and the agent import it. It runs in Node and in the page, where Studio on the web runs the agent.

```ts
import { getDefaultAiModel } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';

const model = getDefaultAiModel( 'wpcom' );
const ai = await getProviderServices( 'wpcom' ).ai!.model( config, model, { sessionId } );
// The runtime registers `ai` with pi and runs the turn on it.
```

Text a provider gives surfaces is plain strings, except a connect method's `instructions`, which is Markdown: the settings render it, `studio code` prints it. An icon is an SVG document, which may draw in `currentColor`.

## Connecting an account

`account.methods` lists the ways an account connects, the first being the default. Each has a stable `id`, which the config records, a `label` for the user to pick it by, optional Markdown `instructions`, and a `kind`:

- **`form`**: `input()` returns a zod object of string fields, whose metadata (`.meta()`) gives each field's `title`, `description` and `examples`; `writeOnly: true` marks a secret. `getConnectFields( method )` reads it for any surface: the settings render a form, `studio code` prompts. Anthropic asks for an API key, or a `claude setup-token` token, this way.
- **`loopback`**: signing in on the provider's site, which redirects back to this computer. Studio listens on a free port (`startProviderConnect` in `@studio/common/lib/provider-connect.ts`) and passes the address to the provider's `start`. OpenAI connects this way.
- **`device`**: approving a code on the provider's site while Studio waits: `start` returns the code. Spacefast connects this way.
- **`redirect`**: the Studio sign-in. Each app receives WordPress.com's redirect its own way (Desktop's `wp-studio://auth` deep link, `studio ui`'s callback page, Studio on the web's page, the token the CLI user pastes) from `getSignInUrl` in `@studio/providers/wpcom`.

For the methods that sign in on the provider's site, `account.start( method, context )` returns where the user goes (`url`), a `code` to approve when there is one, and a `handoff`. `account.connect( method, input )` takes a form's values, a redirect's parameters, or the handoff (with a loopback redirect's parameters), checks them and returns the config to store, or throws `ConnectError`. The same flow runs in every surface: `startProviderConnect`, then `connectProvider` in `@studio/common`.

`context.hostId` stays the same on this computer, and `context.remembered` is what `account.remember( config )` kept from a config the provider rejected, so signing in again continues the same registration.

`account.describe( config )` is what surfaces show of a connected account: the method, a `summary` (an email, the start of a key), a `note` such as whose plan pays for it, and `links` such as where to manage usage; never the credential. `account.expiresAt( config )` says when a config stops working, after which Studio treats the provider as disconnected. The services' `refresh( config )` renews a credential about to expire, such as a ChatGPT access token; Studio calls it through `readFreshProviderConfig` before using the config. `disconnect( config )` lets a provider clean up before Studio removes the config, as WordPress.com revokes its token.

## Providers own no storage

A provider never reads or writes a file. It defines its config (`config.ts`, a zod schema), and every call takes that config, or `undefined` when there is none. Studio stores the configs in `shared.json` through `@studio/common/lib/provider-config.ts`, and the selected chat provider through `@studio/common/lib/ai-settings.ts`. A call without a usable config throws `NotConnectedError`; the CLI turns it into a message that says how to connect.

## Ids

Provider ids and model ids are stored, so they never change. Builds before the `anthropic` id stored `anthropic-api-key`: readers go through `normalizeProviderId`, and writers store `toStoredProviderId( id )`, so older builds keep the user's choice. The same model id in two providers is the same model.

## Adding a provider

Add a folder laid out like the others, add its id to `ProviderId` and `ProviderConfigs` in `types.ts`, and register it in `registry.ts` and `services.ts`. Studio then needs to know where to store its config (`provider-config.ts`); the provider then shows up in the settings and in `studio code`'s `/connect` on its own. A provider with remote sites also adds its site to `ProviderSites`, and Studio a place to store its connections (`remote-sites.ts`).

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- The package imports no other workspace package: Studio passes in what a provider needs.
- It uses no Node APIs, since the agent runs it in the page too.
- The files the surface entries are made of import only each other.
- `apps/ui` imports only `@studio/providers` and `@studio/providers/wpcom`, and `@studio/common` never imports `@studio/providers/services`.

## Tests

Tests sit next to their code, in each folder's `tests/`. `npm test -- packages/providers` runs them.
