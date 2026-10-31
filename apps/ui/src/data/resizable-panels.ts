export interface ResizablePanelConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidthRatio: number;
}

export const SIDEBAR_PANEL_STORAGE_KEY = 'studio-ui-sidebar-width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'studio-ui-sidebar-collapsed';
export const PREVIEW_CONTENT_WIDTH_STORAGE_KEY = 'studio-ui-preview-content-width';
export const PREVIEW_OPEN_STORAGE_KEY = 'studio-ui-preview-open';
export const PREVIEW_LAYOUT_STORAGE_KEY = 'studio-ui-running-preview-layout';
export const SITE_CHAT_HIDDEN_STORAGE_KEY = 'studio-ui-chat-hidden-by-site';
const PREVIEW_CONTENT_WIDTH_SITE_PREFIX = `${ PREVIEW_CONTENT_WIDTH_STORAGE_KEY }:`;

export function getPreviewContentWidthStorageKey( siteId: string ): string {
	return `${ PREVIEW_CONTENT_WIDTH_SITE_PREFIX }${ siteId }`;
}

export function getStoredSiteChatVisibility(): Record< string, boolean > {
	try {
		const stored: unknown = JSON.parse(
			window.localStorage.getItem( SITE_CHAT_HIDDEN_STORAGE_KEY ) ?? '{}'
		);
		return stored && typeof stored === 'object' && ! Array.isArray( stored )
			? Object.fromEntries( Object.entries( stored ).filter( ( [ , hidden ] ) => hidden === true ) )
			: {};
	} catch {
		return {};
	}
}

export function storeSiteChatVisibility( hiddenBySiteId: Record< string, boolean > ): void {
	try {
		if ( Object.values( hiddenBySiteId ).some( Boolean ) ) {
			window.localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( hiddenBySiteId ) );
		} else {
			window.localStorage.removeItem( SITE_CHAT_HIDDEN_STORAGE_KEY );
		}
	} catch {
		// Keep visibility usable when storage is unavailable.
	}
}

export function getStoredPreviewVisibility(): boolean | null {
	try {
		const stored = window.localStorage.getItem( PREVIEW_OPEN_STORAGE_KEY );
		return stored === 'true' ? true : stored === 'false' ? false : null;
	} catch {
		return null;
	}
}

export interface PreviewLayout {
	open: boolean;
	chatHidden: boolean;
}

export function getStoredPreviewLayout(): PreviewLayout {
	try {
		const stored: unknown = JSON.parse(
			window.localStorage.getItem( PREVIEW_LAYOUT_STORAGE_KEY ) ?? 'null'
		);
		if (
			stored &&
			typeof stored === 'object' &&
			'open' in stored &&
			'chatHidden' in stored &&
			typeof stored.open === 'boolean' &&
			typeof stored.chatHidden === 'boolean'
		) {
			return { open: stored.open, chatHidden: stored.chatHidden };
		}
	} catch {
		// Fall back to the previous visibility preference.
	}
	return { open: getStoredPreviewVisibility() ?? true, chatHidden: false };
}

export function storePreviewLayout( layout: PreviewLayout ): void {
	try {
		window.localStorage.setItem( PREVIEW_LAYOUT_STORAGE_KEY, JSON.stringify( layout ) );
	} catch {
		// Keep layout changes usable without storage.
	}
}

export const PREVIEW_CONTENT_DEFAULT_WIDTH = 360;
export const PREVIEW_PANEL_MIN_WIDTH = 360;
const PREVIEW_PANEL_MIN_CONTENT_WIDTH = 360;
export const PREVIEW_SPLIT_MIN_WIDTH = PREVIEW_PANEL_MIN_WIDTH + PREVIEW_PANEL_MIN_CONTENT_WIDTH;

export const SIDEBAR_PANEL_CONFIG: ResizablePanelConfig = {
	defaultWidth: 256,
	minWidth: 256,
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
	return window.innerWidth;
}

export function getStoredResizablePanelWidth(
	storageKey: string,
	config: ResizablePanelConfig,
	viewportWidth: number
): number {
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
	try {
		window.localStorage.setItem( storageKey, String( width ) );
	} catch {
		// Ignore storage failures; resizing should still work for this session.
	}
}

const PANEL_WIDTH_STORAGE_KEYS = [
	SIDEBAR_PANEL_STORAGE_KEY,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	SITE_CHAT_HIDDEN_STORAGE_KEY,
	PREVIEW_OPEN_STORAGE_KEY,
	PREVIEW_LAYOUT_STORAGE_KEY,
];
export const PANEL_WIDTHS_RESET_EVENT = 'studio-panel-widths-reset';

function getPanelWidthStorageKeys(): string[] {
	return [
		...PANEL_WIDTH_STORAGE_KEYS,
		...Object.keys( window.localStorage ).filter( ( key ) =>
			key.startsWith( PREVIEW_CONTENT_WIDTH_SITE_PREFIX )
		),
	];
}

export function hasCustomPanelLayout(): boolean {
	try {
		return (
			getPanelWidthStorageKeys().some( ( key ) => {
				if ( key === PREVIEW_LAYOUT_STORAGE_KEY ) {
					const layout = getStoredPreviewLayout();
					return ! layout.open || layout.chatHidden;
				}
				return window.localStorage.getItem( key ) !== null;
			} ) || window.localStorage.getItem( SIDEBAR_COLLAPSED_STORAGE_KEY ) === 'true'
		);
	} catch {
		return false;
	}
}

// Restores panel widths and visibility; mounted panels listen for the event.
export function resetPanelLayout(): void {
	try {
		[ ...getPanelWidthStorageKeys(), SIDEBAR_COLLAPSED_STORAGE_KEY ].forEach( ( key ) =>
			window.localStorage.removeItem( key )
		);
	} catch {
		// Nothing stored to forget.
	}
	window.dispatchEvent( new Event( PANEL_WIDTHS_RESET_EVENT ) );
}

interface PreviewSplitLayout {
	contentWidth: number;
	previewWidth: number;
	previewMinWidth: number;
	previewMaxWidth: number;
}

// The single source of truth for the preview split clamp. Given the measured
// frame width and the user's preferred content width, returns the content
// width clamped so the content column keeps PREVIEW_PANEL_MIN_CONTENT_WIDTH and
// the preview keeps PREVIEW_PANEL_MIN_WIDTH, plus the derived preview track and
// the bounds the resize handle reports. At mobile widths, chat fills the frame.
// Other frames too narrow for both floors split proportionally without resizing.
// CSS just consumes the
// content width; it does not re-clamp.
export function getPreviewSplitLayout(
	containerWidth: number,
	preferredContentWidth: number
): PreviewSplitLayout {
	const width = Math.max( 0, Math.round( containerWidth ) );
	if ( width <= 540 ) {
		return {
			contentWidth: width,
			previewWidth: 0,
			previewMinWidth: 0,
			previewMaxWidth: 0,
		};
	}
	if ( width < PREVIEW_SPLIT_MIN_WIDTH ) {
		const contentWidth = Math.round(
			( width * PREVIEW_PANEL_MIN_CONTENT_WIDTH ) / PREVIEW_SPLIT_MIN_WIDTH
		);
		const previewWidth = width - contentWidth;
		return {
			contentWidth,
			previewWidth,
			previewMinWidth: previewWidth,
			previewMaxWidth: previewWidth,
		};
	}
	const previewMinWidth = Math.min( PREVIEW_PANEL_MIN_WIDTH, width );
	const previewMaxWidth = Math.max( previewMinWidth, width - PREVIEW_PANEL_MIN_CONTENT_WIDTH );
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
