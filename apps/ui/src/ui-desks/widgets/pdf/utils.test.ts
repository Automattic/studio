import { describe, expect, it } from 'vitest';
import {
	chromelessPdfUrl,
	createLocalPdfFileUrl,
	formatPdfBytes,
	getPdfTitleFromFilename,
	getPdfTitleFromUrl,
	isPdfUrl,
} from './utils';

describe( 'PDF widget utilities', () => {
	it( 'matches PDF URLs with query strings using the reference rule', () => {
		expect( isPdfUrl( 'https://example.com/report.pdf' ) ).toBe( true );
		expect( isPdfUrl( 'https://example.com/report.pdf?download=1' ) ).toBe( true );
		expect( isPdfUrl( 'https://example.com/report' ) ).toBe( false );
	} );

	it( 'creates friendly PDF titles from filenames and URLs', () => {
		expect( getPdfTitleFromFilename( 'Annual Report.pdf' ) ).toBe( 'Annual Report' );
		expect( getPdfTitleFromUrl( 'https://example.com/files/Annual%20Report.pdf' ) ).toBe(
			'Annual Report'
		);
		expect( getPdfTitleFromUrl( 'not-a-url' ) ).toBe( 'PDF' );
	} );

	it( 'adds chromeless PDF viewer flags while preserving existing hash fragments', () => {
		expect( chromelessPdfUrl( 'https://example.com/report.pdf' ) ).toBe(
			'https://example.com/report.pdf#toolbar=0&navpanes=0&scrollbar=0&statusbar=0'
		);
		expect( chromelessPdfUrl( 'https://example.com/report.pdf#page=2' ) ).toBe(
			'https://example.com/report.pdf#page=2&toolbar=0&navpanes=0&scrollbar=0&statusbar=0'
		);
	} );

	it( 'creates encoded local PDF file URLs', () => {
		expect( createLocalPdfFileUrl( '/Users/example/Documents/My Brief.pdf' ) ).toBe(
			'file:///Users/example/Documents/My%20Brief.pdf'
		);
	} );

	it( 'formats PDF file sizes with the same binary units as the reference', () => {
		expect( formatPdfBytes( 512 ) ).toBe( '512 B' );
		expect( formatPdfBytes( 2.4 * 1024 * 1024 ) ).toBe( '2.4 MB' );
		expect( formatPdfBytes( 12 * 1024 * 1024 ) ).toBe( '12 MB' );
	} );
} );
