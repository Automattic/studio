export interface ResizablePanelConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidthRatio: number;
}

export const SIDEBAR_PANEL_STORAGE_KEY = 'studio-ui-sidebar-width';
export const PREVIEW_PANEL_STORAGE_KEY = 'studio-ui-preview-width';
export const PREVIEW_CONTENT_WIDTH_STORAGE_KEY = 'studio-ui-preview-content-width';
export const PREVIEW_PANEL_DEFAULT_WIDTH = 520;
export const PREVIEW_PANEL_MIN_WIDTH = 360;
export const PREVIEW_PANEL_MIN_CONTENT_WIDTH = 280;

export const SIDEBAR_PANEL_CONFIG: ResizablePanelConfig = {
	defaultWidth: 320,
	minWidth: 240,
	maxWidthRatio: 0.25,
};

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

export function removeStoredResizablePanelWidth( storageKey: string ): void {
	if ( typeof window === 'undefined' ) {
		return;
	}

	try {
		window.localStorage.removeItem( storageKey );
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

// Sanitizes a stored legacy preview width against the viewport. Migration-only:
// used to convert the deprecated `studio-ui-preview-width` key into a content
// width the first time the preview opens.
export function clampPreviewWidth( previewWidth: number, viewportWidth: number ): number {
	const maxPreviewWidth =
		viewportWidth > 0
			? Math.max( PREVIEW_PANEL_MIN_WIDTH, viewportWidth - PREVIEW_PANEL_MIN_CONTENT_WIDTH )
			: previewWidth;
	return Math.min(
		maxPreviewWidth,
		Math.max( PREVIEW_PANEL_MIN_WIDTH, Math.round( previewWidth ) )
	);
}

export interface InitialPreviewLayout {
	// The persisted content width (new key), or null when we have not stored one
	// yet and must fall back to the legacy preview width on first open.
	contentWidth: number | null;
	// The legacy preview width (sanitized), used only until migration completes.
	legacyPreviewWidth: number;
	hasLegacyPreviewWidth: boolean;
}

// Reads the persisted split state, preferring the new content-width key and
// falling back to the deprecated preview-width key for migration.
export function getInitialPreviewLayout( viewportWidth: number ): InitialPreviewLayout {
	const fallback: InitialPreviewLayout = {
		contentWidth: null,
		legacyPreviewWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
		hasLegacyPreviewWidth: false,
	};

	if ( typeof window === 'undefined' ) {
		return fallback;
	}

	try {
		const storedContentWidth = Number(
			window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY )
		);
		const storedPreviewWidth = window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY );
		const parsedPreviewWidth = storedPreviewWidth ? Number( storedPreviewWidth ) : NaN;
		return {
			contentWidth:
				Number.isFinite( storedContentWidth ) && storedContentWidth > 0
					? Math.round( storedContentWidth )
					: null,
			legacyPreviewWidth: clampPreviewWidth(
				Number.isFinite( parsedPreviewWidth ) ? parsedPreviewWidth : PREVIEW_PANEL_DEFAULT_WIDTH,
				viewportWidth
			),
			hasLegacyPreviewWidth:
				storedPreviewWidth !== null && Number.isFinite( Number( storedPreviewWidth ) ),
		};
	} catch {
		return fallback;
	}
}
