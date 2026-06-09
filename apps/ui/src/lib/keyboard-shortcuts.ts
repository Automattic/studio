import { DEFAULT_MESSAGE_SEND_SHORTCUT } from '@studio/common/lib/user-settings/message-send-shortcut';
import { __ } from '@wordpress/i18n';
import { getNavigatorPlatform } from '@/lib/platform';
import type { MessageSendShortcut } from '@/data/core';

export type KeyboardShortcutId =
	| 'toggle-sidebar'
	| 'open-app-settings'
	| 'new-chat-in-current-site'
	| 'toggle-site-preview'
	| 'toggle-site-menu';

export interface KeyboardShortcutDefinition {
	id: KeyboardShortcutId;
	label: string;
	key: string;
	modifier: 'primary';
	shiftKey?: boolean;
}

type KeyboardEventLike = Pick<
	KeyboardEvent,
	'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'
>;

export const KEYBOARD_SHORTCUTS: KeyboardShortcutDefinition[] = [
	{
		id: 'toggle-sidebar',
		label: __( 'Toggle sidebar' ),
		key: 'b',
		modifier: 'primary',
	},
	{
		id: 'open-app-settings',
		label: __( 'Open preferences' ),
		key: ',',
		modifier: 'primary',
	},
	{
		id: 'new-chat-in-current-site',
		label: __( 'New chat in current site' ),
		key: 'n',
		modifier: 'primary',
	},
	{
		id: 'toggle-site-preview',
		label: __( 'Toggle browser' ),
		key: 'b',
		modifier: 'primary',
		shiftKey: true,
	},
	{
		id: 'toggle-site-menu',
		label: __( 'Open site menu' ),
		key: 'i',
		modifier: 'primary',
	},
];

export function getKeyboardShortcut( id: KeyboardShortcutId ): KeyboardShortcutDefinition {
	const shortcut = KEYBOARD_SHORTCUTS.find( ( candidate ) => candidate.id === id );
	if ( ! shortcut ) {
		throw new Error( `Unknown keyboard shortcut: ${ id }` );
	}
	return shortcut;
}

export function isApplePlatform( platform = getPlatform() ): boolean {
	return /mac|iphone|ipad|ipod/i.test( platform );
}

export function getPrimaryModifierLabel( platform = getPlatform() ): string {
	return isApplePlatform( platform ) ? '⌘' : 'Ctrl';
}

export function getKeyboardShortcutLabel(
	shortcut: KeyboardShortcutDefinition,
	platform = getPlatform()
): string {
	const modifier = getPrimaryModifierLabel( platform );
	const key = shortcut.key.toUpperCase();
	if ( shortcut.shiftKey ) {
		return isApplePlatform( platform ) ? `${ modifier }⇧${ key }` : `${ modifier }+Shift+${ key }`;
	}
	return isApplePlatform( platform ) ? `${ modifier }${ key }` : `${ modifier }+${ key }`;
}

export function getKeyboardShortcutAriaKeyShortcut(
	shortcut: KeyboardShortcutDefinition,
	platform = getPlatform()
): string {
	const modifiers = [ isApplePlatform( platform ) ? 'Meta' : 'Control' ];
	if ( shortcut.shiftKey ) {
		modifiers.push( 'Shift' );
	}
	return `${ modifiers.join( '+' ) }+${ shortcut.key.toUpperCase() }`;
}

export function getKeyboardShortcutDescriptor(
	shortcut: KeyboardShortcutDefinition,
	platform = getPlatform()
): { displayShortcut: string; ariaKeyShortcut: string } {
	return {
		displayShortcut: getKeyboardShortcutLabel( shortcut, platform ),
		ariaKeyShortcut: getKeyboardShortcutAriaKeyShortcut( shortcut, platform ),
	};
}

export function getMessageSendShortcutLabel(
	shortcut: MessageSendShortcut = DEFAULT_MESSAGE_SEND_SHORTCUT,
	platform = getPlatform()
): string {
	if ( shortcut === 'enter' ) {
		return 'Enter';
	}
	return isApplePlatform( platform )
		? `${ getPrimaryModifierLabel( platform ) }Enter`
		: `${ getPrimaryModifierLabel( platform ) }+Enter`;
}

export function matchesKeyboardShortcut(
	event: KeyboardEventLike,
	shortcut: KeyboardShortcutDefinition,
	platform = getPlatform()
): boolean {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.shiftKey !== Boolean( shortcut.shiftKey ) ||
		event.altKey
	) {
		return false;
	}
	const hasPrimaryModifier = isApplePlatform( platform ) ? event.metaKey : event.ctrlKey;
	if ( ! hasPrimaryModifier ) {
		return false;
	}
	return event.key.toLowerCase() === shortcut.key.toLowerCase();
}

export function shouldSendMessageForKeyDown(
	event: Pick< KeyboardEventLike, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' > & {
		isComposing?: boolean;
	},
	shortcut: MessageSendShortcut = DEFAULT_MESSAGE_SEND_SHORTCUT,
	platform = getPlatform()
): boolean {
	// Ignore the Enter that commits an active IME composition (e.g. CJK input),
	// otherwise a half-composed message would be sent — especially in 'enter' mode.
	if ( event.isComposing || event.key !== 'Enter' || event.shiftKey || event.altKey ) {
		return false;
	}
	const hasPrimaryModifier = isApplePlatform( platform ) ? event.metaKey : event.ctrlKey;
	if ( shortcut === 'enter' ) {
		return ! hasPrimaryModifier;
	}
	return hasPrimaryModifier;
}

function getPlatform(): string {
	return getNavigatorPlatform();
}
