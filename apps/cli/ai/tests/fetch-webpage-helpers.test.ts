import { describe, expect, it } from 'vitest';
import { extractPageText, isFetchableUrl, normalizeUrl } from '../tools/fetch-webpage-helpers';

describe( 'normalizeUrl', () => {
	it( 'keeps an explicit scheme', () => {
		expect( normalizeUrl( 'https://example.com/about' ) ).toBe( 'https://example.com/about' );
	} );

	it( 'defaults a missing scheme to https', () => {
		expect( normalizeUrl( 'example.com' ) ).toBe( 'https://example.com/' );
	} );

	it( 'trims surrounding whitespace', () => {
		expect( normalizeUrl( '  example.com  ' ) ).toBe( 'https://example.com/' );
	} );

	it( 'returns null for empty input', () => {
		expect( normalizeUrl( '   ' ) ).toBeNull();
	} );
} );

describe( 'isFetchableUrl', () => {
	it( 'allows public http(s) hosts', () => {
		expect( isFetchableUrl( 'https://example.com/' ) ).toBe( true );
		expect( isFetchableUrl( 'http://stripe.com/pricing' ) ).toBe( true );
	} );

	it( 'rejects non-http(s) schemes', () => {
		expect( isFetchableUrl( 'file:///etc/passwd' ) ).toBe( false );
		expect( isFetchableUrl( 'ftp://example.com/' ) ).toBe( false );
		expect( isFetchableUrl( 'data:text/html,<h1>hi</h1>' ) ).toBe( false );
	} );

	it( 'rejects localhost and the .localhost suffix', () => {
		expect( isFetchableUrl( 'http://localhost:8080/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://studio.localhost/' ) ).toBe( false );
	} );

	it( 'rejects bare single-label hosts', () => {
		expect( isFetchableUrl( 'http://intranet/' ) ).toBe( false );
	} );

	it( 'rejects private and reserved IPv4 literals', () => {
		expect( isFetchableUrl( 'http://127.0.0.1/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://10.0.0.5/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://172.16.0.1/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://192.168.1.1/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://169.254.169.254/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://100.64.0.1/' ) ).toBe( false );
	} );

	it( 'allows a public IPv4 literal', () => {
		expect( isFetchableUrl( 'http://93.184.216.34/' ) ).toBe( true );
	} );

	it( 'rejects loopback and link-local IPv6 literals', () => {
		expect( isFetchableUrl( 'http://[::1]/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://[fe80::1]/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://[fc00::1]/' ) ).toBe( false );
		expect( isFetchableUrl( 'http://[::ffff:127.0.0.1]/' ) ).toBe( false );
	} );
} );

describe( 'extractPageText', () => {
	const html = `
		<html>
			<head>
				<title>Acme Candy &amp; Co.</title>
				<meta name="description" content="Artisanal sweets, hand made." />
				<script>console.log('ignore me');</script>
				<style>.x{color:red}</style>
			</head>
			<body>
				<h1>Welcome to Acme</h1>
				<main>
					<h2>Our Sweets</h2>
					<p>We craft small-batch confections using time-honored techniques and the very best ingredients available.</p>
					<p>short</p>
				</main>
				<footer>© 2026 Acme Candy</footer>
			</body>
		</html>`;

	it( 'surfaces title, description, headings, substantive paragraphs, and footer', () => {
		const text = extractPageText( html );
		expect( text ).toContain( 'TITLE: Acme Candy & Co.' );
		expect( text ).toContain( 'DESCRIPTION: Artisanal sweets, hand made.' );
		expect( text ).toContain( 'H1: Welcome to Acme' );
		expect( text ).toContain( 'H2: Our Sweets' );
		expect( text ).toContain( 'P: We craft small-batch confections' );
		expect( text ).toContain( 'FOOTER: © 2026 Acme Candy' );
	} );

	it( 'drops script and style contents', () => {
		const text = extractPageText( html );
		expect( text ).not.toContain( 'ignore me' );
		expect( text ).not.toContain( 'color:red' );
	} );

	it( 'skips paragraphs shorter than 40 characters', () => {
		const text = extractPageText( html );
		expect( text ).not.toContain( 'P: short' );
	} );

	it( 'returns an empty string for an SPA shell with no readable copy', () => {
		expect( extractPageText( '<html><body><div id="root"></div></body></html>' ) ).toBe( '' );
	} );
} );
