# @studio/providers

The services Studio holds an account with: WordPress.com (`wpcom`), Anthropic (`anthropic`), OpenAI (`openai`), Google Gemini (`gemini`), GitHub Copilot (`github-copilot`), Meta (`meta`), xAI (`xai`), OpenRouter (`openrouter`), Spacefast (`spacefast`), the Local LLM connector (`local-llm`), a model server the user runs, and SSH (`ssh`), WordPress sites on servers the user reaches with their own `ssh`. Each provider describes itself and implements what it offers, so the CLI, the apps and the agent never hardcode one. The architecture and its rules are in `docs/design-docs/providers.md`.

```
index.ts         @studio/providers: what surfaces read, getProvider( id )
services.ts      @studio/providers/services: what hosts run, getProviderServices( id )
ui.tsx           @studio/providers/ui: what the apps render, getProviderUi( id )
wpcom.ts         @studio/providers/wpcom: the Studio sign-in URL, and WordPress.com sync's sites and options
registry.ts      the provider ids, getProvider( id ), the stored ids, remote-site names
models.ts        findAiModel( id ), servesAiModel( provider, id ), getAiModels( provider, account ),
                 getDefaultAiModel( provider, options )
connection.ts    getConnectMethod( provider, id ), getFormFields( schema ), needsHost( method )
types.ts         Provider, ProviderServices, ConnectMethod, AccountDetails, AiConnection, …
errors.ts        NotConnectedError, ConnectError, RemoteSiteError
<provider>/      descriptor.ts (its Provider and connect forms), config.ts, services.ts (its
                 ProviderServices), ui.tsx (its ProviderUi), account.ts, and api.ts, ai.ts and
                 sites.ts or folders of them
```

## Three halves of each provider

- **`getProvider( id )`** (`@studio/providers`) is the provider as data: its label, description and icon, its `account` (config schema, connect methods, what to show of a connected account), its `ai` models and its `sites` presentation. Calling it never reaches a service, and it has no React, so the CLI and the agent read it too.
- **`getProviderServices( id )`** (`@studio/providers/services`) is what the provider does, in the same groups: `account` (start, connect, refresh, disconnect), `ai` (a model connection, image generation) and `sites` (list, resolve, create, push, pull, and previews). The CLI, the apps' backends and the agent import it, in Node.
- **`getProviderUi( id )`** (`@studio/providers/ui`) is what a hosting provider looks like in the apps, as React components built on `@studio/ds`: `ConnectForm`, the form for a site its `sites.connect` describes, `SiteRows`, what the publish panel shows under a connected site, such as WordPress.com's plan, and `NewSiteRows`, what it asks before creating a site, such as the Spacefast team. `NewSiteRows` keeps its choices in an `input` that Studio passes to the services' `create` and `creationVisibility`. Each is optional, and the apps render their default without it. A component gets what it needs as props, such as `openUrl` and the panel's own `Row`, so the provider's rows look like the rest.

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

- **`form`**: `input()` returns a zod object of string fields, whose metadata (`.meta()`) gives each field's `title`, `description` and `examples`; `writeOnly: true` marks a secret, and a field whose schema accepts an empty value is optional. `getFormFields( method.input() )` reads it for any surface: the settings render a form, `studio code` prompts. Anthropic asks for an API key, or a `claude setup-token` token, this way, OpenAI for an API key, and the Local LLM connector for a server's address and an optional key.
- **`loopback`**: signing in on the provider's site, which redirects back to this computer. Studio listens on a free port (`startProviderConnect` in `@studio/common/lib/provider-connect.ts`) and passes the address to the provider's `start`. OpenAI connects a ChatGPT plan this way.
- **`device`**: approving a code on the provider's site while Studio waits: `start` returns the code. Spacefast and GitHub Copilot connect this way.
- **`redirect`**: the Studio sign-in. Each app receives WordPress.com's redirect its own way (Desktop's `wp-studio://auth` deep link, `studio ui`'s callback page, the token the CLI user pastes) from `getSignInUrl` in `@studio/providers/wpcom`.

For the methods that sign in on the provider's site, `account.start( method, context )` returns where the user goes (`url`), a `code` to approve when there is one, and a `handoff`. `account.connect( method, input )` takes a form's values, a redirect's parameters, or the handoff (with a loopback redirect's parameters), checks them and returns the config to store, or throws `ConnectError`. The same flow runs in every surface: `startProviderConnect`, then `connectProvider` in `@studio/common`.

A method with `hostOnly: true` checks something only the user's computer can reach, such as a server on it, so a Studio running on another machine, as Studio Cloud does, leaves it out.

`context.hostId` stays the same on this computer, and `context.remembered` is what `account.remember( config )` kept from a config the provider rejected, so signing in again continues the same registration.

