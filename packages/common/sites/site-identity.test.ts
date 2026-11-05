import EventEmitter from 'node:events';
import { expect, it, vi } from 'vitest';
import { readGlobalStyles } from './site-identity';
import type { ExecuteCliCommand } from '../lib/cli-process';

it.each( [ { settings: {}, styles: {} }, null ] )(
	'reads WordPress global styles, including unsupported classic themes: %j',
	async ( styles ) => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
		const result = readGlobalStyles( execute, '/sites/example' );
		emitter.emit( 'success', { result: { stdout: JSON.stringify( styles ) } } );
		expect( await result ).toEqual( styles );
		expect( execute ).toHaveBeenCalledWith(
			[ 'wp', '--path', '/sites/example', 'studio', 'get-global-styles' ],
			{ output: 'capture' }
		);
	}
);

it( 'rejects a command failure so the UI can offer a retry', async () => {
	const emitter = new EventEmitter();
	const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
	const result = readGlobalStyles( execute, '/sites/example' );
	emitter.emit( 'failure', { error: new Error( 'Could not read styles' ) } );
	await expect( result ).rejects.toThrow( 'Could not read styles' );
} );
