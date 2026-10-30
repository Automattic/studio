import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
// eslint-disable-next-line import-x/default -- Vite's `?raw` import is the file's text.
import wpCliClient from './wp-cli-client.mjs?raw';
import type { BashSpawnHook } from '@earendil-works/pi-coding-agent';

function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

// The environment variable that holds the address of the agent's WP-CLI server.
export const WP_CLI_SERVER_ENV = 'STUDIO_AGENT_WP_CLI';

/**
 * The commands of the agent's shell that run the Studio running the agent:
 * `studio`, whichever Studio is installed on the machine as well, and `wp`,
 * which runs `studio wp`: WP-CLI on Studio's PHP binary for the site, with
 * Studio's SQLite integration loaded. A system `wp`, where one is installed at
 * all, runs on whatever PHP the machine has and cannot open a Studio site's
 * database.
 *
 * Where the agent's process serves WP-CLI (WP_CLI_SERVER_ENV), `wp` and
 * `studio wp` ask it for the site's PHP process and run that, as `studio wp`
 * would, without starting Studio's CLI for each command: under load, starting
 * it took 1-2s of each command's 2.3s.
 *
 * Both mark the run as one the agent's Studio spawned, as the app marks the CLI
 * runs it spawns, so each command is not counted as a launch of the CLI.
 */
export function getStudioShims( nodePath: string, cliPath: string ): Record< string, string > {
	const cli = `${ shellQuote( nodePath ) } ${ shellQuote( cliPath ) }`;
	const client = `${ shellQuote(
		nodePath
	) } "$(dirname "$0")/wp-cli-client.mjs" "$${ WP_CLI_SERVER_ENV }" ${ shellQuote( cliPath ) }`;
	const served = `[ -n "$${ WP_CLI_SERVER_ENV }" ]`;
	return {
		studio: `#!/bin/sh\nif [ "$1" = wp ] && ${ served }; then shift; exec ${ client } "$@"; fi\nexec ${ cli } "$@" --avoid-telemetry\n`,
		wp: `#!/bin/sh\nif ${ served }; then exec ${ client } "$@"; fi\nexec ${ cli } wp "$@" --avoid-telemetry\n`,
		'wp-cli-client.mjs': wpCliClient,
	};
}

// Writes the shims into a directory named after their content, so concurrent Studio
// processes (or different installs) never overwrite each other's scripts.
export function ensureStudioShimDirectory(
	shims: Record< string, string >,
	root: string = path.join( getConfigDirectory(), 'tmp', 'agent-bin' )
): string {
	const directory = path.join(
		root,
		createHash( 'sha256' ).update( JSON.stringify( shims ) ).digest( 'hex' ).slice( 0, 12 )
	);
	for ( const [ name, script ] of Object.entries( shims ) ) {
		const shimPath = path.join( directory, name );
		if ( ! fs.existsSync( shimPath ) ) {
			fs.mkdirSync( directory, { recursive: true } );
			const temporaryPath = `${ shimPath }.${ process.pid }`;
			fs.writeFileSync( temporaryPath, script, { mode: 0o755 } );
			fs.renameSync( temporaryPath, shimPath );
		}
	}
	return directory;
}

function prependToPath( directory: string ): BashSpawnHook {
	return ( context ) => {
		const pathKey =
			Object.keys( context.env ).find( ( key ) => key.toUpperCase() === 'PATH' ) ?? 'PATH';
		const current = context.env[ pathKey ];
		return {
			...context,
			env: {
				...context.env,
				[ pathKey ]: current ? `${ directory }${ path.delimiter }${ current }` : directory,
			},
		};
	};
}

/**
 * npm in the agent's shell installs what its cache holds from the cache, and
 * asks the registry only for what it lacks: npm's prefer-offline config
 * ("staleness checks for cached data will be bypassed, but missing data will
 * be requested from the server", npm help config). Without it, an install
 * with no lockfile asks the registry about every cached package, which for
 * the 1244 packages @wordpress/scripts brings took 366s through a slow
 * registry against 3s from the cache. A prefer-offline or prefer-online the
 * environment already sets is left as it is.
 */
const preferNpmCache: BashSpawnHook = ( context ) =>
	Object.keys( context.env ).some( ( key ) => /^npm_config_prefer_o(ff|n)line$/i.test( key ) )
		? context
		: { ...context, env: { ...context.env, npm_config_prefer_offline: 'true' } };

/**
 * The agent's shell: the shims in `directory` first on its PATH, the address
 * of the agent's WP-CLI server, where it serves one, and npm preferring its cache.
 */
export function agentShell( directory: string, wpCliServer?: string ): BashSpawnHook {
	const shims = prependToPath( directory );
	return ( context ) => {
		const shell = preferNpmCache( shims( context ) );
		return wpCliServer
			? { ...shell, env: { ...shell.env, [ WP_CLI_SERVER_ENV ]: wpCliServer } }
			: shell;
	};
}
