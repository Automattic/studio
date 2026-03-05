import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { baseConfig, yargsLocalesCopyPlugin } from './vite.config.base';

const packageJson = JSON.parse( readFileSync( resolve( __dirname, 'package.json' ), 'utf-8' ) );
const packageVersion = packageJson.version;

// Externalize all runtime dependencies except @studio/common (which is bundled via alias)
const externalDeps = Object.keys( packageJson.dependencies || {} ).filter(
	( dep ) => dep !== '@studio/common'
);

/**
 * Vite plugin that prepends a Node.js shebang to the main entry point.
 * Only main.js gets the shebang — proxy-daemon and wordpress-server-child
 * are spawned by PM2 with an explicit `node` invocation.
 */
function shebangPlugin(): Plugin {
	return {
		name: 'shebang',
		apply: 'build',
		generateBundle( _options, bundle ) {
			const mainChunk = bundle[ 'main.js' ];
			if ( mainChunk && mainChunk.type === 'chunk' ) {
				mainChunk.code = '#!/usr/bin/env node\n' + mainChunk.code;
			}
		},
	};
}

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [ yargsLocalesCopyPlugin, shebangPlugin() ],
		build: {
			rollupOptions: {
				external: ( id ) => {
					// Node built-ins
					if ( /^node:/.test( id ) ) {
						return true;
					}
					if (
						/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/.test(
							id
						)
					) {
						return true;
					}
					if ( id === 'fs/promises' || id === 'dns/promises' ) {
						return true;
					}

					// Bundle the blueprint-schema-validator subpath (not exported by the package)
					if ( id.includes( 'blueprint-schema-validator' ) ) {
						return false;
					}

					// Externalize @php-wasm/* and @wp-playground/* (transitive deps resolved by npm)
					if ( /^@php-wasm\//.test( id ) || /^@wp-playground\//.test( id ) ) {
						return true;
					}

					// Externalize all declared runtime dependencies
					return externalDeps.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
				},
			},
		},
		define: {
			__STUDIO_CLI_VERSION__: JSON.stringify( packageVersion ),
		},
	} )
);
