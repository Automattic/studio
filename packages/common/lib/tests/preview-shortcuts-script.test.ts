/** @vitest-environment node */
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
	PREVIEW_SHORTCUTS_SCRIPT,
	READ_ADMIN_BAR_VISIBILITY_SCRIPT,
} from '../preview-shortcuts-script';

function createPage( pathname = '/', apple = true ) {
	const postMessage = vi.fn();
	const parent = { postMessage };
	const handlers = new Map< string, ( event: object ) => void >();
	const window = {
		parent,
		addEventListener: ( name: string, handler: ( event: object ) => void ) =>
			handlers.set( name, handler ),
	};
	const bar = { visible: false, checkVisibility: () => bar.visible };
	const document = { addEventListener: window.addEventListener, getElementById: () => bar };
	const location = { pathname, href: `http://localhost:9010${ pathname }`, assign: vi.fn() };
	runInNewContext( PREVIEW_SHORTCUTS_SCRIPT, { window, document, location, URL } );
	const login = ( source: unknown = parent, origin = 'http://localhost:8081' ) =>
		handlers.get( 'message' )!( {
			source,
			origin,
			data: { type: 'studio:preview:login' },
		} );
	const initialize = ( source: unknown = parent, origin = 'http://localhost:8081' ) =>
		handlers.get( 'message' )!( {
			source,
			origin,
			data: { type: 'studio:preview-shortcuts:init', apple },
		} );
	const readAdminBar = ( source: unknown = parent, origin = 'http://localhost:8081' ) =>
		handlers.get( 'message' )!( {
			source,
			origin,
			data: { type: 'studio:preview:read-admin-bar' },
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
	return { initialize, press, postMessage, login, location, bar, readAdminBar };
}

describe( 'browser preview shortcut bridge', () => {
	it( 'reports the actual toolbar visibility at initialization and when asked again', () => {
		const page = createPage();
		page.initialize();
		expect( page.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'studio:preview:admin-bar-state', visible: false },
			'http://localhost:8081'
		);
		page.bar.visible = true;
		page.readAdminBar();
		expect( page.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'studio:preview:admin-bar-state', visible: true },
			'http://localhost:8081'
		);
	} );

	it( 'only reports toolbar state to its initialized parent origin', () => {
		const page = createPage();
		page.readAdminBar();
		expect( page.postMessage ).not.toHaveBeenCalled();
		page.initialize();
		page.postMessage.mockClear();
		page.readAdminBar( {} );
		page.readAdminBar( undefined, 'https://unrelated.test' );
		expect( page.postMessage ).not.toHaveBeenCalled();
	} );

	it( 'treats a missing toolbar as hidden and checks CSS visibility when present', () => {
		expect(
			runInNewContext( READ_ADMIN_BAR_VISIBILITY_SCRIPT, {
				document: { getElementById: () => null },
			} )
		).toBe( false );
		const checkVisibility = vi.fn( () => true );
		expect(
			runInNewContext( READ_ADMIN_BAR_VISIBILITY_SCRIPT, {
				document: { getElementById: () => ( { checkVisibility } ) },
			} )
		).toBe( true );
		expect( checkVisibility ).toHaveBeenCalledWith( {
			checkOpacity: true,
			checkVisibilityCSS: true,
		} );
	} );
	it( 'signs in through the local endpoint and returns to the current page', () => {
		const page = createPage( '/sample-page/' );
		page.location.href += '?preview=1#details';
		page.initialize();
		page.login();
		const loginUrl = new URL( page.location.assign.mock.calls[ 0 ][ 0 ] );
		expect( loginUrl.origin ).toBe( 'http://localhost:9010' );
		expect( loginUrl.pathname ).toBe( '/studio-auto-login' );
		expect( loginUrl.searchParams.get( 'redirect_to' ) ).toBe( page.location.href );
	} );

	it( 'only accepts sign-in requests from its initialized parent origin', () => {
		const page = createPage();
		page.login();
		page.initialize();
		page.login( {} );
		page.login( undefined, 'http://unrelated.test' );
		expect( page.location.assign ).not.toHaveBeenCalled();
	} );

	it( 'leaves WP Admin intact when a late sign-in request arrives', () => {
		const page = createPage( '/wp-admin/post.php' );
		page.initialize();
		page.login();
		expect( page.location.assign ).not.toHaveBeenCalled();
	} );

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
		expect( page.postMessage ).not.toHaveBeenCalledWith(
			{ type: 'studio:preview-shortcuts:command-palette' },
			'http://localhost:8081'
		);
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
		expect( page.postMessage ).not.toHaveBeenCalledWith(
			{ type: 'studio:preview-shortcuts:command-palette' },
			'http://localhost:8081'
		);
	} );
} );
