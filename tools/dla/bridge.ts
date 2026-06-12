/**
 * MCP-stdio bridge between Studio's pi-agent runtime and the Data
 * Liberation Agent (DLA) package's `src/mcp-server.ts` entry point.
 *
 * `startDlaBridge` spawns DLA's MCP server as a child process driven by
 * `tsx`, connects an MCP `Client` over stdio, lists tools, and returns
 * a `DlaBridge` handle that exposes:
 *
 * - `tools`: the adapted pi `ToolDefinition[]` ready to feed into the
 *   runtime's `customTools` slot.
 * - `dispose()`: closes the MCP client (which triggers EOF on the child
 *   stdin) and, belt-and-braces, force-kills the child after a 2 second
 *   grace period if it is still alive.
 *
 * Failures during `listTools` resolve with an empty tool array and a
 * warning rather than throwing — a missing or broken DLA install must
 * not crash session startup. Callers can fall back to the regular Studio
 * toolset when the bridge is degraded.
 *
 * See `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-mcp-bridge-feasibility.md`
 * §3 and §6 for the full design.
 */
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { adaptMcpToolToPi, type RemoteMcpTool } from './agent-tool-adapter';
import { defaultPolicyBuckets, type DlaPolicyBuckets } from './policy';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const require = createRequire( import.meta.url );

/**
 * The `listTools` timeout in milliseconds. The MCP child needs to boot
 * (Node + `tsx` + DLA's module graph) before the first response, but
 * anything past ten seconds points at a broken install rather than a
 * cold start, so we surrender and continue without DLA.
 */
const LIST_TOOLS_TIMEOUT_MS = 10_000;

/**
 * Grace period in milliseconds between `client.close()` (which sends EOF
 * to the child stdin) and a hard SIGKILL on the child's pid. DLA's MCP
 * server normally exits on stdin EOF, but `liberate_extract` can hold a
 * long-running adapter loop open; the SIGKILL is the safety net.
 */
const KILL_GRACE_MS = 2_000;

/**
 * The set of environment variables forwarded into the DLA child process.
 * Studio injects `STUDIO_WPCOM_TOKEN` explicitly via opts so the parent
 * never needs to set it on the host environment; the other two are
 * end-user-supplied secrets that DLA reads directly.
 */
const PASSTHROUGH_ENV_KEYS = [
	'LIBERATION_TOKEN',
	'SHOPIFY_ADMIN_TOKEN',
	'NODE_PATH',
	'NODE_OPTIONS',
] as const;

/**
 * Options for `startDlaBridge`.
 */
export interface StartDlaBridgeOptions {
	/** Optional WordPress.com bearer forwarded to DLA as `STUDIO_WPCOM_TOKEN`. */
	wpcomToken?: string;
	/** Buckets to consult for the policy layer. Defaults to `defaultPolicyBuckets`. */
	policyBuckets?: DlaPolicyBuckets;
	/**
	 * Extra environment variables to merge into the child process. Useful
	 * for tests that want to pin paths or feature flags.
	 */
	env?: Record< string, string >;
	/**
	 * Override the spawn/connect plumbing entirely. Tests pass a stub
	 * here to avoid forking a real Node process; production callers
	 * should leave this undefined.
	 */
	transport?: BridgeTransportProvider;
	/** Override the `listTools` timeout. Defaults to 10 seconds. */
	listToolsTimeoutMs?: number;
}

/**
 * Internal contract that allows tests to swap out the spawn/connect
 * pipeline without forking a real DLA child process. The production
 * implementation lives in `defaultTransportProvider`.
 */
export interface BridgeTransportProvider {
	/**
	 * Construct an MCP `Client` and connect it over a transport. The
	 * returned `pid` is used by `dispose()` to belt-and-braces SIGKILL
	 * the child after the grace period.
	 */
	connect( env: Record< string, string > ): Promise< {
		client: Pick< Client, 'callTool' | 'listTools' | 'close' >;
		pid: number | null;
	} >;
}

/**
 * The handle returned by `startDlaBridge`. Consumers consume `tools`,
 * then call `dispose()` during session teardown.
 */
export interface DlaBridge {
	/** The bridged DLA tools, adapted as pi `ToolDefinition[]`. Empty if `listTools` failed. */
	readonly tools: ToolDefinition[];
	/** Whether the bridge degraded to an empty tool list during startup. */
	readonly degraded: boolean;
	/** Optional human-readable reason for degradation. */
	readonly degradationReason?: string;
	/** Tear down the MCP client and ensure the child process exits. */
	dispose(): Promise< void >;
}

/**
 * Spawn DLA's MCP server, connect, list tools, and return a bridge handle.
 *
 * The function never throws on a missing or broken DLA install — failures
 * resolve to a bridge whose `tools` is empty and whose `degraded` flag is
 * `true`. Callers should log the `degradationReason` and continue.
 *
 * @param opts - Options for spawn-time customisation (token, env, policy).
 * @returns A connected `DlaBridge` handle.
 *
 * @example
 * const bridge = await startDlaBridge( { wpcomToken } );
 * try {
 *   runtime.use( { customTools: bridge.tools } );
 *   // ...
 * } finally {
 *   await bridge.dispose();
 * }
 */
