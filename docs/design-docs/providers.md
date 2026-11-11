# Providers

## About this doc

This document defines how Studio works with the services it holds an account with: WordPress.com, Anthropic, and other hosts. Each service is a provider, described in one package, so the CLI, the apps and the agent never hardcode one.

Items marked _(planned)_ are not implemented yet. For WordPress.com sync and previews, _(planned)_ means the feature works today but does not yet go through a provider.

## Terminology

- **Provider**: a service Studio holds an account with.
- **Studio sign-in**: the WordPress.com account the user signs in to Studio with. It is also the WordPress.com provider's account.
- **Capability**: something a provider offers. Every provider has an `account`. It may also offer `ai` (chat models and image generation), `sites` (connect, push and pull remote sites) and `previews` (hosted copies of local sites).
- **Config**: what a provider needs to remember between runs, such as its credentials. The provider defines its shape; Studio stores it.
- **Descriptor**: the data a surface needs about a provider: id, label, capabilities, models and config schema. It is browser-safe.
- **Implementation**: the code behind a capability: requests, model connections, push and pull. It runs in Node.

## Principles

1. **Capabilities are optional and independent.** A user can chat through Anthropic while generating images and pushing through WordPress.com.
2. **Surfaces read descriptors and never branch on a provider id.** `apps/ui` renders providers, models, connection state and site statuses from data. A provider-specific flow, such as a plan upgrade, reaches the UI as a status with an action link, not as a component or an enum the UI must know. The one exception is [Studio sign-in](#studio-sign-in), which is WordPress.com by definition.
3. **Operations go through CLI commands.** Commands are generic and dispatch to the provider; see [How the CLI and Studio apps communicate](./cli-host-communication.md). Provider code never prompts or exits. The command asks the user for what is missing.
4. **The agent receives resolved inputs, not provider knowledge.** The runtime gets a ready-to-use AI connection. Tools are gated on the capabilities of the connected providers.
5. **Providers own no storage.** A provider never reads or writes a file. It defines its config, Studio passes that config into every call, and Studio stores any new config the provider hands back. Studio also owns everything that isn't a provider's: the selected chat provider, and which remote site each local site is connected to.
6. **Persisted values are forever.** Desktop and CLI builds of different versions read the same `shared.json` and session files. A stored id or field is only ever added, or read through a mapping. Config schemas follow the same rule: new fields are optional.

## Providers

| Provider                                                  | Account                           | AI                                   | Sites                  | Previews    |
| --------------------------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------- | ----------- |
| WordPress.com (`wpcom`)                                   | Studio sign-in                    | `fast`, `balanced`, `strong`; images | push, pull _(planned)_ | _(planned)_ |
| Anthropic (`anthropic`)                                   | API key; subscription _(planned)_ | Claude models                        | —                      | —           |
| Other hosts, such as an SSH host or Spacefast _(planned)_ | Per host                          | —                                    | push, pull             | —           |

The WordPress.com tiers are capability aliases. The proxy's `studio-agent` lane resolves each one to an upstream model server-side, so the mapping can change without a release.

## Studio sign-in

Signing in to Studio means signing in to WordPress.com. That account is who the user is in Studio, so it is not one provider account among others.

The WordPress.com provider owns how sign-in works. Studio's apps and the CLI can always rely on a WordPress.com provider being there, and they import its sign-in from `@studio/providers/wpcom` by name. That entry offers:

- turning a token from the OAuth flow into WordPress.com config (`{ token }`), after checking it;
- the signed-in user from that config: id, email, and whether they're an Automattician;
- token revocation;
- the WordPress.com REST client that sign-in, sync, previews and `wpcom_request` use.

The OAuth authorize and sign-up URLs are browser-safe, so they come from `@studio/providers` instead.

Studio stores the WordPress.com config like any other provider's (see [Accounts](#accounts)), where the token is today (`authToken`), so builds of every version share the sign-in. When `STUDIO_WPCOM_TOKEN` is set, the CLI builds the config from it instead.

The code that uses sign-in names WordPress.com directly:

- `studio auth login|logout|status` signs in to Studio. It takes no provider.
- The user menu in the apps shows the signed-in WordPress.com user, and signing in and out from it is Studio sign-in.
- Anything else that needs the signed-in user, such as Tracks identity.

OAuth redirects stay with the shells, because they differ per runtime ([Auth across surfaces](./studio-apps-and-surfaces.md#auth-across-surfaces)).

As a provider, WordPress.com's account is connected exactly when the user is signed in to Studio. Its only connection method is `studio`, and no other provider uses that method.

## Package layout

`@studio/providers` (`packages/providers`) has one folder per provider. Everything about a provider lives in its folder, so adding one means adding a folder and registering it:

```
packages/providers/
  index.ts                  browser-safe entry: PROVIDER_IDS, getProviderDescriptor, normalizeProviderId
  node.ts                   Node entry: getProvider( id )
  types.ts                  ProviderDescriptor, AiModel, RemoteSite (planned), AiConnection, Provider
  models.ts                 getAiModel( provider, id ), getAiModelProviders( id )
  errors.ts                 ProviderNotReadyError
  wpcom/
    descriptor.ts           label, connection methods, tier models
    config.ts               config schema: { token }
    index.ts                the Provider, assembled from the files below
    sign-in.ts              Studio sign-in: config from a token, user, revocation (the @studio/providers/wpcom entry)
    oauth.ts                authorize and sign-up URLs
    api.ts                  WordPress.com REST client
    account.ts              connected when signed in to Studio
    ai.ts                   gateway URL, tier → API table, headers, usage-cap rewrite
    images.ts               image generation
    sites.ts                /me/sites, backup pull, import push (planned)
    previews.ts             preview sites (planned)
  anthropic/
    descriptor.ts           label, connection methods, Claude models
    config.ts               config schema: { method: 'api-key', apiKey }
    index.ts
    account.ts              key validation; subscription sign-in (planned)
    ai.ts                   model config from pi's Anthropic catalog
  spacefast/                (planned)
    descriptor.ts
    config.ts
    index.ts
    sites.ts
```

Studio's side lives in `@studio/common`, next to the rest of `shared.json`:

```
packages/common/lib/
  provider-config.ts        each provider's config in shared.json, with locking and the legacy fields
  ai-settings.ts            the selected chat provider
  connected-sites.ts        connections to remote sites, for every provider (planned; WordPress.com-only today)
```

The package has three entry points, and lint keeps them apart:

- **`@studio/providers`** is browser-safe. It holds `index.ts`, `types.ts`, `models.ts`, each provider's `descriptor.ts` and `config.ts`, and `wpcom/oauth.ts`. Those files import only each other, and nothing from Node (type-only imports are fine).
- **`@studio/providers/wpcom`** is Studio sign-in, for the code that relies on WordPress.com by name.
- **`@studio/providers/node`** holds everything else.

Dependencies point one way:

- `@studio/providers` imports no other workspace package. Studio passes in everything it needs: the provider's config and the Studio user agent.
- `@studio/common` imports `@studio/providers` for the config schemas and types such as `RemoteSite`, and never the Node entries.
- `apps/ui` imports `@studio/providers`.
- The Desktop main process, `apps/local` and the CLI import `@studio/providers/wpcom` for sign-in and `@studio/providers/node` for everything else.
- `@studio/agent` imports `@studio/providers`, which includes the `AiConnection` type, and `@studio/providers/wpcom` for `wpcom_request`.

It is a package of its own because sites and previews are not agent concerns, so the push command must not import `@studio/agent`. It isn't part of `@studio/common` because providers must stay free of Studio's storage, and its browser-safe boundary needs lint enforcement.

## Interfaces

Descriptors are data, plus the zod schema of the provider's config:

```ts
// types.ts
export type ProviderId = 'wpcom' | 'anthropic';

// studio: connected by Studio sign-in (wpcom only)
export type AccountMethod = 'studio' | 'api-key' | 'subscription'; // subscription: planned

export interface ProviderDescriptor< Config = unknown > {
	id: ProviderId;
	label: string; // brand name, not translated
	configSchema: z.ZodType< Config >; // what Studio stores for this provider
	account: { methods: readonly AccountMethod[] };
	ai?: {
		models: readonly AiModel[];
		defaultModel: AiModelId;
		paidDefaultModel?: AiModelId; // wpcom: balanced when paid credits remain
		images?: boolean;
	};
	sites?: { selectiveSync: boolean }; // planned
	previews?: true; // planned
}

// types.ts
export interface AiModel {
	id: string; // stable, stored in sessions; the same id in two providers is the same model
	label: () => string;
	supportsImages?: boolean;
	requiresPaidAiCredits?: boolean; // set per provider's listing
}
```

Several providers can serve the same model. For example, a Claude model can be listed by WordPress.com and by Anthropic. Each listing carries its own access rules, such as paid credits, and each provider's `connect` decides how to reach it. Model ids are what sessions record, so they never change. A model is identified by the provider serving it plus its id: `getAiModel( provider, id )`.

Implementations sit behind the descriptor. Every call takes the config Studio stored, or `undefined` when there is none:

```ts
// types.ts
export interface ProviderContext< Config > {
	config: Config | undefined;
	userAgent: string;
}

export interface Provider< Config = unknown > {
	descriptor: ProviderDescriptor< Config >;
	account: {
		status( config: Config | undefined ): AccountStatus;
		connectApiKey?( key: string ): Promise< Config >; // api-key method; validates first
		// The subscription method's sign-in is planned.
	};
	ai?: {
		// Whether a selection that isn't ready falls back to another ready
		// provider instead of asking for credentials.
		fallbackWhenNotReady: boolean;
		connect(
			context: ProviderContext< Config >,
			model: AiModelId,
			options: { sessionId?: string }
		): Promise< AiConnection >;
		generateImages?: GenerateImages< Config >;
	};
	sites?: {
		// planned
		list( context: ProviderContext< Config > ): Promise< RemoteSite[] >;
		push(
			context: ProviderContext< Config >,
			site: LocalSite,
			remote: RemoteSite,
			options: SyncOptions,
			onProgress: ProgressCallback
		): Promise< RemoteSite >;
		pull(
			context: ProviderContext< Config >,
			site: LocalSite,
			remote: RemoteSite,
			options: SyncOptions,
			onProgress: ProgressCallback
		): Promise< RemoteSite >;
	};
	previews?: {
		// planned
		list( context: ProviderContext< Config >, site: LocalSite ): Promise< Snapshot[] >;
		create(
			context: ProviderContext< Config >,
			site: LocalSite,
			onProgress: ProgressCallback
		): Promise< Snapshot >;
		update(
			context: ProviderContext< Config >,
			site: LocalSite,
			hostname: string,
			onProgress: ProgressCallback
		): Promise< Snapshot >;
		delete(
			context: ProviderContext< Config >,
			hostname: string,
			onProgress: ProgressCallback
		): Promise< void >;
	};
}

export interface AccountStatus {
	connected: boolean;
	method: AccountMethod | null; // how it is connected
	credentialPreview: string | null; // `sk-ant-…abcd`; never the credential itself
}
```

Connecting an account returns new config, and Studio stores it. Disconnecting is Studio removing the config; the one exception is signing out of Studio, which revokes the WordPress.com token first. When a call has to change the config, for example to refresh a subscription token _(planned)_, it returns the new config with its result, and Studio stores that too.

Any capability call can throw `ProviderNotReadyError`, which carries the provider's connection methods, when its config is missing or no longer works. The CLI command catches it and asks the user: Studio sign-in for `studio`, a password prompt for `api-key`, and a sign-in for `subscription` _(planned)_. When a provider offers several methods, the user picks one. Without a terminal, it reports the error instead.

## AI

### Connection

`ai.connect` returns everything the runtime needs to register one model with pi:

```ts
export interface AiConnection {
	piProvider: string; // 'studio-wpcom', 'anthropic'
	apiKey: string;
	headers?: Record< string, string >;
	model: Model< Api >; // pi's own type: api dialect, baseUrl, context window, compat
	requestModelId?: string; // the upstream alias sent on the wire (balanced-2, strong-2)
	rewriteError?: ( error: Error ) => Error | undefined; // wpcom usage-cap 429s
}
```

`AiConnection` uses pi's `Model` type rather than a Studio copy of it. pi is the runtime, and a parallel type would only drift from it.

The provider owns how its models are reached. WordPress.com sends `strong` over Anthropic Messages, `balanced` over Responses and `fast` over Chat Completions. Anthropic reads thinking and compat settings from pi's catalog.

The CLI reads the provider's config, calls `connect`, and passes the connection to `runStudioAgentTurn` as `ai`. Credentials never travel through environment variables. The runtime registers every provider the same way, with `registerProvider( conn.piProvider, … )`. It wraps each stream with the stale-image strip, the leaked tool-call markup cleanup and `conn.rewriteError`.

### Selection

- The user picks a chat provider in the app's settings or with `/provider` in `studio code`. Studio saves it in `shared.json`, and every surface shares it.
- A conversation pinned to a provider keeps it. Without credentials for the pinned provider, the conversation runs on WordPress.com.
- When the selected provider isn't ready and `fallbackWhenNotReady` is set, the CLI uses the first ready provider in `PROVIDER_IDS` order. Otherwise it asks for credentials.
- The default model is the provider's `defaultModel`, or `paidDefaultModel` when the account has paid AI credits left. Switching provider keeps the conversation's model when the new provider serves it too. A recorded model the provider doesn't serve snaps to that default.
- Paid tiers are gated in the UI by `requiresPaidAiCredits`, using the WordPress.com quota. The proxy enforces access.

### Images

`generate_images` is available when a connected provider offers `ai.generateImages`, whichever provider serves chat. Today only WordPress.com offers it.

### Persisted ids

An id names the provider only. How the account is connected (an API key, a subscription) is a connection method, stored in the config, so a new method never adds a provider.

The Anthropic provider is `anthropic`. Builds before this design stored `anthropic-api-key` in `shared.json` (`aiProvider`) and in session entries (`studio.session_context.provider`). Readers go through `normalizeProviderId`, which maps it to `anthropic`. Writers still store `anthropic-api-key`, in both places. Older builds fall back to WordPress.com on an id they don't know, so this keeps the user's choice in every build.

## Accounts

Studio stores each provider's config in `shared.json`, through `provider-config.ts`. It validates the config against the descriptor's `configSchema` when reading it, and takes the lock when writing it.

- Configs live under `providers[id]` _(planned)_. Until then, and for a few releases after so older builds keep working, Studio reads and writes the legacy fields: WordPress.com's config in `authToken`, Anthropic's in `anthropicApiKey`. That mapping is Studio's storage code; providers never see it.
- The selected chat provider is `aiProvider` (see [Persisted ids](#persisted-ids)).
- The app's settings list every provider with its connection state. WordPress.com shows the Studio sign-in. Other providers show a control for each method they offer: a key field for `api-key`, and a sign-in for `subscription` _(planned)_.
- In `studio code`, `/provider` asks for a missing key. A provider connects there or in settings, never through `studio auth`.

## Remote sites _(planned)_

A remote site is a site on a provider that a local site syncs with:

```ts
// types.ts (planned)
export interface RemoteSite {
	provider: ProviderId;
	remoteId: string;
	localSiteId: string;
	name: string;
	url: string;
	environment?: 'production' | 'staging' | 'development';
	status: RemoteSiteStatus;
	lastPullAt: string | null;
	lastPushAt: string | null;
}

export type RemoteSiteStatus =
	| { kind: 'ready' }
	| { kind: 'blocked'; reason: string; action?: { label: string; url: string } };
```

- `RemoteSite` replaces `SyncSite`. `status` replaces the `syncSupport` enum. WordPress.com maps its own states onto it; for example, a site that needs an upgrade is `blocked`, with a link to upgrade the plan.
- Connections are Studio's data about its local sites, not provider config. Studio stores them in `shared.json` under `connectedRemoteSites[provider][accountKey]`, replacing `connectedWpcomSites[userId]`, and records `lastPullAt` and `lastPushAt` after each sync.
- The commands stay `studio push` and `studio pull`, with a `--remote <provider>:<remoteId>` target. Bare WordPress.com site ids and URLs keep working.
- The provider brings transport and the remote side. The local side (exporting a site to an archive, importing an archive) is shared by every provider.
- Progress is published as label and percent events, so each provider reports its own steps. WordPress.com's `PUSH_PHASES` are its own.
- Selective sync is offered only when the descriptor's `sites.selectiveSync` is true.

## Previews _(planned)_

Previews are a capability, and WordPress.com is the only provider that offers it. The UI shows previews only when a connected provider offers them, and preview commands dispatch to that provider.

## Surfaces

**UI connector:**

- `getAiSettings()` returns `{ provider }`. `setAiProvider( provider )` saves the chat provider.
- `getProviderAccounts()` returns each provider's `AccountStatus`. `saveProviderApiKey( provider, key )` replaces `saveAnthropicApiKey`.
- `getAuthUser()`, `authenticate()` and `onAuthStateChanged()` stay Studio sign-in, so they take no provider. Both shells back them with `@studio/providers/wpcom`.
- `getRemoteSites( localSiteId? )` and `listRemoteSites( provider )` _(planned)_ replace `getConnectedWpcomSites` and the WordPress.com site list. Push and pull take a `RemoteSite` _(planned)_.

Both connectors stay thin wrappers over Studio's storage in `@studio/common` and over `@studio/providers/node`: `ipc` through `apps/studio`, and `local` through `apps/local`. The Tracks props (`has_anthropic_api_key`) keep their names, so reporting stays continuous.

**Agent host:**

- `host.sync.push` and `host.sync.pull` return a `RemoteSite` _(planned)_.
- `host.remoteSites.list( provider )` _(planned)_ replaces `host.wpcom.sites`.

**Agent tools:**

- `generate_images` follows the image capability (see [Images](#images)).
- `wpcom_request` also requires Studio sign-in _(planned)_. The MCP runtime's `wpcomRequest` option still turns it off per client (Codex), whatever the account.

**CLI:** `studio code` lists providers and models from descriptors. `studio auth` is Studio sign-in, through `@studio/providers/wpcom`. `studio push`, `pull` and `preview` dispatch to providers _(planned)_.

## Out of scope

- **Providers added at runtime** (plugins, user config). Providers are compiled in.
- **Mixing models from different providers in one turn.**

## Open questions

1. **Running the agent without the CLI.** The in-page agent for Studio on the web has no CLI. `ai.connect` should then avoid Node-only APIs, or have a browser variant, so it can run there.
2. **Designing sites against a second host.** The `sites` interface above is drawn from WordPress.com. It should be checked against a second real host (an SSH host or Spacefast) before it is built, so it doesn't copy WordPress.com's backup, import-polling and transfer steps.
