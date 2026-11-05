/** @vitest-environment node */
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
	PREVIEW_SHORTCUTS_SCRIPT,
	READ_ADMIN_BAR_VISIBILITY_SCRIPT,
	READ_AUTO_LOGIN_SCRIPT,
} from '../preview-shortcuts-script';

function createPage(
	pathname = '/',
	apple = true,
	options: { cookie?: string; loggedIn?: boolean; embedded?: boolean } = {}
) {
	const postMessage = vi.fn();
	const parent = { postMessage };
	const handlers = new Map< string, ( event: object ) => void >();
	const window: {
		parent: unknown;
		addEventListener: ( name: string, handler: ( event: object ) => void ) => void;
	} = {
		parent,
		addEventListener: ( name: string, handler: ( event: object ) => void ) =>
			handlers.set( name, handler ),
	};
	if ( options.embedded === false ) window.parent = window;
	const bar = { visible: false, checkVisibility: () => bar.visible };
	const attributes = new Map< string, string >();
	const document = {
		cookie: options.cookie ?? '',
		currentScript: {
			dataset: {
				studioAutoLoginCookie: 'studio_auto_login_site',
				studioLoggedIn: options.loggedIn ? 'true' : 'false',
			},
		},
		documentElement: {
			getAttribute: ( name: string ) => attributes.get( name ) ?? null,
			setAttribute: ( name: string, value: string ) => attributes.set( name, value ),
			removeAttribute: ( name: string ) => attributes.delete( name ),
		},
		title: 'Preview page',
		addEventListener: window.addEventListener,
		getElementById: () => bar,
	};
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
			data: { type: 'studio:preview-shortcuts:init', apple, navigationId: 7 },
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
	return { initialize, press, postMessage, login, location, bar, readAdminBar, handlers, document };
}

describe( 'browser preview shortcut bridge', () => {
	it( 'reports confirmed automatic login once after the parent handshake', () => {
		const page = createPage( '/', true, { cookie: 'studio_auto_login_site=1', loggedIn: true } );
		expect( page.document.cookie ).toContain( 'Max-Age=0' );
		expect( page.postMessage ).not.toHaveBeenCalled();
		page.initialize();
		page.initialize();
		page.readAdminBar();
		page.handlers.get( 'pageshow' )!( {} );
		expect(
			page.postMessage.mock.calls.filter(
				( [ message ] ) => message.type === 'studio:preview:auto-login'
			)
		).toEqual( [
			[ { type: 'studio:preview:auto-login', navigationId: 7 }, 'http://localhost:8081' ],
		] );
	} );

	it.each( [
		{ cookie: '', loggedIn: true },
		{ cookie: 'studio_auto_login_other=1', loggedIn: true },
		{ cookie: 'studio_auto_login_site=1', loggedIn: false },
	] )( 'does not announce an existing, unrelated, or failed session: %j', ( options ) => {
		const page = createPage( '/', true, options );
		page.initialize();
		expect(
			page.postMessage.mock.calls.some(
				( [ message ] ) => message.type === 'studio:preview:auto-login'
			)
		).toBe( false );
	} );

	it( 'lets the desktop consume the same confirmation once', () => {
		const page = createPage( '/', true, {
			cookie: 'studio_auto_login_site=1',
			loggedIn: true,
			embedded: false,
		} );
		expect( runInNewContext( READ_AUTO_LOGIN_SCRIPT, { document: page.document } ) ).toBe( true );
		expect( runInNewContext( READ_AUTO_LOGIN_SCRIPT, { document: page.document } ) ).toBe( false );
		expect( page.postMessage ).not.toHaveBeenCalled();
	} );
	it( 'reports the actual toolbar visibility at initialization and when asked again', () => {
		const page = createPage();
		page.initialize();
		expect( page.postMessage ).toHaveBeenLastCalledWith(
			{
				type: 'studio:preview:admin-bar-state',
				visible: false,
				url: page.location.href,
				title: 'Preview page',
				navigationId: 7,
			},
			'http://localhost:8081'
		);
		page.bar.visible = true;
		page.readAdminBar();
		expect( page.postMessage ).toHaveBeenLastCalledWith(
			{
				type: 'studio:preview:admin-bar-state',
				visible: true,
				url: page.location.href,
				title: 'Preview page',
				navigationId: 7,
			},
			'http://localhost:8081'
		);
	} );

	it( 'reports navigation and the restored page location without signing in', () => {
		const page = createPage( '/sample-page/' );
		page.initialize();
		page.handlers.get( 'pagehide' )!( {} );
		expect( page.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'studio:preview:navigating', navigationId: 7 },
			'http://localhost:8081'
		);
		page.location.href += '#details';
		for ( const event of [ 'pageshow', 'hashchange', 'popstate' ] ) {
			page.handlers.get( event )!( {} );
			expect( page.postMessage ).toHaveBeenLastCalledWith(
				expect.objectContaining( { url: page.location.href, navigationId: 7 } ),
				'http://localhost:8081'
			);
		}
		expect( page.location.assign ).not.toHaveBeenCalled();
	} );

	it( 'leaves non-HTML responses unavailable', () => {
		expect(
			runInNewContext( READ_ADMIN_BAR_VISIBILITY_SCRIPT, {
				document: { contentType: 'application/json' },
			} )
		).toBeNull();
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

	it.each( [ '/wp-admin/post.php', '/wp-login.php', '/wp-signup.php', '/wp-activate.php' ] )(
		'leaves %s intact when a late sign-in request arrives',
		( path ) => {
			const page = createPage( path );
			page.initialize();
			page.login();
			expect( page.location.assign ).not.toHaveBeenCalled();
		}
	);

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
