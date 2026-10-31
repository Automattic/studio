import { describe, expect, it } from 'vitest';
import {
	clampResizablePanelWidth,
	getStoredSiteChatVisibility,
	SITE_CHAT_HIDDEN_STORAGE_KEY,
	PREVIEW_OPEN_STORAGE_KEY,
	getPreviewContentWidthStorageKey,
	hasCustomPanelLayout,
	resetPanelLayout,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	getPreviewSplitLayout,
	getResizablePanelMaxWidth,
	type ResizablePanelConfig,
} from '@/data/resizable-panels';

const config: ResizablePanelConfig = {
	defaultWidth: 320,
	minWidth: 240,
	maxWidthRatio: 0.25,
};

describe( 'resizable panels', () => {
	it( 'caps panel width to the configured viewport ratio', () => {
		expect( clampResizablePanelWidth( 500, config, 1200 ) ).toBe( 300 );
	} );

	it( 'does not shrink below the configured minimum width', () => {
		expect( clampResizablePanelWidth( 120, config, 1200 ) ).toBe( 240 );
	} );

	it( 'lets the minimum width win when the viewport ratio is smaller', () => {
		expect( getResizablePanelMaxWidth( 800, config ) ).toBe( 240 );
		expect( clampResizablePanelWidth( 320, config, 800 ) ).toBe( 240 );
	} );
} );

describe( 'getPreviewSplitLayout', () => {
	// Content floor 360, preview floor 360.
	it( 'leaves a comfortable preferred width untouched on a wide frame', () => {
		const layout = getPreviewSplitLayout( 1000, 600 );
		expect( layout.contentWidth ).toBe( 600 );
		expect( layout.previewWidth ).toBe( 400 );
		expect( layout.previewMinWidth ).toBe( 360 );
		expect( layout.previewMaxWidth ).toBe( 640 );
	} );

	it( 'caps content so the preview keeps its minimum width', () => {
		// Preferred content larger than container - previewMin -> clamped down.
		expect( getPreviewSplitLayout( 1000, 900 ).contentWidth ).toBe( 640 );
		expect( getPreviewSplitLayout( 1000, 900 ).previewWidth ).toBe( 360 );
	} );

	it( 'floors content at its minimum so the preview cannot swallow it', () => {
		// This is the regime where the old CSS-only clamp diverged: a preferred
		// content below the 360 floor must be raised to 360, not left as-is.
		expect( getPreviewSplitLayout( 1000, 100 ).contentWidth ).toBe( 360 );
		expect( getPreviewSplitLayout( 1000, 100 ).previewWidth ).toBe( 640 );
	} );

	it.each( [ 320, 540 ] )( 'gives chat the full frame at %ipx', ( width ) => {
		expect( getPreviewSplitLayout( width, 360 ) ).toEqual( {
			contentWidth: width,
			previewWidth: 0,
			previewMinWidth: 0,
			previewMaxWidth: 0,
		} );
	} );

	it( 'splits a frame too narrow for both floors in their proportion, and fixes it', () => {
		const layout = getPreviewSplitLayout( 544, 600 );
		expect( layout.contentWidth ).toBe( 272 );
		expect( layout.previewWidth ).toBe( 272 );
		expect( layout.previewMinWidth ).toBe( 272 );
		expect( layout.previewMaxWidth ).toBe( 272 );
	} );
} );

it( 'detects and resets all site widths and the legacy width', () => {
	localStorage.clear();
	localStorage.setItem( getPreviewContentWidthStorageKey( 'one' ), '500' );
	localStorage.setItem( getPreviewContentWidthStorageKey( 'two' ), '400' );
	localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( { one: true } ) );
	localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
	localStorage.setItem( 'unrelated', 'keep' );
	expect( hasCustomPanelLayout() ).toBe( true );
	localStorage.setItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, '600' );
	resetPanelLayout();
	expect( hasCustomPanelLayout() ).toBe( false );
	expect( localStorage.getItem( getPreviewContentWidthStorageKey( 'one' ) ) ).toBeNull();
	expect( localStorage.getItem( getPreviewContentWidthStorageKey( 'two' ) ) ).toBeNull();
	expect( localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( SITE_CHAT_HIDDEN_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( PREVIEW_OPEN_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( 'unrelated' ) ).toBe( 'keep' );
	localStorage.clear();
} );

it( 'defaults to open for invalid visibility storage and reads only hidden sites', () => {
	for ( const invalid of [ 'broken', 'null', '[]', '42' ] ) {
		localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, invalid );
		expect( getStoredSiteChatVisibility() ).toEqual( {} );
	}
	localStorage.setItem(
		SITE_CHAT_HIDDEN_STORAGE_KEY,
		JSON.stringify( { one: true, two: false, three: 'true' } )
	);
	expect( getStoredSiteChatVisibility() ).toEqual( { one: true } );
	localStorage.removeItem( SITE_CHAT_HIDDEN_STORAGE_KEY );
} );
