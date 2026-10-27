import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { captureCommandOutput, captureConsoleOutput } from 'cli/ai/tools/utils';

// A command that prints its lines with waits between them, so commands run
// side by side print in turn, as tool calls the agent makes at once do.
const command = ( name: string, waits: number[] ) => async () => {
	for ( const wait of waits ) {
		await sleep( wait );
		console.log( `${ name } ${ wait }` );
	}
	console.table( [ { name } ] );
};

describe( 'capturing what a command prints', () => {
	it( 'gives each of the calls running at once the lines its own command printed', async () => {
		const [ list, info, previews ] = await Promise.all( [
			captureConsoleOutput( command( 'list', [ 30, 1 ] ) ),
			captureConsoleOutput( command( 'info', [ 1, 20 ] ) ),
			captureCommandOutput( command( 'previews', [ 10, 10 ] ) ),
		] );
		// Its lines, then its table, rendered and printed with console.log.
		const expectPrinted = ( output: string, name: string, waits: number[] ) => {
			const lines = waits.map( ( wait ) => `${ name } ${ wait }\n` ).join( '' );
			expect( output.slice( 0, lines.length ) ).toBe( lines );
			expect( output.slice( lines.length ) ).toContain( `'${ name }'` );
		};
		expectPrinted( list, 'list', [ 30, 1 ] );
		expectPrinted( info, 'info', [ 1, 20 ] );
		expectPrinted( previews.consoleOutput, 'previews', [ 10, 10 ] );
		expect( list + info ).not.toContain( 'previews' );
	} );

	it( 'leaves what is printed outside a call to the console', async () => {
		const printed = vi.fn();
		console.log = printed;
		const running = captureConsoleOutput( command( 'list', [ 20 ] ) );
		await sleep( 5 );
		console.log( 'the agent' );
		expect( ( await running ).split( '\n', 1 ) ).toEqual( [ 'list 20' ] );
		console.log( 'after' );
		expect( printed.mock.calls ).toEqual( [ [ 'the agent' ], [ 'after' ] ] );
	} );
} );
