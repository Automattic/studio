import { execSync } from 'child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import semver from 'semver';
import { defineConfig } from 'vite';
import packageJson from './package.json';

const nodeBuiltinExternals: RegExp[] = [
	/^node:/,
	/^(path|fs|os|child_process|crypto|http|https|http2|url|querystring|stream|util|events|buffer|assert|net|tty|readline|zlib|constants|tls|domain|dns)$/,
	/^fs\/promises$/,
	/^dns\/promises$/,
];

const packageJsonDependencies = Object.keys( packageJson.dependencies || {} );
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

const bundledWpFilesPath = resolve( __dirname, '..', '..', 'wp-files' );
const phpSourceCodePath = resolve( __dirname, 'php' );
// The Skill tool loads skills from `<chunk dir>/skills` at runtime (see
// `ai/skills.ts`), so they must sit directly next to the built chunks.
const skillsSourcePath = resolve( __dirname, 'ai/skills' );

const dataLiberationSourcePath = resolve(
	__dirname,
	'..',
	'..',
	'packages',
	'data-liberation-agent'
);
const repoRoot = resolve( __dirname, '..', '..' );

// The `studio ui` command serves the built browser UI (apps/ui `dist-local`)
// from `<chunk dir>/ui`, so it must sit next to the built chunks too. Built
// separately (`npm run build:local --workspace=apps/ui`); absent in API-only
// or dev-server setups, which is fine — for dev builds. Release configs must
// include `buildLocalUiPlugin` so the shipped CLI never lacks the UI.
const localUiDistPath = resolve( __dirname, '../ui/dist-local' );

// Builds the browser UI so the copy in `write-dist-extras` always has it.
// Release configs (npm, prod, standalone) include this plugin; without it a
// missing `dist-local` is silently skipped and `studio ui` ships broken
// ("Cannot GET /", as happened with wp-studio@1.15.0 on npm).
export function buildLocalUiPlugin() {
	return {
		name: 'build-local-ui',
		apply: 'build' as const,
		buildStart() {
			// Equivalent to apps/ui's `build:local` script, but with the target set
			// via the environment: the script's inline `STUDIO_TARGET=local` prefix
			// is POSIX-only and fails under cmd.exe on Windows CI.
			execSync( 'npx vite build', {
				cwd: resolve( __dirname, '../ui' ),
				stdio: 'inherit',
				env: { ...process.env, STUDIO_TARGET: 'local' },
			} );
			if ( ! existsSync( localUiDistPath ) ) {
				throw new Error(
					`The browser UI build did not produce ${ localUiDistPath }; refusing to ship a CLI without the \`studio ui\` assets.`
				);
			}
		},
	};
}

// Ship only the self-contained engine bundle — its deps are inlined. Shipping
// the tsc output + node_modules instead added ~10k files to the installer and
// ~8 min to the Windows CI build (STU-2027).
function copyDataLiberationEngine( outDir: string ) {
	execSync( 'npm -w data-liberation run build:mcp-bundle', {
		cwd: repoRoot,
		stdio: 'inherit',
	} );
	const engineOutDir = resolve( outDir, 'data-liberation-agent' );
	mkdirSync( resolve( engineOutDir, 'dist' ), { recursive: true } );
	copyFileSync(
		resolve( dataLiberationSourcePath, 'dist', 'mcp-server.bundle.mjs' ),
		resolve( engineOutDir, 'dist', 'mcp-server.bundle.mjs' )
	);
	cpSync( resolve( dataLiberationSourcePath, 'skills' ), resolve( engineOutDir, 'skills' ), {
		recursive: true,
	} );

	// The skills also invoke pipeline drivers via `node scripts/run.mjs <name>`.
	// Ship the launcher plus the self-contained driver bundles it falls back to
	// when no dev dependencies resolve next to it (dist/scripts/, emitted by the
	// same build:mcp-bundle run as the server bundle).
	cpSync(
		resolve( dataLiberationSourcePath, 'dist', 'scripts' ),
		resolve( engineOutDir, 'dist', 'scripts' ),
		{ recursive: true }
	);
	mkdirSync( resolve( engineOutDir, 'scripts' ), { recursive: true } );
	copyFileSync(
		resolve( dataLiberationSourcePath, 'scripts', 'run.mjs' ),
		resolve( engineOutDir, 'scripts', 'run.mjs' )
	);

	// The bundle resolves vendored runtime assets (.php helpers run via
	// `wp eval-file`, .json data like core-block-attrs.json) relative to the
	// engine's original src/ module paths — see the import.meta.url rewrite in
	// packages/data-liberation-agent/scripts/build-mcp-bundle.mjs — so mirror
	// those files (and nothing else) under src/.
	const copyRuntimeAssets = ( srcDir: string, destDir: string ) => {
		for ( const entry of readdirSync( srcDir, { withFileTypes: true } ) ) {
			const from = resolve( srcDir, entry.name );
			if ( entry.isDirectory() ) {
				if ( /^__(tests|fixtures|snapshots)__$/.test( entry.name ) ) {
					continue;
				}
				copyRuntimeAssets( from, resolve( destDir, entry.name ) );
			} else if ( /\.(php|json)$/.test( entry.name ) ) {
				mkdirSync( destDir, { recursive: true } );
				copyFileSync( from, resolve( destDir, entry.name ) );
			}
		}
	};
	copyRuntimeAssets( resolve( dataLiberationSourcePath, 'src' ), resolve( engineOutDir, 'src' ) );
}

