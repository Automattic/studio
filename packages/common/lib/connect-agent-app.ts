import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { __, sprintf } from '@wordpress/i18n';
import {
	AGENT_APP_IDS,
	AGENT_APP_NAMES,
	type AgentApp,
	type AgentAppId,
} from '@studio/common/lib/agent-apps';
import { MCP_SERVER_NAME } from '@studio/common/lib/mcp-config';
import { isInstalled } from '@studio/common/lib/user-settings/installed-apps';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

/**
 * Connects an agent app to Studio by installing the Studio plugin from a
 * marketplace Studio writes on disk, whose plugin starts Studio's own CLI:
 * cloning the published marketplace, which carries the CLI, takes a minute.
 * Cursor installs only plugins of its own marketplace, so it gets the plugin as
 * a local plugin. Shared by the desktop's IPC handler and the `studio ui`
 * server.
 */

const PLUGIN = 'wp-studio@studio';

// The host's own Node.js and Studio CLI, which the plugin starts Studio's MCP
// server with, by full path: an app started from the Dock may find neither.
export interface StudioCli {
	nodeBinary: string;
	cliBinary: string;
}

export interface ConnectAgentAppOptions extends StudioCli {
	// Opens Cursor on the plugin's page.
	openUrl: ( url: string ) => Promise< void >;
}

// Cursor names a local plugin after its folder, and gives it the ID `user-local:<folder>`.
const CURSOR_PLUGIN_FOLDER = 'WordPress-Studio';

type CliAppId = Exclude< AgentAppId, 'cursor' >;

interface CliPlan {
	command: string;
	// Checked before PATH.
	locations: string[];
	// Install the plugin from Studio's marketplace, each safe to run again.
	steps: string[][];
	// Update it to the plugin Studio's marketplace has now.
	updates: string[][];
	// Whether the app has the plugin, from its records on disk: their list
	// commands are slow, the ChatGPT app's Codex taking up to a minute.
	hasPlugin: () => Promise< boolean >;
}

// The output of a failed step that still leaves the plugin installed, like a
// `studio` marketplace the app already has.
const ALREADY_DONE = /already/i;

async function readText( file: string ): Promise< string > {
	try {
		return await fs.promises.readFile( file, 'utf8' );
	} catch {
		return '';
	}
}

async function readJson< T >( file: string ): Promise< T | null > {
	try {
		return JSON.parse( await readText( file ) );
	} catch {
		return null;
	}
}

async function editJson< T >( file: string, edit: ( value: T ) => unknown ): Promise< void > {
	const value = JSON.parse( await fs.promises.readFile( file, 'utf8' ) );
	await fs.promises.writeFile( file, JSON.stringify( edit( value ), null, 2 ) + '\n' );
}

