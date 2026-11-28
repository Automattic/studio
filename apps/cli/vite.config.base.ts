import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { builtinModules, createRequire } from 'module';
import { dirname, relative, resolve } from 'path';
import semver from 'semver';
import { defineConfig, type Plugin } from 'vite';

const __dirname = import.meta.dirname;
const packageJson = createRequire( import.meta.url )( './package.json' ) as {
	dependencies?: Record< string, string >;
	engines?: { node?: string };
	version: string;
};

// Kept external and installed by `install:bundle`; everything else, including the
// workspace packages and their dependencies, is bundled. See "Bundled Workspace
// Packages" in AGENTS.md.
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

// pi is bundled, but reads its version from its `package.json` and its themes from files. These
// are copied to `<chunk dir>/pi-coding-agent`, where `PI_PACKAGE_DIR` points it.
const piPackagePath = resolve( __dirname, '../../node_modules/@earendil-works/pi-coding-agent' );
const PI_PACKAGE_FILES = [ 'package.json', 'dist/modes/interactive/theme' ];

const bundledWpFilesPath = resolve( __dirname, '..', '..', 'wp-files' );
const phpSourceCodePath = resolve( __dirname, 'php' );

// Settings installs the Studio plugin in agent apps from a marketplace Studio
// writes from these, copied to `<chunk dir>/agent-plugins` with this version
// (see `connect-agent-app.ts` in @studio/common). Its server is Studio's own CLI,
// so the launcher scripts stay out, and so do the directory listing's screenshots.
const pluginsSourcePath = resolve( __dirname, '../../plugins' );
const AGENT_PLUGIN_FILES = [
	'.claude-plugin/marketplace.json',
	'.agents/plugins/marketplace.json',
	'wp-studio/.claude-plugin',
	'wp-studio/.codex-plugin',
	'wp-studio/.cursor-plugin',
	'wp-studio/.grok-plugin',
	'wp-studio/.mcp.json',
	'wp-studio/agents',
	'wp-studio/assets/logo.png',
	'wp-studio/skills',
];
const AGENT_PLUGIN_MANIFESTS = [
	'.claude-plugin',
	'.codex-plugin',
	'.cursor-plugin',
	'.grok-plugin',
];

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

// `studio mcp` serves the WordPress library page (apps/mcp-ui `dist`) from
// `<chunk dir>/mcp-ui`. Built separately like the browser UI; release configs
// include `buildMcpUiPlugin`.
const mcpUiDistPath = resolve( __dirname, '../mcp-ui/dist' );

export function buildMcpUiPlugin() {
	return {
		name: 'build-mcp-ui',
		apply: 'build' as const,
		buildStart() {
			execSync( 'npx vite build', { cwd: resolve( __dirname, '../mcp-ui' ), stdio: 'inherit' } );
			if ( ! existsSync( mcpUiDistPath ) ) {
				throw new Error(
					`The MCP Apps page build did not produce ${ mcpUiDistPath }; refusing to ship a CLI without it.`
				);
			}
		},
	};
}

// Files that bundled code loads from next to its chunk at runtime, such as pi's image resize worker,
// are invisible to the bundler, so the build fails when one is missing from the output. This matches
// the first argument of each call, which may hold one level of parentheses.
const RUNTIME_FILE_REFERENCE =
	/new URL\(((?:[^()]|\([^()]*\))*?),\s*import\.meta\.url\s*\)|new Worker\(((?:[^(),]|\([^()]*\))*)[,)]|import\.meta\.resolve\(([^(),]*)\)/g;
