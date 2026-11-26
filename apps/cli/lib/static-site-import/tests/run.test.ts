import {
	decodeStaticSiteImportReceipt,
	staticSiteImportReceiptError,
} from 'cli/lib/static-site-import/run';

describe( 'static site import receipts', () => {
	it( 'decodes the last JSON object line of the importer output', () => {
		expect(
			decodeStaticSiteImportReceipt( 'Importing…\n{"status":"started"}\n{"status":"completed"}\n' )
		).toEqual( { status: 'completed' } );
		expect( decodeStaticSiteImportReceipt( 'Importing…\n[1,2]\n' ) ).toBeUndefined();
	} );

	it( 'describes the error a receipt reports', () => {
		expect(
			staticSiteImportReceiptError( {
				response: { error: { code: 'bad_request', message: 'Missing source' } },
			} )
		).toBe( 'bad_request: Missing source' );
		expect( staticSiteImportReceiptError( undefined ) ).toBe( '' );
	} );
} );
