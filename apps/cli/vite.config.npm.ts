import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vite';
import { baseConfig, nodeBuiltinExternals } from './vite.config.base';

const packageJson = JSON.parse( readFileSync( resolve( __dirname, 'package.json' ), 'utf-8' ) );

// Externalize all runtime dependencies listed in package.json
const externalDeps = Object.keys( packageJson.dependencies || {} );

export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			sourcemap: false,
			rollupOptions: {
				output: {
					// Add shebang to main.js so it can be executed directly as a CLI.
					banner: ( chunk ) => ( chunk.fileName === 'main.js' ? '#!/usr/bin/env node' : '' ),
				},
				external: ( id ) => {
					// Node built-ins (reuse shared list from base config)
					if (
						nodeBuiltinExternals.some( ( pattern ) =>
							pattern instanceof RegExp ? pattern.test( id ) : pattern === id
						)
					) {
						return true;
					}

					// Bundle the blueprint-schema-validator subpath (not exported by the package)
					if ( id.includes( 'blueprint-schema-validator' ) ) {
						return false;
					}

					// Externalize @php-wasm/* and @wp-playground/* (includes transitive deps
					// like @php-wasm/node-* that aren't listed in package.json directly)
					if ( /^@php-wasm\//.test( id ) || /^@wp-playground\//.test( id ) ) {
						return true;
					}

					// Externalize all declared runtime dependencies
					return externalDeps.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
				},
			},
		},
		define: {
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
