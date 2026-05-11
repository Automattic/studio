import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DESK_TOOLBAR_LAYOUT,
	moveDeskToolbarButton,
	normalizeDeskToolbarLayout,
	normalizeDeskToolbarSettings,
} from './toolbar-layout';

describe( 'desk toolbar layout', () => {
	it( 'normalizes toolbar layouts and appends missing buttons to the right side', () => {
		expect(
			normalizeDeskToolbarLayout( {
				left: [ 'settings', 'chat', 'chat', 'unknown' ],
				right: [ 'create' ],
			} )
		).toEqual( {
			left: [ 'settings', 'chat' ],
			right: [ 'create', 'site-map' ],
		} );
	} );

	it( 'falls back to the default toolbar layout for invalid shapes', () => {
		expect( normalizeDeskToolbarLayout( { left: [ 'chat' ], right: 'settings' } ) ).toEqual(
			DEFAULT_DESK_TOOLBAR_LAYOUT
		);
	} );

	it( 'normalizes persisted settings for toolbar rendering', () => {
		expect(
			normalizeDeskToolbarSettings( {
				version: 1,
				updatedAt: '2026-05-11T00:00:00.000Z',
				showSiteName: true,
				toolbarLayout: {
					left: [ 'settings' ],
					right: [ 'unknown', 'chat' ],
				},
			} )
		).toEqual( {
			version: 1,
			updatedAt: '2026-05-11T00:00:00.000Z',
			showSiteName: true,
			toolbarLayout: {
				left: [ 'settings' ],
				right: [ 'chat', 'create', 'site-map' ],
			},
		} );
	} );

	it( 'moves a toolbar button between sides', () => {
		expect(
			moveDeskToolbarButton( DEFAULT_DESK_TOOLBAR_LAYOUT, 'settings', 'left', 'chat' )
		).toEqual( {
			left: [ 'settings', 'chat', 'create' ],
			right: [ 'site-map' ],
		} );
	} );
} );
