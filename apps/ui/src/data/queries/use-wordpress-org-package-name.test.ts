import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWordPressOrgPackageName } from './use-wordpress-org-package-name';

describe( 'fetchWordPressOrgPackageName', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'returns the canonical package name from WordPress.org', async () => {
		const fetchMock = vi.fn().mockResolvedValue( {
			ok: true,
			json: async () => ( { name: 'Query Monitor' } ),
		} );
		vi.stubGlobal( 'fetch', fetchMock );

		await expect( fetchWordPressOrgPackageName( 'plugin', 'query-monitor' ) ).resolves.toBe(
			'Query Monitor'
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=query-monitor'
		);
	} );

	it( 'decodes HTML entities in package names', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( { name: 'Jetpack &#8211; Security &amp; Backup' } ),
			} )
		);

		await expect( fetchWordPressOrgPackageName( 'plugin', 'jetpack' ) ).resolves.toBe(
			'Jetpack – Security & Backup'
		);
	} );
} );