`account.describe( config )` is what surfaces show of a connected account: the method, a `summary` (an email, the start of a key), a `note` such as whose plan pays for it, and `links` such as where to manage usage; never the credential. A provider whose plan decides which of its models the account runs lists those in `models`, and the pickers offer only them, through `getAiModels( provider, account )`; GitHub Copilot reads them from the plan when it connects and whenever it renews its token. `account.expiresAt( config )` says when a config stops working, after which Studio treats the provider as disconnected. The services' `refresh( config )` renews a credential about to expire, such as a ChatGPT access token; Studio calls it through `readFreshProviderConfig` before using the config. `disconnect( config )` lets a provider clean up before Studio removes the config, as WordPress.com revokes its token.

## Models a server lists

A catalog provider (`ai.catalog`) runs more models than it lists: its `listModels` gives the catalog, the settings pick from it with `selectModels`, and `ai.catalog.prefixes` name its ids, such as `openrouter/`, Anthropic's `claude-`, or the makers GitHub Copilot runs models of (`claude-`, `gpt-`, …). A provider pi runs builds its catalog from the models pi knows, narrowed by the account's own list, with `piCatalog` (`catalog.ts`).

The Local LLM connector is a catalog provider whose catalog is the chat models the user's server lists, less those it says only make embeddings: connecting offers them all, those the server says call tools first, since new chats start on the first, and the settings narrow them. `ai.local` says its models run on the user's server: chats on them need no internet, and analytics never name them.

A model connection whose `model.contextWindow` is exactly the context the server runs the model with says so with `exactContextWindow`, and the words a turn that still can't fit ends with: the runtime then never sends a request that window can't hold.

## Sites and previews

`sites` sends local sites to sites the user keeps on the provider, and `previews` says whether it also builds temporary previews shared by a link. A preview is updated with a push to it, with `preview` set, and created, listed and deleted through `previews`.

`sites.intro` is what the panel says before a site is connected, with an optional `learnMoreUrl`. `sites.describe( site )` gives the facts the panel lists about a connected site and the `links` its site menu shows, in order, each with an optional `icon` (an SVG document in `currentColor`). `sites.visibility` lists who can see a site (`options`) and where its access is managed on the provider (`manage`), next to the services' `visibility`, which reads and sets it.

A provider whose config is `undefined`, such as SSH, has no `account`: there is nothing to connect, and surfaces treat it as connected. The user connects each of its sites with the descriptor's `sites.connect` form, the same shape as an account's form method, and the services' `resolve` checks it by reaching the site: `resolve( config, { input } )` takes the form's values, and `resolve( config, { id } )` a site's id, as `--remote-site ssh:<id>` names it. It pulls by writing the site's archive (`pullArchive`). Its form is `hostOnly`, so only the user's computer offers it.

## Providers own no storage

A provider never reads or writes a file. It defines its config (`config.ts`, a zod schema), and every call takes that config, or `undefined` when there is none. Studio stores the configs in `config.json` through `@studio/common/lib/provider-config.ts`, and the selected chat provider through `@studio/common/lib/ai-settings.ts`. A call without a usable config throws `NotConnectedError`; the CLI turns it into a message that says how to connect.

## Ids

Provider ids and model ids are stored, so they never change. Builds before the `anthropic` id stored `anthropic-api-key`: readers go through `normalizeProviderId`, and writers store `toStoredProviderId( id )`, so older builds keep the user's choice. The same model id in two providers is the same model.

## Adding a provider

Add a folder laid out like the others, then register it in three places: its config in `ProviderConfigs` (`types.ts`), which names its id, its descriptor in `registry.ts`, and its services in `services.ts`. Typecheck reports a provider missing from either map. A hosting provider also registers its UI in `ui.tsx`. The provider then shows up in the settings, the model picker and `studio code`'s `/connect` on its own, and Studio stores its config. The order in `registry.ts` is the order of every provider list: AI providers fall back in it, and the publish panel offers hosting providers in it. A provider that lists models adds their ids to `AiModelId` (`models.ts`). A provider with remote sites adds its site to `ProviderSites`; one that only hosts sites is left out of `AiProviderId`.

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- The package imports no other workspace package but `@studio/ds`, which its forms (`.tsx`) build on alone: Studio passes in what a provider needs, such as the WP-CLI the SSH provider runs on servers, named in `STUDIO_WP_CLI_PHAR`.
- Its surface entries use no Node APIs, since `apps/ui` loads them in the browser. The services may, as SSH runs `ssh`.
- The files the surface entries are made of import only each other.
- `apps/ui` imports only `@studio/providers`, `@studio/providers/wpcom` and `@studio/providers/ui`, and `@studio/common` never imports `@studio/providers/services`.

## Tests

Tests sit next to their code, in each folder's `tests/`. `npm test -- packages/providers` runs them.
