/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectAgentApp, detectAgentApps, refreshAgentPlugins } from '../connect-agent-app';

vi.mock( 'node:child_process', () => ( { execFile: vi.fn() } ) );

type Callback = ( error: Error | null, stdout: string, stderr: string ) => void;

const SHELL_BIN = '/shell/bin';
const REPO_PLUGINS = path.resolve( import.meta.dirname, '../../../../plugins' );
const openUrl = vi.fn( async ( _url: string ) => {} );

let home: string;
let studio: { nodeBinary: string; cliBinary: string; openUrl: typeof openUrl };

const marketplace = () => path.join( home, '.studio', 'agent-plugins' );
const readJson = ( ...parts: string[] ) =>
	JSON.parse( fs.readFileSync( path.join( ...parts ), 'utf8' ) );

// What the CLI build puts next to the CLI: the repository's plugins at `version`.
function bundlePlugins( version: string, skill = '# Build a site' ) {
	const bundled = path.join( home, 'cli', 'agent-plugins' );
	fs.rmSync( bundled, { recursive: true, force: true } );
	fs.cpSync( REPO_PLUGINS, bundled, { recursive: true } );
	for ( const manifest of [
		'.claude-plugin',
		'.codex-plugin',
		'.cursor-plugin',
		'.grok-plugin',
	] ) {
		const file = path.join( bundled, 'wp-studio', manifest, 'plugin.json' );
		fs.writeFileSync( file, JSON.stringify( { ...readJson( file ), version } ) );
	}
	fs.writeFileSync( path.join( bundled, 'wp-studio', 'skills', 'build-site', 'SKILL.md' ), skill );
}

beforeEach( () => {
	vi.clearAllMocks();
	home = fs.mkdtempSync( path.join( os.tmpdir(), 'connect-agent-app-' ) );
	vi.spyOn( os, 'homedir' ).mockReturnValue( home );
	for ( const name of [
		'CLAUDE_CONFIG_DIR',
		'CODEX_HOME',
		'GROK_HOME',
		'DEV_CONFIG_DIR',
		'E2E',
	] ) {
		vi.stubEnv( name, undefined );
	}
	studio = { nodeBinary: '/studio/node', cliBinary: path.join( home, 'cli', 'main.mjs' ), openUrl };
	bundlePlugins( '2.1.1' );
	mockCli();
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	fs.rmSync( home, { recursive: true, force: true } );
} );

// Answers the login shell's PATH, and each CLI call with `answer`.
function mockCli(
	answer: ( args: string[] ) => { error?: boolean; output?: string } = () => ( {} )
) {
	vi.mocked( execFile ).mockImplementation( ( (
		_file: string,
		args: string[],
		_options: unknown,
		callback: Callback
	) => {
		if ( args[ 0 ] === '-ilc' ) {
			callback( null, `noise__STUDIO_PATH__${ SHELL_BIN }__STUDIO_PATH__`, '' );
		} else {
			const { error, output = '' } = answer( args );
			callback( error ? new Error( 'exit 1' ) : null, '', output );
		}
	} ) as unknown as typeof execFile );
}

// Makes these CLIs, and only these, executable; files in the home stay real.
function installCli( ...files: string[] ) {
	const { accessSync, statSync } = fs;
	vi.spyOn( fs, 'accessSync' ).mockImplementation( ( file, mode ) => {
		if ( String( file ).startsWith( home ) ) {
			return accessSync( file, mode );
		}
		if ( ! files.includes( String( file ) ) ) {
			throw new Error( 'ENOENT' );
		}
	} );
	vi.spyOn( fs, 'statSync' ).mockImplementation( ( ( file: fs.PathLike ) =>
		String( file ).startsWith( home )
			? statSync( file )
			: ( { isFile: () => true } as fs.Stats ) ) as typeof fs.statSync );
}

function write( file: string, content: string ) {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, content );
}

