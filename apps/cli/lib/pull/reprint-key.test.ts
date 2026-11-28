import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateReprintKey } from './reprint-key';

describe( 'loadOrCreateReprintKey', () => {
	const roots: string[] = [];
	afterEach( () => roots.splice( 0 ).forEach( ( r ) => fs.rmSync( r, { recursive: true } ) ) );

	it( 'gives pulls started together one key, which signs for the public key it reports', async () => {
		const root = fs.mkdtempSync( path.join( os.tmpdir(), 'reprint-key-' ) );
		roots.push( root );
		const keyPath = path.join( root, 'nested', 'reprint-key.pem' );

		const publicKeys = await Promise.all(
			[ 1, 2, 3 ].map( () => loadOrCreateReprintKey( keyPath ) )
		);

		expect( new Set( publicKeys ).size ).toBe( 1 );
		expect( fs.readdirSync( path.dirname( keyPath ) ) ).toEqual( [ 'reprint-key.pem' ] );
		const publicKey = crypto.createPublicKey( {
			key: Buffer.from( publicKeys[ 0 ], 'base64' ),
			format: 'der',
			type: 'spki',
		} );
		const signature = crypto.sign(
			'sha256',
			Buffer.from( 'x' ),
			fs.readFileSync( keyPath, 'utf8' )
		);
		expect( crypto.verify( 'sha256', Buffer.from( 'x' ), publicKey, signature ) ).toBe( true );
		expect( await loadOrCreateReprintKey( keyPath ) ).toBe( publicKeys[ 0 ] );
	} );
} );
