import {
	createDefaultDeskSettings,
	normalizeDeskSettings,
	normalizeDeskToolbarLayout,
} from '../desk-settings';

describe( 'desk settings', () => {
	it( 'creates default global desk settings', () => {
		expect( createDefaultDeskSettings( '2026-05-11T00:00:00.000Z' ) ).toEqual( {
			version: 1,
			updatedAt: '2026-05-11T00:00:00.000Z',
			showSiteName: true,
			toolbarLayout: {
				left: [],
				right: [],
			},
		} );
	} );

	it( 'normalizes persisted toolbar layouts as deduped string arrays', () => {
		expect(
			normalizeDeskToolbarLayout( {
				left: [ 'settings', 'chat', 'chat', null, 'unknown' ],
				right: [ 'create', 'settings', '' ],
			} )
		).toEqual( {
			left: [ 'settings', 'chat', 'unknown' ],
			right: [ 'create' ],
		} );
	} );

	it( 'falls back to an empty toolbar layout for invalid persisted shapes', () => {
		expect( normalizeDeskToolbarLayout( { left: [ 'chat' ], right: 'settings' } ) ).toEqual( {
			left: [],
			right: [],
		} );
	} );

	it( 'normalizes saved settings', () => {
		const settings = normalizeDeskSettings( {
			version: 999,
			updatedAt: '2026-05-11T00:00:00.000Z',
			showSiteName: true,
			toolbarLayout: {
				left: [ 'settings' ],
				right: [ 'chat', 'create', 'site-map' ],
			},
		} );

		expect( settings ).toEqual( {
			version: 1,
			updatedAt: '2026-05-11T00:00:00.000Z',
			showSiteName: true,
			toolbarLayout: {
				left: [ 'settings' ],
				right: [ 'chat', 'create', 'site-map' ],
			},
		} );
	} );
} );