export const baseConfig = defineConfig( {
	oxc: {
		target: `node${ semver.major( minimumNodeVersion ) }`,
	},
	plugins: [
		{
			name: 'write-dist-extras',
			apply: 'build',
			writeBundle( options ) {
				const outDir = options.dir ?? resolve( __dirname, 'dist/cli' );
				mkdirSync( outDir, { recursive: true } );
				writeFileSync(
					resolve( outDir, 'package.json' ),
					JSON.stringify( { type: 'module' }, null, 2 ) + '\n'
				);
				if ( existsSync( phpSourceCodePath ) ) {
					cpSync( phpSourceCodePath, resolve( outDir, 'php' ), { recursive: true } );
				}
				if ( existsSync( bundledWpFilesPath ) ) {
					cpSync( bundledWpFilesPath, resolve( outDir, 'wp-files' ), { recursive: true } );
				}
				if ( existsSync( skillsSourcePath ) ) {
					cpSync( skillsSourcePath, resolve( outDir, 'skills' ), { recursive: true } );
				}

				copyDataLiberationEngine( outDir );

				if ( existsSync( localUiDistPath ) ) {
					cpSync( localUiDistPath, resolve( outDir, 'ui' ), { recursive: true } );
				}
			},
		},
	],
	build: {
		emptyOutDir: true,
		lib: {
			entry: {
				main: resolve( __dirname, 'index.ts' ),
				'process-manager-daemon': resolve( __dirname, 'process-manager-daemon.ts' ),
				'proxy-daemon': resolve( __dirname, 'proxy-daemon.ts' ),
				'playground-server-child': resolve( __dirname, 'playground-server-child.ts' ),
				'php-server-child': resolve( __dirname, 'php-server-child.ts' ),
				'reprint-child': resolve( __dirname, 'reprint-child.ts' ),
			},
			name: 'StudioCLI',
			formats: [ 'es' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rolldownOptions: {
			output: {
				format: 'es',
				entryFileNames: '[name].mjs',
				chunkFileNames: '[name]-[hash].mjs',
				// Some bundled CommonJS dependencies (e.g. `lockfile`, `debug`) call
				// `require( ... )` for Node built-ins at module init. Rolldown (the
				// default bundler in Vite 8) emits a shim that throws when those calls
				// run in an ESM output (`.mjs`), since ESM has no implicit `require`.
				// Provide a real `require` per chunk via `createRequire` so the shim
				// uses it instead of throwing. `main.mjs` additionally gets a shebang so
				// the npm-published bundle can be executed directly as a CLI (harmless in
				// other builds — Node ignores it when the file is run via `node main.mjs`).
				banner: ( chunk ) => {
					const requireShim =
						'import { createRequire as __studioCreateRequire } from "node:module"; const require = __studioCreateRequire(import.meta.url);';
					return chunk.fileName === 'main.mjs'
						? `#!/usr/bin/env node\n${ requireShim }`
						: requireShim;
				},
			},
			external: ( id ) => {
				// Bundle the `@wp-playground/blueprints/blueprint-schema-validator` module since we've defined
				// that module ourselves
				if ( id.includes( 'blueprint-schema-validator' ) ) {
					return false;
				}

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
			cli: resolve( __dirname, '.' ),
			'@studio/common': resolve( __dirname, '../../packages/common' ),
			// The `studio ui` local server (apps/local) is bundled into the CLI
			// from source, the same way `@studio/common` is.
			'@studio/local': resolve( __dirname, '../local/src' ),
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
		__IS_PACKAGED_FOR_STANDALONE__: false,
		__MINIMUM_NODE_VERSION__: JSON.stringify( minimumNodeVersion ),
		__STUDIO_CLI_VERSION__: JSON.stringify( packageJson.version ),
	},
} );
