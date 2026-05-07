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

	const setMode = useCallback( ( nextMode: UiMode ) => {
		setModeState( nextMode );
		writeStoredUiMode( nextMode );
	}, [] );

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
			setModeState( ( currentMode ) => {
				const nextMode = currentMode === 'classic' ? 'desks' : 'classic';
				writeStoredUiMode( nextMode );
				return nextMode;
			} );
		}

		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [] );

	return { mode, setMode };
}
