import { describe, expect, it } from 'vitest';
import { getSitePreviewPathFromContentLink } from './preview-target';

describe( 'getSitePreviewPathFromContentLink', () => {
	it( 'stores only path, query, and hash for absolute content links', () => {
		expect(
			getSitePreviewPathFromContentLink( 'http://localhost:8881/about/team/?view=card#bio' )
		).toBe( '/about/team/?view=card#bio' );
	} );

	it( 'removes the internal preview flag from content links', () => {
		expect(
			getSitePreviewPathFromContentLink(
				'https://example.test/post/?studio_desk_preview=1&foo=bar'
			)
		).toBe( '/post/?foo=bar' );
	} );

	it( 'normalizes relative links against the provided site URL', () => {
		expect( getSitePreviewPathFromContentLink( 'contact', 'http://localhost:8881' ) ).toBe(
			'/contact'
		);
	} );
} );
