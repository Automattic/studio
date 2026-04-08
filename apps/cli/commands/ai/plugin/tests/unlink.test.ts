import { vi } from 'vitest';
import { runCommand } from '../unlink';

const mockUnlinkPlugin = vi.fn();

vi.mock( 'cli/ai/plugin-manager', () => ( {
	AiPluginManager: class {
		unlinkPlugin = mockUnlinkPlugin;
	},
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
	sprintf: ( str: string, ...args: string[] ) => {
		let result = str;
		args.forEach( ( arg, i ) => {
			result = result.replace( `%${ i + 1 }$s`, arg ).replace( '%s', arg );
		} );
		return result;
	},
} ) );

describe( 'Plugin Unlink Command', () => {
	let consoleOutput: string;

	beforeEach( () => {
		vi.clearAllMocks();
		consoleOutput = '';
		vi.spyOn( console, 'log' ).mockImplementation( ( ...args: unknown[] ) => {
			consoleOutput += args.map( String ).join( ' ' ) + '\n';
		} );
	} );

	it( 'unlinks a plugin', async () => {
		mockUnlinkPlugin.mockResolvedValue( undefined );

		await runCommand( 'data-liberation' );
		expect( mockUnlinkPlugin ).toHaveBeenCalledWith( 'data-liberation' );
		expect( consoleOutput ).toContain( 'Unlinked' );
	} );

	it( 'throws for non-linked plugin', async () => {
		mockUnlinkPlugin.mockRejectedValue( new Error( 'Plugin "data-liberation" is not linked.' ) );

		await expect( runCommand( 'data-liberation' ) ).rejects.toThrow( 'is not linked' );
	} );
} );
