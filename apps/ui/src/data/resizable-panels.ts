export interface ResizablePanelConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidthRatio: number;
}

export const SIDEBAR_PANEL_STORAGE_KEY = 'studio-ui-sidebar-width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'studio-ui-sidebar-collapsed';
export const PANEL_CONTENT_WIDTH_STORAGE_KEY = 'studio-ui-preview-content-width';
export const LEGACY_PANEL_OPEN_STORAGE_KEY = 'studio-ui-preview-open';
export const LEGACY_PANEL_LAYOUT_STORAGE_KEY = 'studio-ui-running-preview-layout';
export const SITE_CHAT_HIDDEN_STORAGE_KEY = 'studio-ui-chat-hidden-by-site';
const LEGACY_SITE_PANEL_OPEN_STORAGE_KEY = 'studio-ui-preview-open-by-site';
const PANEL_CONTENT_WIDTH_SITE_PREFIX = `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:`;

interface PanelLayout {
	open: boolean;
	chatHidden: boolean;
}

export function getDefaultPanelLayout( running = true ): PanelLayout {
	return { open: running, chatHidden: false };
}

export const PANEL_CONTENT_DEFAULT_WIDTH = 360;
export const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_CONTENT_WIDTH = 360;
export const PANEL_SPLIT_MIN_WIDTH = PANEL_MIN_WIDTH + PANEL_MIN_CONTENT_WIDTH;

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

const PANEL_WIDTH_STORAGE_KEYS = [ SIDEBAR_PANEL_STORAGE_KEY, PANEL_CONTENT_WIDTH_STORAGE_KEY ];
const LEGACY_PANEL_LAYOUT_STORAGE_KEYS = [
	SITE_CHAT_HIDDEN_STORAGE_KEY,
	LEGACY_SITE_PANEL_OPEN_STORAGE_KEY,
	LEGACY_PANEL_OPEN_STORAGE_KEY,
	LEGACY_PANEL_LAYOUT_STORAGE_KEY,
];
export const PANEL_WIDTHS_RESET_EVENT = 'studio-panel-widths-reset';

function getPanelWidthStorageKeys(): string[] {
	return [
		...PANEL_WIDTH_STORAGE_KEYS,
		...Object.keys( window.localStorage ).filter( ( key ) =>
			key.startsWith( PANEL_CONTENT_WIDTH_SITE_PREFIX )
		),
	];
}

export function hasCustomPanelLayout(): boolean {
	try {
		return (
			getPanelWidthStorageKeys().some( ( key ) => window.localStorage.getItem( key ) !== null ) ||
			window.localStorage.getItem( SIDEBAR_COLLAPSED_STORAGE_KEY ) === 'true'
		);
	} catch {
		return false;
	}
}

// Restores panel widths and visibility; mounted panels listen for the event.
export function resetPanelLayout(): void {
	try {
		[
			...getPanelWidthStorageKeys(),
			...LEGACY_PANEL_LAYOUT_STORAGE_KEYS,
			SIDEBAR_COLLAPSED_STORAGE_KEY,
		].forEach( ( key ) => window.localStorage.removeItem( key ) );
	} catch {
		// Nothing stored to forget.
	}
	window.dispatchEvent( new Event( PANEL_WIDTHS_RESET_EVENT ) );
}

interface PanelSplitLayout {
	contentWidth: number;
	panelWidth: number;
	panelMinWidth: number;
	panelMaxWidth: number;
}

// The single source of truth for the panel split clamp. Given the measured
// frame width and the user's preferred content width, returns the content
// width clamped so the content column keeps PANEL_MIN_CONTENT_WIDTH and
// the panel keeps PANEL_MIN_WIDTH, plus the derived panel track and
// the bounds the resize handle reports. At mobile widths, chat fills the frame.
// Other frames too narrow for both floors split proportionally without resizing.
// CSS just consumes the
// content width; it does not re-clamp.
export function getPanelSplitLayout(
	containerWidth: number,
	preferredContentWidth: number
): PanelSplitLayout {
	const width = Math.max( 0, Math.round( containerWidth ) );
	if ( width <= 540 ) {
		return {
			contentWidth: width,
			panelWidth: 0,
			panelMinWidth: 0,
			panelMaxWidth: 0,
		};
	}
	if ( width < PANEL_SPLIT_MIN_WIDTH ) {
		const contentWidth = Math.round( ( width * PANEL_MIN_CONTENT_WIDTH ) / PANEL_SPLIT_MIN_WIDTH );
		const panelWidth = width - contentWidth;
		return {
			contentWidth,
			panelWidth,
			panelMinWidth: panelWidth,
			panelMaxWidth: panelWidth,
		};
	}
	const panelMinWidth = Math.min( PANEL_MIN_WIDTH, width );
	const panelMaxWidth = Math.max( panelMinWidth, width - PANEL_MIN_CONTENT_WIDTH );
	const contentWidth = Math.min(
		width - panelMinWidth,
		Math.max( width - panelMaxWidth, Math.round( preferredContentWidth ) )
	);

	return {
		contentWidth,
		panelWidth: Math.max( 0, width - contentWidth ),
		panelMinWidth,
		panelMaxWidth,
	};
}

export function getInitialPanelContentWidth(): number | null {
	try {
		const storedContentWidth = window.localStorage.getItem( PANEL_CONTENT_WIDTH_STORAGE_KEY );
		const parsedContentWidth = storedContentWidth ? Number( storedContentWidth ) : NaN;
		return Number.isFinite( parsedContentWidth ) && parsedContentWidth > 0
			? Math.round( parsedContentWidth )
			: null;
	} catch {
		return null;
	}
}
