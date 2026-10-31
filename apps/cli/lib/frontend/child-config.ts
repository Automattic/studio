/**
 * The env-var contract between `frontend/server.ts` (which starts the daemon
 * process) and `frontend-server-child.ts` (which runs in it). Everything else
 * in the child's env, including the `buildFrontendEnv` contract, is passed
 * through to the dev server.
 */
import path from 'path';
import { resolveDevCommand, type SiteFrontend } from '@studio/common/lib/site-frontend';
import { z } from 'zod';
import { prependToPath } from 'cli/lib/frontend/shell';

export const FRONTEND_CHILD_ENV = {
	KIND: 'STUDIO_FRONTEND_KIND',
	PORT: 'STUDIO_FRONTEND_PORT',
	PATH: 'STUDIO_FRONTEND_PATH',
	SERVED_DIR: 'STUDIO_FRONTEND_SERVED_DIR',
	COMMAND: 'STUDIO_FRONTEND_COMMAND',
	NODE_BIN_DIR: 'STUDIO_FRONTEND_NODE_BIN_DIR',
	READY_TIMEOUT_MS: 'STUDIO_FRONTEND_READY_TIMEOUT_MS',
} as const;

// `npm install` on a first start or a cold Astro/Next compile can take a while.
export const FRONTEND_READY_TIMEOUT_MS = 120_000;

// Variables that describe the CLI's own runtime and would confuse a dev server:
// Next.js warns about a non-standard NODE_ENV, ELECTRON_RUN_AS_NODE turns any
// Electron binary the project runs into plain Node, and the NODE_CHANNEL_* pair
// would make Node look for an IPC channel the dev server doesn't have. The
// login shell sets the user's own NODE_ENV or NODE_OPTIONS again if they have one.
const ENV_NOT_INHERITED_BY_DEV_SERVER = [
	'NODE_ENV',
	'NODE_OPTIONS',
	'ELECTRON_RUN_AS_NODE',
	'NODE_CHANNEL_FD',
	'NODE_CHANNEL_SERIALIZATION_MODE',
];

const childConfigSchema = z.discriminatedUnion( 'kind', [
	z.object( {
		kind: z.literal( 'static' ),
		port: z.number().int().positive(),
		projectPath: z.string().min( 1 ),
		servedDir: z.string().min( 1 ),
		readyTimeoutMs: z.number().int().positive(),
	} ),
	z.object( {
		kind: z.literal( 'command' ),
		port: z.number().int().positive(),
		projectPath: z.string().min( 1 ),
		command: z.string().min( 1 ),
		nodeBinDir: z.string().optional(),
		readyTimeoutMs: z.number().int().positive(),
	} ),
] );

export type FrontendChildConfig = z.infer< typeof childConfigSchema >;

export function getServedDirectory( frontend: Pick< SiteFrontend, 'path' | 'servedDir' > ): string {
	return path.resolve( frontend.path, frontend.servedDir ?? '.' );
}

export function buildFrontendChildEnv( options: {
	baseEnv: NodeJS.ProcessEnv;
	frontend: SiteFrontend;
	contractEnv: Record< string, string >;
	nodePath?: string;
	readyTimeoutMs?: number;
} ): NodeJS.ProcessEnv {
	const { frontend } = options;
	const env: NodeJS.ProcessEnv = {
		...options.baseEnv,
		...options.contractEnv,
		[ FRONTEND_CHILD_ENV.KIND ]: frontend.kind,
		[ FRONTEND_CHILD_ENV.PORT ]: String( frontend.port ),
		[ FRONTEND_CHILD_ENV.PATH ]: frontend.path,
		[ FRONTEND_CHILD_ENV.READY_TIMEOUT_MS ]: String(
			options.readyTimeoutMs ?? FRONTEND_READY_TIMEOUT_MS
		),
	};
	if ( frontend.kind === 'static' ) {
		env[ FRONTEND_CHILD_ENV.SERVED_DIR ] = getServedDirectory( frontend );
	} else {
		env[ FRONTEND_CHILD_ENV.COMMAND ] = resolveDevCommand(
			frontend.devCommand ?? '',
			frontend.port
		);
		if ( options.nodePath ) {
			env[ FRONTEND_CHILD_ENV.NODE_BIN_DIR ] = path.dirname( options.nodePath );
		}
	}
	return env;
}

export function parseFrontendChildConfig( env: NodeJS.ProcessEnv ): FrontendChildConfig {
	const common = {
		port: Number( env[ FRONTEND_CHILD_ENV.PORT ] ),
		projectPath: env[ FRONTEND_CHILD_ENV.PATH ],
		readyTimeoutMs: Number(
			env[ FRONTEND_CHILD_ENV.READY_TIMEOUT_MS ] ?? FRONTEND_READY_TIMEOUT_MS
		),
	};
	return childConfigSchema.parse(
		env[ FRONTEND_CHILD_ENV.KIND ] === 'static'
			? { ...common, kind: 'static', servedDir: env[ FRONTEND_CHILD_ENV.SERVED_DIR ] }
			: {
					...common,
					kind: env[ FRONTEND_CHILD_ENV.KIND ],
					command: env[ FRONTEND_CHILD_ENV.COMMAND ],
					nodeBinDir: env[ FRONTEND_CHILD_ENV.NODE_BIN_DIR ] || undefined,
			  }
	);
}

/** The dev server's env: the child's own, minus Studio's internals, plus `PORT`. */
export function buildDevServerEnv(
	childEnv: NodeJS.ProcessEnv,
	config: Extract< FrontendChildConfig, { kind: 'command' } >,
	platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
	const internalKeys = new Set< string >( [
		...Object.values( FRONTEND_CHILD_ENV ),
		...ENV_NOT_INHERITED_BY_DEV_SERVER,
	] );
	let env: NodeJS.ProcessEnv = Object.fromEntries(
		Object.entries( childEnv ).filter( ( [ key ] ) => ! internalKeys.has( key ) )
	);
	env.PORT = String( config.port );
	if ( config.nodeBinDir ) {
		env = prependToPath( env, config.nodeBinDir, platform );
	}
	return env;
}
