import {
	decodeStaticSiteImportReceipt,
	staticSiteImportQualityFailure,
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
		expect(
			staticSiteImportReceiptError( {
				response: { error: { code: 'static_site_importer_quality_failed' } },
			} )
		).toContain(
			'The site and staged request were preserved: static_site_importer_quality_failed'
		);
		expect( staticSiteImportReceiptError( undefined ) ).toBe( '' );
	} );

	it( 'reports failed quality validation and accepts a passing import', () => {
		expect(
			staticSiteImportQualityFailure( {
				response: {
					result: {
						import_validation_result: {
							status: 'failed',
							failure_reasons: [ 'raw_html' ],
							raw_html_count: 2,
						},
					},
				},
			} )
		).toBe( 'SSI reported 2 raw_html failures. Review the importer diagnostics and retry.' );
		expect(
			staticSiteImportQualityFailure( {
				response: { import_report_summary: { quality_pass: false, fallback_count: 3 } },
			} )
		).toBe( 'SSI reported 3 fallback blocks. Review the importer diagnostics and retry.' );
		expect(
			staticSiteImportQualityFailure( {
				response: { result: { import_validation_result: { status: 'passed' } } },
			} )
		).toBeUndefined();
	} );
} );
