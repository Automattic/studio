export interface ResizablePanelConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidthRatio: number;
}

export const SIDEBAR_PANEL_STORAGE_KEY = 'studio-ui-sidebar-width';
export const PREVIEW_PANEL_STORAGE_KEY = 'studio-ui-preview-width';

export const SIDEBAR_PANEL_CONFIG: ResizablePanelConfig = {
	defaultWidth: 320,
	minWidth: 240,
	maxWidthRatio: 0.25,
};

export const PREVIEW_PANEL_CONFIG: ResizablePanelConfig = {
	defaultWidth: 520,
	minWidth: 360,
	maxWidthRatio: 0.5,
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
