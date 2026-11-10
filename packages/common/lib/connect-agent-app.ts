import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { __, sprintf } from '@wordpress/i18n';
import { writeFile as writeAtomicFile } from 'atomically';
import { compare, lt, valid } from 'semver';
import {
	AGENT_APP_IDS,
	AGENT_APP_NAMES,
	type AgentApp,
	type AgentAppId,
} from '@studio/common/lib/agent-apps';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
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
const CLI_TIMEOUT_MS = 5 * 60_000;
const REFRESH_STATE_FILE = '.studio-refresh.json';
const PLUGIN_LOCK_TIMEOUT_MS = 30 * 60_000;

interface RefreshState {
	version: string;
	pending: AgentAppId[];
}

async function withAgentPluginsLock< T >( operation: () => Promise< T > ): Promise< T > {
	const lock = `${ getMarketplacePath() }.lock`;
	await fs.promises.mkdir( path.dirname( lock ), { recursive: true } );
	// A refresh can run five commands, each with a five-minute timeout.
	await lockFileAsync( lock, { stale: PLUGIN_LOCK_TIMEOUT_MS, wait: PLUGIN_LOCK_TIMEOUT_MS } );
	try {
		return await operation();
	} finally {
		await unlockFileAsync( lock );
	}
}

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
	pluginVersion: () => Promise< string | undefined >;
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

async function readClaudePlugins(): Promise< { version?: string }[] > {
	const config = process.env.CLAUDE_CONFIG_DIR ?? path.join( os.homedir(), '.claude' );
	const record = await readJson< { plugins?: Record< string, { version?: string }[] > } >(
		path.join( config, 'plugins', 'installed_plugins.json' )
	);
	return record?.plugins?.[ PLUGIN ] ?? [];
}

async function readGrokPlugins(): Promise< { version?: string }[] > {
	const config = process.env.GROK_HOME ?? path.join( os.homedir(), '.grok' );
	const record = await readJson< {
		repos?: Record< string, { plugins?: Record< string, { version?: string } > } >;
	} >( path.join( config, 'installed-plugins', 'registry.json' ) );
	return Object.values( record?.repos ?? {} ).flatMap( ( repo ) =>
		repo.plugins?.[ 'wp-studio' ] ? [ repo.plugins[ 'wp-studio' ] ] : []
	);
}

