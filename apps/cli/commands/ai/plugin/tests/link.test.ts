import { vi } from 'vitest';
import { runCommand } from '../link';

const mockLinkPlugin = vi.fn();

vi.mock( 'cli/ai/plugin-manager', () => ( {
	AiPluginManager: class {
		linkPlugin = mockLinkPlugin;
	},
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
	sprintf: ( str: string, ...args: string[] ) => {
		let result = str;
		args.forEach( ( arg, i ) => {
			result = result.replace( `%${ i + 1 }$s`, arg );
		} );
		return result;
	},
} ) );

describe( 'Plugin Link Command', () => {
	let consoleOutput: string;

	beforeEach( () => {
		vi.clearAllMocks();
		consoleOutput = '';
		vi.spyOn( console, 'log' ).mockImplementation( ( ...args: unknown[] ) => {
			consoleOutput += args.map( String ).join( ' ' ) + '\n';
		} );
	} );

	it( 'links a plugin', async () => {
		mockLinkPlugin.mockResolvedValue( undefined );

		await runCommand( 'data-liberation', '/path/to/checkout' );
		expect( mockLinkPlugin ).toHaveBeenCalledWith( 'data-liberation', '/path/to/checkout' );
		expect( consoleOutput ).toContain( 'Linked' );
	} );

	it( 'throws for invalid path', async () => {
		mockLinkPlugin.mockRejectedValue( new Error( 'No .claude-plugin/plugin.json found' ) );

		await expect( runCommand( 'data-liberation', '/bad/path' ) ).rejects.toThrow(
			'.claude-plugin/plugin.json'
		);
	} );
} );
