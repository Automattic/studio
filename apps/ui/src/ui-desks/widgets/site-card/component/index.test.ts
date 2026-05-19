import { describe, expect, it } from 'vitest';
import { parseSiteIdentitySettings } from './settings';

describe( 'parseSiteIdentitySettings', () => {
	it( 'decodes WordPress settings entities for editable identity text', () => {
		const settings = parseSiteIdentitySettings( {
			title: 'Research &amp; Development',
			description: 'Build &amp; ship',
			site_icon: 42,
			site_icon_url: 'https://example.com/icon.png',
		} );

		expect( settings ).toEqual( {
			title: 'Research & Development',
			tagline: 'Build & ship',
			siteIconId: 42,
			siteIconUrl: 'https://example.com/icon.png',
		} );
	} );
} );