const RELATIVE_STRING_LITERAL = /(['"`])(\.\.?\/[^'"`$]+)\1/g;
const UNREACHABLE_RUNTIME_FILE_REFERENCES = [
	// pi's codemode extension, which Studio never creates.
	'@earendil-works/pi-codemode/dist/runtime/host.js',
];

function checkRuntimeFilesPlugin(): Plugin {
	let references: { chunk: string; module: string; candidates: string[] }[] = [];
	let outDir = '';
	return {
		name: 'check-runtime-files',
		apply: 'build',
		writeBundle( options, bundle ) {
			outDir = options.dir ?? resolve( __dirname, 'dist/cli' );
			references = [];
			for ( const chunk of Object.values( bundle ) ) {
				if ( chunk.type !== 'chunk' ) {
					continue;
				}
				for ( const [ module, { code } ] of Object.entries( chunk.modules ) ) {
					if (
						! code ||
						UNREACHABLE_RUNTIME_FILE_REFERENCES.some( ( allowed ) => module.endsWith( allowed ) )
					) {
						continue;
					}
					for ( const match of code.matchAll( RUNTIME_FILE_REFERENCE ) ) {
						const argument = match[ 1 ] ?? match[ 2 ] ?? match[ 3 ];
						const candidates = [ ...argument.matchAll( RELATIVE_STRING_LITERAL ) ].map(
							( literal ) => literal[ 2 ]
						);
						if ( candidates.length > 0 ) {
							references.push( { chunk: chunk.fileName, module, candidates } );
						}
					}
				}
			}
		},
		// After every plugin's `writeBundle`, which is where copies like `viteStaticCopy` happen.
		closeBundle() {
			const missing = references.filter(
				// A reference may pick between paths at runtime (`isTs ? './a.ts' : './a.js'`), so one
				// of them existing is enough.
				( { chunk, candidates } ) =>
					! candidates.some( ( candidate ) =>
						existsSync( resolve( outDir, dirname( chunk ), candidate ) )
					)
			);
			if ( missing.length > 0 ) {
				throw new Error(
					'The CLI build output lacks files its code loads at runtime. Add them as a build entry or copy them into the output:\n' +
						missing
							.map(
								( { chunk, module, candidates } ) =>
									`  ${ candidates.join( ' or ' ) }, referenced by ${ chunk } (from ${ relative(
										resolve( __dirname, '../..' ),
										module
									) })`
							)
							.join( '\n' )
				);
			}
		},
	};
}

export const baseConfig = defineConfig( {
	oxc: {
		target: `node${ semver.major( minimumNodeVersion ) }`,
	},
	plugins: [
		checkRuntimeFilesPlugin(),
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
					// WordPress ships as `latest/wordpress.zip`; the extracted copy is for build scripts.
					const extractedWordPressPath = resolve( bundledWpFilesPath, 'latest', 'wordpress' );
					cpSync( bundledWpFilesPath, resolve( outDir, 'wp-files' ), {
						recursive: true,
						filter: ( source ) => source !== extractedWordPressPath,
					} );
				}
				for ( const file of PI_PACKAGE_FILES ) {
					cpSync( resolve( piPackagePath, file ), resolve( outDir, 'pi-coding-agent', file ), {
						recursive: true,
						filter: ( source ) => ! /\.(js|ts|map)$/.test( source ),
					} );
				}
				const agentPlugins = resolve( outDir, 'agent-plugins' );
				for ( const file of AGENT_PLUGIN_FILES ) {
					cpSync( resolve( pluginsSourcePath, file ), resolve( agentPlugins, file ), {
						recursive: true,
					} );
				}
				for ( const manifest of AGENT_PLUGIN_MANIFESTS ) {
					const file = resolve( agentPlugins, 'wp-studio', manifest, 'plugin.json' );
					const fields = JSON.parse( readFileSync( file, 'utf8' ) );
					writeFileSync(
						file,
						JSON.stringify( { ...fields, version: packageJson.version }, null, 2 ) + '\n'
					);
				}

				if ( existsSync( localUiDistPath ) ) {
					cpSync( localUiDistPath, resolve( outDir, 'ui' ), { recursive: true } );
				}
				if ( existsSync( mcpUiDistPath ) ) {
					cpSync( mcpUiDistPath, resolve( outDir, 'mcp-ui' ), { recursive: true } );
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
				'php-server-child': resolve( __dirname, 'php-server-child.ts' ),
				'frontend-server-child': resolve( __dirname, 'frontend-server-child.ts' ),
				// pi starts its image resizing worker from `image-resize-worker.js` next to its own code,
				// which is bundled here.
				'image-resize-worker': resolve(
					__dirname,
					'../../node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize-worker.js'
				),
			},
			name: 'StudioCLI',
			formats: [ 'es' ],
		},
		outDir: 'dist/cli',
		target: 'node22',
		rolldownOptions: {
			output: {
				format: 'es',
				entryFileNames: ( chunk ) =>
					chunk.name === 'image-resize-worker' ? '[name].js' : '[name].mjs',
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

				if ( id.startsWith( 'node:' ) || builtinModules.includes( id ) ) {
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
			'@studio/agent': resolve( __dirname, '../../packages/agent' ),
			'@studio/providers': resolve( __dirname, '../../packages/providers' ),
			'@studio/design-md': resolve( __dirname, '../../packages/design-md/index.ts' ),
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
		'process.env.PI_PACKAGE_DIR': 'import.meta.dirname + "/pi-coding-agent"',
	},
} );
