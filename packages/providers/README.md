# @studio/providers

The services Studio holds an account with: WordPress.com (`wpcom`), Anthropic (`anthropic`), OpenAI (`openai`), Google Gemini (`gemini`), GitHub Copilot (`github-copilot`) and Spacefast (`spacefast`). Each provider describes itself and implements what it offers, so the CLI, the apps and the agent never hardcode one. The architecture and its rules are in `docs/design-docs/providers.md`.

```
index.ts         @studio/providers: what surfaces read
services.ts      @studio/providers/services: what hosts run, getProviderServices( id ), from each
                 folder's services.ts
wpcom.ts         @studio/providers/wpcom: the Studio sign-in URL, and WordPress.com sync's sites and options
registry.ts      the registration: every provider's descriptor, in order, and the provider ids and
                 types derived from it; getProvider( id ), the stored ids, remote-site names
models.ts        findAiModel( id ), getAiModels( provider, account ), getDefaultAiModel( provider )
connection.ts    getConnectMethod( provider, id ), getConnectFields( method )
types.ts         the contract: defineProvider, defineServices, and every value they take, documented
errors.ts        NotConnectedError, ConnectError, RemoteSiteError
<provider>/      config.ts (its config schema), descriptor.ts (defineProvider), services.ts
                 (defineServices), and its own modules and tests/
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

Text a provider gives surfaces is plain strings, except a connect method's `instructions`, which is Markdown: the settings render it, `studio code` prints it. An `icon` is an SVG document, which may draw in `currentColor`. A `logo` is a square SVG document in the brand's colors, background included, that fills its canvas: surfaces round it into a tile like an app icon, so it reads the same in light and dark.

## Connecting an account

`account.methods` lists the ways an account connects, the first being the default. Each has a stable `id`, which the config records, a `label` for the user to pick it by, optional Markdown `instructions`, and a `kind`:

- **`form`**: `input()` returns a zod object of string fields, whose metadata (`.meta()`) gives each field's `title`, `description` and `examples`; `writeOnly: true` marks a secret. `getConnectFields( method )` reads it for any surface: the settings render a form, `studio code` prompts. Anthropic asks for an API key, or a `claude setup-token` token, this way, and OpenAI for an API key. Every app offers it: the Desktop app, `studio ui`, `studio code` and Studio on the web.
- **`loopback`**: signing in on the provider's site, which redirects back to this computer. Studio listens on a free port (`startProviderConnect` in `@studio/common/lib/provider-connect.ts`) and passes the address to the provider's `start`. OpenAI connects a ChatGPT plan this way. The Desktop app, `studio ui` and `studio code` offer it; Studio on the web doesn't.
- **`device`**: approving a code on the provider's site while Studio waits: `start` returns the code. Spacefast and GitHub Copilot connect this way. The Desktop app, `studio ui` and `studio code` offer it; Studio on the web doesn't.
- **`redirect`**: the Studio sign-in, WordPress.com's only. Each app receives WordPress.com's redirect its own way (Desktop's `wp-studio://auth` deep link, `studio ui`'s callback page, Studio on the web's page, the token the CLI user pastes) from `getSignInUrl` in `@studio/providers/wpcom`. Typecheck rejects it in any other provider's descriptor.

For the methods that sign in on the provider's site, `account.start( method, context )` returns where the user goes (`url`), a `code` to approve when there is one, and a `handoff`. `account.connect( method, input )` takes a form's values, a redirect's parameters, or the handoff (with a loopback redirect's parameters), checks them and returns the config to store, or throws `ConnectError`. The same flow runs in every surface: `startProviderConnect`, then `connectProvider` in `@studio/common`.

`context.hostId` stays the same on this computer, and `context.remembered` is what `account.remember( config )` kept from a config the provider rejected, so signing in again continues the same registration.

