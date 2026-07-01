import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import packageJson from './package.json';

// Node built-ins are always provided by the runtime, never bundled.
const nodeBuiltinExternals: RegExp[] = [
	/^node:/,
	/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/,
	/^fs\/promises$/,
	/^dns\/promises$/,
];

// Only the runtime npm dependencies declared in package.json stay external (and
// are resolved from node_modules at run time). Everything else — including the
// `@studio/common` source we alias below and its transitive deps — is bundled
// into a single self-contained `dist/index.mjs`.
const packageJsonDependencies = Object.keys( packageJson.dependencies || {} );

export default defineConfig( {
	plugins: [
		{
			// The bundle is ESM; mark the output directory as such so Node loads the
			// `.mjs` chunks with the right module semantics.
			name: 'write-dist-package-json',
			apply: 'build',
			writeBundle( options ) {
				const outDir = options.dir ?? resolve( __dirname, 'dist' );
				mkdirSync( outDir, { recursive: true } );
				writeFileSync(
					resolve( outDir, 'package.json' ),
					JSON.stringify( { type: 'module' }, null, 2 ) + '\n'
				);
			},
		},
	],
	build: {
		emptyOutDir: true,
		lib: {
			entry: { index: resolve( __dirname, 'src/index.ts' ) },
			name: 'StudioHosted',
			formats: [ 'es' ],
		},
		outDir: 'dist',
		target: 'node22',
		rolldownOptions: {
			output: {
				format: 'es',
				entryFileNames: '[name].mjs',
				chunkFileNames: '[name]-[hash].mjs',
				// Bundled CommonJS deps (e.g. `lockfile`) call `require( ... )` for Node
				// built-ins at module init. ESM output has no implicit `require`, so
				// provide a real one per chunk via `createRequire`.
				banner:
					'import { createRequire as __studioCreateRequire } from "node:module"; const require = __studioCreateRequire(import.meta.url);',
			},
			external: ( id: string ) => {
				if ( nodeBuiltinExternals.some( ( pattern ) => pattern.test( id ) ) ) {
					return true;
				}
				return packageJsonDependencies.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
			},
		},
		commonjsOptions: {
			ignoreDynamicRequires: true,
		},
		sourcemap: false,
		minify: false,
	},
	resolve: {
		alias: {
			'@studio/common': resolve( __dirname, '../../packages/common' ),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
} );
