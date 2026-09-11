import {
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	SIDEBAR_PANEL_CONFIG,
	SIDEBAR_PANEL_STORAGE_KEY,
	clampResizablePanelWidth,
	getPreviewSplitLayout,
	storeResizablePanelWidth,
} from '@/lib/resizable-panels';
import type {
	MarketingPanelLayout,
	MarketingPreviewState,
	MarketingSidebarState,
} from './scenarios';

const PANEL_FRAME_GAP = 12;
const MIN_PREVIEW_WIDTH_RATIO = 0.2;
const MAX_PREVIEW_WIDTH_RATIO = 0.8;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 600;

export interface AppliedMarketingPanelLayout {
	sidebar: {
		state: MarketingSidebarState;
		width: number;
	};
	preview: {
		state: MarketingPreviewState;
		requestedWidthRatio: number;
		contentWidth: number;
		width: number;
	};
}

export function resolveMarketingPanelLayout(
	defaults: MarketingPanelLayout,
	searchParams: URLSearchParams
): MarketingPanelLayout {
	return {
		sidebar: {
			state: parseState(
				searchParams.get( 'sidebar' ),
				[ 'expanded', 'collapsed' ],
				defaults.sidebar.state,
				'sidebar'
			),
			width: parseNumber(
				searchParams.get( 'sidebarWidth' ),
				defaults.sidebar.width,
				MIN_SIDEBAR_WIDTH,
				MAX_SIDEBAR_WIDTH,
				'sidebarWidth'
			),
		},
		preview: {
			state: parseState(
				searchParams.get( 'preview' ),
				[ 'open', 'closed' ],
				defaults.preview.state,
				'preview'
			),
			widthRatio: parseNumber(
				searchParams.get( 'previewWidthRatio' ),
				defaults.preview.widthRatio,
				MIN_PREVIEW_WIDTH_RATIO,
				MAX_PREVIEW_WIDTH_RATIO,
				'previewWidthRatio'
			),
		},
	};
}

export function applyMarketingPanelLayout(
	layout: MarketingPanelLayout,
	viewportWidth: number
): AppliedMarketingPanelLayout {
	const storedSidebarWidth = clampResizablePanelWidth(
		layout.sidebar.width,
		SIDEBAR_PANEL_CONFIG,
		viewportWidth
	);
	storeResizablePanelWidth( SIDEBAR_PANEL_STORAGE_KEY, storedSidebarWidth );

	// The open sidebar also has a CSS max-width of 25vw. At the narrow smoke
	// viewport that can be smaller than the resizer's 240px interaction floor.
	const renderedSidebarWidth =
		layout.sidebar.state === 'expanded'
			? Math.min(
					storedSidebarWidth,
					Math.floor( viewportWidth * SIDEBAR_PANEL_CONFIG.maxWidthRatio )
			  )
			: 0;
	// Keep in sync with --panel-frame-gap in preview-split-frame/style.module.css.
	// A collapsed sidebar makes that frame full-bleed, so it has no outer gap.
	const frameGap = layout.sidebar.state === 'expanded' ? PANEL_FRAME_GAP : 0;
	const frameWidth = Math.max( 0, viewportWidth - renderedSidebarWidth - frameGap );
	const preferredContentWidth = Math.round( frameWidth * ( 1 - layout.preview.widthRatio ) );
	const previewLayout = getPreviewSplitLayout( frameWidth, preferredContentWidth );
	storeResizablePanelWidth( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, previewLayout.contentWidth );

	return {
		sidebar: {
			state: layout.sidebar.state,
			width: renderedSidebarWidth,
		},
		preview: {
			state: layout.preview.state,
			requestedWidthRatio: layout.preview.widthRatio,
			contentWidth: previewLayout.contentWidth,
			width: previewLayout.previewWidth,
		},
	};
}

function parseState< T extends string >(
	value: string | null,
	allowed: readonly T[],
	fallback: T,
	parameter: string
): T {
	if ( value === null ) {
		return fallback;
	}
	if ( allowed.includes( value as T ) ) {
		return value as T;
	}
	throw new Error(
		`Unknown marketing screenshot ${ parameter } value "${ value }". Expected one of: ${ allowed.join(
			', '
		) }.`
	);
}

function parseNumber(
	value: string | null,
	fallback: number,
	minimum: number,
	maximum: number,
	parameter: string
): number {
	if ( value === null ) {
		return fallback;
	}
	const parsed = Number( value );
	if ( ! Number.isFinite( parsed ) || parsed < minimum || parsed > maximum ) {
		throw new Error(
			`Marketing screenshot ${ parameter } must be between ${ minimum } and ${ maximum }.`
		);
	}
	return parsed;
}
