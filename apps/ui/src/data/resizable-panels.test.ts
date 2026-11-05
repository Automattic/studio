import { describe, expect, it } from 'vitest';
import {
	clampResizablePanelWidth,
	SITE_CHAT_HIDDEN_STORAGE_KEY,
	LEGACY_PANEL_OPEN_STORAGE_KEY,
	hasCustomPanelLayout,
	resetPanelLayout,
	PANEL_CONTENT_WIDTH_STORAGE_KEY,
	getPanelSplitLayout,
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

describe( 'getPanelSplitLayout', () => {
	// Content floor 360, panel floor 360.
	it( 'leaves a comfortable preferred width untouched on a wide frame', () => {
		const layout = getPanelSplitLayout( 1000, 600 );
		expect( layout.contentWidth ).toBe( 600 );
		expect( layout.panelWidth ).toBe( 400 );
		expect( layout.panelMinWidth ).toBe( 360 );
		expect( layout.panelMaxWidth ).toBe( 640 );
	} );

	it( 'caps content so the panel keeps its minimum width', () => {
		// Preferred content larger than container - panelMin -> clamped down.
		expect( getPanelSplitLayout( 1000, 900 ).contentWidth ).toBe( 640 );
		expect( getPanelSplitLayout( 1000, 900 ).panelWidth ).toBe( 360 );
	} );

	it( 'floors content at its minimum so the panel cannot swallow it', () => {
		// This is the regime where the old CSS-only clamp diverged: a preferred
		// content below the 360 floor must be raised to 360, not left as-is.
		expect( getPanelSplitLayout( 1000, 100 ).contentWidth ).toBe( 360 );
		expect( getPanelSplitLayout( 1000, 100 ).panelWidth ).toBe( 640 );
	} );

	it.each( [ 320, 540 ] )( 'gives chat the full frame at %ipx', ( width ) => {
		expect( getPanelSplitLayout( width, 360 ) ).toEqual( {
			contentWidth: width,
			panelWidth: 0,
			panelMinWidth: 0,
			panelMaxWidth: 0,
		} );
	} );

	it( 'splits a frame too narrow for both floors in their proportion, and fixes it', () => {
		const layout = getPanelSplitLayout( 544, 600 );
		expect( layout.contentWidth ).toBe( 272 );
		expect( layout.panelWidth ).toBe( 272 );
		expect( layout.panelMinWidth ).toBe( 272 );
		expect( layout.panelMaxWidth ).toBe( 272 );
	} );
} );

it( 'detects and resets all site widths and the legacy width', () => {
	localStorage.clear();
	localStorage.setItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:one`, '500' );
	localStorage.setItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:two`, '400' );
	localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( { one: true } ) );
	localStorage.setItem( LEGACY_PANEL_OPEN_STORAGE_KEY, 'false' );
	localStorage.setItem( 'unrelated', 'keep' );
	expect( hasCustomPanelLayout() ).toBe( true );
	localStorage.setItem( PANEL_CONTENT_WIDTH_STORAGE_KEY, '600' );
	resetPanelLayout();
	expect( hasCustomPanelLayout() ).toBe( false );
	expect( localStorage.getItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:one` ) ).toBeNull();
	expect( localStorage.getItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:two` ) ).toBeNull();
	expect( localStorage.getItem( PANEL_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( SITE_CHAT_HIDDEN_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( LEGACY_PANEL_OPEN_STORAGE_KEY ) ).toBeNull();
	expect( localStorage.getItem( 'unrelated' ) ).toBe( 'keep' );
	localStorage.clear();
} );

it( 'ignores obsolete panel visibility when checking for a custom layout', () => {
	localStorage.clear();
	localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( { one: true } ) );
	localStorage.setItem( LEGACY_PANEL_OPEN_STORAGE_KEY, 'false' );
	expect( hasCustomPanelLayout() ).toBe( false );
	resetPanelLayout();
	expect( localStorage.length ).toBe( 0 );
} );
