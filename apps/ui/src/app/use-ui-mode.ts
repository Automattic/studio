import { useCallback, useState } from 'react';

export type UiMode = 'classic' | 'desks';

const STUDIO_UI_MODE_PARAM = 'studio-ui-mode';
const STUDIO_UI_MODE_STORAGE_KEY = 'studio-ui-mode';
const DEFAULT_UI_MODE: UiMode = 'desks';

function readLaunchUiMode(): UiMode | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}

	try {
		const mode = new URLSearchParams( window.location.search ).get( STUDIO_UI_MODE_PARAM );
		if ( mode === 'desks' ) {
			return 'desks';
		}
		if ( mode === 'agentic' ) {
			return 'classic';
		}
	} catch {
		return undefined;
	}
}

// Persisted so a real-path web build keeps its mode across reloads/deep links.
// On desktop the launch query param (derived from feature flags, see
// apps/studio/src/main-window.ts) is always present and takes precedence, so
// the stored value only ever decides the mode in the web build.
function readStoredUiMode(): UiMode | undefined {
	try {
		const stored = window.localStorage?.getItem( STUDIO_UI_MODE_STORAGE_KEY );
		return stored === 'desks' || stored === 'classic' ? stored : undefined;
	} catch {
		return undefined;
	}
}

function storeUiMode( mode: UiMode ) {
	try {
		window.localStorage?.setItem( STUDIO_UI_MODE_STORAGE_KEY, mode );
	} catch {
		// Ignore storage failures (private mode, etc.).
	}
}

function readInitialUiMode(): UiMode {
	return readLaunchUiMode() ?? readStoredUiMode() ?? DEFAULT_UI_MODE;
}

// Entries whose default differs from DEFAULT_UI_MODE (the web build defaults
// to classic) call this at bootstrap. It only seeds when the user hasn't
// already chosen a mode via query param or an earlier visit.
export function seedDefaultUiMode( defaultMode: UiMode ) {
	if ( readLaunchUiMode() === undefined && readStoredUiMode() === undefined ) {
		storeUiMode( defaultMode );
	}
}

function resetRoute() {
	if ( typeof window === 'undefined' ) {
		return;
	}

	if ( window.location.protocol === 'file:' ) {
		if ( window.location.hash !== '#/' ) {
			window.history.replaceState( window.history.state, '', '#/' );
		}
		return;
	}

	if ( window.location.pathname !== '/' || window.location.search || window.location.hash ) {
		window.history.replaceState( window.history.state, '', '/' );
	}
}

export function useUiMode() {
	const [ mode, setModeState ] = useState< UiMode >( readInitialUiMode );

	const setMode = useCallback(
		( nextMode: UiMode ) => {
			if ( mode === nextMode ) {
				return;
			}

			setModeState( nextMode );
			storeUiMode( nextMode );
			resetRoute();
		},
		[ mode ]
	);

	return { mode, setMode };
}