async function readCodexPluginVersion(): Promise< string | undefined > {
	const config = process.env.CODEX_HOME ?? path.join( os.homedir(), '.codex' );
	const root = path.join( config, 'plugins', 'cache', 'studio', 'wp-studio' );
	const entries = await fs.promises.readdir( root, { withFileTypes: true } ).catch( () => [] );
	// Match Codex's active-version selection, including its preferred local copy.
	// https://github.com/openai/codex/blob/007f668c34cca4b9c36ca7ddc08066897f2bbabc/codex-rs/core-plugin-common/src/installed.rs
	const versions = entries
		.filter( ( entry ) => entry.isDirectory() && /^[a-z\d._+-]+$/i.test( entry.name ) )
		.map( ( entry ) => entry.name )
		.sort( ( a, b ) =>
			valid( a ) && valid( b ) ? compare( a, b ) : a < b ? -1 : a > b ? 1 : 0
		);
	const active = versions.includes( 'local' ) ? 'local' : versions.at( -1 );
	if ( ! active ) {
		return undefined;
	}
	const manifest = await readJson< { version?: string } >(
		path.join( root, active, '.codex-plugin', 'plugin.json' )
	);
	return manifest?.version ?? active;
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
			hasPlugin: async () => !! ( await readClaudePlugins() ).length,
			pluginVersion: async () => ( await readClaudePlugins() )[ 0 ]?.version,
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
			pluginVersion: readCodexPluginVersion,
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
			hasPlugin: async () => !! ( await readGrokPlugins() ).length,
			pluginVersion: async () => ( await readGrokPlugins() )[ 0 ]?.version,
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
			{ env, shell: batch, timeout: CLI_TIMEOUT_MS, windowsHide: true },
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

async function readRefreshState( marketplace: string ): Promise< RefreshState | undefined > {
	const state = await readJson< RefreshState >( path.join( marketplace, REFRESH_STATE_FILE ) );
	if ( state ) {
		return state;
	}
	const version = await readPluginVersion( marketplace );
	return version ? { version, pending: [] } : undefined;
}

async function writeRefreshState( marketplace: string, state: RefreshState ): Promise< void > {
	await writeAtomicFile( path.join( marketplace, REFRESH_STATE_FILE ), JSON.stringify( state ) );
}

// Writes Studio's marketplace, with the plugin's MCP server set to this Studio's CLI.
async function writeMarketplace( cli: StudioCli ): Promise< string > {
	const source = getBundledMarketplacePath( cli );
	const target = getMarketplacePath();
	const refreshState = await readRefreshState( target );
	const staging = await fs.promises.mkdtemp( `${ target }.` );
	try {
		await fs.promises.cp( source, staging, { recursive: true } );
		if ( refreshState ) {
			await writeRefreshState( staging, refreshState );
		}
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
	} finally {
		await fs.promises.rm( staging, { recursive: true, force: true } );
	}
}

function getCursorPluginPath(): string {
	return path.join( os.homedir(), '.cursor', 'plugins', 'local', CURSOR_PLUGIN_FOLDER );
}

function readCursorPlugin(
	plugin = getCursorPluginPath()
): Promise< { version?: string } | null > {
	return readJson( path.join( plugin, '.cursor-plugin', 'plugin.json' ) );
}

// Cursor can import Claude Code's plugins. Preserve an existing local copy:
// Cursor's third-party imports may be disabled.
function claudeCodeHasPlugin(): Promise< boolean > {
	return getCliPlans( getMarketplacePath() )[ 'claude-code' ].hasPlugin();
}

function getCursorPluginPage( id: string ): string {
	return `cursor://anysphere.cursor-deeplink/plugin/add?id=${ encodeURIComponent( id ) }`;
}

async function installCursorPlugin( marketplace: string ) {
	const target = getCursorPluginPath();
	// Cursor loads every folder in `local` as it appears, so the copy is made
	// beside it and moved in once complete.
	const stagingRoot = path.join(
		path.dirname( path.dirname( target ) ),
		'.wordpress-studio-installing'
	);
	await fs.promises.mkdir( path.dirname( stagingRoot ), { recursive: true } );
	const staging = await fs.promises.mkdtemp( `${ stagingRoot }.` );
	try {
		await fs.promises.cp( path.join( marketplace, 'wp-studio' ), staging, { recursive: true } );
		await fs.promises.mkdir( path.dirname( target ), { recursive: true } );
		await fs.promises.rm( target, { recursive: true, force: true } );
		await fs.promises.rename( staging, target );
	} finally {
		await fs.promises.rm( staging, { recursive: true, force: true } );
	}
}

// Installs the plugin unless Cursor has this one, then opens its page.
async function connectCursor( options: ConnectAgentAppOptions ) {
	if ( ! ( await readCursorPlugin() ) && ( await claudeCodeHasPlugin() ) ) {
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

async function getInstalledPluginVersion( id: AgentAppId ): Promise< string | undefined > {
	const plans = getCliPlans( getMarketplacePath() );
	if ( id === 'cursor' ) {
		const local = await readCursorPlugin();
		return local ? local.version : plans[ 'claude-code' ].pluginVersion();
	}
	return plans[ id ].pluginVersion();
}

function isOlderVersion( installed: string | undefined, bundled: string | undefined ): boolean {
	return !! (
		installed &&
		bundled &&
		valid( installed ) &&
		valid( bundled ) &&
		lt( installed, bundled )
	);
}

async function getUpdateStatus(
	id: AgentAppId,
	connected: boolean,
	bundled: string | undefined,
	state: RefreshState | undefined,
	busy = false
): Promise< AgentApp[ 'updateStatus' ] > {
	const version = connected ? await getInstalledPluginVersion( id ) : undefined;
	if ( isOlderVersion( bundled, version ) ) {
		return undefined;
	}
	if ( state?.pending.includes( id ) ) {
		return busy ? 'updating' : 'failed';
	}
	return connected && isOlderVersion( version, bundled ) ? 'available' : undefined;
}

export async function detectAgentApps( studio: StudioCli ): Promise< AgentApp[] > {
	const plans = getCliPlans( getMarketplacePath() );
	const [ bundled, state, lock ] = await Promise.all( [
		readPluginVersion( getBundledMarketplacePath( studio ) ),
		readRefreshState( getMarketplacePath() ),
		fs.promises.stat( `${ getMarketplacePath() }.lock` ).catch( () => undefined ),
	] );
	const busy = !! lock && Date.now() - lock.mtimeMs < PLUGIN_LOCK_TIMEOUT_MS;
	return Promise.all(
		AGENT_APP_IDS.map( async ( id ) => {
			const installed =
				id === 'cursor' ? isInstalled( 'cursor' ) : !! ( await findCli( plans[ id ] ) );
			const connected =
				id === 'cursor'
					? ( await readCursorPlugin() ) !== null || ( await claudeCodeHasPlugin() )
					: installed && ( await plans[ id ].hasPlugin() );
			return {
				id,
				installed,
				connected,
				updateStatus: installed
					? await getUpdateStatus( id, connected, bundled, state, busy )
					: undefined,
			};
		} )
	);
}

export async function connectAgentApp(
	id: AgentAppId,
	options: ConnectAgentAppOptions
): Promise< void > {
	return withAgentPluginsLock( () => connectAgentAppUnlocked( id, options ) );
}

async function connectAgentAppUnlocked(
	id: AgentAppId,
	options: ConnectAgentAppOptions
): Promise< void > {
	const state = await readRefreshState( getMarketplacePath() );
	const bundled = await readPluginVersion( getBundledMarketplacePath( options ) );
	const hasPlugin =
		id === 'cursor'
			? !! ( await readCursorPlugin() ) || ( await claudeCodeHasPlugin() )
			: await getCliPlans( getMarketplacePath() )[ id ].hasPlugin();
	if ( await getUpdateStatus( id, hasPlugin, bundled, state ) ) {
		const marketplace = await writeMarketplace( options );
		const updateState: RefreshState = state ?? { version: bundled!, pending: [] };
		if ( ! updateState.pending.includes( id ) ) {
			updateState.pending.push( id );
		}
		await writeRefreshState( marketplace, updateState );
		await updateAgentPlugin( id, marketplace );
		updateState.pending = updateState.pending.filter( ( app ) => app !== id );
		await writeRefreshState( marketplace, updateState );
		return;
	}
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
	if ( ! hasPlugin ) {
		await installWithCli( id, plan, cli, options );
	}
}

async function updateAgentPlugin( id: AgentAppId, marketplace: string ): Promise< void > {
	if ( id === 'cursor' ) {
		await installCursorPlugin( marketplace );
		return;
	}
	const plan = getCliPlans( marketplace )[ id ];
	const app = await findCli( plan );
	if ( ! app ) {
		throw new Error(
			sprintf( __( '%s isn’t installed on this computer.' ), AGENT_APP_NAMES[ id ] )
		);
	}
	const installed = await plan.hasPlugin();
	const env = { ...process.env, PATH: await getSearchPath() };
	for ( const args of installed ? plan.updates : plan.steps ) {
		const { failed, output } = await runCli( app, args, env );
		if ( failed && ( installed || ! ALREADY_DONE.test( output ) ) ) {
			throw new Error(
				sprintf(
					// translators: %1$s: an agent app. %2$s: the app's error message.
					__( '%1$s couldn’t update the WordPress Studio plugin: %2$s' ),
					AGENT_APP_NAMES[ id ],
					output.split( '\n' ).pop() || __( 'Unknown error' )
				)
			);
		}
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
	// Checked before taking the lock too, which writes to the config directory:
	// most starts have nothing to refresh.
	if ( ! ( await readRefreshWork( cli ) ) ) {
		return;
	}
	return withAgentPluginsLock( () => refreshAgentPluginsUnlocked( cli ) );
}

async function readRefreshWork(
	cli: StudioCli
): Promise< { previous: RefreshState; bundled: string } | undefined > {
	const previous = await readRefreshState( getMarketplacePath() );
	const bundled = await readPluginVersion( getBundledMarketplacePath( cli ) );
	if (
		! previous ||
		! bundled ||
		( ! isOlderVersion( previous.version, bundled ) && ! previous.pending.length )
	) {
		return undefined;
	}
	return { previous, bundled };
}

async function refreshAgentPluginsUnlocked( cli: StudioCli ): Promise< void > {
	const work = await readRefreshWork( cli );
	if ( ! work ) {
		return;
	}
	const { previous, bundled } = work;
	const marketplace = await writeMarketplace( cli );
	const plans = getCliPlans( marketplace );
	const state: RefreshState = {
		version: bundled,
		pending: previous.version === bundled ? [ ...previous.pending ] : [],
	};
	if ( previous.version !== bundled ) {
		for ( const id of AGENT_APP_IDS ) {
			if ( isOlderVersion( bundled, await getInstalledPluginVersion( id ) ) ) {
				continue;
			}
			const installed =
				id === 'cursor'
					? !! ( await readCursorPlugin() )
					: ( await plans[ id ].hasPlugin() ) && !! ( await findCli( plans[ id ] ) );
			if ( installed || previous.pending.includes( id ) ) {
				state.pending.push( id );
			}
		}
	}
	// Record the work before Grok's uninstall, so a failed reinstall can recover.
	await writeRefreshState( marketplace, state );
	const errors: Error[] = [];
	for ( const id of [ ...state.pending ] ) {
		try {
			if ( ! isOlderVersion( bundled, await getInstalledPluginVersion( id ) ) ) {
				await updateAgentPlugin( id, marketplace );
			}
			state.pending = state.pending.filter( ( app ) => app !== id );
			await writeRefreshState( marketplace, state );
		} catch ( error ) {
			errors.push( error instanceof Error ? error : new Error( String( error ) ) );
		}
	}
	if ( errors.length ) {
		throw new Error( errors.map( ( error ) => error.message ).join( '\n' ) );
	}
}
