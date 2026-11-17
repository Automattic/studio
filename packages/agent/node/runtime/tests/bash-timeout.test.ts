import os from 'os';
import { createBashTool } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import { withDefaultTimeout } from '../bash-timeout';

const bash = withDefaultTimeout( createBashTool( os.tmpdir() ), 1 );
const run = ( args: { command: string; timeout?: number } ) =>
	bash.execute( 'call', args, new AbortController().signal ).then(
		( result ) => ( result.content[ 0 ] as { text: string } ).text,
		( error: Error ) => error.message
	);

it.each( [
	{ name: 'a command that ends in time', command: 'echo done', timeout: undefined, output: 'done' },
	{
		name: 'a command past the default',
		command: 'echo started; sleep 5',
		timeout: undefined,
		output: 'Command timed out after 1 seconds',
	},
	{
		name: 'a call that sets a longer timeout',
		command: 'sleep 1.5; echo done',
		timeout: 5,
		output: 'done',
	},
] )( 'runs $name', async ( { command, timeout, output } ) => {
	expect( await run( { command, timeout } ) ).toContain( output );
} );

it( 'states the default in the timeout parameter', () => {
	expect(
		( bash.parameters.properties.timeout as { description?: string } ).description
	).toContain( 'default 1' );
	expect( bash.parameters.required ).toEqual( [ 'command' ] );
} );
