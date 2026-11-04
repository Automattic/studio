import { useSyncExternalStore } from 'react';
import type { PreviewColorScheme } from './preview-surface/webview';

const STORAGE_KEY = 'studio-preview-appearance';
export const PREVIEW_HISTORY_CLEARED_EVENT = 'studio-preview-history-cleared';
const RECENT_LOCATIONS_PREFIX = 'studio-preview-recent-locations:';

function readColorScheme(): PreviewColorScheme {
	try {
		const saved = localStorage.getItem( STORAGE_KEY );
		if ( saved === 'light' || saved === 'dark' ) return saved;
	} catch {
		// Appearance remains usable when storage is unavailable.
	}
	return 'system';
}

const listeners = new Set< () => void >();
let colorScheme = readColorScheme();

export function setPreviewColorScheme( value: PreviewColorScheme ) {
	colorScheme = value;
	try {
		localStorage.setItem( STORAGE_KEY, value );
	} catch {
		// Keep the preference for this window when storage is unavailable.
	}
	listeners.forEach( ( listener ) => listener() );
}

export function usePreviewColorScheme() {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			const handleStorage = ( event: StorageEvent ) => {
				if ( event.key === STORAGE_KEY ) {
					colorScheme = readColorScheme();
					listener();
				}
			};
			window.addEventListener( 'storage', handleStorage );
			return () => {
				listeners.delete( listener );
				window.removeEventListener( 'storage', handleStorage );
			};
		},
		() => colorScheme
	);
}

export function clearPreviewRecentLocations() {
	for ( const key of Object.keys( localStorage ) ) {
		if ( key.startsWith( RECENT_LOCATIONS_PREFIX ) ) localStorage.removeItem( key );
	}
	window.dispatchEvent( new Event( PREVIEW_HISTORY_CLEARED_EVENT ) );
}
