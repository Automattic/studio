import { execSync } from 'child_process';
import { createHash } from 'crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	statSync,
	writeFileSync,
} from 'fs';
import { join, relative, resolve, sep } from 'path';
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

// The CLI only ships the engine's self-contained MCP bundle. On CI the
// committed bundle is used as-is: run-lint.sh rebuilds it and fails on any
// drift from src/, so every CI checkout carries a provably fresh copy and
// rebuilding here would only waste time (the Windows job builds the CLI twice
// per run). Locally the CLI spawns the bundle rather than running the engine
// from src/ via tsx (unlike the plugin flow, see the engine's
// scripts/mcp-launcher.mjs), so rebuild it when its inputs changed since the
// last successful build — tracked via a fingerprint stamp inside the engine's
// dist/ — to keep engine devs from silently testing a stale bundle. The root
// lockfile is included so dependency bumps invalidate the inlined bundle even
// when the engine's own sources are untouched.
const dataLiberationStampPath = resolve( dataLiberationSourcePath, 'dist', '.studio-build-stamp' );
const dataLiberationInputs = [ 'src', 'scripts', 'package.json' ];

function computeDataLiberationFingerprint(): string {
	const entries: string[] = [];
	const walk = ( filePath: string ) => {
		const stats = statSync( filePath );
		if ( stats.isDirectory() ) {
			for ( const name of readdirSync( filePath ).sort() ) {
				walk( join( filePath, name ) );
			}
		} else {
			entries.push(
				`${ relative( dataLiberationSourcePath, filePath ) }|${ stats.size }|${ stats.mtimeMs }`
			);
		}
	};
	for ( const input of dataLiberationInputs ) {
		const inputPath = resolve( dataLiberationSourcePath, input );
		if ( existsSync( inputPath ) ) {
			walk( inputPath );
		}
	}
	const lockfilePath = resolve( repoRoot, 'package-lock.json' );
	if ( existsSync( lockfilePath ) ) {
		const lockStats = statSync( lockfilePath );
		entries.push( `package-lock.json|${ lockStats.size }|${ lockStats.mtimeMs }` );
	}
	return createHash( 'sha256' ).update( entries.join( '\n' ) ).digest( 'hex' );
}

const dataLiberationBundlePath = resolve(
	dataLiberationSourcePath,
	'dist',
	'mcp-server.bundle.mjs'
);

function buildDataLiberationIfStale() {
	if ( process.env.CI && existsSync( dataLiberationBundlePath ) ) {
		console.log( 'data-liberation engine: using the committed bundle (CI verifies its freshness)' );
		return;
	}
	const fingerprint = computeDataLiberationFingerprint();
	if (
		existsSync( dataLiberationBundlePath ) &&
		existsSync( dataLiberationStampPath ) &&
		readFileSync( dataLiberationStampPath, 'utf8' ) === fingerprint
	) {
		console.log( 'data-liberation engine is up to date — skipping nested build' );
		return;
	}
	execSync( 'npm -w data-liberation run build:mcp-bundle', { cwd: repoRoot, stdio: 'inherit' } );
	writeFileSync( dataLiberationStampPath, fingerprint );
}

// The cpSync filter below keeps only the engine's runtime assets, which leaves
// behind the directories whose files were all filtered out.
function pruneEmptyDirs( dir: string ): boolean {
	let empty = true;
	for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
		const entryPath = join( dir, entry.name );
		if ( entry.isDirectory() && pruneEmptyDirs( entryPath ) ) {
			rmdirSync( entryPath );
		} else {
			empty = false;
		}
	}
	return empty;
}

// The `studio ui` command serves the built browser UI (apps/ui `dist-local`)
// from `<chunk dir>/ui`, so it must sit next to the built chunks too. Built
// separately (`npm run build:local --workspace=apps/ui`); absent in API-only
// or dev-server setups, which is fine.
const localUiDistPath = resolve( __dirname, '../ui/dist-local' );

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

				buildDataLiberationIfStale();
				cpSync( dataLiberationSourcePath, resolve( outDir, 'data-liberation-agent' ), {
					recursive: true,
					filter: ( src ) => {
						const rel = relative( dataLiberationSourcePath, src );
						if ( rel === '' ) {
							return true;
						}

						const normalized = rel.split( sep ).join( '/' );
						const top = rel.split( sep )[ 0 ];
						// The bundle resolves the engine's vendored PHP helpers and JSON
						// data relative to their original src/ paths (see the engine's
						// build-mcp-bundle.mjs), so those assets must ship alongside it.
						if ( top === 'src' ) {
							if ( /(^|\/)(__fixtures__|__snapshots__|__tests__)(\/|$)/.test( normalized ) ) {
								return false;
							}
							return statSync( src ).isDirectory() || /\.(php|json)$/.test( rel );
						}
						if ( top === 'dist' ) {
							return rel === 'dist' || normalized === 'dist/mcp-server.bundle.mjs';
						}
						return top === 'package.json' || top === 'skills';
					},
				} );
				pruneEmptyDirs( resolve( outDir, 'data-liberation-agent' ) );

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
