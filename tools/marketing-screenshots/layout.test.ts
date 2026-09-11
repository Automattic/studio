import { describe, expect, it } from 'vitest';
import {
	addPanelLayoutSearchParams,
	parseEffectivePanelLayout,
	parsePreviewPanelState,
	parsePreviewWidthRatio,
	parseSidebarPanelState,
	parseSidebarWidth,
} from './layout.ts';

describe( 'panel layout CLI values', () => {
	it( 'accepts values inside the documented bounds', () => {
		expect( parsePreviewWidthRatio( '0.2' ) ).toBe( 0.2 );
		expect( parsePreviewWidthRatio( '0.8' ) ).toBe( 0.8 );
		expect( parseSidebarWidth( '240' ) ).toBe( 240 );
		expect( parseSidebarWidth( '600' ) ).toBe( 600 );
		expect( parsePreviewPanelState( 'closed' ) ).toBe( 'closed' );
		expect( parseSidebarPanelState( 'collapsed' ) ).toBe( 'collapsed' );
	} );

	it( 'rejects out-of-range and malformed values', () => {
		expect( () => parsePreviewWidthRatio( '0.19' ) ).toThrow( '0.2 through 0.8' );
		expect( () => parsePreviewWidthRatio( 'wide' ) ).toThrow( '0.2 through 0.8' );
		expect( () => parseSidebarWidth( '239' ) ).toThrow( '240 through 600' );
		expect( () => parseSidebarWidth( '320.5' ) ).toThrow( 'integer' );
		expect( () => parsePreviewPanelState( 'expanded' ) ).toThrow( 'open or closed' );
		expect( () => parseSidebarPanelState( 'open' ) ).toThrow( 'expanded or collapsed' );
	} );
} );

describe( 'panel layout query parameters', () => {
	it( 'adds no parameters when no overrides were requested', () => {
		const url = new URL( 'http://127.0.0.1/?scenario=site-overview&theme=light' );
		addPanelLayoutSearchParams( url, {} );

		expect( url.search ).toBe( '?scenario=site-overview&theme=light' );
	} );

	it( 'forwards every requested override with the agreed names', () => {
		const url = new URL( 'http://127.0.0.1/' );
		addPanelLayoutSearchParams( url, {
			previewWidthRatio: 0.42,
			sidebarWidth: 360,
			preview: 'open',
			sidebar: 'collapsed',
		} );

		expect( Object.fromEntries( url.searchParams ) ).toEqual( {
			previewWidthRatio: '0.42',
			sidebarWidth: '360',
			preview: 'open',
			sidebar: 'collapsed',
		} );
	} );
} );

describe( 'effective panel layout metadata', () => {
	it( 'validates and returns the metadata exposed by the UI', () => {
		expect(
			parseEffectivePanelLayout( {
				sidebar: { state: 'expanded', width: 320 },
				preview: {
					state: 'open',
					requestedWidthRatio: 0.4,
					contentWidth: 640,
					width: 430.5,
				},
			} )
		).toEqual( {
			sidebar: { state: 'expanded', width: 320 },
			preview: {
				state: 'open',
				requestedWidthRatio: 0.4,
				contentWidth: 640,
				width: 430.5,
			},
		} );
	} );

	it( 'rejects absent or malformed UI metadata', () => {
		expect( () => parseEffectivePanelLayout( undefined ) ).toThrow( 'did not expose' );
		expect( () =>
			parseEffectivePanelLayout( {
				sidebar: { state: 'visible', width: 320 },
				preview: { state: 'open', requestedWidthRatio: 0.4, contentWidth: 640, width: 430 },
			} )
		).toThrow( 'invalid sidebar panel state' );
	} );
} );
