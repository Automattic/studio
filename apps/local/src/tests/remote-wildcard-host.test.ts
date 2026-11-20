import { describe, expect, it } from 'vitest';
import { startLocalServer } from '../index';
import { baseServerOptions } from './utils/remote-test-utils';

describe( 'remote mode with a wildcard host', () => {
	it.each( [
		'0.0.0.0',
		'::',
		'0:0:0:0:0:0:0:0',
		'',
		'::0',
		'0::0',
		'[::]',
		'0',
		'::ffff:0.0.0.0',
	] )( 'refuses %j before listening', async ( host ) => {
		const attempt = startLocalServer( {
			...baseServerOptions,
			host,
			remote: { label: 'Test Mac', studioVersion: '0.0.0-test' },
		} );
		try {
			await expect( attempt ).rejects.toThrow( 'Remote mode needs one address to listen on' );
		} finally {
			// The refusal must come first; if the server started anyway, do not leave it listening.
			await attempt.then( ( server ) => server.close() ).catch( () => undefined );
		}
	} );
} );
