import { isAppleOS } from '@wordpress/keycodes';

type Modifier = 'alt' | 'shift';

// Option and non-Latin layouts change `event.key` (⌥P types π, a Russian
// layout's K types л), so a letter is read from the physical key unless the
// layout types a Latin letter there.
function getKey( event: KeyboardEvent ) {
	if ( /^[a-z]$/i.test( event.key ) ) {
		return event.key.toLowerCase();
	}
	return event.code.startsWith( 'Key' ) ? event.code.slice( 3 ).toLowerCase() : event.key;
}

/**
 * Whether `event` is ⌘ (Ctrl elsewhere) plus `key`, with exactly the given
 * extra modifier. Keys pressed while an IME composes belong to the IME.
 */
export function isShortcut( event: KeyboardEvent, key: string, modifier?: Modifier ) {
	const primary = isAppleOS() ? event.metaKey && ! event.ctrlKey : event.ctrlKey && ! event.metaKey;
	return (
		primary &&
		event.altKey === ( modifier === 'alt' ) &&
		event.shiftKey === ( modifier === 'shift' ) &&
		! event.isComposing &&
		! event.getModifierState?.( 'AltGraph' ) &&
		getKey( event ) === key
	);
}

export function isTextEntry( target: EventTarget | null ) {
	return (
		target instanceof Element &&
		!! target.closest( 'input, textarea, select, [contenteditable]:not([contenteditable="false"])' )
	);
}

export function isDialogOpen() {
	return !! document.querySelector( '[data-slot="dialog-content"]:not([data-closed])' );
}
