import { __ } from '@wordpress/i18n';
import {
	ariaKeyShortcut,
	displayShortcut,
	isAppleOS,
	isKeyboardEvent,
	shortcutAriaLabel,
} from '@wordpress/keycodes';
import type { BrowserShortcutCommand } from '@studio/agent/protocol/inspector/page-script';

export function getBrowserShortcutDescriptor( key: string ) {
	return {
		displayShortcut: displayShortcut.primary( key ),
		ariaKeyShortcut: ariaKeyShortcut.primary( key ),
		label: shortcutAriaLabel.primary( key ),
	};
}

export function getNavigationShortcutDescriptor( direction: 'back' | 'forward' ) {
	const isApple = isAppleOS();
	const arrow = direction === 'back' ? '←' : '→';
	const arrowKey = direction === 'back' ? 'ArrowLeft' : 'ArrowRight';
	const bracket = direction === 'back' ? '[' : ']';
	const arrowLabel = direction === 'back' ? __( 'Left Arrow' ) : __( 'Right Arrow' );
	return {
		displayShortcut: isApple ? `⌘${ arrow }` : `Alt+${ arrow }`,
		ariaKeyShortcut: `${ isApple ? 'Meta' : 'Alt' }+${ arrowKey } ${ ariaKeyShortcut.primary(
			bracket
		) }`,
		label: isApple ? `${ __( 'Command' ) } ${ arrowLabel }` : `${ __( 'Alt' ) } + ${ arrowLabel }`,
	};
}

export type NavigationShortcut = ReturnType< typeof getNavigationShortcutDescriptor >;

function isTextEntryTarget( target: EventTarget | null ) {
	return (
		target instanceof HTMLElement &&
		( target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement )
	);
}

export function getBrowserShortcutCommand(
	event: globalThis.KeyboardEvent
): BrowserShortcutCommand | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	// ⌘⇧R is accepted as an alias so the browser habit isn't a dead key.
	if ( isKeyboardEvent.primary( event, 'r' ) || isKeyboardEvent.primaryShift( event, 'r' ) ) {
		return 'reload';
	}
	if ( isKeyboardEvent.primary( event, '[' ) ) {
		return 'back';
	}
	if ( isKeyboardEvent.primary( event, ']' ) ) {
		return 'forward';
	}
	// Layout-independent back/forward aliases (⌘←/⌘→ on macOS, Alt+←/→
	// elsewhere): the bracket chords need Option/AltGr on many European
	// layouts. Skipped while editing text to keep native caret movement.
	if ( isTextEntryTarget( event.target ) ) {
		return null;
	}
	const isNavigationChord = isAppleOS() ? isKeyboardEvent.primary : isKeyboardEvent.alt;
	if ( isNavigationChord( event, 'ArrowLeft' ) ) {
		return 'back';
	}
	if ( isNavigationChord( event, 'ArrowRight' ) ) {
		return 'forward';
	}
	return null;
}