// What each app records for the plugin once it installs it.
function recordPlugins( apps = [ 'claude-code', 'codex', 'grok-build' ], version = '2.1.1' ) {
	if ( apps.includes( 'claude-code' ) ) {
		write(
			path.join( home, '.claude', 'plugins', 'installed_plugins.json' ),
			JSON.stringify( {
				version: 2,
				plugins: { 'wp-studio@studio': [ { scope: 'user', version } ] },
			} )
		);
	}
	if ( apps.includes( 'codex' ) ) {
		write(
			path.join( home, '.codex', 'config.toml' ),
			'[plugins."wp-studio@studio"]\nenabled = true\n'
		);
		write(
			path.join(
				home,
				'.codex',
				'plugins',
				'cache',
				'studio',
				'wp-studio',
				version,
				'.codex-plugin',
				'plugin.json'
			),
			JSON.stringify( { name: 'wp-studio', version } )
		);
	}
	if ( apps.includes( 'grok-build' ) ) {
		write(
			path.join( home, '.grok', 'installed-plugins', 'registry.json' ),
			JSON.stringify( {
				version: 1,
				repos: { 'wp-studio-8a7854ad': { plugins: { 'wp-studio': { version } } } },
			} )
		);
	}
}

const cliCalls = () =>
	vi
		.mocked( execFile )
		.mock.calls.filter( ( [ , args ] ) => ( args as string[] )[ 0 ] !== '-ilc' )
		.map( ( [ file, args ] ) => [ file, ...( args as string[] ) ] );

