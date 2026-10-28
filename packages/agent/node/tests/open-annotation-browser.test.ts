import { describe, expect, it, vi } from 'vitest';
import { NOTE_EDITOR_EVENT } from '@studio/agent/node/inspector/note-editor';
import { openAnnotationBrowserTool } from '@studio/agent/node/tools/open-annotation-browser';
import { INSPECTOR_BRIDGE_PREFIX } from '@studio/agent/protocol/inspector/page-script';

const page = vi.hoisted( () => ( {
	handlers: {} as Record< string, ( ( value?: unknown ) => void )[] >,
	editor: undefined as ( ( action: unknown ) => void ) | undefined,
	evaluate: vi.fn( async ( ..._args: unknown[] ) => undefined ),
} ) );
const close = vi.hoisted( () => vi.fn( async () => undefined ) );

vi.mock( '@studio/agent/node/browser-utils', () => ( {
	launchChromiumWithInstall: async () => ( {
		on: () => undefined,
		close,
		newPage: async () => ( {
			evaluate: page.evaluate,
			exposeFunction: async ( _name: string, fn: ( action: unknown ) => void ) => {
				page.editor = fn;
			},
			on: ( event: string, fn: () => void ) => {
				( page.handlers[ event ] ??= [] ).push( fn );
			},
			goto: async () => undefined,
			bringToFront: async () => undefined,
			isClosed: () => false,
		} ),
	} ),
} ) );

function editingId(): string {
	const detail = page.evaluate.mock.calls
		.map( ( [ , args ] ) => args as [ string, { editing?: { id: string } } ] )
		.filter( ( args ) => Array.isArray( args ) && args[ 0 ] === NOTE_EDITOR_EVENT )
		.map( ( [ , value ] ) => value )
		.filter( ( value ) => value.editing )
		.at( -1 );
	return detail?.editing?.id as string;
}

describe( 'open_annotation_browser', () => {
	it( 'returns the notes once the user clicks Send', async () => {
		const result = openAnnotationBrowserTool.rawHandler( { url: 'http://localhost:8881' } );
		await vi.waitFor( () => expect( page.editor ).toBeDefined() );

		page.handlers.console[ 0 ]( {
			text: () =>
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( {
					type: 'pick',
					target: {
						selector: 'h1',
						tag: 'h1',
						nearbyText: 'Welcome',
						url: 'http://localhost:8881/',
					},
					anchor: { left: 10, top: 20 },
				} ),
		} );
		await vi.waitFor( () => expect( editingId() ).toBeTruthy() );
		page.editor?.( { type: 'change', id: editingId(), comment: 'Make it bigger' } );
		page.editor?.( { type: 'save' } );
		page.editor?.( { type: 'send' } );

		const { content } = await result;
		expect( content[ 0 ] ).toMatchObject( {
			type: 'text',
			text: expect.stringContaining( '- Comment: Make it bigger' ),
		} );
		expect( close ).toHaveBeenCalled();
	} );
} );
