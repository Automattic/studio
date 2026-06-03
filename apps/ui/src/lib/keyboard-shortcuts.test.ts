import { describe, expect, it } from 'vitest';
import {
	getKeyboardShortcut,
	getKeyboardShortcutLabel,
	matchesKeyboardShortcut,
	shouldSendMessageForKeyDown,
} from './keyboard-shortcuts';

describe( 'keyboard shortcut helpers', () => {
	it( 'matches primary modifier shortcuts', () => {
		expect(
			matchesKeyboardShortcut(
				{
					key: 'b',
					metaKey: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
					repeat: false,
					defaultPrevented: false,
				},
				getKeyboardShortcut( 'toggle-sidebar' )
			)
		).toBe( true );
	} );

	it( 'ignores repeated or modified shortcut events', () => {
		expect(
			matchesKeyboardShortcut(
				{
					key: 'b',
					metaKey: true,
					ctrlKey: false,
					shiftKey: true,
					altKey: false,
					repeat: false,
					defaultPrevented: false,
				},
				getKeyboardShortcut( 'toggle-sidebar' )
			)
		).toBe( false );
		expect(
			matchesKeyboardShortcut(
				{
					key: 'b',
					metaKey: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
					repeat: true,
					defaultPrevented: false,
				},
				getKeyboardShortcut( 'toggle-sidebar' )
			)
		).toBe( false );
	} );

	it( 'formats primary modifier labels for macOS and other platforms', () => {
		const shortcut = getKeyboardShortcut( 'new-chat-in-current-site' );

		expect( getKeyboardShortcutLabel( shortcut, 'MacIntel' ) ).toBe( '⌘N' );
		expect( getKeyboardShortcutLabel( shortcut, 'Win32' ) ).toBe( 'Ctrl+N' );
	} );

	it( 'matches the configured message send shortcut', () => {
		expect(
			shouldSendMessageForKeyDown(
				{
					key: 'Enter',
					metaKey: false,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
				},
				'enter'
			)
		).toBe( true );
		expect(
			shouldSendMessageForKeyDown(
				{
					key: 'Enter',
					metaKey: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
				},
				'mod-enter'
			)
		).toBe( true );
		expect(
			shouldSendMessageForKeyDown(
				{
					key: 'Enter',
					metaKey: false,
					ctrlKey: false,
					shiftKey: true,
					altKey: false,
				},
				'enter'
			)
		).toBe( false );
	} );
} );