describe.skipIf( process.platform === 'win32' )( 'connectAgentApp with an app’s CLI', () => {
	it( 'installs the plugin from Studio’s marketplace, with the app’s CLI from the login shell’s PATH', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/grok` );
		await connectAgentApp( 'claude-code', studio );
		await connectAgentApp( 'grok-build', studio );
		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/claude`, 'plugin', 'marketplace', 'add', marketplace() ],
			[ `${ SHELL_BIN }/claude`, 'plugin', 'install', 'wp-studio@studio' ],
			[
				`${ SHELL_BIN }/grok`,
				'plugin',
				'install',
				path.join( marketplace(), 'wp-studio' ),
				'--trust',
			],
		] );
		const [ , , options ] = vi.mocked( execFile ).mock.calls.at( -1 )!;
		expect( ( options as { env: NodeJS.ProcessEnv } ).env.PATH ).toContain( SHELL_BIN );
	} );

	it( 'writes a marketplace whose plugin starts this Studio’s CLI in every app', async () => {
		installCli( `${ SHELL_BIN }/codex` );
		await connectAgentApp( 'codex', studio );
		const plugin = path.join( marketplace(), 'wp-studio' );
		const server = {
			command: '/studio/node',
			args: [ studio.cliBinary, 'mcp' ],
			env: { STUDIO_PLUGIN_ID: 'wp-studio@studio', STUDIO_PLUGIN_VERSION: '2.1.1' },
		};
		for ( const manifest of [ '.claude-plugin', '.cursor-plugin' ] ) {
			expect( readJson( plugin, manifest, 'plugin.json' ).mcpServers ).toEqual( {
				'wordpress-studio': server,
			} );
		}
		expect( readJson( plugin, '.grok-plugin', 'mcp.json' ) ).toEqual( {
			mcpServers: { 'wordpress-studio': server },
		} );
		const codex = readJson( plugin, '.mcp.json' ).mcpServers[ 'wordpress-studio' ];
		expect( codex ).toMatchObject( { ...server, startup_timeout_sec: 600 } );
		expect( codex.env_vars ).toContain( 'HOME' );
		expect( codex.cwd ).toBeUndefined();
		expect(
			readJson( plugin, '.codex-plugin', 'plugin.json' ).interface.screenshots
		).toBeUndefined();
		expect( readJson( plugin, '.claude-plugin', 'plugin.json' ).version ).toBe( '2.1.1' );
		expect( fs.readdirSync( path.dirname( marketplace() ) ) ).toEqual( [ 'agent-plugins' ] );
	} );

	it( 'leaves an app that already has the plugin alone', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex`, `${ SHELL_BIN }/grok` );
		recordPlugins();
		for ( const id of [ 'claude-code', 'codex', 'grok-build' ] as const ) {
			await connectAgentApp( id, studio );
		}
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'carries on past a marketplace or plugin the app already has', async () => {
		installCli( `${ SHELL_BIN }/codex` );
		mockCli( ( args ) =>
			args[ 1 ] === 'marketplace'
				? { error: true, output: 'Marketplace `studio` is already added from https://github.com/x' }
				: {}
		);
		await expect( connectAgentApp( 'codex', studio ) ).resolves.toBeUndefined();
		expect( cliCalls() ).toHaveLength( 2 );
	} );

	it( 'serializes connections to different apps and removes their staging files', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex` );
		await Promise.all( [
			connectAgentApp( 'claude-code', studio ),
			connectAgentApp( 'codex', studio ),
		] );
		expect( cliCalls() ).toHaveLength( 4 );
		expect( fs.readdirSync( path.dirname( marketplace() ) ) ).toEqual( [ 'agent-plugins' ] );
	} );

	it( 'reports the app’s error', async () => {
		installCli( `${ SHELL_BIN }/claude` );
		mockCli( ( args ) =>
			args[ 1 ] === 'install' ? { error: true, output: 'Installing…\nError: network down' } : {}
		);
		await expect( connectAgentApp( 'claude-code', studio ) ).rejects.toThrow(
			'Claude Code couldn’t install the WordPress Studio plugin: Error: network down'
		);
		await expect( connectAgentApp( 'cursor', studio ) ).resolves.toBeUndefined();
	} );

	it( 'reports an app that isn’t installed', async () => {
		installCli();
		await expect( connectAgentApp( 'codex', studio ) ).rejects.toThrow(
			'ChatGPT isn’t installed on this computer.'
		);
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'tells which apps have the plugin from their records', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/grok` );
		write(
			path.join( home, '.grok', 'installed-plugins', 'registry.json' ),
			JSON.stringify( { repos: { 'wp-studio-8a7854ad': { plugins: { 'wp-studio': {} } } } } )
		);
		const apps = await detectAgentApps( studio );
		expect( apps.find( ( app ) => app.id === 'grok-build' ) ).toEqual( {
			id: 'grok-build',
			installed: true,
			connected: true,
		} );
		expect( apps.find( ( app ) => app.id === 'claude-code' ) ).toEqual( {
			id: 'claude-code',
			installed: true,
			connected: false,
		} );
		expect( apps.find( ( app ) => app.id === 'codex' )?.installed ).toBe( false );
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'offers updates for older installed plugins, without downgrading newer versions', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex`, `${ SHELL_BIN }/grok` );
		recordPlugins( [ 'claude-code', 'codex' ], '2.0.0' );
		recordPlugins( [ 'grok-build' ], '3.0.0' );
		const apps = await detectAgentApps( studio );
		expect( apps.find( ( app ) => app.id === 'claude-code' )?.updateStatus ).toBe( 'available' );
		expect( apps.find( ( app ) => app.id === 'codex' )?.updateStatus ).toBe( 'available' );
		expect( apps.find( ( app ) => app.id === 'grok-build' )?.updateStatus ).toBeUndefined();
		await connectAgentApp( 'grok-build', studio );
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'uses Codex’s active local cache rather than another cached version', async () => {
		installCli( `${ SHELL_BIN }/codex` );
		recordPlugins( [ 'codex' ], '3.0.0' );
		write(
			path.join(
				home,
				'.codex',
				'plugins',
				'cache',
				'studio',
				'wp-studio',
				'local',
				'.codex-plugin',
				'plugin.json'
			),
			JSON.stringify( { name: 'wp-studio', version: '2.0.0' } )
		);
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'codex' )?.updateStatus
		).toBe( 'available' );
	} );

	it( 'updates only the selected app and exposes a failed update for retry', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex` );
		recordPlugins( [ 'claude-code', 'codex' ], '2.0.0' );
		mockCli( () => ( { error: true, output: 'Error: temporarily busy' } ) );
		await expect( connectAgentApp( 'claude-code', studio ) ).rejects.toThrow( 'couldn’t update' );
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'claude-code' )?.updateStatus
		).toBe( 'failed' );
		vi.mocked( execFile ).mockClear();
		mockCli( ( args ) => {
			if ( args[ 1 ] === 'update' ) {
				recordPlugins( [ 'claude-code' ] );
			}
			return {};
		} );
		await connectAgentApp( 'claude-code', studio );
		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/claude`, 'plugin', 'marketplace', 'update', 'studio' ],
			[ `${ SHELL_BIN }/claude`, 'plugin', 'update', 'wp-studio@studio' ],
		] );
		const apps = await detectAgentApps( studio );
		expect( apps.find( ( app ) => app.id === 'claude-code' )?.updateStatus ).toBeUndefined();
		expect( apps.find( ( app ) => app.id === 'codex' )?.updateStatus ).toBe( 'available' );
		expect( readJson( marketplace(), '.studio-refresh.json' ).pending ).toEqual( [] );
	} );
} );

