import { describe, it, expect } from 'vitest';
import { isAbsentDocumentRender } from './absent-document.js';

/** The exact shape captured from https://mint-brand-vote.base44.app/Favorites and
 * /SellerProfile: HTTP 200, a generic fallback template rendered by the client
 * router, parameterized only by the requested route's own name. */
function base44NotFound( routeName: string ): string {
	return `<!DOCTYPE html><html lang="en"><head><title>${ routeName } | LogoMint</title></head>
<body>
<div id="root"><div class="min-h-screen flex items-center justify-center p-6 bg-slate-50"><div class="max-w-md w-full"><div class="text-center space-y-6"><div class="space-y-2"><h1 class="text-7xl font-light text-slate-300">404</h1></div><div class="space-y-3"><h2 class="text-2xl font-medium text-slate-800">Page Not Found</h2><p class="text-slate-600 leading-relaxed">The page <span class="font-medium text-slate-700">"${ routeName }"</span> could not be found in this application.</p></div><div class="pt-6"><button>Go Home</button></div></div></div></div></div>
</body></html>`;
}

describe( 'isAbsentDocumentRender', () => {
	it( 'recognizes the real base44 client-routed not-found screen (HTTP 200, rendered in JS)', () => {
		expect( isAbsentDocumentRender( base44NotFound( 'Favorites' ) ) ).toBe( true );
		expect( isAbsentDocumentRender( base44NotFound( 'SellerProfile' ) ) ).toBe( true );
	} );

	it( 'recognizes a bare 410 heading the same way, matching the HTTP-layer status set', () => {
		expect(
			isAbsentDocumentRender(
				'<html><body><h1>410</h1><p>This resource is gone.</p></body></html>'
			)
		).toBe( true );
	} );

	it( 'does not flag a real page whose heading merely contains the digits, not just them', () => {
		// "Room 404", "404 Handbook" -- the number is part of a larger heading,
		// not the whole of it.
		expect(
			isAbsentDocumentRender( '<html><body><h1>Room 404</h1><p>Check-in at 3pm.</p></body></html>' )
		).toBe( false );
		expect(
			isAbsentDocumentRender(
				'<html><body><h1>404 Handbook</h1><p>A field guide to HTTP status codes, ' +
					'their history, and how servers use them in practice every day.</p></body></html>'
			)
		).toBe( false );
	} );

	it( 'does not flag a real page that mentions 404 in prose but not as a whole heading', () => {
		expect(
			isAbsentDocumentRender(
				'<html><body><h1>Troubleshooting guide</h1><p>If you see a 404, check the URL and try again. ' +
					'Contact support if the problem persists after reloading the page.</p></body></html>'
			)
		).toBe( false );
	} );

	it( 'does not flag a genuinely minimal real page that has no absent-document heading', () => {
		// The real "Access Denied" / "Sign in to vote" empty states captured from
		// the same base44 app: short, but never headed with just "404"/"410".
		expect(
			isAbsentDocumentRender( '<html><body><h1>Access Denied</h1></body></html>' )
		).toBe( false );
		expect(
			isAbsentDocumentRender( '<html><body><h2>Sign in to Vote</h2></body></html>' )
		).toBe( false );
	} );

	it( 'does not flag a long real page merely because a heading somewhere says 404', () => {
		const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat( 12 );
		expect(
			isAbsentDocumentRender(
				`<html><body><h1>404</h1><p>${ paragraph }</p></body></html>`
			)
		).toBe( false );
	} );

	it( 'does not flag an empty document', () => {
		expect( isAbsentDocumentRender( '<html><body></body></html>' ) ).toBe( false );
	} );
} );
