# @studio/agent

The Studio Code agent: the model loop, its tools and skills, its system prompt, and the sessions it records. It runs in the CLI (`studio code`, the eval runner), serves its tools to agent apps through `studio mcp`, and runs in the page in Studio on the web; the Desktop app and `studio ui` show it by forking the CLI.

```
protocol/   the contract between the agent and the apps that show it
shared/     what every agent runs, in Node or a browser: tools, skills, the system prompt, the host interface
node/       the agent in Node: pi's coding-agent runtime and file tools, sessions, run-manager
web/        the agent in a browser: pi-agent-core's loop, with the file tools rebuilt over the host
```

The apps that show the agent import its **protocol**; the apps that run it import **node** or **web**.

## protocol/

What both sides agree on: events (`agent-events`, `session-events`, `json-events`), session and entry types (`sessions/`), chat artifacts, files, images and attachments, models and providers, slash commands, tool progress, visual annotations, and the inspector page script.

It is browser-safe: no Node APIs and nothing from `node/`. `apps/ui` imports this and nothing else from the package.

```ts
import { isAiModelId } from '@studio/agent/protocol/models';
```

## node/

### Running the agent

`createAgent( { host } )`, from `@studio/agent/node`, is how an app runs the agent:

```ts
import { createAgent } from '@studio/agent/node';

const agent = createAgent( { host } );

// A conversation turn: the prompt, the model's tool calls, its answer.
const session = await agent.sessions.create();
const turn = agent.runTurn( { session, prompt, model, activeSite, onEvent, onAskUser } );
await turn.result; // turn.interrupt(), turn.hasTool( name )

// The tools alone, for an app that runs them itself, such as an MCP server.
const tools = agent.tools( { imageGeneration, canAskUser, imageLink } );
```

`createAgent` holds no state: sessions are files, and turns are independent. Two agents with different hosts can run in one process.

### The host

The host (`StudioAgentHost`, `shared/host.ts`) is what the app running the agent provides. The agent never imports an app: everything it needs from one comes through the host, so the same tools run in Node and in a browser.

- `sites`, `previews`, `sync`, `wpcom`: the site operations its tools run, and the WordPress.com client. Site operations belong to the app; the CLI implements them with its own commands (`apps/cli/ai/host.ts`), so each operation has one implementation.
- `files`, `path`: the sites' files, by the paths the agent sees, and the path functions for them.
- `pages`: pages loaded in the host's browser, for screenshots, design inspection, audits and block validation. Page scripts are shared; the host only opens the page.
- `saveImage`: where images the agent makes, such as screenshots, are kept for the user.
- `tracks`: where analytics events go.
- `sitesRoot`, `userAgent`: the folder sites live in, and the User-Agent of requests to WordPress.com.
- `selectSite`, `annotate`: optional; how the conversation follows a site the agent created, and the annotation browser.
- `ui`: present when an app shows the conversation. Tool results then show in it as chat artifacts, and the tools that only make sense there, such as `refresh_browser`, are offered.

In Node, `nodeHostServices()` provides `files`, `path`, `pages` (Playwright's Chromium), `saveImage` and `annotate`; the CLI's host spreads them in. Studio on the web's host (`apps/ui/src/data/core/connectors/web/agent/host.ts`) runs sites in Playground, reads their files from the runtimes and loads pages in off-screen frames.

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

A definition runs once bound to a host: `agent.tools()` returns bound tools, and `bindTool( definition, host )` binds one an app defines itself, as `studio mcp` does for `studio_instructions`.

A tool, or a mention in the prompt, that only makes sense in some apps depends on what the host provides, such as `host.ui`, so it never reaches an app where it would do nothing. The prompt's tool list is generated from the registered tools' snippets, so only behavioral mentions elsewhere in the prompt need that care.

Where guidance goes: the system prompt (`shared/system-prompt.ts`) holds only what is always true, plus skill routing; procedures go in skills (`shared/skills/`); facts about one tool go in its description.

### In a browser

`createWebAgent( { host } )`, from `@studio/agent/web`, runs a turn with the same tools, skills and prompt. The model is called from the page, and Read, Write, Edit, Grep, Glob and Ls are rebuilt over `host.files` with pi's names, schemas and descriptions (there is no Bash). The app stores the conversation and passes its messages in with each turn:

```ts
const turn = createWebAgent( { host } ).runTurn( {
	sessionId, prompt, history, model, credentials, activeSite,
	onEvent, onMessage, onCompaction, onAskUser,
} );
const { failure } = await turn.result;
```

### Layout

```
shared/
  host.ts         StudioAgentHost
  tools/          the tools
  skills/         the skills' runbooks, bundled as text
  system-prompt.ts, page scripts (block-validator, *-audit), image-generation, runtime-guards/
node/
  index.ts        the entry: createAgent, nodeHostServices, the host types, tool authoring, helpers apps share
  agent.ts        createAgent
  node-host.ts    nodeHostServices: files, pages and images in Node
  runtime/        the pi coding-agent session, its file tools and compaction
  sessions/       session files and the sessions store
  settings-store.ts, global-instructions.ts, run-manager.ts, local-media.ts
web/
  index.ts        createWebAgent
  file-tools.ts, models.ts, compaction.ts
```

The last line, and the sessions store, are for the apps that show the agent: the Desktop main process and `apps/local` read and write settings and sessions, and fork the CLI to run turns. They import these modules by path (`@studio/agent/node/sessions/store`) rather than from the entry, so they never load the runtime.

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- `apps/ui` imports `@studio/agent/protocol/*`, and its web connector `@studio/agent/web`.
- `protocol/`, `shared/` and `web/` use no Node APIs, and import nothing from `node/`.
- The package imports no app code (`cli/*`, `src/*`).
- Apps import the agent from `@studio/agent/node`, not its `runtime/`, `tools/` or `host` modules.
- `@studio/common` never imports this package; this package builds on it.

## Tests

Tests sit next to their code. Tool and runtime tests run against `node/tests/fake-host.ts`, a host whose operations are spies that succeed with empty output, over the real file system:

```ts
const host = createFakeHost();
vi.mocked( host.sites.isRunning ).mockResolvedValue( false );
const result = await bindTool( scaffoldThemeTool, host ).rawHandler( args );
```

What the CLI host does with its commands is tested in `apps/cli/ai/tests/host.test.ts`.

Agent behavior, such as the prompt, tool descriptions and result shapes, is covered by the evals in `scripts/eval/`, which run the real agent through the CLI. Run the affected cases whenever you change it (see `AGENTS.md`).
