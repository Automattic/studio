import { describe, expect, it } from 'vitest';
import {
	getKeyboardShortcut,
	getKeyboardShortcutAriaKeyShortcut,
	getKeyboardShortcutDescriptor,
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

	it( 'formats the sidebar toggle shortcut as command-b on macOS', () => {
		const shortcut = getKeyboardShortcut( 'toggle-sidebar' );

		expect( getKeyboardShortcutLabel( shortcut, 'MacIntel' ) ).toBe( '⌘B' );
	} );

	it( 'formats the app settings shortcut as command-comma on macOS', () => {
		const shortcut = getKeyboardShortcut( 'open-app-settings' );

		expect( getKeyboardShortcutLabel( shortcut, 'MacIntel' ) ).toBe( '⌘,' );
		expect( getKeyboardShortcutLabel( shortcut, 'Win32' ) ).toBe( 'Ctrl+,' );
		expect( getKeyboardShortcutAriaKeyShortcut( shortcut, 'MacIntel' ) ).toBe( 'Meta+,' );
		expect(
			matchesKeyboardShortcut(
				{
					key: ',',
					metaKey: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
					repeat: false,
					defaultPrevented: false,
				},
				shortcut
			)
		).toBe( true );
	} );

	it( 'formats the browser toggle shortcut as command-shift-b on macOS', () => {
		const shortcut = getKeyboardShortcut( 'toggle-site-preview' );

		expect( getKeyboardShortcutLabel( shortcut, 'MacIntel' ) ).toBe( '⌘⇧B' );
		expect( getKeyboardShortcutLabel( shortcut, 'Win32' ) ).toBe( 'Ctrl+Shift+B' );
		expect( getKeyboardShortcutAriaKeyShortcut( shortcut, 'MacIntel' ) ).toBe( 'Meta+Shift+B' );
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
				shortcut
			)
		).toBe( true );
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
				shortcut
			)
		).toBe( false );
	} );

	it( 'formats shortcut metadata for tooltip and accessibility output', () => {
		const shortcut = getKeyboardShortcut( 'toggle-site-menu' );

		expect( getKeyboardShortcutLabel( shortcut, 'MacIntel' ) ).toBe( '⌘I' );
		expect( getKeyboardShortcutAriaKeyShortcut( shortcut, 'MacIntel' ) ).toBe( 'Meta+I' );
		expect( getKeyboardShortcutDescriptor( shortcut, 'Win32' ) ).toEqual( {
			displayShortcut: 'Ctrl+I',
			ariaKeyShortcut: 'Control+I',
		} );
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