export async function startDlaBridge( opts: StartDlaBridgeOptions = {} ): Promise< DlaBridge > {
	const env = buildChildEnv( opts );
	const transportProvider = opts.transport ?? defaultTransportProvider;

	let client: Pick< Client, 'callTool' | 'listTools' | 'close' >;
	let pid: number | null = null;
	try {
		const connected = await transportProvider.connect( env );
		client = connected.client;
		pid = connected.pid;
	} catch ( error ) {
		const reason = error instanceof Error ? error.message : String( error );
		console.warn(
			`[@studio/dla] failed to spawn DLA MCP server (${ reason }); continuing without DLA tools.`
		);
		return {
			tools: [],
			degraded: true,
			degradationReason: reason,
			dispose: async () => {},
		};
	}

	const buckets = opts.policyBuckets ?? defaultPolicyBuckets;
	const timeoutMs = opts.listToolsTimeoutMs ?? LIST_TOOLS_TIMEOUT_MS;

	let toolList: RemoteMcpTool[];
	try {
		const listed = await client.listTools( undefined, {
			signal: AbortSignal.timeout( timeoutMs ),
		} );
		toolList = ( listed?.tools ?? [] ) as RemoteMcpTool[];
	} catch ( error ) {
		const reason = error instanceof Error ? error.message : String( error );
		console.warn( `[@studio/dla] listTools failed (${ reason }); continuing without DLA tools.` );
		return makeBridge( [], client, pid, true, reason );
	}

	const tools = toolList.map( ( remoteTool ) =>
		adaptMcpToolToPi( remoteTool, client as Client, {
			getBuckets: () => buckets,
		} )
	);

	return makeBridge( tools, client, pid, false );
}

/**
 * Build a `DlaBridge` handle around a successfully (or partially)
 * connected MCP client. Extracted for reuse between the success and
 * `listTools`-failure code paths.
 */
function makeBridge(
	tools: ToolDefinition[],
	client: Pick< Client, 'close' >,
	pid: number | null,
	degraded: boolean,
	degradationReason?: string
): DlaBridge {
	let disposed = false;
	return {
		tools,
		degraded,
		degradationReason,
		async dispose(): Promise< void > {
			if ( disposed ) {
				return;
			}
			disposed = true;
			try {
				await client.close();
			} catch ( error ) {
				// Closing a half-broken transport throws; that's expected
				// when we are recovering from a startup error. Swallow and
				// fall through to the SIGKILL fallback.
				const reason = error instanceof Error ? error.message : String( error );
				console.warn(
					`[@studio/dla] error closing MCP client (${ reason }); forcing child kill if still alive.`
				);
			}
			if ( pid !== null && pid > 0 ) {
				setTimeout( () => {
					try {
						process.kill( pid, 'SIGKILL' );
					} catch {
						// Already exited — nothing to do.
					}
				}, KILL_GRACE_MS ).unref();
			}
		},
	};
}

/**
 * Build the environment forwarded to the spawned DLA child. Studio's
 * `STUDIO_WPCOM_TOKEN` is supplied via `opts.wpcomToken`; other DLA
 * secrets (`LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`) are passed through
 * from the parent's environment if they are set.
 */
function buildChildEnv( opts: StartDlaBridgeOptions ): Record< string, string > {
	const env: Record< string, string > = {
		// Always start with a clean PATH so the child can find Node binaries
		// without inheriting the entire shell environment.
		PATH: process.env.PATH ?? '',
	};
	for ( const key of PASSTHROUGH_ENV_KEYS ) {
		const value = process.env[ key ];
		if ( typeof value === 'string' && value.length > 0 ) {
			env[ key ] = value;
		}
	}
	if ( opts.wpcomToken ) {
		env.STUDIO_WPCOM_TOKEN = opts.wpcomToken;
	}
	if ( opts.env ) {
		Object.assign( env, opts.env );
	}
	return env;
}

/**
 * The production transport provider — spawns Node + tsx + DLA's
 * `src/mcp-server.ts` over stdio.
 *
 * Path resolution uses `createRequire` against `import.meta.url` so the
 * bridge works whether it ships from `tools/dla/` (dev) or from the
 * bundled CLI at `apps/cli/dist/cli/`. The `tsx` package is spelled as
 * `tsx/cli` (its public `exports` key) rather than `tsx/dist/cli.mjs`,
 * because the package's `exports` map does not expose the `dist/`
 * subpath directly — the deep path throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * at runtime.
 */
export const defaultTransportProvider: BridgeTransportProvider = {
	async connect( env ) {
		const tsxCli = require.resolve( 'tsx/cli' );
		const mcpServerEntry = require.resolve( 'data-liberation/src/mcp-server.ts' );

		const transport = new StdioClientTransport( {
			command: process.execPath,
			args: [ tsxCli, mcpServerEntry ],
			env,
			stderr: 'pipe',
		} );

		const client = new Client( { name: 'studio-cli', version: '1.0.0' }, { capabilities: {} } );
		await client.connect( transport );
		return { client, pid: transport.pid ?? null };
	},
};
