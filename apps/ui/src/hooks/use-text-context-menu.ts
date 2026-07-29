import { useEffect } from 'react';
import { useConnector } from '@/data/core';

// Elements carrying a message's full text opt in with this attribute, so a
// right-click anywhere inside one can offer to copy the whole thing.
export const MESSAGE_TEXT_ATTRIBUTE = 'data-message-text';

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Routes right-clicks to the host's native text context menu.
 *
 * Only the renderer knows which message the pointer landed on, so it drives the
 * menu rather than the main process listening for `context-menu` — pushing the
 * message text over afterwards would race the browser's own menu request.
 * Hosts without a native menu to pop (the browser builds, which already have a
 * real one) don't implement the method, and the default menu is left alone.
 */
export function useTextContextMenu(): void {
	const connector = useConnector();
	const showTextContextMenu = connector.showTextContextMenu;

	useEffect( () => {
		if ( ! showTextContextMenu ) {
			return;
		}

		const handleContextMenu = ( event: MouseEvent ) => {
			const target = event.target instanceof Element ? event.target : null;
			if ( ! target ) {
				return;
			}

			const messageHost = target.closest( `[${ MESSAGE_TEXT_ATTRIBUTE }]` );
			const messageText = messageHost?.getAttribute( MESSAGE_TEXT_ATTRIBUTE ) || undefined;
			const selectionText = window.getSelection()?.toString() ?? '';
			const isEditable = Boolean( target.closest( EDITABLE_SELECTOR ) );

			if ( ! messageText && ! selectionText.trim() && ! isEditable ) {
				return;
			}

			// Nothing else would handle it, but claiming the event keeps a host
			// menu from ever stacking on top of ours.
			event.preventDefault();
			showTextContextMenu( { selectionText, isEditable, messageText } );
		};

		document.addEventListener( 'contextmenu', handleContextMenu );
		return () => document.removeEventListener( 'contextmenu', handleContextMenu );
	}, [ showTextContextMenu ] );
}
