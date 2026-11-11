# Providers

## About this doc

This document defines how Studio works with the services it holds an account with: WordPress.com, Anthropic, and other hosts. Each service is a provider, described in one package, so the CLI, the apps and the agent never hardcode one.

It describes the architecture and the rules, not the exact APIs, which are expected to evolve. Items marked _(planned)_ are not implemented yet. For WordPress.com sync and previews, _(planned)_ means the feature works today but does not yet go through a provider.

## Terminology

- **Provider**: a service Studio holds an account with.
- **Studio sign-in**: the WordPress.com account the user signs in to Studio with. It is also the WordPress.com provider's account.
- **Capability**: something a provider offers. Every provider has an account. It may also offer AI (chat models and image generation), remote sites (connect, push and pull) and previews (hosted copies of local sites).
- **Config**: what a provider needs to remember between runs, such as its credentials. The provider defines its shape; Studio stores it.
- **Descriptor**: what a surface needs to know about a provider to show it: its label, capabilities, models and how its account connects. It is browser-safe.

## Principles

1. **Capabilities are optional and independent.** A user can chat through Anthropic while generating images and pushing through WordPress.com.
2. **Surfaces read descriptors and never branch on a provider id.** `apps/ui` renders providers, models, connection state and site statuses from data. A provider-specific flow, such as a plan upgrade, reaches the UI as a status with an action link, not as a component or a state the UI must know. The one exception is [Studio sign-in](#studio-sign-in), which is WordPress.com by definition.
3. **Operations go through CLI commands.** Commands are generic and hand the work to the provider; see [How the CLI and Studio apps communicate](./cli-host-communication.md). Provider code never prompts or exits. The command asks the user for what is missing.
4. **The agent receives resolved inputs, not provider knowledge.** The runtime is handed a ready-to-use model connection. Tools are available according to the capabilities of the connected providers.
5. **Providers own no storage.** A provider never reads or writes a file. It defines its config, Studio passes that config into every call, and Studio stores any new config the provider hands back. Studio also owns everything that isn't a provider's: the selected chat provider, and which remote site each local site is connected to.
6. **Persisted values are forever.** Desktop and CLI builds of different versions read the same `shared.json` and session files. A stored id or field is only ever added, or read through a mapping. Provider configs follow the same rule.

## Providers

| Provider                                                  | Account                           | AI                                   | Sites                  | Previews    |
| --------------------------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------- | ----------- |
| WordPress.com (`wpcom`)                                   | Studio sign-in                    | `fast`, `balanced`, `strong`; images | push, pull _(planned)_ | _(planned)_ |
| Anthropic (`anthropic`)                                   | API key; subscription _(planned)_ | Claude models                        | —                      | —           |
| Other hosts, such as an SSH host or Spacefast _(planned)_ | Per host                          | —                                    | push, pull             | —           |

The WordPress.com tiers are capability aliases. The proxy's `studio-agent` lane resolves each one to an upstream model server-side, so the mapping can change without a release.

## Studio sign-in

Signing in to Studio means signing in to WordPress.com. That account is who the user is in Studio, so it is not one provider account among others.

The WordPress.com provider owns how sign-in works: turning a token from the OAuth flow into its config, the signed-in user, token revocation, and the WordPress.com REST client. Studio's apps and the CLI can always rely on a WordPress.com provider being there, and use its sign-in by name:

- `studio auth` signs in to Studio. It takes no provider.
- The user menu in the apps shows the signed-in WordPress.com user, and signing in and out from it is Studio sign-in.
- Anything else that needs the signed-in user, such as Tracks identity, gets it the same way.

OAuth redirects stay with the shells, because they differ per runtime ([Auth across surfaces](./studio-apps-and-surfaces.md#auth-across-surfaces)).

As a provider, WordPress.com's account is connected exactly when the user is signed in to Studio. No other provider connects that way.

## Package layout

`@studio/providers` (`packages/providers`) has one folder per provider (`wpcom/`, `anthropic/`, …). Everything about a provider lives in its folder, so adding one means adding a folder and registering it. Code shared by every provider (the registry, the shared types, model lookup) sits at the package root.

The package is split in two parts, and lint keeps them apart:

- **A browser-safe part**, with the registry and each provider's descriptor and config schema. `apps/ui` imports only this part.
- **A Node part**, with the implementations, for the CLI, the apps' backends and the agent.

WordPress.com sign-in is also exposed on its own, for the code that relies on it by name.

Dependencies point one way:

- `@studio/providers` imports no other workspace package. Studio passes in what a provider needs, such as its config and the Studio user agent.
- `@studio/common` holds Studio's side, next to the rest of `shared.json`: storing provider configs, the selected chat provider and remote-site connections. It may import the browser-safe part for schemas and types, never the Node part.

It is a package of its own because sites and previews are not agent concerns, so the push command must not depend on `@studio/agent`. It isn't part of `@studio/common` because providers must stay free of Studio's storage, and the browser-safe boundary needs lint enforcement.

## Accounts

- Each provider lists the ways its account can connect: Studio sign-in for WordPress.com, an API key for Anthropic, and later a subscription _(planned)_. When a provider offers several, the user picks one.
- Connecting returns the provider's config, and Studio stores it. Disconnecting is Studio removing it, except signing out of Studio, which revokes the WordPress.com token first.
- When a provider has no usable config, it says so, along with how it can connect. The CLI asks the user; without a terminal, it reports the error.
- Studio stores configs in `shared.json` and validates them against each provider's schema. Configs move to a per-provider section _(planned)_. Until then, and for a few releases after so older builds keep working, Studio uses the existing fields (`authToken` and `anthropicApiKey`). This mapping is Studio's storage code; providers never see it. When `STUDIO_WPCOM_TOKEN` is set, the CLI uses it for the WordPress.com config.
- The app's settings list every provider with its connection state. WordPress.com shows the Studio sign-in; other providers offer a way to connect for each method they support. In `studio code`, `/provider` asks for what is missing. No provider connects through `studio auth`.

## AI

### Models

Each provider lists the models it serves. Several providers can serve the same model (for example, a Claude model listed by WordPress.com and by Anthropic), and the same id means the same model. Each listing carries its own access rules, such as paid credits. Model ids are what sessions record, so they never change.

### Connection

To run a turn, the CLI asks the selected provider for a connection to the chosen model. The connection holds everything the runtime needs: endpoint, credentials, headers, API dialect and model limits. Credentials never travel through environment variables.

The provider owns how its models are reached. For example, WordPress.com sends each tier over a different API, and rewrites its usage-cap errors. The runtime treats every connection the same way, and applies the same request clean-ups to every provider.

### Selection

- The user picks a chat provider in the app's settings or with `/provider` in `studio code`. Studio saves it in `shared.json`, and every surface shares it.
- A conversation pinned to a provider keeps it. Without credentials for the pinned provider, the conversation runs on WordPress.com.
- When the selected provider isn't ready, WordPress.com falls back to another ready provider, and the others ask for credentials.
- Each provider has a default model; WordPress.com picks a stronger one when the account has paid AI credits left. Switching provider keeps the conversation's model when the new provider serves it too, and falls back to its default otherwise.
- The UI gates paid tiers using the WordPress.com quota. The proxy enforces access.

### Images

Image generation is available when a connected provider offers it, whichever provider serves chat. Today only WordPress.com does.

### Persisted ids

An id names the provider only. How the account is connected (an API key, a subscription) is part of the config, so a new way of connecting never adds a provider.

The Anthropic provider is `anthropic`. Builds before this design stored `anthropic-api-key`, in `shared.json` (`aiProvider`) and in session entries. Readers map it to `anthropic`, and writers keep storing `anthropic-api-key`. Older builds fall back to WordPress.com on an id they don't know, so this keeps the user's choice in every build.

## Remote sites _(planned)_

- A remote site is a site on a provider that a local site syncs with. A generic remote site replaces today's WordPress.com-only `SyncSite`.
- Whether a site can sync is a status with an optional action, replacing the WordPress.com-specific states. For example, a site that needs a plan upgrade is blocked, with a link to upgrade.
- Connections are Studio's data about its local sites, not provider config. Studio stores them for every provider, replacing `connectedWpcomSites`, and records when each site was last pushed or pulled.
- `studio push` and `studio pull` stay the commands, and take a remote that names its provider. Bare WordPress.com site ids and URLs keep working.
- The provider brings the transport and the remote side. The local side (exporting a site to an archive, importing an archive) is shared by every provider.
- Progress is reported as generic steps, so each provider describes its own. A provider declares whether it supports selective sync.

## Previews _(planned)_

Previews are a capability, and WordPress.com is the only provider that offers it. The UI shows previews only when a connected provider offers them, and preview commands go to that provider.

## Surfaces

- **`apps/ui`** reads descriptors and account states through its connectors, and never names a provider, apart from Studio sign-in. The `ipc` and `local` connectors stay thin wrappers over Studio's storage in `@studio/common` and the providers' Node part.
- **The agent** receives a model connection per turn. Tools that depend on a capability are available only when a connected provider offers it. `wpcom_request` also requires Studio sign-in _(planned)_; the MCP runtime can still turn it off per client (Codex).
- **The CLI** lists providers and models from descriptors in `studio code`. `studio auth` is Studio sign-in. `studio push`, `pull` and `preview` hand the work to providers _(planned)_.
- **Analytics**: existing Tracks properties keep their names, so reporting stays continuous.

## Out of scope

- **Providers added at runtime** (plugins, user config). Providers are compiled in.
- **Mixing models from different providers in one turn.**

## Open questions

1. **Running the agent without the CLI.** The in-page agent for Studio on the web has no CLI. Getting a model connection should then avoid Node-only APIs, or have a browser variant, so it can run there.
2. **Designing sites against a second host.** The remote-sites direction above is drawn from WordPress.com. It should be checked against a second real host (an SSH host or Spacefast) before it is built, so it doesn't copy WordPress.com's backup, import-polling and transfer steps.
