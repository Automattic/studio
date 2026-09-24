import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { progressFrom, readCapture, siteNameFrom } from './pipeline.ts';

describe( 'progressFrom', () => {
	it( 'follows the capture, page by page', () => {
		const first = progressFrom( '[liberate] 1/20 https://mysite.com/' );
		expect( first ).toMatchObject( {
			step: 'capture',
			detail: 'Copied 1 of 20 pages',
			counts: { pages: 1 },
		} );
		const last = progressFrom( '[liberate] 20/20 https://mysite.com/about' );
		expect( last!.progress ).toBeGreaterThan( first!.progress! );
		expect( last!.progress ).toBeCloseTo( 0.58 );
	} );

	it( 'names the phase for the messages that carry no count', () => {
		expect( progressFrom( 'Data Liberation 0.5.3' ) ).toMatchObject( { step: 'scan' } );
		expect( progressFrom( '[liberate] discovering' ) ).toMatchObject( { step: 'scan' } );
		expect( progressFrom( '[liberate] finalizing' ) ).toMatchObject( { step: 'capture' } );
		expect( progressFrom( 'Static site import… 12 sec elapsed' ) ).toMatchObject( {
			step: 'import',
		} );
		expect( progressFrom( 'Finalization… 3 sec elapsed' ) ).toMatchObject( { step: 'import' } );
	} );

	it( 'ignores anything else the CLI says', () => {
		expect( progressFrom( 'Creating site…' ) ).toBeUndefined();
		expect( progressFrom( '' ) ).toBeUndefined();
	} );
} );

describe( 'siteNameFrom', () => {
	it.each( [
		[ 'Sonora', 'Sonora' ],
		[ '  Dopple   Creative Studio ', 'Dopple Creative Studio' ],
		[ 'Home | Acme Coffee', 'Acme Coffee' ],
		[ 'Acme Coffee — Home', 'Acme Coffee' ],
		[ 'Acme Coffee - Fresh roasts daily', 'Acme Coffee' ],
		[ 'Imported Site', undefined ],
		[ 'Home', undefined ],
		[ '', undefined ],
		[ null, undefined ],
		[ 'The pooches of Sonora should get their own catwalk', undefined ],
	] )( 'turns %j into %j', ( title, name ) => {
		expect( siteNameFrom( title ) ).toBe( name );
	} );
} );

describe( 'readCapture', () => {
	it( 'reads the source site’s own name and platform from the capture receipt', () => {
		const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'liberate-capture-' ) );
		const receiptDir = path.join( dir, 'mysite.squarespace.com' );
		fs.mkdirSync( receiptDir );
		fs.writeFileSync(
			path.join( receiptDir, 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				title: 'Sonora',
				source: { url: 'https://mysite.squarespace.com/', platform: 'squarespace' },
			} )
		);
		expect( readCapture( dir ) ).toEqual( { title: 'Sonora', platform: 'Squarespace' } );
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'says nothing when there is no capture to read', () => {
		expect( readCapture( path.join( os.tmpdir(), 'liberate-missing' ) ) ).toEqual( {} );
	} );
} );