`account.describe( config )` is what surfaces show of a connected account: the method, a `summary` (an email, the start of a key), a `note` such as whose plan pays for it, and `links` such as where to manage usage; never the credential. A provider whose plan decides which of its models the account runs lists those in `models`, and the pickers offer only them, through `getAiModels( provider, account )`; GitHub Copilot reads them from the plan when it connects and whenever it renews its token. `account.expiresAt( config )` says when a config stops working, after which Studio treats the provider as disconnected. The services' `refresh( config )` renews a credential about to expire, such as a ChatGPT access token; the Desktop app, `studio ui` and the CLI call it through `readFreshProviderConfig` before using the config, while Studio on the web uses the stored config as it is until `expiresAt` passes. `disconnect( config )` lets a provider clean up before Studio removes the config, as WordPress.com revokes its token.

## Providers own no storage

A provider never reads or writes a file. It defines its config (`config.ts`, a zod schema), and every call takes that config, or `undefined` when there is none. Studio stores the configs in `shared.json` through `@studio/common/lib/provider-config.ts`, each under the provider's id in `providerConfigs`, and the selected chat provider through `@studio/common/lib/ai-settings.ts`. Only the first providers keep fields of their own, which older builds read: WordPress.com's config is the Studio sign-in, and an Anthropic API key stays in `anthropicApiKey`. Which remote sites a local site is connected to is Studio's too, in `remoteSites`. A call without a usable config throws `NotConnectedError`; the CLI turns it into a message that says how to connect.

## Ids

Provider ids, model ids and connect-method ids are stored, so they never change. Builds before the `anthropic` id stored `anthropic-api-key`: readers go through `normalizeProviderId`, and writers store `toStoredProviderId( id )`, so older builds keep the user's choice. Every other provider is stored under its id. The same model id in two providers is the same model.

## Adding a provider

A provider is its folder and one entry in the registration. Nothing else in Studio changes: the settings, the model pickers, `studio code`, the publish panel, `studio push` and the agent read every registered provider, and Studio stores its config and connected sites on its own.

1. Add `packages/providers/<id>/`, laid out like the others:
   - `config.ts`: the zod schema of the config Studio stores for it.
   - `descriptor.ts`: `export const exampleProvider = defineProvider( { … } )`, from `../types`.
   - `services.ts`: `export const services = defineServices( exampleProvider, { … } )`, from `../types`. The services entry reads every folder's `services` export.
   - Its own modules, such as `account.ts`, `ai.ts` or `sites.ts`, and `tests/`.
2. Append its descriptor to the list in `registry.ts`: import it, and add it at the end. Studio lists providers in that order, and where it picks the first connected provider, or the first provider that lists a model, the earlier one wins, so a new provider never goes ahead of the others.

`types.ts` documents every value a provider declares, receives or returns: what it means, whether a provider supplies it, and what Studio does with it.

### What a provider fills in

Every provider declares an `account`, and offers chat models (`ai`), remote sites (`sites`), or both. `defineServices` takes the folder's descriptor and requires the services it declares; typecheck reports, in `services.ts`, a part that is missing or one the descriptor doesn't declare.

