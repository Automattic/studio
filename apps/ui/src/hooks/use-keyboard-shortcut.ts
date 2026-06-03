import { useEffect, useRef } from 'react';
import { getKeyboardShortcut, matchesKeyboardShortcut } from '@/lib/keyboard-shortcuts';
import type { KeyboardShortcutId } from '@/lib/keyboard-shortcuts';

interface UseKeyboardShortcutOptions {
	enabled?: boolean;
}

export function useKeyboardShortcut(
	shortcutId: KeyboardShortcutId,
	callback: ( event: KeyboardEvent ) => void,
	{ enabled = true }: UseKeyboardShortcutOptions = {}
) {
	const callbackRef = useRef( callback );

	useEffect( () => {
		callbackRef.current = callback;
	}, [ callback ] );

	useEffect( () => {
		if ( ! enabled ) {
			return;
		}
		const shortcut = getKeyboardShortcut( shortcutId );
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( ! matchesKeyboardShortcut( event, shortcut ) ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			callbackRef.current( event );
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ enabled, shortcutId ] );
}
