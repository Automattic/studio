import type { BrowserShortcutCommand } from '@studio/common/ai/inspector/page-script';

export interface BrowserHistoryEntry {
	index: number;
	title: string;
	url: string;
}

export interface BrowserNavigationState {
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	progress: number;
	title: string | null;
	historyEntries: BrowserHistoryEntry[];
	activeHistoryIndex: number;
	// The last main-frame load failed, so the page on screen is the browser's error page.
	failed: boolean;
}

export interface BrowserCommand {
	id: number;
	type: BrowserShortcutCommand | 'go-to-history';
	historyIndex?: number;
}

export const EMPTY_BROWSER_STATE: BrowserNavigationState = {
	canGoBack: false,
	canGoForward: false,
	loading: false,
	progress: 0,
	title: null,
	historyEntries: [],
	activeHistoryIndex: -1,
	failed: false,
};

export function areBrowserStatesEqual( a: BrowserNavigationState, b: BrowserNavigationState ) {
	return (
		a.canGoBack === b.canGoBack &&
		a.canGoForward === b.canGoForward &&
		a.loading === b.loading &&
		a.progress === b.progress &&
		a.title === b.title &&
		a.failed === b.failed &&
		a.activeHistoryIndex === b.activeHistoryIndex &&
		a.historyEntries.length === b.historyEntries.length &&
		a.historyEntries.every( ( entry, index ) => {
			const other = b.historyEntries[ index ];
			return other?.index === entry.index && other.title === entry.title && other.url === entry.url;
		} )
	);
}

export function getDirectionalHistoryEntries(
	entries: BrowserHistoryEntry[],
	activeIndex: number,
	direction: 'back' | 'forward'
): BrowserHistoryEntry[] {
	const directional = entries.filter( ( entry ) =>
		direction === 'back' ? entry.index < activeIndex : entry.index > activeIndex
	);
	return direction === 'back' ? directional.reverse() : directional;
}

export function getHistoryEntryPath( url: string ) {
	try {
		const parsed = new URL( url );
		return `${ parsed.pathname }${ parsed.search }${ parsed.hash }`;
	} catch {
		return url;
	}
}

export function normalizeDocumentTitle( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
