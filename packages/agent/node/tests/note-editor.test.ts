import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	NOTE_EDITOR_BINDING,
	NOTE_EDITOR_EVENT,
	NOTE_EDITOR_SCRIPT,
} from '@studio/agent/node/inspector/note-editor';

const labels = {
	placeholder: 'Leave a note…',
	cancel: 'Cancel',
	send: 'Send',
	status: '1 annotation',
};

function mount() {
	const binding = vi.fn();
	vi.stubGlobal( NOTE_EDITOR_BINDING, binding );
	vi.stubGlobal( 'requestAnimationFrame', () => 0 );
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
		}
	);
	new Function( NOTE_EDITOR_SCRIPT )();
	const root = document.getElementById( '__studio-note-editor' )?.shadowRoot as ShadowRoot;
	const publish = ( detail: Record< string, unknown > ) =>
		window.dispatchEvent( new CustomEvent( NOTE_EDITOR_EVENT, { detail } ) );
	return { binding, root, publish };
}

describe( 'annotation browser note editor', () => {
	afterEach( () => {
		( window as Window & { __studioNoteEditorDispose?: () => void } ).__studioNoteEditorDispose?.();
		vi.unstubAllGlobals();
	} );

	it( 'reports the note as it is typed, saves on Enter, and sends from the bar', () => {
		const { binding, root, publish } = mount();
		publish( {
			labels,
			count: 1,
			anchor: { left: 10, top: 20 },
			editing: { id: 'n1', comment: '', images: [] },
		} );
		const input = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		const editor = root.querySelector( '.editor' ) as HTMLElement;
		expect( editor.hidden ).toBe( false );

		input.value = 'Make this bigger';
		input.dispatchEvent( new Event( 'input' ) );
		input.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', cancelable: true } ) );
		( root.querySelector( '.send' ) as HTMLButtonElement ).click();

		expect( binding.mock.calls.map( ( [ action ] ) => action ) ).toEqual( [
			{ type: 'change', id: 'n1', comment: 'Make this bigger' },
			{ type: 'save' },
			{ type: 'send' },
		] );
		expect( root.querySelector( '.status' )?.textContent ).toBe( '1 annotation' );
	} );

	it( 'closes the editor and keeps Send disabled without notes', () => {
		const { root, publish } = mount();
		publish( { labels, count: 0, anchor: null, editing: null } );

		expect( ( root.querySelector( '.editor' ) as HTMLElement ).hidden ).toBe( true );
		expect( ( root.querySelector( '.send' ) as HTMLButtonElement ).disabled ).toBe( true );
	} );
} );
