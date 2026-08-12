import { describe, expect, it } from 'vitest';
import {
	clampResizablePanelWidth,
	getPreviewOpenPlan,
	getPreviewSplitLayout,
	getResizablePanelMaxWidth,
	getSidebarOpenPlan,
	type ResizablePanelConfig,
} from './resizable-panels';

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
	// Content floor 280, preview floor 360.
	it( 'leaves a comfortable preferred width untouched on a wide frame', () => {
		const layout = getPreviewSplitLayout( 1000, 600 );
		expect( layout.contentWidth ).toBe( 600 );
		expect( layout.previewWidth ).toBe( 400 );
		expect( layout.previewMinWidth ).toBe( 360 );
		expect( layout.previewMaxWidth ).toBe( 720 );
	} );

	it( 'caps content so the preview keeps its minimum width', () => {
		// Preferred content larger than container - previewMin -> clamped down.
		expect( getPreviewSplitLayout( 1000, 900 ).contentWidth ).toBe( 640 );
		expect( getPreviewSplitLayout( 1000, 900 ).previewWidth ).toBe( 360 );
	} );

	it( 'floors content at its minimum so the preview cannot swallow it', () => {
		// This is the regime where the old CSS-only clamp diverged: a preferred
		// content below the 280 floor must be raised to 280, not left as-is.
		expect( getPreviewSplitLayout( 1000, 100 ).contentWidth ).toBe( 280 );
		expect( getPreviewSplitLayout( 1000, 100 ).previewWidth ).toBe( 720 );
	} );

	it( 'degrades gracefully when the frame is narrower than both floors', () => {
		const layout = getPreviewSplitLayout( 400, 300 );
		expect( layout.contentWidth ).toBeGreaterThanOrEqual( 0 );
		expect( layout.contentWidth ).toBeLessThanOrEqual( 400 );
		expect( layout.previewWidth ).toBe( 400 - layout.contentWidth );
	} );
} );

describe( 'panel opening plans', () => {
	it( 'grows the window enough to preserve an open sidebar and a new preview', () => {
		expect( getPreviewOpenPlan( 660, false, 1200 ) ).toEqual( {
			minimumWindowWidth: 892,
			closeOtherPanel: false,
		} );
	} );

	it( 'collapses the sidebar when the display cannot fit all three columns', () => {
		expect( getPreviewOpenPlan( 660, false, 800 ) ).toEqual( {
			minimumWindowWidth: 660,
			closeOtherPanel: true,
		} );
	} );

	it( 'grows a compact chat-only window to fit a preview split', () => {
		expect( getPreviewOpenPlan( 420, true, 1200 ) ).toEqual( {
			minimumWindowWidth: 640,
			closeOtherPanel: false,
		} );
	} );

	it( 'preserves the preview when opening the sidebar fits on screen', () => {
		expect( getSidebarOpenPlan( true, 1200 ) ).toEqual( {
			minimumWindowWidth: 892,
			closeOtherPanel: false,
		} );
	} );

	it( 'closes the preview when opening the sidebar cannot fit on screen', () => {
		expect( getSidebarOpenPlan( true, 800 ) ).toEqual( {
			minimumWindowWidth: 660,
			closeOtherPanel: true,
		} );
	} );
} );
