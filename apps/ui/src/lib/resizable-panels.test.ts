import { describe, expect, it } from 'vitest';
import {
	clampResizablePanelWidth,
	getPreviewSplitLayout,
	getResizablePanelMaxWidth,
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
	// Content floor 320, preview floor 360.
	it( 'leaves a comfortable preferred width untouched on a wide frame', () => {
		const layout = getPreviewSplitLayout( 1000, 600 );
		expect( layout.contentWidth ).toBe( 600 );
		expect( layout.previewWidth ).toBe( 400 );
		expect( layout.previewMinWidth ).toBe( 360 );
		expect( layout.previewMaxWidth ).toBe( 680 );
	} );

	it( 'caps content so the preview keeps its minimum width', () => {
		// Preferred content larger than container - previewMin -> clamped down.
		expect( getPreviewSplitLayout( 1000, 900 ).contentWidth ).toBe( 640 );
		expect( getPreviewSplitLayout( 1000, 900 ).previewWidth ).toBe( 360 );
	} );

	it( 'floors content at its minimum so the preview cannot swallow it', () => {
		// This is the regime where the old CSS-only clamp diverged: a preferred
		// content below the 320 floor must be raised to 320, not left as-is.
		expect( getPreviewSplitLayout( 1000, 100 ).contentWidth ).toBe( 320 );
		expect( getPreviewSplitLayout( 1000, 100 ).previewWidth ).toBe( 680 );
	} );

	it( 'keeps the preview at its minimum when the frame is narrower than both floors', () => {
		const layout = getPreviewSplitLayout( 400, 300 );
		expect( layout.contentWidth ).toBe( 40 );
		expect( layout.previewWidth ).toBe( 360 );
		expect( layout.previewMinWidth ).toBe( 360 );
		expect( layout.previewMaxWidth ).toBe( 360 );
	} );
} );
