# Providers

## About this doc

This document defines how WordPress Studio works with the services it holds an account with: WordPress.com, Anthropic, OpenAI, and other hosts. Each service is a provider, described in one package, so the CLI, the apps and the agent never hardcode one.

It describes the architecture and the rules, not the exact APIs, which are expected to evolve. Items marked _(planned)_ are not implemented yet. For WordPress.com sync, _(planned)_ means the feature works today but does not yet go through a provider.

## Terminology

- **Provider**: a service WordPress Studio holds an account with.
- **WordPress Studio sign-in**: the WordPress.com account the user signs in to WordPress Studio with. It is also the WordPress.com provider's account.
- **Capability**: something a provider offers. Every provider has an account. It may also offer AI (chat models and image generation) and remote sites: sites the user keeps (connect, push and pull), previews (temporary copies shared by a link), or both.
- **Config**: what a provider needs to remember between runs, such as its credentials. The provider defines its shape; WordPress Studio stores it.
- **Descriptor**: what a surface needs to know about a provider to show it: its label, capabilities, models and how its account connects. It is browser-safe.

## Principles

1. **Capabilities are optional and independent.** A user can chat through Anthropic while generating images and pushing through WordPress.com.
2. **Surfaces read descriptors and never branch on a provider id.** `apps/ui` renders providers, models, connection forms, connection state and site statuses from data. A provider-specific flow, such as a plan upgrade, reaches the UI as a status with an action link, not as a state the UI must know. A provider that needs more than data can describe brings its own component for each surface, with the provider rather than in the surface _(planned)_. The one exception is [WordPress Studio sign-in](#wordpress-studio-sign-in), which is WordPress.com by definition.
3. **Operations go through CLI commands.** Commands are generic and hand the work to the provider; see [How the CLI and WordPress Studio apps communicate](./cli-host-communication.md). Provider code never prompts or exits. The command asks the user for what is missing.
4. **The agent receives resolved inputs, not provider knowledge.** The runtime is handed a ready-to-use model connection. Tools are available according to the capabilities of the connected providers.
5. **Providers own no storage.** A provider never reads or writes a file. It defines its config, WordPress Studio passes that config into every call, and WordPress Studio stores any new config the provider hands back. WordPress Studio also owns everything that isn't a provider's: the selected chat provider, and which remote site each local site is connected to.
6. **Persisted values are forever.** Desktop and CLI builds of different versions read the same config file and session files. A stored id or field is only ever added, or read through a mapping. Provider configs follow the same rule.

## Providers

| Provider                                     | Account                        | AI                                   | Sites      | Previews |
| -------------------------------------------- | ------------------------------ | ------------------------------------ | ---------- | -------- |
| WordPress.com (`wpcom`)                      | WordPress Studio sign-in       | `fast`, `balanced`, `strong`; images | push, pull | yes      |
| Anthropic (`anthropic`)                      | API key, or subscription token | Claude models                        | —          | —        |
| OpenAI (`openai`)                            | ChatGPT plan, or API key       | GPT models; images with an API key   | —          | —        |
| Google Gemini (`gemini`)                     | API key                        | Gemini models; images                | —          | —        |
| GitHub Copilot (`github-copilot`)            | Copilot plan, device sign-in   | Claude, GPT and Gemini models        | —          | —        |
| Meta (`meta`)                                | API key                        | Muse models; images                  | —          | —        |
| xAI (`xai`)                                  | Grok plan or API key           | Grok models; images                  | —          | —        |
| OpenRouter (`openrouter`)                    | Sign-in or API key             | Models from many labs                | —          | —        |
| Local LLM (`local-llm`)                      | Server address, optional key   | The models the server lists          | —          | —        |
| Spacefast (`spacefast`)                      | Device sign-in                 | —                                    | publish    | —        |
| SSH (`ssh`)                                  | None: the user's SSH setup     | —                                    | push, pull | —        |

The WordPress.com tiers are capability aliases. The proxy's `studio-agent` lane resolves each one to an upstream model server-side, so the mapping can change without a release.

## WordPress Studio sign-in

Signing in to WordPress Studio means signing in to WordPress.com. That account is who the user is in WordPress Studio, so it is not one provider account among others.

The WordPress.com provider owns how sign-in works: the authorization URL, turning what WordPress.com sends back into its config (checking the token and reading the signed-in user), and token revocation, and its REST client. WordPress Studio's apps and the CLI can always rely on a WordPress.com provider being there, and use its sign-in by name:

- `studio auth` signs in to WordPress Studio. It takes no provider.
- The user menu in the apps shows the signed-in WordPress.com user, and signing in and out from it is WordPress Studio sign-in.
- Anything else that needs the signed-in user, such as Tracks identity, gets it the same way.

Receiving the OAuth redirect stays with the shells, because it differs per runtime ([Auth across surfaces](./studio-apps-and-surfaces.md#auth-across-surfaces)): a deep link in the Desktop app, a callback page in `studio ui`, and a token the user pastes in the CLI. Each hands what came back to the provider.

As a provider, WordPress.com's account is connected exactly when the user is signed in to WordPress Studio. No other provider connects that way.

## Package layout

`@studio/providers` (`packages/providers`) has one folder per provider (`wpcom/`, `anthropic/`, …). Everything about a provider lives in its folder, so adding one means adding a folder and registering it. Code shared by every provider (the registry, the shared types, model lookup) sits at the package root.

The package is split in two parts, and lint keeps them apart:

- **What surfaces read**: the registry, and each provider's descriptor, config schema and connection form. `apps/ui` imports only this part.
- **The services**: the implementations, for the CLI, the apps' backends and the agent.

What surfaces read uses no Node APIs. The services may, where a provider runs a program on the user's computer, as SSH runs `ssh`.

Dependencies point one way:

- `@studio/providers` imports no other workspace package but `@studio/ds`, for the forms in `./ui`. WordPress Studio passes in what a provider needs, such as its config.
- `@studio/common` holds WordPress Studio's side, next to the rest of the config store: storing provider configs, the selected chat provider and remote-site connections. It may import what surfaces read, for schemas and types, never the services; the apps pass in the provider a stored operation needs.

It is a package of its own because sites and previews are not agent concerns, so the push command must not depend on `@studio/agent`. It isn't part of `@studio/common` because providers must stay free of WordPress Studio's storage, and the browser-safe boundary needs lint enforcement.

## Accounts

- Each provider lists the methods its account connects with, the first being the default. Each has a stable id, which the config records, and a label the user picks it by:
  - **A form**, described by a schema whose fields carry their labels, help and whether they are secret, and optionally Markdown instructions for getting its values (a page to read, a command to run). Anthropic asks for an API key this way.
  - **A redirect** to the provider's site, where the user approves access and is sent back to the app. WordPress.com connects this way, and connecting it is signing in to WordPress Studio.
  - **A device sign-in**: the provider gives a code to approve on its site while WordPress Studio waits for the approval. No redirect comes back, so it works the same in every app and the CLI. Spacefast and GitHub Copilot connect this way.
  - **A loopback redirect**: like a redirect, but back to this computer: the process that runs the operation (the Desktop main process, the `studio ui` server or the CLI) listens on a free local port while the browser signs in, and gives the provider that address. Where the browser can't reach it, such as over SSH, the CLI asks for the address the browser landed on. OpenAI connects this way, through its sign-in for agents: it registers a client for WordPress Studio, which the user allows to use their ChatGPT plan through the public API.
  - **Several methods**, when a provider offers several ways. The user picks one, and only one is connected at a time. Anthropic takes an API key, or a token from `claude setup-token` that bills the Claude subscription; both are forms.
- A method that signs in on the provider's site (a device code or a loopback redirect) runs the same way everywhere: the provider starts it and says where the user goes, WordPress Studio shows that address and any code, then hands the provider back what it started with, which waits for the user.
- The provider says what surfaces show of a connected account: a summary such as an email or a key's first and last characters, a note such as whose plan pays for it, and links such as where to manage usage; never the credential.
- Surfaces render the form from its schema, so neither the settings nor `studio code` know what a provider asks for. A field whose schema accepts an empty value is optional: the settings save the form, and `studio code` takes the answer, without it.
- Connecting hands what the user gave, a form's values or the redirect's result, to the provider, which checks it and returns its config. WordPress Studio stores the config without looking inside it. Disconnecting lets the provider clean up on its side, as WordPress.com revokes its token, then WordPress Studio removes the config.
- A credential that expires before the account does, like a ChatGPT access token, is renewed by the provider (`refresh`) before WordPress Studio uses the config. WordPress Studio stores the renewed config, under a lock of its own, since a refresh token works once. A provider that no longer accepts the renewal is disconnected.
- When a provider has no usable config, it says so, along with how it can connect. The CLI asks the user; without a terminal, it reports the error.
- WordPress Studio stores each provider's config under `providers.configs.<id>` in `config.json` and validates it against the provider's schema. Builds before `config.json` kept the first two in their own fields (`authToken` and `anthropicApiKey` in `shared.json`), which the legacy import moves there. Connecting one Anthropic method replaces the other. This storage is WordPress Studio's code; providers never see it. When `STUDIO_WPCOM_TOKEN` is set, the CLI uses it for the WordPress.com config.
- The app's settings list every provider with its connection state and a summary the provider gives, such as a key's first and last characters, never the credential itself. WordPress.com shows the WordPress Studio sign-in; other providers show their form, picked from the Connect button's menu when the provider offers several methods. In `studio code`, `/connect [provider]` connects any provider the way it says, first asking how when it offers several methods, and `/disconnect [provider]` removes it; `/provider` asks for what is missing before switching. For WordPress.com these are `/login` and `/logout`, the WordPress Studio sign-in. No provider connects through `studio auth`.

## AI

### Models

Each provider lists the models it serves. Several providers can serve the same model (for example, a Claude model listed by WordPress.com and by Anthropic), and the same id means the same model. Each listing carries its own access rules, such as paid credits. Model ids are what sessions record, so they never change.

Where the account decides which of those models it runs, rather than the provider, the connected account says so and the pickers offer only those; a provider that doesn't narrow them offers all it lists. The provider reads that set when it connects and keeps it current when it renews its credential, so the pickers never reach the service to build their list. A GitHub Copilot plan works this way: it includes its own set of models, and leaves some of them off until they are turned on. Its catalog is the plan's models that pi knows how to run, described the way Copilot's own picker sorts them (lightweight, versatile, powerful). The account offers Studio's three until the user picks others, and picking one the plan leaves off turns it on, as Copilot Chat does.

The catalogs of the providers pi runs (Anthropic, OpenAI, Google Gemini, Meta, xAI, GitHub Copilot) hold only the models pi knows, since pi says how each one is called and how it thinks: a new model comes with a pi upgrade. The account's own list narrows them, as a plan runs only some, and where the provider doesn't list them for the account, its catalog is all of pi's. All but Copilot's share one (`piCatalog`): it keeps the models that reason, a preview or a dated snapshot only when its release isn't listed, recommends the newest of the families Studio lists, and runs each model within Studio Code's limits (a 32K-token reply, a 200K-token context).

Anthropic's catalog is the Claude models Anthropic lists for the account, with prices only for an API key. The newest of each family is recommended, and the account offers those until the user picks others in the settings. Its ids are Anthropic's own (`claude-opus-5-5`), the ids other providers serving the model use, so a catalog says which ids are its own by their prefixes (`ai.catalog.prefixes`).

OpenAI's catalog is the GPT models OpenAI lists for the API key, or the ChatGPT plan's own list, which says what each model is for and hides some. Keeping the models that reason leaves out GPT-4o and GPT-4.1. The newest of Studio's families (Terra, Sol) are recommended, and only an API key's models show their price.

Google Gemini's catalog is the chat models Google lists for the key (Pro, Flash, Flash Lite, Argon), with their prices, leaving out aliases such as `gemini-flash-latest` and models made for one task such as Computer Use. The newest of Studio's families (Flash, Argon) are recommended.

Meta's catalog is the Muse models Meta lists for the key, with their prices; a `-contributor` model is a family of its own. xAI's is the Grok models xAI lists for the API key or the Grok plan, with prices only for a key.

The Local LLM connector's catalog is the chat models the user's server lists, less those it says only make embeddings. Connecting offers them all, those the server says call tools first, and the settings narrow them like OpenRouter's. Its model ids are `local-llm/` and the server's name for the model (`local-llm/qwen3:0.6b`). Chats on these models need no internet, and analytics never name them.

### Connection

To run a turn, the CLI asks the selected provider for a connection to the chosen model. The connection holds everything the runtime needs: endpoint, credentials, headers, API dialect and model limits. Credentials never travel through environment variables.

The provider owns how its models are reached. For example, WordPress.com sends each tier over a different API, and rewrites its usage-cap errors. The runtime treats every connection the same way, and applies the same request clean-ups to every provider.

A connection may say its context window is exactly the one the model runs with, as the Local LLM connector does when the server reports it, since some servers cut a request that doesn't fit without saying. The runtime then sizes compaction to that window, never sends a request its token estimate says the window can't hold, and ends a turn that still can't fit with the words the connection gives.

### Selection

- The user picks a chat provider in the app's settings or with `/provider` in `studio code`. WordPress Studio saves it in `config.json` (`providers.selected`), and every surface shares it.
- A conversation pinned to a provider keeps it. Without credentials for the pinned provider, the conversation runs on WordPress.com.
- Connecting a provider makes it the default only when the current default isn't connected, so a connected WordPress.com stays the default until the user picks another.
- When the selected provider isn't ready, WordPress.com, the WordPress Studio sign-in, falls back to another ready provider, and the others ask to be connected again. The app runs a chat on the first connected provider, WordPress.com first.
- Each provider has a default model; WordPress.com picks a stronger one when the account has paid AI credits left. Switching provider keeps the conversation's model when the new provider serves it too, and falls back to its default otherwise.
- The UI gates paid tiers using the WordPress.com quota. The proxy enforces access.

### On another machine

Studio Cloud runs WordPress Studio on a machine away from the user's computer, so its settings offer only the connect methods that work from there. A `loopback` sign-in would return to a port on that machine, not the user's, so the settings leave it out, along with `device` sign-ins, and with them the ChatGPT plan and GitHub Copilot. A method marked as one only a host on the user's computer can run is left out too: the Local LLM connector checks a server on the user's computer or network.

### Images

Image generation is available when a connected provider offers it, whichever provider serves chat. WordPress.com does, as do Google Gemini, Meta and OpenAI with an API key; a ChatGPT plan shared with WordPress Studio can't, which its `canGenerateImages( config )` says. When several providers do, the chat's provider generates the images; otherwise the first connected provider that does. The agent gets it from its host, which finds that provider, so the agent never names one.

### Persisted ids

An id names the provider only. How the account is connected (an API key, a subscription) is part of the config, so a new way of connecting never adds a provider.

The Anthropic provider is `anthropic`. Builds before this design stored `anthropic-api-key`, in the stored selected provider and in session entries. Readers map it to `anthropic`, and writers keep storing `anthropic-api-key`. Older builds fall back to WordPress.com on an id they don't know, so this keeps the user's choice in every build.

The Local LLM connector is `local-llm`, with no stored alias: builds that don't know it run chats on another connected provider and keep its config. Its model ids (`local-llm/<server name>`) are recorded in sessions like any other.

## Remote sites

- A remote site is a site on a provider that a local site syncs with. Each provider with remote sites declares the shape of its site: WordPress.com's is `SyncSite`, Spacefast's a `Space`.
- The provider owns the remote side of a sync: listing the account's sites, creating one when it can, sending what a push sends and applying it remotely, and, for pull, backing the site up remotely or opening the export API a local Reprint reads it through. It reports the steps it runs through as a status. Pull is optional: Spacefast only publishes.
- WordPress Studio owns the local side, shared by every provider, and builds what the provider's push takes: the site's WordPress archive (WordPress.com), or a static export of its pages (Spacefast). On pull, it runs Reprint or imports a downloaded backup. The CLI does this.
- Connections are WordPress Studio's data about its local sites, not provider config. `@studio/common/lib/remote-sites.ts` reads and writes them per provider, and records when each site was last pushed or pulled. WordPress.com's stay in `connectedWpcomSites`, so builds of every version read them; later providers' are in `remoteSites`.
- Whether a site can sync is a status with an optional action, replacing the WordPress.com-specific states. For example, a site that needs a plan upgrade is blocked, with a link to upgrade _(planned)_.
- `studio push` and `studio pull` stay the commands. `studio push --remote-site spacefast[:<space>]` publishes to Spacefast, and bare WordPress.com site ids and URLs keep working. The Share and Publish panel uses the same provider descriptors and remote-site connections.
- A provider declares whether it supports selective sync.
- A provider without an account, such as SSH, has nothing to connect and counts as connected. Its sites aren't listed from an account: the user connects one by describing it in the provider's site form (`sites.connect`), which the provider checks by reaching the site. On pull, such a provider sends the site itself as an archive (`pullArchive`), which the CLI imports like a downloaded backup. A provider whose site form is `hostOnly` is left out where WordPress Studio runs elsewhere, as Studio Cloud does. See `ssh-sites.md`.

### Share and Publish panel

The selected destination owns the panel state. Studio stores selection by local site, provider and remote id (or preview hostname), and compares each destination with its own last successful full-transfer baseline. A partial transfer leaves that comparison unknown; it does not mark other destinations up to date.

The sites descriptor supplies a summary, the facts and links of a connected site, which the site menu shows in order, and the visibility options with where access is managed. The remote site carries its launch state and last known visibility. Providers with a visibility service can read or change access. The panel uses the provider's shared logo, alongside `selective`, `content`, `pull`, and `newSite`, and renders the provider's own `SiteRows` (`getProviderUi`) under a connected site, such as WordPress.com's plan or Spacefast's "Add a domain", and its `NewSiteRows` before a new site is created, such as Spacefast's team; it never chooses a provider-specific layout by id. The destination picker offers connected providers; connecting another provider opens provider settings. Selecting a destination does not create or publish anything.

In Publish, each local site has one publishing destination for the current account. Choosing another replaces it across hosting providers. A checkout replaces it after the first successful publish. Temporary previews and connections belonging to other accounts stay available. A routine CLI transfer updates its own connection.

The destination picker groups connected sites and previews by provider. Removing a preview deletes the preview after confirmation. Removing a published destination disconnects it from the local site; providers do not currently expose remote-site deletion.

## Previews

- A preview is a remote site that expires: the provider builds it from a local site and shares it by a link until it is taken down or bought. It is part of the provider's sites, not a capability of its own, so a provider with `sites.previews` makes previews as well as publishing to sites the user keeps.
- Updating a preview is a push to it, with `preview` set. Creating one is `previews.create`, since the provider builds the site from the first upload. `previews.list` gives the account's previews still up, and `previews.delete` takes one down. A bought preview keeps its site ID, and WordPress Studio then connects it to its local site like any remote site.
- WordPress.com builds previews through its site importer, from the zip of the site's folder with its SQLite database, while a push to a site the user keeps goes through its sync import, which takes the export archive and needs a plan; an unpaid preview refuses it.
- WordPress Studio owns which local site each preview was made from and which connected site it shows changes to. Previews made on Jurassic Ninja by older builds are left to expire: updating one makes a new WordPress.com preview, and deleting one only drops it from the list.
- Each transfer records its comparison version on the local site’s connection to that remote ID. A bought preview keeps the same connection. A partial transfer clears the comparison version.
- `studio preview` stays the command family. WordPress.com is the only provider that offers previews, and the commands use it; naming the provider comes with a second one _(planned)_.

## Surfaces

- **`apps/ui`** reads descriptors and account states through its connectors, and never names a provider, apart from WordPress Studio sign-in. The `ipc` and `local` connectors stay thin wrappers over WordPress Studio's storage in `@studio/common` and the providers' services.
- **The agent** receives a model connection per turn. Tools that depend on a capability are available only when a connected provider offers it. `wpcom_request` also requires WordPress Studio sign-in _(planned)_; the MCP runtime can still turn it off per client (Codex).
- **The CLI** lists providers and models from descriptors in `studio code`. `studio auth` is WordPress Studio sign-in. `studio push`, `pull` and `preview` hand the remote side to the provider.
- **Analytics**: existing Tracks properties keep their names, so reporting stays continuous.

## Out of scope

- **Providers added at runtime** (plugins, user config). Providers are compiled in.
- **Mixing models from different providers in one turn.**

## Open questions

1. **Provider-owned interaction flows.** Descriptors cover the current connection and publishing flows. Providers that require richer interactions may need to supply a component rather than expanding the shared panel with provider-specific behavior.
