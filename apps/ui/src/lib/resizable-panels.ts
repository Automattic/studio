export interface ResizablePanelConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidthRatio: number;
}

export const SIDEBAR_PANEL_STORAGE_KEY = 'studio-ui-sidebar-width';
export const PREVIEW_CONTENT_WIDTH_STORAGE_KEY = 'studio-ui-preview-content-width';
export const PREVIEW_PANEL_DEFAULT_WIDTH = 520;
export const PREVIEW_PANEL_MIN_WIDTH = 360;
export const PREVIEW_PANEL_MIN_CONTENT_WIDTH = 280;
export const PREVIEW_SPLIT_MIN_WIDTH = PREVIEW_PANEL_MIN_WIDTH + PREVIEW_PANEL_MIN_CONTENT_WIDTH;

export const SIDEBAR_PANEL_CONFIG: ResizablePanelConfig = {
	defaultWidth: 320,
	minWidth: 240,
	maxWidthRatio: 0.25,
};

// Below this width, keeping the sidebar open would leave less than the
// agentic window's compact 420px chat surface.
export const SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = SIDEBAR_PANEL_CONFIG.minWidth + 420;
// Keep in sync with --panel-frame-gap in preview-split-frame/style.module.css.
const PREVIEW_FRAME_END_GAP = 12;
export const ALL_PANELS_MIN_WIDTH =
	SIDEBAR_PANEL_CONFIG.minWidth + PREVIEW_SPLIT_MIN_WIDTH + PREVIEW_FRAME_END_GAP;

export interface PanelOpenPlan {
	minimumWindowWidth: number;
	closeOtherPanel: boolean;
}

export function getPreviewOpenPlan(
	viewportWidth: number,
	previewContainerWidth: number,
	sidebarCollapsed: boolean,
	availableWindowWidth: number
): PanelOpenPlan {
	const requiredWidth = viewportWidth + PREVIEW_SPLIT_MIN_WIDTH - previewContainerWidth;
	const shouldCollapseSidebar = ! sidebarCollapsed && requiredWidth > availableWindowWidth;

	return {
		minimumWindowWidth: shouldCollapseSidebar
			? Math.max( viewportWidth, PREVIEW_SPLIT_MIN_WIDTH )
			: Math.max( viewportWidth, requiredWidth ),
		closeOtherPanel: shouldCollapseSidebar,
	};
}

export function getSidebarOpenPlan(
	previewOpen: boolean,
	availableWindowWidth: number
): PanelOpenPlan {
	const preservePreview = previewOpen && ALL_PANELS_MIN_WIDTH <= availableWindowWidth;

	return {
		minimumWindowWidth: preservePreview ? ALL_PANELS_MIN_WIDTH : SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
		closeOtherPanel: previewOpen && ! preservePreview,
	};
}

export function getResizablePanelMaxWidth(
	viewportWidth: number,
	{ minWidth, maxWidthRatio }: ResizablePanelConfig
): number {
	return Math.max( minWidth, Math.floor( viewportWidth * maxWidthRatio ) );
}

export function clampResizablePanelWidth(
	width: number,
	config: ResizablePanelConfig,
	viewportWidth: number
): number {
	const maxWidth = getResizablePanelMaxWidth( viewportWidth, config );
	return Math.min( maxWidth, Math.max( config.minWidth, Math.round( width ) ) );
}

export function getViewportWidth(): number {
	return typeof window === 'undefined' ? 0 : window.innerWidth;
}

export function getAvailableWindowWidth(): number {
	if ( typeof window === 'undefined' ) {
		return Number.POSITIVE_INFINITY;
	}
	return window.screen?.availWidth || Number.POSITIVE_INFINITY;
}

export function getStoredResizablePanelWidth(
	storageKey: string,
	config: ResizablePanelConfig,
	viewportWidth: number
): number {
	if ( typeof window === 'undefined' ) {
		return clampResizablePanelWidth( config.defaultWidth, config, viewportWidth );
	}

	try {
		const storedWidth = window.localStorage.getItem( storageKey );
		if ( storedWidth ) {
			const parsedWidth = Number( storedWidth );
			if ( Number.isFinite( parsedWidth ) ) {
				return clampResizablePanelWidth( parsedWidth, config, viewportWidth );
			}
		}
	} catch {
		// Ignore storage failures and fall back to the default width.
	}

	return clampResizablePanelWidth( config.defaultWidth, config, viewportWidth );
}

export function storeResizablePanelWidth( storageKey: string, width: number ): void {
	if ( typeof window === 'undefined' ) {
		return;
	}

	try {
		window.localStorage.setItem( storageKey, String( width ) );
	} catch {
		// Ignore storage failures; resizing should still work for this session.
	}
}

export interface PreviewSplitLayout {
	contentWidth: number;
	previewWidth: number;
	previewMinWidth: number;
	previewMaxWidth: number;
}

// The single source of truth for the preview split clamp. Given the measured
// frame width and the user's preferred content width, returns the content
// width clamped so the content column keeps PREVIEW_PANEL_MIN_CONTENT_WIDTH and
// the preview keeps PREVIEW_PANEL_MIN_WIDTH, plus the derived preview track and
// the bounds the resize handle reports. CSS just consumes the content width;
// it does not re-clamp.
export function getPreviewSplitLayout(
	containerWidth: number,
	preferredContentWidth: number
): PreviewSplitLayout {
	const width = Math.max( 0, Math.round( containerWidth ) );
	const minContentWidth = Math.min( PREVIEW_PANEL_MIN_CONTENT_WIDTH, width );
	const previewMaxWidth = Math.max( 0, width - minContentWidth );
	const previewMinWidth = Math.min( PREVIEW_PANEL_MIN_WIDTH, previewMaxWidth );
	const contentWidth = Math.min(
		width - previewMinWidth,
		Math.max( width - previewMaxWidth, Math.round( preferredContentWidth ) )
	);

	return {
		contentWidth,
		previewWidth: Math.max( 0, width - contentWidth ),
		previewMinWidth,
		previewMaxWidth,
	};
}

export function getInitialPreviewContentWidth(): number | null {
	if ( typeof window === 'undefined' ) {
		return null;
	}

	try {
		const storedContentWidth = window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY );
		const parsedContentWidth = storedContentWidth ? Number( storedContentWidth ) : NaN;
		return Number.isFinite( parsedContentWidth ) && parsedContentWidth > 0
			? Math.round( parsedContentWidth )
			: null;
	} catch {
		return null;
	}
}
