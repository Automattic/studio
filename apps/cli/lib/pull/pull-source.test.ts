import { describe, expect, it } from 'vitest';
import { getReprintApiUrlForSite } from './pull-source';

describe( 'getReprintApiUrlForSite', () => {
	it.each( [
		[
			'https://example.wpcomstaging.com/',
			'https://example.wpcomstaging.com/?reprint-api-jetpack',
		],
		// WordPress.com lists a new site under the http:// address it was created with.
		[ 'http://example.wpcomstaging.com/', 'https://example.wpcomstaging.com/?reprint-api-jetpack' ],
	] )( 'points %s at its HTTPS exporter', ( siteUrl, apiUrl ) => {
		expect( getReprintApiUrlForSite( siteUrl ) ).toBe( apiUrl );
	} );
} );
