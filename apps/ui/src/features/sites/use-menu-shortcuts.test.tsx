import { fireEvent, render, screen } from '@testing-library/react';
import { displayShortcut } from '@wordpress/keycodes';
import { afterEach, expect, it, vi } from 'vitest';
import { useItemShortcuts } from './use-item-shortcuts';

function Scope( {
	name,
	active,
	rename,
	pin,
	archive,
}: {
	name: string;
	active?: 'site' | 'chat';
	rename: () => void;
	pin: () => void;
	archive?: () => void;
} ) {
	const props = useItemShortcuts( { rename, pin, archive } );
	return (
		<div { ...props } data-item-shortcuts-active={ active }>
			<button>{ name }</button>
			<input aria-label={ `${ name } input` } />
		</div>
	);
}

afterEach( () => vi.restoreAllMocks() );

it.each( [ 'MacIntel', 'Win32', 'Linux x86_64' ] )(
	'routes shortcuts to the focused row and active chat on %s',
	( platform ) => {
		vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
		const siteRename = vi.fn();
		const chatRename = vi.fn();
		const pin = vi.fn();
		render(
			<>
				<Scope name="Site" active="site" rename={ siteRename } pin={ pin } />
				<Scope name="Chat" active="chat" rename={ chatRename } pin={ pin } />
			</>
		);
		const modifiers = {
			altKey: true,
			metaKey: platform === 'MacIntel',
			ctrlKey: platform !== 'MacIntel',
		};
		fireEvent.keyDown( document.body, { code: 'KeyR', key: '®', ...modifiers } );
		expect( chatRename ).toHaveBeenCalledOnce();
		expect( siteRename ).not.toHaveBeenCalled();
		fireEvent.keyDown( screen.getByText( 'Site' ), { code: 'KeyR', ...modifiers } );
		expect( siteRename ).toHaveBeenCalledOnce();
		fireEvent.keyDown( screen.getByText( 'Chat' ), { code: 'KeyP', ...modifiers } );
		expect( pin ).toHaveBeenCalledOnce();
		fireEvent.keyDown( screen.getByLabelText( 'Site input' ), { code: 'KeyR', ...modifiers } );
		fireEvent.keyDown( document.body, { code: 'KeyR', ...modifiers, repeat: true } );
		fireEvent.keyDown( document.body, { code: 'KeyR', ...modifiers, shiftKey: true } );
		expect( siteRename ).toHaveBeenCalledOnce();
		expect( chatRename ).toHaveBeenCalledOnce();
		expect( displayShortcut.primaryAlt( 'r' ) ).toBe(
			platform === 'MacIntel' ? '⌥⌘R' : 'Ctrl+Alt+R'
		);
	}
);

it.each( [ 'MacIntel', 'Win32' ] )(
	'archives only the scoped chat with Shift on %s',
	( platform ) => {
		vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
		const archive = vi.fn();
		render(
			<>
				<Scope name="Site" active="site" rename={ vi.fn() } pin={ vi.fn() } />
				<Scope name="Chat" active="chat" rename={ vi.fn() } pin={ vi.fn() } archive={ archive } />
			</>
		);
		const key = {
			code: 'KeyA',
			shiftKey: true,
			metaKey: platform === 'MacIntel',
			ctrlKey: platform !== 'MacIntel',
		};
		fireEvent.keyDown( screen.getByText( 'Site' ), key );
		fireEvent.keyDown( screen.getByLabelText( 'Chat input' ), key );
		fireEvent.keyDown( document.body, { ...key, repeat: true } );
		fireEvent.keyDown( document.body, { ...key, altKey: true } );
		expect( archive ).not.toHaveBeenCalled();
		fireEvent.keyDown( document.body, key );
		expect( archive ).toHaveBeenCalledOnce();
		expect( displayShortcut.primaryShift( 'a' ) ).toBe(
			platform === 'MacIntel' ? '⇧⌘A' : 'Ctrl+Shift+A'
		);
	}
);
