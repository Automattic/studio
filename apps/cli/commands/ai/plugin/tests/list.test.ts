import { vi } from 'vitest';
import { runCommand } from '../list';

const mockGetPluginInfo = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockGetDefaultPlugins = vi.fn( () => [
	{ name: 'data-liberation', repo: 'Automattic/data-liberation-agent' },
] );

vi.mock( 'cli/ai/plugin-manager', () => ( {
	AiPluginManager: class {
		getPluginInfo = mockGetPluginInfo;
		checkForUpdates = mockCheckForUpdates;
		getDefaultPlugins = mockGetDefaultPlugins;
	},
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
} ) );

describe( 'Plugin List Command', () => {
	let consoleOutput: string;

	beforeEach( () => {
		vi.clearAllMocks();
		consoleOutput = '';
		vi.spyOn( console, 'log' ).mockImplementation( ( ...args: unknown[] ) => {
			consoleOutput += args.map( String ).join( ' ' ) + '\n';
		} );
	} );

	it( 'shows installed plugin info', async () => {
		mockGetPluginInfo.mockResolvedValue( {
			name: 'data-liberation',
			version: 'v0.1.0',
			source: 'cloned',
			path: '/path/to/plugin',
		} );
		mockCheckForUpdates.mockResolvedValue( { available: false } );

		await runCommand( 'compact' );
		expect( consoleOutput ).toContain( 'data-liberation' );
		expect( consoleOutput ).toContain( 'v0.1.0' );
		expect( consoleOutput ).toContain( 'cloned' );
	} );

	it( 'shows linked plugin info', async () => {
		mockGetPluginInfo.mockResolvedValue( {
			name: 'data-liberation',
			version: null,
			source: 'linked',
			path: '/plugin/dir',
			linkTarget: '/Users/dev/data-liberation-agent',
		} );
		mockCheckForUpdates.mockResolvedValue( { available: false } );

		await runCommand( 'compact' );
		expect( consoleOutput ).toContain( 'linked' );
		expect( consoleOutput ).toContain( '/Users/dev/data-liberation-agent' );
	} );

	it( 'outputs JSON format', async () => {
		mockGetPluginInfo.mockResolvedValue( {
			name: 'data-liberation',
			version: 'v0.1.0',
			source: 'cloned',
			path: '/path/to/plugin',
		} );
		mockCheckForUpdates.mockResolvedValue( {
			available: true,
			currentVersion: 'v0.1.0',
			latestVersion: 'v0.2.0',
		} );

		await runCommand( 'json' );
		const parsed = JSON.parse( consoleOutput.trim() );
		expect( parsed ).toBeInstanceOf( Array );
		expect( parsed[ 0 ].name ).toBe( 'data-liberation' );
		expect( parsed[ 0 ].updateAvailable ).toBe( 'v0.2.0' );
	} );

	it( 'shows message when no plugins installed', async () => {
		mockGetPluginInfo.mockResolvedValue( null );
		mockCheckForUpdates.mockResolvedValue( { available: false } );

		await runCommand( 'compact' );
		expect( consoleOutput ).toContain( 'No AI plugins installed' );
	} );
} );
