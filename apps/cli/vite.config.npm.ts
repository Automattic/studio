import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { baseConfig, yargsLocalesCopyPlugin } from './vite.config.base';

const packageJson = JSON.parse( readFileSync( resolve( __dirname, 'package.json' ), 'utf-8' ) );
const packageVersion = packageJson.version;

// Externalize all runtime dependencies listed in package.json
const externalDeps = Object.keys( packageJson.dependencies || {} );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		plugins: [ yargsLocalesCopyPlugin ],
		build: {
			rollupOptions: {
				output: {
					// Add shebang to main.js only. Using banner (rather than mutating code
					// in generateBundle) ensures Rollup accounts for it in sourcemaps.
					banner: ( chunk ) => ( chunk.fileName === 'main.js' ? '#!/usr/bin/env node' : '' ),
				},
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
