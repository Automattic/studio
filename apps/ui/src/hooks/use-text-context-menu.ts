import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { emitComposerTextQuote } from '@/lib/composer-text-quote';

// Elements carrying a message's full text opt in with this attribute, so a
// right-click anywhere inside one can offer to copy the whole thing.
export const MESSAGE_TEXT_ATTRIBUTE = 'data-message-text';

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

// Only a selection the pointer is actually inside counts. A highlight left
// behind elsewhere in the app must not put Copy on an unrelated right-click,
// where choosing it would copy something the user can't even see.
function getSelectionTextAt( target: Element ): string {
	const editable = target.closest( EDITABLE_SELECTOR );
	if ( editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement ) {
		const start = editable.selectionStart;
		const end = editable.selectionEnd;
		return start === null || end === null ? '' : editable.value.slice( start, end );
	}

	const selection = window.getSelection();
	if ( ! selection || selection.isCollapsed || selection.rangeCount === 0 ) {
		return '';
	}
	return selection.getRangeAt( 0 ).intersectsNode( target ) ? selection.toString() : '';
}

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
			const isEditable = Boolean( target.closest( EDITABLE_SELECTOR ) );
			const selectionText = getSelectionTextAt( target );

			// Right-clicking something that isn't text — a menu, a button, the
			// sidebar, empty canvas — has nothing to offer, so stay out of the
			// way entirely rather than opening a menu of unrelated actions.
			if ( ! messageText && ! isEditable && ! selectionText.trim() ) {
				return;
			}

			// Nothing else would handle it, but claiming the event keeps a host
			// menu from ever stacking on top of ours.
			event.preventDefault();
			void showTextContextMenu( { selectionText, isEditable, messageText } ).then( ( result ) => {
				if ( result?.action === 'quote-selection' ) {
					emitComposerTextQuote( result.selectionText );
				}
			} );
		};

		document.addEventListener( 'contextmenu', handleContextMenu );
		return () => document.removeEventListener( 'contextmenu', handleContextMenu );
	}, [ showTextContextMenu ] );
}
