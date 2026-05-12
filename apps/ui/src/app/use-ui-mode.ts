import { useCallback, useEffect, useState } from 'react';

export type UiMode = 'classic' | 'desks';

const UI_MODE_STORAGE_KEY = 'studio.uiMode';

function isUiMode( value: string | null ): value is UiMode {
	return value === 'classic' || value === 'desks';
}

function readStoredUiMode(): UiMode {
	if ( typeof window === 'undefined' ) {
		return 'classic';
	}

	try {
		const storedMode = window.localStorage.getItem( UI_MODE_STORAGE_KEY );
		return isUiMode( storedMode ) ? storedMode : 'classic';
	} catch {
		return 'classic';
	}
}

function writeStoredUiMode( mode: UiMode ) {
	try {
		window.localStorage.setItem( UI_MODE_STORAGE_KEY, mode );
	} catch {
		// Local storage is best-effort; the in-memory mode switch still works.
	}
}

function resetRouteAndReload() {
	if ( typeof window === 'undefined' ) {
		return;
	}

	if ( window.location.pathname !== '/' || window.location.search || window.location.hash ) {
		window.history.replaceState( window.history.state, '', '/' );
	}

	window.location.reload();
}

function isEditableTarget( target: EventTarget | null ) {
	if ( ! ( target instanceof HTMLElement ) ) {
		return false;
	}

	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

export function useUiMode() {
	const [ mode, setModeState ] = useState< UiMode >( readStoredUiMode );

	const setMode = useCallback(
		( nextMode: UiMode ) => {
			if ( mode === nextMode ) {
				return;
			}

			setModeState( nextMode );
			writeStoredUiMode( nextMode );
			resetRouteAndReload();
		},
		[ mode ]
	);

	useEffect( () => {
		function handleKeyDown( event: KeyboardEvent ) {
			if (
				event.defaultPrevented ||
				isEditableTarget( event.target ) ||
				event.key.toLowerCase() !== 'd' ||
				! event.shiftKey ||
				! ( event.metaKey || event.ctrlKey )
			) {
				return;
			}

			event.preventDefault();
			setMode( mode === 'classic' ? 'desks' : 'classic' );
		}

		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ mode, setMode ] );

	return { mode, setMode };
}
