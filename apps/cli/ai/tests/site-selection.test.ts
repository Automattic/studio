import { describe, expect, it } from 'vitest';
import { formatActiveSitePrefix } from 'cli/ai/site-selection';
import { loadSkills } from 'cli/ai/skills';

describe( 'formatActiveSitePrefix', () => {
	it( 'names the remote skill for a WordPress.com site', () => {
		const prefix = formatActiveSitePrefix( {
			name: 'Franklin Works',
			path: '',
			remote: true,
			url: 'https://example.wordpress.com',
			wpcomSiteId: 123,
		} as Parameters< typeof formatActiveSitePrefix >[ 0 ] );

		expect( prefix ).toBe(
			'[Active site: "Franklin Works" (ID: 123) at https://example.wordpress.com (WordPress.com, live: load the edit-manage-remote-site skill before working on it)]'
		);
		expect( loadSkills().map( ( skill ) => skill.name ) ).toContain( 'edit-manage-remote-site' );
	} );

	it( 'leaves a local site line without a skill', () => {
		const prefix = formatActiveSitePrefix( {
			name: 'Local',
			path: '/nonexistent/local',
			running: true,
		} as Parameters< typeof formatActiveSitePrefix >[ 0 ] );

		expect( prefix ).toBe( '[Active site: "Local" at /nonexistent/local (running)]' );
	} );
} );
