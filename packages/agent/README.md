# @studio/agent

The Studio Code agent: the model loop, its tools and skills, its system prompt, and the sessions it records. It runs in the CLI (`studio code`, the eval runner) and serves its tools to agent apps through `studio mcp`; the Desktop app and `studio ui` show it by forking the CLI.

The package has two parts, with one rule between them: the apps that show the agent import its **protocol**, and only the apps that run it import **node**.

```
protocol/   the contract between the agent and the apps that show it
node/       the agent, in Node
```

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

The host (`StudioAgentHost`, `node/host.ts`) is what the app running the agent provides. The agent never imports an app: everything it needs from one comes through the host.

- `sites`, `previews`, `sync`, `wpcom`: the site operations its tools run. Site operations belong to the app; the CLI implements them with its own commands (`apps/cli/ai/host.ts`), so each operation has one implementation.
- `tracks`: where analytics events go.
- `sitesRoot`: the folder Studio's sites live in. The file tools are rooted there.
- `userAgent`: the User-Agent of requests to WordPress.com.
- `selectSite`, `screenshotsDirectory`: optional; how the conversation follows a site the agent created, and where captures are kept.
- `ui`: present when an app shows the conversation. Tool results then show in it as chat artifacts, and the tools that only make sense there, such as `refresh_browser`, are offered.

`studio code` builds its host per command from the CLI's (`{ ...cliAgentHost, ui, selectSite, screenshotsDirectory }`); `studio mcp` and the eval runner use the CLI's as it is.

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

Where guidance goes: the system prompt (`node/system-prompt.ts`) holds only what is always true, plus skill routing; procedures go in skills (`node/skills/`); facts about one tool go in its description.

### Layout

```
node/
  index.ts        the entry: createAgent, the host types, tool authoring, and helpers apps share
  agent.ts        createAgent
  host.ts         StudioAgentHost
  runtime/        the pi agent loop, its guards, and compaction
  tools/          the tools
  skills/         the skills' runbooks, copied next to the CLI's built chunks
  system-prompt.ts
  sessions/       session files and the sessions store
  settings-store.ts, global-instructions.ts, run-manager.ts, local-media.ts
```

The last line, and the sessions store, are for the apps that show the agent: the Desktop main process and `apps/local` read and write settings and sessions, and fork the CLI to run turns. They import these modules by path (`@studio/agent/node/sessions/store`) rather than from the entry, so they never load the runtime.

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- `apps/ui` imports only `@studio/agent/protocol/*`.
- `protocol/` uses no Node APIs and imports nothing from `node/`.
- The package imports no app code (`cli/*`, `src/*`).
- Apps import the agent from `@studio/agent/node`, not its `runtime/`, `tools/` or `host` modules.
- `@studio/common` never imports this package; this package builds on it.

## Tests

Tests sit next to their code. Tool and runtime tests run against `node/tests/fake-host.ts`, a host whose operations are spies that succeed with empty output:

```ts
const host = createFakeHost();
vi.mocked( host.sites.isRunning ).mockResolvedValue( false );
const result = await bindTool( scaffoldThemeTool, host ).rawHandler( args );
```

What the CLI host does with its commands is tested in `apps/cli/ai/tests/host.test.ts`.

Agent behavior, such as the prompt, tool descriptions and result shapes, is covered by the evals in `scripts/eval/`, which run the real agent through the CLI. Run the affected cases whenever you change it (see `AGENTS.md`).