describe( 'connectAgentApp for Cursor', () => {
	const pluginPage =
		'cursor://anysphere.cursor-deeplink/plugin/add?id=user-local%3AWordPress-Studio';
	const cursorPlugin = () => path.join( home, '.cursor', 'plugins', 'local', 'WordPress-Studio' );

	it( 'installs the plugin as a local plugin, then opens its page', async () => {
		await connectAgentApp( 'cursor', studio );
		expect( readJson( cursorPlugin(), '.cursor-plugin', 'plugin.json' ).mcpServers ).toEqual(
			readJson( marketplace(), 'wp-studio', '.cursor-plugin', 'plugin.json' ).mcpServers
		);
		expect(
			fs.readFileSync( path.join( cursorPlugin(), 'skills', 'build-site', 'SKILL.md' ), 'utf8' )
		).toBe( '# Build a site' );
		expect( fs.readdirSync( path.join( home, '.cursor', 'plugins' ) ) ).toEqual( [ 'local' ] );
		expect( openUrl ).toHaveBeenCalledWith( pluginPage );
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'cursor' )?.connected
		).toBe( true );
	} );

	it( 'installs Cursor’s own copy even when Claude Code has the plugin', async () => {
		recordPlugins( [ 'claude-code' ] );
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'cursor' )?.connected
		).toBe( false );

		await connectAgentApp( 'cursor', studio );
		expect( fs.existsSync( cursorPlugin() ) ).toBe( true );
		expect( openUrl ).toHaveBeenLastCalledWith( pluginPage );
	} );

	it( 'only opens a plugin Cursor already has, and replaces one for another Studio', async () => {
		await connectAgentApp( 'cursor', studio );
		const skill = path.join( cursorPlugin(), 'skills', 'build-site', 'SKILL.md' );
		fs.writeFileSync( skill, 'edited' );

		await connectAgentApp( 'cursor', studio );
		expect( fs.readFileSync( skill, 'utf8' ) ).toBe( 'edited' );

		await connectAgentApp( 'cursor', { ...studio, nodeBinary: '/another/node' } );
		expect( fs.readFileSync( skill, 'utf8' ) ).toBe( '# Build a site' );
		expect( openUrl ).toHaveBeenCalledTimes( 3 );
	} );
} );

