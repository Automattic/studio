import { resolve } from 'path';
import semver from 'semver';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import packageJson from './package.json';

const minimumNodeVersionRange = packageJson.engines?.node;

if ( typeof minimumNodeVersionRange !== 'string' || minimumNodeVersionRange.length === 0 ) {
	throw new Error( 'apps/cli/package.json must define engines.node as a non-empty string.' );
}

const minimumNodeVersion = semver.minVersion( minimumNodeVersionRange )?.version;

if ( ! minimumNodeVersion ) {
	throw new Error(
		`Invalid engines.node range in apps/cli/package.json: ${ minimumNodeVersionRange }`
	);
}

// Node.js built-in modules that must always be externalized
export const nodeBuiltins = [
	'assert',
	'async_hooks',
	'buffer',
	'child_process',
	'cluster',
	'constants',
	'crypto',
	'dgram',
	'diagnostics_channel',
	'dns',
	'domain',
	'events',
	'fs',
	'http',
	'http2',
	'https',
	'inspector',
	'module',
	'net',
	'os',
	'path',
	'perf_hooks',
	'process',
	'punycode',
	'querystring',
	'readline',
	'stream',
	'string_decoder',
	'timers',
	'tls',
	'trace_events',
	'tty',
	'url',
	'util',
	'v8',
	'vm',
	'wasi',
	'worker_threads',
	'zlib',
];

// Packages that cannot be bundled by Vite and must remain as external node_modules.
// Reasons: native .node addons, WASM binaries, platform-specific binaries,
// or worker threads using data: URLs that need runtime module resolution.
export const nativeExternals = [
	'@anthropic-ai/claude-agent-sdk',
	'@img/',
	'@php-wasm/',
	'@wp-playground/',
	'fs-ext-extra-prebuilt',
	'koffi',
	'playwright',
	'playwright-core',
	'sharp',
	'trash',
	'winreg',
];

// All package.json dependencies (used by npm config to externalize everything)
export const packageJsonDependencies = Object.keys( packageJson.dependencies || {} );

function isNodeBuiltin( id: string ): boolean {
	if ( id.startsWith( 'node:' ) ) {
		return true;
	}
	// Match builtins and their subpaths (e.g., 'fs/promises', 'stream/promises')
	if ( nodeBuiltins.some( ( b ) => id === b || id.startsWith( b + '/' ) ) ) {
		return true;
	}
	// Handle trailing slash (e.g., 'string_decoder/')
	if ( id.endsWith( '/' ) && nodeBuiltins.includes( id.slice( 0, -1 ) ) ) {
		return true;
	}
	return false;
}

function isNativeExternal( id: string ): boolean {
	return nativeExternals.some( ( ext ) => id === ext || id.startsWith( ext ) );
}

export const baseConfig = defineConfig( {
	plugins: [
		viteStaticCopy( {
			targets: [
				{
					src: '../../wp-files',
					dest: '.',
					preserveTimestamps: true,
				},
			],
		} ),
		{
			// Fix trailing-slash imports for Node.js builtins (e.g., 'string_decoder/')
			// that some CJS-to-ESM interop generates.
			name: 'fix-trailing-slash-imports',
			resolveId( source ) {
				if ( source.endsWith( '/' ) && nodeBuiltins.includes( source.slice( 0, -1 ) ) ) {
					return { id: source.slice( 0, -1 ), external: true };
				}
				return null;
			},
		},
	],
	build: {
		lib: {
			entry: {
				main: resolve( __dirname, 'index.ts' ),
			},
			name: 'StudioCLI',
			formats: [ 'es' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rollupOptions: {
			output: {
				format: 'es',
				inlineDynamicImports: true,
				entryFileNames: '[name].mjs',
				paths: ( id ) => {
					// Rewrite trailing-slash imports in output
					if ( id.endsWith( '/' ) ) {
						return id.slice( 0, -1 );
					}
					return id;
				},
			},
			external: ( id ) => {
				// Bundle the blueprint-schema-validator (locally defined module)
				if ( id.includes( 'blueprint-schema-validator' ) ) {
					return false;
				}

				if ( isNodeBuiltin( id ) ) {
					return true;
				}

				// Only externalize packages with native addons or WASM
				return isNativeExternal( id );
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
			cli: resolve( __dirname, '.' ),
			'@studio/common': resolve( __dirname, '../../tools/common' ),
			'@wp-playground/blueprints/blueprint-schema-validator': resolve(
				__dirname,
				'../../node_modules/@wp-playground/blueprints/blueprint-schema-validator.js'
			),
		},
		conditions: [ 'node' ],
		mainFields: [ 'main' ],
	},
	define: {
		__ENABLE_CLI_TELEMETRY__: false,
		__IS_PACKAGED_FOR_NPM__: false,
		__MINIMUM_NODE_VERSION__: JSON.stringify( minimumNodeVersion ),
		__STUDIO_CLI_VERSION__: JSON.stringify( packageJson.version ),
	},
} );
