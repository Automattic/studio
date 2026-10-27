import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { INSPECTOR_BRIDGE_PREFIX } from '@studio/common/ai/inspector/page-script';
import { describe, expect, it, vi } from 'vitest';
import { NOTE_EDITOR_EVENT } from '../inspector/note-editor';
import { openAnnotationBrowserTool } from '../tools/open-annotation-browser';

const page = vi.hoisted( () => ( {
	handlers: {} as Record< string, ( ( value?: unknown ) => void )[] >,
	editor: undefined as ( ( action: unknown ) => void ) | undefined,
	evaluate: vi.fn( async ( ..._args: unknown[] ) => undefined ),
	goto: vi.fn( async ( _url: string ) => undefined ),
} ) );
const close = vi.hoisted( () => vi.fn( async () => undefined ) );

vi.mock( 'cli/ai/browser-utils', () => ( {
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
		const root = mkdtempSync( path.join( tmpdir(), 'annotate-' ) );
		const site = { id: '1', name: 'My Site', path: root, port: 8881, phpVersion: '8.3' };
		writeFileSync(
			path.join( root, 'cli.json' ),
			JSON.stringify( { version: 1, sites: [ site ] } )
		);
		vi.stubEnv( 'E2E', '1' );
		vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );
		const result = openAnnotationBrowserTool.rawHandler( {
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
		page.editor?.( { type: 'change', id: editingId(), comment: 'Make it bigger' } );
		page.editor?.( { type: 'save' } );
		page.editor?.( { type: 'send' } );

		const { content } = await result;
		expect( content[ 0 ] ).toMatchObject( {
			type: 'text',
			text: expect.stringContaining( '- Comment: Make it bigger' ),
		} );
		expect( close ).toHaveBeenCalled();
		expect( page.goto.mock.calls[ 0 ][ 0 ] ).toBe( 'http://localhost:8881/about' );
	} );

	it( 'closes the browser and stops waiting when the turn is stopped', async () => {
		const root = mkdtempSync( path.join( tmpdir(), 'annotate-' ) );
		const site = { id: '1', name: 'My Site', path: root, port: 8881, phpVersion: '8.3' };
		writeFileSync(
			path.join( root, 'cli.json' ),
			JSON.stringify( { version: 1, sites: [ site ] } )
		);
		vi.stubEnv( 'E2E', '1' );
		vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );
		close.mockClear();
		page.editor = undefined;
		const turn = new AbortController();
		const result = openAnnotationBrowserTool.execute(
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
