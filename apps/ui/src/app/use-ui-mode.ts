import { useCallback, useEffect, useState } from 'react';

export type UiMode = 'classic' | 'desks';

const UI_MODE_STORAGE_KEY = 'studio.uiMode';
const STUDIO_UI_MODE_PARAM = 'studio-ui-mode';
const DEFAULT_UI_MODE: UiMode = 'desks';

function isUiMode( value: string | null ): value is UiMode {
	return value === 'classic' || value === 'desks';
}

function readStoredUiMode(): UiMode {
	if ( typeof window === 'undefined' ) {
		return DEFAULT_UI_MODE;
	}

	try {
		const storedMode = window.localStorage.getItem( UI_MODE_STORAGE_KEY );
		return isUiMode( storedMode ) ? storedMode : DEFAULT_UI_MODE;
	} catch {
		return DEFAULT_UI_MODE;
	}
}

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

function readInitialUiMode(): UiMode {
	return readLaunchUiMode() ?? readStoredUiMode();
}

function writeStoredUiMode( mode: UiMode ) {
	try {
		window.localStorage.setItem( UI_MODE_STORAGE_KEY, mode );
	} catch {
		// Local storage is best-effort; the in-memory mode switch still works.
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
			writeStoredUiMode( nextMode );
			resetRoute();
		},
		[ mode ]
	);

	useEffect( () => {
		const launchMode = readLaunchUiMode();
		if ( launchMode ) {
			writeStoredUiMode( launchMode );
		}
	}, [] );

	return { mode, setMode };
}
