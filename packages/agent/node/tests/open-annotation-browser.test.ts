import { describe, expect, it, vi } from 'vitest';
import { NOTE_EDITOR_EVENT } from '@studio/agent/node/inspector/note-editor';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { openAnnotationBrowserTool } from '@studio/agent/node/tools/open-annotation-browser';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
} from '@studio/agent/protocol/inspector/page-script';
import { createFakeHost } from './fake-host';

const page = vi.hoisted( () => ( {
	handlers: {} as Record< string, ( ( value?: unknown ) => void )[] >,
	editor: undefined as ( ( action: unknown ) => void ) | undefined,
	evaluate: vi.fn( async ( ..._args: unknown[] ) => undefined ),
	goto: vi.fn( async ( _url: string ) => undefined ),
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
			goto: page.goto,
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
	it( 'opens the page of the site it names, and returns the notes once the user clicks Send', async () => {
		const result = bindTool( openAnnotationBrowserTool, createFakeHost() ).rawHandler( {
			nameOrPath: 'My Site',
			page: '/about',
		} );
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
		const id = editingId();
		const markerState = () =>
			page.evaluate.mock.calls
				.map( ( [ , args ] ) => args as [ string, { notes: { id: string; pending: boolean }[] } ] )
				.filter( ( args ) => Array.isArray( args ) && args[ 0 ] === INSPECTOR_COMMAND_EVENT )
				.at( -1 )?.[ 1 ].notes;
		expect( markerState() ).toMatchObject( [ { id, pending: true } ] );
		page.editor?.( { type: 'change', id, comment: 'Make it bigger' } );
		page.handlers.console[ 0 ]( {
			text: () => INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'escape' } ),
		} );
		await vi.waitFor( () => expect( markerState() ).toMatchObject( [ { id, pending: true } ] ) );
		const edit = () =>
			page.handlers.console[ 0 ]( {
				text: () =>
					INSPECTOR_BRIDGE_PREFIX +
					JSON.stringify( { type: 'edit', id, anchor: { left: 10, top: 20 } } ),
			} );
		edit();
		page.editor?.( { type: 'save' } );
		await vi.waitFor( () => expect( markerState() ).toMatchObject( [ { id, pending: false } ] ) );
		edit();
		await vi.waitFor( () => expect( markerState() ).toMatchObject( [ { id, pending: false } ] ) );
		page.editor?.( { type: 'send' } );

		const { content } = await result;
		expect( content[ 0 ] ).toMatchObject( {
			type: 'text',
			text: expect.stringContaining( '- Comment: Make it bigger' ),
		} );
		expect( close ).toHaveBeenCalled();
		expect( page.goto.mock.calls[ 0 ][ 0 ] ).toBe( 'http://localhost:8888/about' );
	} );

	it( 'closes the browser and stops waiting when the turn is stopped', async () => {
		close.mockClear();
		page.editor = undefined;
		const turn = new AbortController();
		const result = bindTool( openAnnotationBrowserTool, createFakeHost() ).execute(
			'a',
			{ nameOrPath: 'My Site' } as never,
			turn.signal
		);
		await vi.waitFor( () => expect( page.editor ).toBeDefined() );
		turn.abort();
		expect( ( await result ).content ).toEqual( [
			{
				type: 'text',
				text: 'The user closed the annotation browser without sending annotations.',
			},
		] );
		expect( close ).toHaveBeenCalled();
	} );
} );
