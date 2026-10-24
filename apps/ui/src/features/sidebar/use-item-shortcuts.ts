import { useEffect, useEffectEvent, useId } from 'react';
import { isShortcut, isTextEntry } from '@/lib/shortcuts';

type Handlers = {
	rename: () => void;
	pin: () => void;
	archive?: () => void;
	lifecycle?: () => void;
};

/**
 * ⌥⌘R or F2 renames, ⌥⌘P pins, ⇧⌘A archives and ⌥⌘S starts or stops (Ctrl+Alt
 * and Ctrl+Shift elsewhere). Spread the returned props on a sidebar row, the
 * menu open on it, and the elements marked `data-item-shortcuts-active` for the
 * open chat and the current site. A shortcut acts on the focused row or menu,
 * else the open chat, else the current site; F2 only on a focused one, and ⌥⌘S
 * always on the current site. Keys typed in a text field stay there.
 */
export function useItemShortcuts( handlers: Handlers ) {
	const id = useId();
	const onKeyDown = useEffectEvent( ( event: KeyboardEvent ) => {
		const f2 =
			event.key === 'F2' &&
			! event.altKey &&
			! event.shiftKey &&
			! event.metaKey &&
			! event.ctrlKey;
		const lifecycle = isShortcut( event, 's', 'alt' );
		const action =
			f2 || isShortcut( event, 'r', 'alt' )
				? handlers.rename
				: isShortcut( event, 'p', 'alt' )
				? handlers.pin
				: isShortcut( event, 'a', 'shift' )
				? handlers.archive
				: lifecycle
				? handlers.lifecycle
				: undefined;
		if ( ! action || event.defaultPrevented || event.repeat || isTextEntry( event.target ) ) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		const focused = target?.closest( '[data-item-shortcuts]' );
		const unscoped = f2 || target?.closest( '[role="dialog"], [role="menu"]' );
		const active = ( kind: string ) =>
			document.querySelector( `[data-item-shortcuts-active="${ kind }"]` );
		const scope = lifecycle
			? ! unscoped && active( 'site' )
			: focused ?? ( unscoped ? null : active( 'chat' ) ?? active( 'site' ) );
		if ( scope && scope.getAttribute( 'data-item-shortcuts' ) === id ) {
			event.preventDefault();
			action();
		}
	} );
	useEffect( () => {
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [] );
	return { 'data-item-shortcuts': id };
}
