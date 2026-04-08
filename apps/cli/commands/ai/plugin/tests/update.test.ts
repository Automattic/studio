import { vi } from 'vitest';
import { runCommand } from '../update';

const mockUpdate = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockGetDefaultPlugins = vi.fn( () => [
	{ name: 'data-liberation', repo: 'Automattic/data-liberation-agent' },
] );

vi.mock( 'cli/ai/plugin-manager', () => ( {
	AiPluginManager: class {
		update = mockUpdate;
		checkForUpdates = mockCheckForUpdates;
		getDefaultPlugins = mockGetDefaultPlugins;
	},
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
} ) );

describe( 'Plugin Update Command', () => {
	let consoleOutput: string;

	beforeEach( () => {
		vi.clearAllMocks();
		consoleOutput = '';
		vi.spyOn( console, 'log' ).mockImplementation( ( ...args: unknown[] ) => {
			consoleOutput += args.map( String ).join( ' ' ) + '\n';
		} );
	} );

	it( 'updates a plugin', async () => {
		mockUpdate.mockResolvedValue( {
			updated: true,
			oldVersion: 'v0.1.0',
			newVersion: 'v0.2.0',
		} );

		await runCommand( { checkOnly: false } );
		expect( consoleOutput ).toContain( 'v0.1.0' );
		expect( consoleOutput ).toContain( 'v0.2.0' );
	} );

	it( 'reports check-only mode', async () => {
		mockCheckForUpdates.mockResolvedValue( {
			available: true,
			currentVersion: 'v0.1.0',
			latestVersion: 'v0.2.0',
		} );

		await runCommand( { checkOnly: true } );
		expect( consoleOutput ).toContain( 'update available' );
		expect( mockUpdate ).not.toHaveBeenCalled();
	} );

	it( 'reports when already up to date', async () => {
		mockUpdate.mockResolvedValue( { updated: false } );

		await runCommand( { checkOnly: false } );
		expect( consoleOutput ).toContain( 'up to date' );
	} );

	it( 'shows error from update failure', async () => {
		mockUpdate.mockResolvedValue( { updated: false, error: 'Git is required' } );

		await runCommand( { checkOnly: false } );
		expect( consoleOutput ).toContain( 'Git is required' );
	} );
} );