describe.skipIf( process.platform === 'win32' )( 'refreshAgentPlugins', () => {
	it( 'does nothing before a first Connect, or for a Studio of the same version', async () => {
		installCli( `${ SHELL_BIN }/codex` );
		recordPlugins( [ 'codex' ] );
		await refreshAgentPlugins( studio );
		expect( fs.existsSync( marketplace() ) ).toBe( false );

		await connectAgentApp( 'cursor', studio );
		await refreshAgentPlugins( { ...studio, nodeBinary: '/another/node' } );
		const manifest = readJson( marketplace(), 'wp-studio', '.claude-plugin', 'plugin.json' );
		expect( manifest.mcpServers[ 'wordpress-studio' ].command ).toBe( '/studio/node' );
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'after an update, rewrites the marketplace and updates the plugin in each app that has it', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex`, `${ SHELL_BIN }/grok` );
		await connectAgentApp( 'cursor', studio );
		recordPlugins( [ 'codex', 'grok-build' ] );
		bundlePlugins( '2.2.0', '# Build a site, updated' );

		await refreshAgentPlugins( studio );

		expect( readJson( marketplace(), 'wp-studio', '.claude-plugin', 'plugin.json' ).version ).toBe(
			'2.2.0'
		);
		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/codex`, 'plugin', 'add', 'wp-studio@studio' ],
			[ `${ SHELL_BIN }/grok`, 'plugin', 'uninstall', 'wp-studio' ],
			[
				`${ SHELL_BIN }/grok`,
				'plugin',
				'install',
				path.join( marketplace(), 'wp-studio' ),
				'--trust',
			],
		] );
		const skill = path.join(
			home,
			'.cursor',
			'plugins',
			'local',
			'WordPress-Studio',
			'skills',
			'build-site',
			'SKILL.md'
		);
		expect( fs.readFileSync( skill, 'utf8' ) ).toBe( '# Build a site, updated' );
	} );

	it( 'updates the plugin in Claude Code and in Cursor’s copy', async () => {
		installCli( `${ SHELL_BIN }/claude` );
		await connectAgentApp( 'cursor', studio );
		recordPlugins( [ 'claude-code' ] );
		bundlePlugins( '2.2.0' );

		await refreshAgentPlugins( studio );

		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/claude`, 'plugin', 'marketplace', 'update', 'studio' ],
			[ `${ SHELL_BIN }/claude`, 'plugin', 'update', 'wp-studio@studio' ],
		] );
		expect(
			fs.existsSync( path.join( home, '.cursor', 'plugins', 'local', 'WordPress-Studio' ) )
		).toBe( true );
		expect(
			readJson(
				path.join( home, '.cursor', 'plugins', 'local', 'WordPress-Studio' ),
				'.cursor-plugin',
				'plugin.json'
			).version
		).toBe( '2.2.0' );
	} );

	it( 'retries only failed apps after an update, then stops once they succeed', async () => {
		installCli( `${ SHELL_BIN }/claude`, `${ SHELL_BIN }/codex` );
		await connectAgentApp( 'cursor', studio );
		recordPlugins( [ 'claude-code', 'codex' ] );
		bundlePlugins( '2.2.0' );
		mockCli( ( args ) =>
			args[ 1 ] === 'update' ? { error: true, output: 'Error: temporarily busy' } : {}
		);

		await expect( refreshAgentPlugins( studio ) ).rejects.toThrow( 'temporarily busy' );
		expect( cliCalls() ).toContainEqual( [
			`${ SHELL_BIN }/codex`,
			'plugin',
			'add',
			'wp-studio@studio',
		] );

		vi.mocked( execFile ).mockClear();
		mockCli();
		await refreshAgentPlugins( studio );
		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/claude`, 'plugin', 'marketplace', 'update', 'studio' ],
			[ `${ SHELL_BIN }/claude`, 'plugin', 'update', 'wp-studio@studio' ],
		] );
		vi.mocked( execFile ).mockClear();
		await refreshAgentPlugins( studio );
		expect( cliCalls() ).toEqual( [] );
	} );

	it( 'recovers Grok after its uninstall succeeds but reinstall fails', async () => {
		installCli( `${ SHELL_BIN }/grok` );
		await connectAgentApp( 'cursor', studio );
		recordPlugins( [ 'grok-build' ] );
		bundlePlugins( '2.2.0' );
		mockCli( ( args ) => {
			if ( args[ 1 ] === 'uninstall' ) {
				fs.rmSync( path.join( home, '.grok', 'installed-plugins', 'registry.json' ) );
				return {};
			}
			return { error: true, output: 'Error: temporarily busy' };
		} );
		await expect( refreshAgentPlugins( studio ) ).rejects.toThrow( 'temporarily busy' );
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'grok-build' )?.connected
		).toBe( false );
		expect(
			( await detectAgentApps( studio ) ).find( ( app ) => app.id === 'grok-build' )?.updateStatus
		).toBe( 'failed' );

		vi.mocked( execFile ).mockClear();
		mockCli();
		await connectAgentApp( 'grok-build', studio );
		expect( cliCalls() ).toEqual( [
			[
				`${ SHELL_BIN }/grok`,
				'plugin',
				'install',
				path.join( marketplace(), 'wp-studio' ),
				'--trust',
			],
		] );
	} );

	it( 'keeps unfinished updates when another app is connected', async () => {
		installCli( `${ SHELL_BIN }/codex`, `${ SHELL_BIN }/grok` );
		await connectAgentApp( 'cursor', studio );
		recordPlugins( [ 'codex' ] );
		bundlePlugins( '2.2.0' );
		mockCli( () => ( { error: true, output: 'Error: temporarily busy' } ) );
		await expect( refreshAgentPlugins( studio ) ).rejects.toThrow( 'temporarily busy' );
		mockCli();
		await connectAgentApp( 'grok-build', studio );
		vi.mocked( execFile ).mockClear();
		await refreshAgentPlugins( studio );
		expect( cliCalls() ).toEqual( [
			[ `${ SHELL_BIN }/codex`, 'plugin', 'add', 'wp-studio@studio' ],
		] );
	} );
} );
