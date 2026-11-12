# Providers

## About this doc

This document defines how Studio works with the services it holds an account with: WordPress.com, Anthropic, OpenAI, and other hosts. Each service is a provider, described in one package, so the CLI, the apps and the agent never hardcode one.

It describes the architecture and the rules, not the exact APIs, which are expected to evolve. Items marked _(planned)_ are not implemented yet. For WordPress.com sync and previews, _(planned)_ means the feature works today but does not yet go through a provider.

## Terminology

- **Provider**: a service Studio holds an account with.
- **Studio sign-in**: the WordPress.com account the user signs in to Studio with. It is also the WordPress.com provider's account.
- **Capability**: something a provider offers. Every provider has an account. It may also offer AI (chat models and image generation), remote sites (connect, push and pull) and previews (hosted copies of local sites).
- **Config**: what a provider needs to remember between runs, such as its credentials. The provider defines its shape; Studio stores it.
- **Descriptor**: what a surface needs to know about a provider to show it: its label, capabilities, models and how its account connects. It is browser-safe.

## Principles

1. **Capabilities are optional and independent.** A user can chat through Anthropic while generating images and pushing through WordPress.com.
2. **Surfaces read descriptors and never branch on a provider id.** `apps/ui` renders providers, models, connection forms, connection state and site statuses from data. A provider-specific flow, such as a plan upgrade, reaches the UI as a status with an action link, not as a state the UI must know. A provider that needs more than data can describe brings its own component for each surface, with the provider rather than in the surface _(planned)_. The one exception is [Studio sign-in](#studio-sign-in), which is WordPress.com by definition.
3. **Operations go through CLI commands.** Commands are generic and hand the work to the provider; see [How the CLI and Studio apps communicate](./cli-host-communication.md). Provider code never prompts or exits. The command asks the user for what is missing.
4. **The agent receives resolved inputs, not provider knowledge.** The runtime is handed a ready-to-use model connection. Tools are available according to the capabilities of the connected providers.
5. **Providers own no storage.** A provider never reads or writes a file. It defines its config, Studio passes that config into every call, and Studio stores any new config the provider hands back. Studio also owns everything that isn't a provider's: the selected chat provider, and which remote site each local site is connected to.
6. **Persisted values are forever.** Desktop and CLI builds of different versions read the same `shared.json` and session files. A stored id or field is only ever added, or read through a mapping. Provider configs follow the same rule.

## Providers

| Provider                                     | Account                        | AI                                   | Sites      | Previews    |
| -------------------------------------------- | ------------------------------ | ------------------------------------ | ---------- | ----------- |
| WordPress.com (`wpcom`)                      | Studio sign-in                 | `fast`, `balanced`, `strong`; images | push, pull | _(planned)_ |
| Anthropic (`anthropic`)                      | API key, or subscription token | Claude models                        | —          | —           |
| OpenAI (`openai`)                            | ChatGPT plan, browser sign-in  | GPT models                           | —          | —           |
| Spacefast (`spacefast`)                      | Device sign-in                 | —                                    | publish    | —           |
| Other hosts, such as an SSH host _(planned)_ | Per host                       | —                                    | push, pull | —           |

The WordPress.com tiers are capability aliases. The proxy's `studio-agent` lane resolves each one to an upstream model server-side, so the mapping can change without a release.

## Studio sign-in

Signing in to Studio means signing in to WordPress.com. That account is who the user is in Studio, so it is not one provider account among others.

The WordPress.com provider owns how sign-in works: the authorization URL, turning what WordPress.com sends back into its config (checking the token and reading the signed-in user), and token revocation, and its REST client. Studio's apps and the CLI can always rely on a WordPress.com provider being there, and use its sign-in by name:

- `studio auth` signs in to Studio. It takes no provider.
- The user menu in the apps shows the signed-in WordPress.com user, and signing in and out from it is Studio sign-in.
- Anything else that needs the signed-in user, such as Tracks identity, gets it the same way.

Receiving the OAuth redirect stays with the shells, because it differs per runtime ([Auth across surfaces](./studio-apps-and-surfaces.md#auth-across-surfaces)): a deep link in the Desktop app, a callback page in `studio ui` and Studio on the web, and a token the user pastes in the CLI. Each hands what came back to the provider.

As a provider, WordPress.com's account is connected exactly when the user is signed in to Studio. No other provider connects that way.

## Package layout

`@studio/providers` (`packages/providers`) has one folder per provider (`wpcom/`, `anthropic/`, …). Everything about a provider lives in its folder, so adding one means adding a folder and registering it. Code shared by every provider (the registry, the shared types, model lookup) sits at the package root.

The package is split in two parts, and lint keeps them apart:

- **What surfaces read**: the registry, and each provider's descriptor, config schema and connection form. `apps/ui` imports only this part.
- **The services**: the implementations, for the CLI, the apps' backends and the agent.

Neither part uses Node APIs. Studio on the web runs the agent in the page, so the services connect accounts, connect to models and generate images there too.

Dependencies point one way:

- `@studio/providers` imports no other workspace package. Studio passes in what a provider needs, such as its config.
- `@studio/common` holds Studio's side, next to the rest of `shared.json`: storing provider configs, the selected chat provider and remote-site connections. It may import what surfaces read, for schemas and types, never the services; the apps pass in the provider a stored operation needs.

It is a package of its own because sites and previews are not agent concerns, so the push command must not depend on `@studio/agent`. It isn't part of `@studio/common` because providers must stay free of Studio's storage, and the browser-safe boundary needs lint enforcement.

## Accounts

- Each provider says how its account connects, in its descriptor:
  - **A form**, described by a schema whose fields carry their labels, help and whether they are secret, and optionally the steps that get its values (a page to read, a command to run). Anthropic asks for an API key this way.
  - **A redirect** to the provider's site, where the user approves access and is sent back to the app. WordPress.com connects this way, and connecting it is signing in to Studio.
  - **A device sign-in**: the provider gives a code to approve on its site while Studio waits for the approval. No redirect comes back, so it works the same in every app and the CLI. Spacefast connects this way.
  - **A loopback redirect**: like a redirect, but back to this computer: the process that runs the operation (the Desktop main process, the `studio ui` server or the CLI) listens on a free local port while the browser signs in, and gives the provider that address. Where the browser can't reach it, such as over SSH, the CLI asks for the address the browser landed on. OpenAI connects this way, through its sign-in for agents: it registers a client for Studio, which the user allows to use their ChatGPT plan through the public API.
  - **Several methods**, each with a stable id and a label, when a provider offers several ways. The user picks one, and only one is connected at a time. Anthropic takes an API key, or a token from `claude setup-token` that bills the Claude subscription; both are forms. The provider receives the chosen method with the form's values, and its config records it.
- Surfaces render the form from its schema, so neither the settings nor `studio code` know what a provider asks for.
- Connecting hands what the user gave, a form's values or the redirect's result, to the provider, which checks it and returns its config. Studio stores the config without looking inside it. Disconnecting lets the provider clean up on its side, as WordPress.com revokes its token, then Studio removes the config.
- A credential that expires before the account does, like a ChatGPT access token, is renewed by the provider (`refresh`) before Studio uses the config. Studio stores the renewed config, under a lock of its own, since a refresh token works once. A provider that no longer accepts the renewal is disconnected.
- When a provider has no usable config, it says so, along with how it can connect. The CLI asks the user; without a terminal, it reports the error.
- Studio stores configs in `shared.json` and validates them against each provider's schema. Providers added after the first two keep their config in a per-provider section, `providerConfigs`. The first two keep using their existing fields (`authToken` and `anthropicApiKey`), which builds of every version read. An Anthropic subscription token is a later method, so it goes in `providerConfigs`, and connecting one method clears the other. This mapping is Studio's storage code; providers never see it. When `STUDIO_WPCOM_TOKEN` is set, the CLI uses it for the WordPress.com config.
- The app's settings list every provider with its connection state and a summary the provider gives, such as a key's first and last characters, never the credential itself. WordPress.com shows the Studio sign-in; other providers show their form, picked from the Connect button's menu when the provider offers several methods. In `studio code`, `/provider` asks for what is missing, first asking how to connect when the provider offers several methods, and one command connects any provider the way it says _(planned)_. No provider connects through `studio auth`.

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

### In the page

Studio on the web runs the agent in the page, so it offers only the providers it can connect and reach from there. OpenAI's sign-in needs a server on this computer, so the web leaves OpenAI out.

### Images

Image generation is available when a connected provider offers it, whichever provider serves chat. Today only WordPress.com does; a ChatGPT plan shared with Studio can't generate images. When several providers do, the chat's provider generates the images; otherwise the first connected provider that does. The agent gets it from its host, which finds that provider, so the agent never names one.

### Persisted ids

An id names the provider only. How the account is connected (an API key, a subscription) is part of the config, so a new way of connecting never adds a provider.

The Anthropic provider is `anthropic`. Builds before this design stored `anthropic-api-key`, in `shared.json` (`aiProvider`) and in session entries. Readers map it to `anthropic`, and writers keep storing `anthropic-api-key`. Older builds fall back to WordPress.com on an id they don't know, so this keeps the user's choice in every build.

## Remote sites

- A remote site is a site on a provider that a local site syncs with. Each provider with remote sites declares the shape of its site: WordPress.com's is `SyncSite`, Spacefast's a `Space`.
- The provider owns the remote side of a sync: listing the account's sites, creating one when it can, sending what a push sends and applying it remotely, and, for pull, backing the site up remotely or opening the export API a local Reprint reads it through. It reports the steps it runs through as a status. Pull is optional: Spacefast only publishes.
- Studio owns the local side, shared by every provider, and builds what the provider's push takes: the site's WordPress archive (WordPress.com), or a static export of its pages (Spacefast). On pull, it runs Reprint or imports a downloaded backup. The CLI does this; Studio on the web builds the archive in the page and hands the same provider a Blob.
- Connections are Studio's data about its local sites, not provider config. `@studio/common/lib/remote-sites.ts` reads and writes them per provider, and records when each site was last pushed or pulled. WordPress.com's stay in `connectedWpcomSites`, so builds of every version read them; later providers' are in `remoteSites`.
- Whether a site can sync is a status with an optional action, replacing the WordPress.com-specific states. For example, a site that needs a plan upgrade is blocked, with a link to upgrade _(planned)_.
- `studio push` and `studio pull` stay the commands. `studio push --remote-site spacefast[:<space>]` publishes to Spacefast, and bare WordPress.com site ids and URLs keep working. A remote that names any provider comes with the descriptor-driven UI _(planned)_.
- A provider declares whether it supports selective sync _(planned)_.

## Previews _(planned)_

Previews are a capability, and WordPress.com is the only provider that offers it. The UI shows previews only when a connected provider offers them, and preview commands go to that provider.

## Surfaces

- **`apps/ui`** reads descriptors and account states through its connectors, and never names a provider, apart from Studio sign-in. The `ipc`, `local` and static connectors stay thin wrappers over Studio's storage in `@studio/common` and the providers' services.
- **The agent**, in Node or in the page, receives a model connection per turn. Tools that depend on a capability are available only when a connected provider offers it. `wpcom_request` also requires Studio sign-in _(planned)_; the MCP runtime can still turn it off per client (Codex).
- **The CLI** lists providers and models from descriptors in `studio code`. `studio auth` is Studio sign-in. `studio push` and `pull` hand the remote side to the provider; `preview` does too _(planned)_.
- **Analytics**: existing Tracks properties keep their names, so reporting stays continuous.

## Out of scope

- **Providers added at runtime** (plugins, user config). Providers are compiled in.
- **Mixing models from different providers in one turn.**

## Open questions

1. **The UI for remote sites.** Settings and Share and publish still name WordPress.com. They should render every provider with remote sites from its descriptor: its connection, its sites and the statuses a site can sync with.