- **An account**, which every provider has. The descriptor gives the `id` and `label`; optionally a `description`, `learnMoreUrl`, `icon` and `logo`, without which surfaces show a generic mark; and `account`: `configSchema`, `methods` of kind `form`, `device` or `loopback`, `describe`, and optionally `expiresAt` and `remember`. The services give `account.connect`, and `account.start` when a method is a `device` or `loopback` sign-in; `refresh` and `disconnect` are optional. Settings list the provider under AI providers, Hosting providers or both, and `studio code`'s `/connect` and `/disconnect` offer it.
- **Chat models.** The descriptor gives `ai.models`, each with a stable `id` and a `label`, and `ai.defaultModel`, one of them; an account that narrows them lists its own in `describe`'s `models`. The services give `ai.model( config, modelId )`, which returns an `AiConnection`: `model.api` is `openai-completions`, `openai-responses`, `anthropic-messages` or `google-generative-ai`, the APIs Studio's agent runs; typecheck rejects any other. `AiConnection` lists what the model needs, and `requestModelId` sends the service its own name for a model. Image generation is optional: `ai.generateImages`, and `ai.canGenerateImages( config )` when only some configs can. The provider then appears in the Default AI provider select once connected, its models in the chat model picker and in `studio code`'s `/provider` and `/model`, and its images are used when it is the chat's provider, or, in the Desktop app, `studio ui` and `studio code`, when it is the first connected provider that generates them.
- **Remote sites.** The descriptor gives `sites`: `pull: false`, `selective`, `content` (`archive` for the site's WordPress archive, `static` for a static export of its pages), `newSite: 'create'`, `intro`, `describe( site: ExampleSite )`, which is where `defineProvider` reads the site's type from, `issue` and `withDetails`, and optionally `maxPushSize` and `pushWarning`. The services give `sites.list`, `sites.create` and `sites.push`, which receives what Studio built (`PushContent` says how to send an archive). The provider then appears in the Default hosting provider select once connected, the publish panel lists its sites, and `studio push --remote-site <id>[:<site>]` publishes to them, in the Desktop app, `studio ui` and the CLI. Studio on the web publishes only to WordPress.com.

Some values belong to WordPress.com, and `types.ts` says what any other provider does with them: the `redirect` connect method, `requiresPaidAiCredits` and `paidDefaultModel`, `sites.pull: true` with the `pull` services, `newSite: 'checkout'`, `hasBackups`, `list`'s `planRequired`, `push`'s options, which a provider whose `selective` is false receives as the whole site, and `push`'s `launchError`.

A provider's code runs in Node and in the page: it uses `fetch` and the Web Crypto API, never a Node API, and imports no other workspace package. `descriptor.ts` and `config.ts` import only each other and the files the surface entry is made of, such as `types.ts`, `errors.ts` and `api-key.ts`, since `apps/ui` bundles them; the services may import anything else in the folder, the package's shared modules and npm dependencies.

### What reports a mistake

- Typecheck, in `descriptor.ts`: a default model or an account's model the provider doesn't list, and a `redirect` method.
- Typecheck, in `services.ts`: a missing part (the model connection, `start`, `push`, `create`), a part for a capability the descriptor doesn't declare, and a model connection over an API Studio doesn't run.
- ESLint (`studio/provider-registration`): a folder `registry.ts` doesn't list, in its `descriptor.ts`; a registered provider without `services.ts`, at its entry in `registry.ts`; services not exported as `services` from `defineServices()`, in `services.ts`.
- ESLint: a Node API or another workspace package anywhere in the folder, and anything but each other and the shared surface files in `descriptor.ts` or `config.ts`.

### Testing a provider

Tests sit next to their code, in the folder's `tests/`, and run with Vitest; stub `fetch` (`vi.stubGlobal`) to answer for the service, as `gemini/tests/provider.test.ts` does. Tests may use Node APIs. Then run, from the repository root:

```sh
npm test -- packages/providers
npm run typecheck
npx eslint packages/providers/registry.ts packages/providers/<id>
npm run knip
```

`npm test -- packages/providers` also runs the package's own tests, which check that every registered provider's services are found under its id, with the capabilities its descriptor declares. To try the provider in Studio, connect it from Settings › Providers in `studio ui` (`npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui`), or with `/connect <id>` in `studio code` (`npm run cli:build && node apps/cli/dist/cli/main.mjs code`).

## Boundaries

Enforced by lint (`eslint.config.mjs`), for every provider folder:

- The package imports no other workspace package: Studio passes in what a provider needs.
- It uses no Node APIs, since the agent runs it in the page too.
- The files the surface entries are made of import only each other.
- Every provider folder is registered, with services the services entry reads.
- `apps/ui` imports only `@studio/providers` and `@studio/providers/wpcom`, and `@studio/common` never imports `@studio/providers/services`.

## Tests

Tests sit next to their code, in each folder's `tests/`. `npm test -- packages/providers` runs them.
