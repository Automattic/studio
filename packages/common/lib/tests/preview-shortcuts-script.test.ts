/** @vitest-environment node */
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_SHORTCUTS_SCRIPT } from '../preview-shortcuts-script';

function createPage( pathname = '/', apple = true ) {
	const postMessage = vi.fn();
	const parent = { postMessage };
	const handlers = new Map< string, ( event: object ) => void >();
	const window = {
		parent,
		addEventListener: ( name: string, handler: ( event: object ) => void ) =>
			handlers.set( name, handler ),
	};
	const document = { addEventListener: window.addEventListener };
	runInNewContext( PREVIEW_SHORTCUTS_SCRIPT, { window, document, location: { pathname }, URL } );
	const initialize = ( source: unknown = parent, origin = 'http://localhost:8081' ) =>
		handlers.get( 'message' )!( {
			source,
			origin,
			data: { type: 'studio:preview-shortcuts:init', apple },
		} );
	const press = ( overrides = {} ) => {
		const event = {
			code: 'KeyK',
			metaKey: apple,
			ctrlKey: ! apple,
			altKey: false,
			shiftKey: false,
			repeat: false,
			isComposing: false,
			getModifierState: () => false,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			...overrides,
		};
		handlers.get( 'keydown' )!( event );
		return event;
	};
	return { initialize, press, postMessage };
}

describe( 'browser preview shortcut bridge', () => {
	it.each( [ true, false ] )( 'forwards the front-end shortcut (Apple: %s)', ( apple ) => {
		const page = createPage( '/', apple );
		page.initialize();
		expect( page.press().preventDefault ).toHaveBeenCalled();
		expect( page.postMessage ).toHaveBeenCalledWith(
			{ type: 'studio:preview-shortcuts:command-palette' },
			'http://localhost:8081'
		);
	} );

	it( 'works on the login screen', () => {
		const page = createPage( '/wp-login.php' );
		page.initialize();
		expect( page.press().preventDefault ).toHaveBeenCalled();
	} );

	it.each( [
		'/wp-admin',
		'/wp-admin/',
		'/wp-admin/post.php',
		'/wordpress/wp-admin/site-editor.php',
	] )( 'leaves %s to WordPress', ( path ) => {
		const page = createPage( path );
		page.initialize();
		expect( page.press().preventDefault ).not.toHaveBeenCalled();
		expect( page.postMessage ).not.toHaveBeenCalled();
	} );

	it( 'does not intercept keys without a handshake from its parent', () => {
		const page = createPage();
		page.press();
		page.initialize( {} );
		page.press();
		expect( page.postMessage ).not.toHaveBeenCalled();
	} );

	it.each( [
		{ shiftKey: true },
		{ altKey: true },
		{ repeat: true },
		{ isComposing: true },
		{ code: 'KeyT' },
		{ metaKey: false },
		{ ctrlKey: true },
	] )( 'preserves other input: %j', ( overrides ) => {
		const page = createPage();
		page.initialize();
		expect( page.press( overrides ).preventDefault ).not.toHaveBeenCalled();
		expect( page.postMessage ).not.toHaveBeenCalled();
	} );
} );
