# @studio/agent

The Studio Code agent: the model loop, its tools and skills, its system prompt, and the sessions it records. It runs in the CLI (`studio code`, the eval runner), and serves its tools to agent apps through `studio mcp`; the Desktop app, `studio ui` and Studio Cloud show it by forking the CLI.

```
protocol/   the contract between the agent and the apps that show it
node/       the agent: its tools, skills and prompt, pi's coding-agent runtime, sessions, run-manager
```

The apps that show the agent import its **protocol**; the apps that run it import **node**.

## protocol/

What both sides agree on: events (`agent-events`, `session-events`, `json-events`), session and entry types (`sessions/`), chat artifacts, files, images and attachments, a session's model and provider, slash commands, tool progress, visual annotations, and the inspector page script.

It is browser-safe: no Node APIs and nothing from `node/`. `apps/ui` imports this and nothing else from the package.

```ts
import { resolveSessionModel } from '@studio/agent/protocol/sessions/model';
```

## node/

### Running the agent

`createAgent( { host } )`, from `@studio/agent/node`, is how an app runs the agent:

```ts
import { createAgent } from '@studio/agent/node';

const agent = createAgent( { host } );

// A conversation turn: the prompt, the model's tool calls, its answer. `ai` is
// the provider's connection to the model (`@studio/providers/services`).
const session = await agent.sessions.create();
const turn = agent.runTurn( { session, prompt, ai, activeSite, onEvent, onAskUser } );
await turn.result; // turn.interrupt(), turn.hasTool( name )

// The tools alone, for an agent that runs them itself, such as one connected to
// `studio mcp`: `studio_instructions` first, which hands it the prompt and the
// skills, and results that carry the notes a conversation would add.
const tools = agent.tools( { imageGeneration, canAskUser, imageLink, picker } );
```

`createAgent` holds no state: sessions are files, and turns are independent. Two agents with different hosts can run in one process.

### The host

The host (`StudioAgentHost`, `node/host.ts`) is what the app running the agent provides. The agent never imports an app: what it needs from one comes through the host. Files and pages are not part of it: the agent reads and writes the sites' files and opens pages in Playwright's Chromium itself.

Every host provides:

- `sites`, `previews`, `sync`: the site operations its tools run. Site operations belong to the app; the CLI implements them with its own commands (`apps/cli/ai/host.ts`), so each operation has one implementation.
- `wpcom`: WordPress.com as the signed-in user: its token, its sites, and REST requests.
- `tracks`: where analytics events go.
- `sitesRoot`: the folder sites live in.

Some capabilities only some hosts have. Each is an optional member, and a host has the capability exactly when it provides the member:

- `ui`: an app shows the conversation. Tool results show in it as chat artifacts, and `refresh_browser` is offered.
- `imagesDirectory`: where the agent's images, such as screenshots, are kept; a temporary folder without it.
- `selectSite`: the conversation follows a site the agent creates.
- `imageGenerator`: image generation through a connected provider that offers it. `generate_images` and the imagery prompt sections are offered when it resolves to one.
- `sendFeedback`: `send_feedback` and the feedback skill.

There are no separate flags: a flag could say yes while the member is missing, or the other way round. Gate a tool, and any mention of it in the prompt, on the member itself (`if ( ! host.ui )` in `resolveStudioTools`), which also narrows its type for the code that calls it. A new capability is a new optional member here, documented with the tools it turns on.

### Tools

Each tool is a definition (`defineTool`): its name, description, schema, prompt snippet, annotations and handler. The handler gets the host from its context:

```ts
export const startSiteTool = defineTool(
	'site_start',
	'Starts a WordPress site by name or path.',
	{ nameOrPath: Type.String() },
	async ( args, { host, onProgress } ) => {
		const site = await host.sites.resolve( args.nameOrPath );
		await host.sites.start( site, onProgress );
		return textResult( `Site "${ site.name }" started at ${ site.url }` );
	},
	{ promptSnippet: 'Start a stopped site', annotations: LOCAL_CHANGE }
);
```

A definition runs once bound to a host: `agent.tools()` returns bound tools, and `bindTool( definition, host )` binds one an app defines itself, as `studio mcp` does for its WordPress library tools.

A tool, or a mention in the prompt, that only makes sense in some apps depends on what the host provides, such as `host.ui`, so it never reaches an app where it would do nothing. The prompt's tool list is generated from the registered tools' snippets, so only behavioral mentions elsewhere in the prompt need that care.

Where guidance goes: the system prompt (`node/system-prompt.ts`) holds only what is always true, plus skill routing; procedures go in skills (`node/skills/`); facts about one tool go in its description.

### Models

The runtime never picks a provider or reads credentials. The app asks the provider serving the chosen model for a connection (`ai.model` in `@studio/providers/services`) and passes it with each turn. The runtime streams through `node/models.ts`, which applies the connection's upstream model name and error rewrite, strips stale screenshots and cleans leaked tool-call markup, whichever provider serves the turn.

### Layout

```
node/
  index.ts        the entry: createAgent, the host types, tool authoring, helpers the CLI shares
  agent.ts        createAgent
  host.ts         StudioAgentHost
  tools/          the tools
  skills/         the skills' runbooks, bundled as text
  runtime/        the pi coding-agent session, its file tools and compaction
  sessions/       session files and the sessions store
  pages.ts        pages in the shared Chromium, for screenshots, inspection, audits and block validation
  global-instructions.ts, run-manager.ts, local-media.ts, annotation-tracks.ts
```

The last line, and the sessions store, are for the apps that show the agent: the Desktop main process and `apps/local` read and write instructions and sessions, and fork the CLI to run turns. They import these modules by path (`@studio/agent/node/sessions/store`) rather than from the entry, so they never load the runtime. They and the entry are the package's exports.

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- `apps/ui` imports only `@studio/agent/protocol/*`.
- `protocol/` uses no Node APIs, and imports nothing from `node/`.
- The package imports no app code (`cli/*`, `src/*`).
- Apps import the agent from `@studio/agent/node`, or one of the modules above by path.
- `@studio/common` never imports this package; this package builds on it.

## Tests

Tests sit next to their code. Tool and runtime tests run against `node/tests/fake-host.ts`, a host whose operations are spies that succeed with empty output, over the real file system; tests that open pages mock the shared browser.

```ts
const host = createFakeHost();
vi.mocked( host.sites.isRunning ).mockResolvedValue( false );
const result = await bindTool( scaffoldThemeTool, host ).rawHandler( args );
```

What the CLI host does with its commands is tested in `apps/cli/ai/tests/host.test.ts`.

Agent behavior, such as the prompt, tool descriptions and result shapes, is covered by the evals in `scripts/eval/`, which run the real agent through the CLI. Run the affected cases whenever you change it (see `AGENTS.md`).