function getCliPlans( marketplace: string ): Record< CliAppId, CliPlan > {
	const home = os.homedir();
	const exe = process.platform === 'win32' ? '.exe' : '';
	return {
		'claude-code': {
			command: 'claude',
			locations: [
				path.join( home, '.local', 'bin', `claude${ exe }` ),
				path.join( home, '.claude', 'local', `claude${ exe }` ),
			],
			steps: [
				[ 'plugin', 'marketplace', 'add', marketplace ],
				[ 'plugin', 'install', PLUGIN ],
			],
			updates: [
				[ 'plugin', 'marketplace', 'update', 'studio' ],
				[ 'plugin', 'update', PLUGIN ],
			],
			hasPlugin: async () => {
				const config = process.env.CLAUDE_CONFIG_DIR ?? path.join( home, '.claude' );
				const record = await readJson< { plugins?: Record< string, unknown[] > } >(
					path.join( config, 'plugins', 'installed_plugins.json' )
				);
				return !! record?.plugins?.[ PLUGIN ]?.length;
			},
		},
		codex: {
			command: 'codex',
			// The Codex the ChatGPT app ships, which it reads plugins with.
			locations:
				process.platform === 'darwin'
					? [ '/Applications', path.join( home, 'Applications' ) ].map( ( dir ) =>
							path.join( dir, 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex' )
					  )
					: [],
			steps: [
				[ 'plugin', 'marketplace', 'add', marketplace ],
				[ 'plugin', 'add', PLUGIN ],
			],
			updates: [ [ 'plugin', 'add', PLUGIN ] ],
			hasPlugin: async () => {
				const config = process.env.CODEX_HOME ?? path.join( home, '.codex' );
				return ( await readText( path.join( config, 'config.toml' ) ) ).includes(
					`[plugins."${ PLUGIN }"]`
				);
			},
		},
		'grok-build': {
			command: 'grok',
			locations: [ path.join( home, '.grok', 'bin', `grok${ exe }` ) ],
			// Grok Build installs a plugin from its folder, with no marketplace.
			steps: [ [ 'plugin', 'install', path.join( marketplace, 'wp-studio' ), '--trust' ] ],
			// Its update skips a plugin installed from a folder, so it installs it again.
			updates: [
				[ 'plugin', 'uninstall', 'wp-studio' ],
				[ 'plugin', 'install', path.join( marketplace, 'wp-studio' ), '--trust' ],
			],
			hasPlugin: async () => {
				const config = process.env.GROK_HOME ?? path.join( home, '.grok' );
				const record = await readJson< {
					repos?: Record< string, { plugins?: Record< string, unknown > } >;
				} >( path.join( config, 'installed-plugins', 'registry.json' ) );
				return Object.values( record?.repos ?? {} ).some(
					( repo ) => repo.plugins?.[ 'wp-studio' ]
				);
			},
		},
	};
}

// Apps started from the Dock or a desktop launcher don't get the PATH the
// user's shell sets up, where these CLIs, and the Node.js some of them run on,
// usually are. The login shell reports it.
let searchPath: Promise< string > | undefined;

function getSearchPath(): Promise< string > {
	if ( process.platform === 'win32' ) {
		return Promise.resolve( process.env.PATH ?? '' );
	}
	searchPath ??= new Promise( ( resolve ) => {
		// The shell's startup files may print, so the PATH comes between markers.
		const marker = '__STUDIO_PATH__';
		execFile(
			process.env.SHELL || '/bin/sh',
			[ '-ilc', `printf '${ marker }%s${ marker }' "$PATH"` ],
			{ timeout: 10_000 },
			( _error, stdout ) => {
				const shellPath = String( stdout ?? '' ).split( marker )[ 1 ];
				resolve( [ shellPath, process.env.PATH ].filter( Boolean ).join( path.delimiter ) );
			}
		);
	} );
	return searchPath;
}

function isExecutable( file: string ): boolean {
	try {
		fs.accessSync( file, fs.constants.X_OK );
		return fs.statSync( file ).isFile();
	} catch {
		return false;
	}
}

async function findCli( plan: CliPlan ): Promise< string | null > {
	const located = plan.locations.find( isExecutable );
	if ( located ) {
		return located;
	}
	const names =
		process.platform === 'win32'
			? [ '.exe', '.cmd', '.bat' ].map( ( extension ) => `${ plan.command }${ extension }` )
			: [ plan.command ];
	for ( const dir of ( await getSearchPath() ).split( path.delimiter ).filter( Boolean ) ) {
		for ( const name of names ) {
			const candidate = path.join( dir, name );
			if ( isExecutable( candidate ) ) {
				return candidate;
			}
		}
	}
	return null;
}

function runCli(
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv
): Promise< { failed: boolean; output: string } > {
	// Windows runs a batch file only through cmd.exe.
	const batch = /\.(bat|cmd)$/i.test( file );
	return new Promise( ( resolve ) => {
		execFile(
			batch ? `"${ file }"` : file,
			args,
			{ env, shell: batch, timeout: 5 * 60_000, windowsHide: true },
			( error, stdout, stderr ) =>
				resolve( { failed: !! error, output: `${ stdout ?? '' }${ stderr ?? '' }`.trim() } )
		);
	} );
}

function getMarketplacePath(): string {
	return path.join( getConfigDirectory(), 'agent-plugins' );
}

// What the CLI build puts next to the CLI, with its version.
function getBundledMarketplacePath( { cliBinary }: StudioCli ): string {
	return path.join( path.dirname( cliBinary ), 'agent-plugins' );
}

// The apps install and update the plugin by its version.
async function readPluginVersion( marketplace: string ): Promise< string | undefined > {
	const manifest = await readJson< { version?: string } >(
		path.join( marketplace, 'wp-studio', '.claude-plugin', 'plugin.json' )
	);
	return manifest?.version;
}

// Writes Studio's marketplace, with the plugin's MCP server set to this Studio's CLI.
async function writeMarketplace( cli: StudioCli ): Promise< string > {
	const source = getBundledMarketplacePath( cli );
	const target = getMarketplacePath();
	const staging = `${ target }.${ process.pid }`;
	await fs.promises.rm( staging, { recursive: true, force: true } );
	await fs.promises.cp( source, staging, { recursive: true } );
	const plugin = path.join( staging, 'wp-studio' );
	const server = {
		command: cli.nodeBinary,
		args: [ cli.cliBinary, 'mcp' ],
		env: { STUDIO_PLUGIN_ID: PLUGIN, STUDIO_PLUGIN_VERSION: await readPluginVersion( source ) },
	};
	const servers = { [ MCP_SERVER_NAME ]: server };
	for ( const manifest of [ '.claude-plugin', '.cursor-plugin' ] ) {
		await editJson< object >( path.join( plugin, manifest, 'plugin.json' ), ( value ) => ( {
			...value,
			mcpServers: servers,
		} ) );
	}
	await editJson( path.join( plugin, '.grok-plugin', 'mcp.json' ), () => ( {
		mcpServers: servers,
	} ) );
	// Codex's config keeps its timeouts and the environment variables it passes on.
	await editJson< { mcpServers: Record< string, { cwd?: string } > } >(
		path.join( plugin, '.mcp.json' ),
		( { mcpServers } ) => {
			const { cwd: _cwd, ...codex } = mcpServers[ MCP_SERVER_NAME ];
			return { mcpServers: { [ MCP_SERVER_NAME ]: { ...codex, ...server } } };
		}
	);
	// Its screenshots are for OpenAI's directory and stay out of the CLI build.
	await editJson< { interface?: { screenshots?: string[] } } >(
		path.join( plugin, '.codex-plugin', 'plugin.json' ),
		( manifest ) => {
			delete manifest.interface?.screenshots;
			return manifest;
		}
	);
	await fs.promises.rm( target, { recursive: true, force: true } );
	await fs.promises.rename( staging, target );
	return target;
}

function getCursorPluginPath(): string {
	return path.join( os.homedir(), '.cursor', 'plugins', 'local', CURSOR_PLUGIN_FOLDER );
}

function readCursorPlugin( plugin = getCursorPluginPath() ): Promise< object | null > {
	return readJson( path.join( plugin, '.cursor-plugin', 'plugin.json' ) );
}

// Cursor also loads the plugins Claude Code has, by default ("import third-party
// plugins"), so with Claude Code's Studio plugin it needs no copy of its own: two
// would give it the Studio tools twice.
function claudeCodeHasPlugin(): Promise< boolean > {
	return getCliPlans( getMarketplacePath() )[ 'claude-code' ].hasPlugin();
}

async function removeCursorPlugin() {
	await fs.promises.rm( getCursorPluginPath(), { recursive: true, force: true } );
}

function getCursorPluginPage( id: string ): string {
	return `cursor://anysphere.cursor-deeplink/plugin/add?id=${ encodeURIComponent( id ) }`;
}

async function installCursorPlugin( marketplace: string ) {
	const target = getCursorPluginPath();
	// Cursor loads every folder in `local` as it appears, so the copy is made
	// beside it and moved in once complete.
	const staging = path.join(
		path.dirname( path.dirname( target ) ),
		'.wordpress-studio-installing'
	);
	await fs.promises.rm( staging, { recursive: true, force: true } );
	await fs.promises.cp( path.join( marketplace, 'wp-studio' ), staging, { recursive: true } );
	await fs.promises.mkdir( path.dirname( target ), { recursive: true } );
	await fs.promises.rm( target, { recursive: true, force: true } );
	await fs.promises.rename( staging, target );
}

// Installs the plugin unless Cursor has this one, then opens its page.
async function connectCursor( options: ConnectAgentAppOptions ) {
	if ( await claudeCodeHasPlugin() ) {
		await removeCursorPlugin();
		await options.openUrl( getCursorPluginPage( PLUGIN ) );
		return;
	}
	const marketplace = await writeMarketplace( options );
	const plugin = await readCursorPlugin( path.join( marketplace, 'wp-studio' ) );
	if ( JSON.stringify( await readCursorPlugin() ) !== JSON.stringify( plugin ) ) {
		await installCursorPlugin( marketplace );
		// Cursor has no page for the plugin until it loads it, a moment after its folder appears.
		await sleep( 200 );
	}
	await options.openUrl( getCursorPluginPage( `user-local:${ CURSOR_PLUGIN_FOLDER }` ) );
}

export async function detectAgentApps(): Promise< AgentApp[] > {
	const plans = getCliPlans( getMarketplacePath() );
	return Promise.all(
		AGENT_APP_IDS.map( async ( id ) => {
			if ( id === 'cursor' ) {
				return {
					id,
					installed: isInstalled( 'cursor' ),
					connected: ( await readCursorPlugin() ) !== null || ( await claudeCodeHasPlugin() ),
				};
			}
			const cli = await findCli( plans[ id ] );
			return {
				id,
				installed: cli !== null,
				connected: !! cli && ( await plans[ id ].hasPlugin() ),
			};
		} )
	);
}

export async function connectAgentApp(
	id: AgentAppId,
	options: ConnectAgentAppOptions
): Promise< void > {
	if ( id === 'cursor' ) {
		await connectCursor( options );
		return;
	}
	const plan = getCliPlans( getMarketplacePath() )[ id ];
	const cli = await findCli( plan );
	if ( ! cli ) {
		throw new Error(
			sprintf(
				// translators: %s: an agent app, like Claude Code.
				__( '%s isn’t installed on this computer.' ),
				AGENT_APP_NAMES[ id ]
			)
		);
	}
	if ( ! ( await plan.hasPlugin() ) ) {
		await installWithCli( id, plan, cli, options );
	}
	if ( id === 'claude-code' ) {
		// Cursor now has the plugin from Claude Code.
		await removeCursorPlugin();
	}
}

async function installWithCli(
	id: CliAppId,
	plan: CliPlan,
	cli: string,
	options: ConnectAgentAppOptions
) {
	await writeMarketplace( options );
	const env = { ...process.env, PATH: await getSearchPath() };
	for ( const args of plan.steps ) {
		const { failed, output } = await runCli( cli, args, env );
		if ( failed && ! ALREADY_DONE.test( output ) ) {
			throw new Error(
				sprintf(
					// translators: %1$s: an agent app, like Claude Code. %2$s: the app's error message.
					__( '%1$s couldn’t install the WordPress Studio plugin: %2$s' ),
					AGENT_APP_NAMES[ id ],
					output.split( '\n' ).pop() || __( 'Unknown error' )
				)
			);
		}
	}
}

// After a Studio update, rewrites Studio's marketplace and updates the plugin
// in each app that has it, so their skills match this Studio. Does nothing
// before a first Connect writes the marketplace, or for another Studio of the
// same version, like a development build beside the app.
export async function refreshAgentPlugins( cli: StudioCli ): Promise< void > {
	const written = await readPluginVersion( getMarketplacePath() );
	const bundled = await readPluginVersion( getBundledMarketplacePath( cli ) );
	if ( ! written || ! bundled || written === bundled ) {
		return;
	}
	const marketplace = await writeMarketplace( cli );
	const env = { ...process.env, PATH: await getSearchPath() };
	for ( const plan of Object.values( getCliPlans( marketplace ) ) ) {
		const app = await findCli( plan );
		if ( app && ( await plan.hasPlugin() ) ) {
			for ( const args of plan.updates ) {
				await runCli( app, args, env );
			}
		}
	}
	if ( await readCursorPlugin() ) {
		if ( await claudeCodeHasPlugin() ) {
			await removeCursorPlugin();
		} else {
			await installCursorPlugin( marketplace );
		}
	}
}
