import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests } from '@/data/app-messages';
import { updateResponsivePreview } from '@/data/responsive-preview';
import { clearComposerDrafts } from '@/features/composer';
import splitStyles from '@/features/sites/panel-split-frame/style.module.css';
import { createFakeConnector, makeSession, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

const COMPOSER = { name: 'Message WordPress Studio' };

const site = ( overrides: Partial< SiteDetails > = {} ) =>
	makeSite( { id: 'one', name: 'My site', path: '/sites/my-site', ...overrides } );

function chatFor( owner: SiteDetails, id = `${ owner.id }-chat` ) {
	return {
		summary: makeSession( {
			id,
			title: `${ owner.name } chat`,
			ownerSiteId: owner.id,
			ownerSitePath: owner.path,
		} ),
		entries: [],
	};
}

function setup( sites: SiteDetails[] = [ site() ], path = '/sites/one' ) {
	const connector = createFakeConnector( {
		sites,
		sessions: sites.map( ( item ) => chatFor( item ) ),
	} );
	return renderApp( { connector, path } );
}

async function restartFromPalette() {
	const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
	fireEvent.keyDown( document, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
	fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
		target: { value: 'Restart site' },
	} );
	fireEvent.click( await screen.findByRole( 'option', { name: /^Restart site/ } ) );
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise< void >( ( done ) => {
		resolve = done;
	} );
	return { promise, resolve };
}

// The sidebar row's start/stop control, whatever its busy label.
function lifecycle( siteName: string ) {
	return screen
		.getByRole( 'button', { name: siteName } )
		.closest( 'li, section' )!
		.querySelector< HTMLButtonElement >( 'button[data-state]' )!;
}

const panelShown = () => screen.queryByRole( 'complementary', { name: 'Panel' } ) !== null;
const frame = () => document.querySelector( 'iframe, webview' );
const layoutMotion = () => document.querySelector( `.${ splitStyles.rootPreviewAnimating }` );

// jsdom's <webview> is a bare element; give it the guest id a loaded page reports.
function loadWebview() {
	const webview = frame()!;
	Object.assign( webview, {
		getWebContentsId: () => 1,
		executeJavaScript: async () => '',
	} );
	fireEvent( webview, new Event( 'did-finish-load' ) );
}

function useElectron() {
	vi.spyOn( navigator, 'userAgent', 'get' ).mockReturnValue( 'Mozilla/5.0 Electron/38.0.0' );
}

beforeEach( () => {
	localStorage.clear();
	clearComposerDrafts();
	resetAppMessagesForTests();
} );

afterEach( () => {
	vi.restoreAllMocks();
} );

describe( 'site lifecycle and preview', () => {
	it.each( [ '/sites/one', '/sessions/one-chat' ] )(
		'attaches a screenshot to the site composer from %s',
		async ( path ) => {
			useElectron();
			const { history, user, connector } = setup( [ site( { running: true } ) ], path );
			await waitFor( () => expect( frame() ).not.toBeNull() );
			loadWebview();
			Object.assign( frame()!, {
				capturePage: async () => ( {
					isEmpty: () => false,
					toDataURL: () => 'data:image/png;base64,c2NyZWVuc2hvdA==',
				} ),
			} );
			fireEvent( frame()!, new Event( 'did-stop-loading' ) );
			if ( path.startsWith( '/sessions/' ) ) {
				fireEvent.change( await screen.findByRole( 'combobox', COMPOSER ), {
					target: { value: 'Keep this draft' },
				} );
				await user.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
			}

			await user.click( await screen.findByRole( 'button', { name: 'Browser options' } ) );
			await user.click( await screen.findByRole( 'menuitem', { name: 'Take screenshot' } ) );

			const input = await screen.findByRole( 'combobox', COMPOSER );
			expect( input ).toBeVisible();
			await screen.findByRole( 'button', { name: /^Preview screenshot-.*\.png$/ } );
			await waitFor( () => expect( input ).toHaveFocus() );
			expect( input ).toHaveValue( path.startsWith( '/sessions/' ) ? 'Keep this draft' : '' );
			expect( history.location.pathname ).toBe(
				path.startsWith( '/sessions/' ) ? path : '/sites/one/new'
			);
			expect( connector.continueSession ).not.toHaveBeenCalled();
		}
	);

	it.each( [ undefined, true, false ] )(
		'uses the startup layout preference: %s',
		async ( openChatOnSiteStart ) => {
			const connector = createFakeConnector( {
				sites: [ site() ],
				preferences: { openChatOnSiteStart },
			} );
			const { history } = renderApp( { connector, path: '/sites/one' } );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
			if ( openChatOnSiteStart !== false )
				expect( await screen.findByRole( 'combobox', COMPOSER ) ).toBeVisible();
			else expect( screen.queryByRole( 'combobox', COMPOSER ) ).not.toBeInTheDocument();
		}
	);

	it.each( [ true, false ] )(
		'opens another site using the startup preference: %s',
		async ( openChatOnSiteStart ) => {
			const connector = createFakeConnector( {
				sites: [ site(), site( { id: 'two', name: 'Second', path: '/sites/two' } ) ],
				preferences: { openChatOnSiteStart },
			} );
			const { history } = renderApp( { connector, path: '/sites/one' } );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Start Second' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		}
	);

	it.each(
		[ true, false ].flatMap( ( fullscreen ) =>
			[ 'thumbnail', 'composer', 'palette', 'sidebar' ].flatMap( ( control ) =>
				[ '/sites/one', '/sites/one/new' ]
					.filter(
						( path ) => ! [ 'composer', 'thumbnail' ].includes( control ) || path.endsWith( '/new' )
					)
					.map( ( path ) => ( { fullscreen, control, path } ) )
			)
		)
	)(
		'uses the startup setting ($fullscreen) from $control at $path',
		async ( { fullscreen, control, path } ) => {
			const connector = createFakeConnector(
				{ sites: [ site() ], preferences: { openChatOnSiteStart: ! fullscreen } },
				{ getSiteThumbnail: async () => 'data:image/png;base64,eA==' }
			);
			const { history } = renderApp( { connector, path } );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			const start = deferred();
			connector.startSite.mockImplementationOnce( () => start.promise );
			if ( control === 'palette' ) {
				const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
				fireEvent.keyDown( document, {
					code: 'KeyK',
					key: 'k',
					metaKey: isApple,
					ctrlKey: ! isApple,
				} );
				fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
					target: { value: 'Start site' },
				} );
				fireEvent.click( await screen.findByRole( 'option', { name: /^Start site/ } ) );
			} else if ( control === 'thumbnail' ) {
				fireEvent.click( await screen.findByRole( 'button', { name: 'Start from preview' } ) );
			} else if ( control === 'composer' ) {
				const input = await screen.findByRole( 'combobox', COMPOSER );
				fireEvent.click(
					within( input.closest( '[role="group"]' )! ).getByRole( 'button', { name: 'Start site' } )
				);
			} else {
				fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
			}
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			const openChat = ! fullscreen;
			const assertLayout = () => {
				const chat = screen.queryByRole( 'combobox', COMPOSER );
				if ( openChat ) expect( chat ).toBeVisible();
				else expect( chat ).not.toBeInTheDocument();
				expect( panelShown() ).toBe( true );
			};
			if ( path === '/sites/one' ) await waitFor( assertLayout );
			else {
				expect( screen.getByRole( 'combobox', COMPOSER ) ).toBeVisible();
				expect( panelShown() ).toBe( false );
			}
			connector.state.sites = [ site( { running: true } ) ];
			await act( async () => start.resolve() );
			await waitFor( () => expect( frame() ).toBeInTheDocument() );
			expect( panelShown() ).toBe( path === '/sites/one' );
			fireEvent.load( frame()! );
			await waitFor( assertLayout );
			await waitFor( () => expect( layoutMotion() ).toBeNull() );
			expect( history.location.pathname ).toBe( '/sites/one/new' );
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it.each( [ 'browser', 'desktop' ] as const )(
		'keeps chat visible until the %s startup preview is ready',
		async ( runtime ) => {
			if ( runtime === 'desktop' ) {
				useElectron();
			}
			const { connector } = setup( [ site() ], '/sessions/one-chat' );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			const composer = await screen.findByRole( 'combobox', COMPOSER );
			fireEvent.change( composer, { target: { value: 'Keep this startup draft' } } );
			const start = deferred();
			connector.startSite.mockImplementationOnce( () => start.promise );
			fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalled() );
			expect( panelShown() ).toBe( false );
			expect( frame() ).toBeNull();
			connector.state.sites = [ site( { running: true } ) ];
			await act( () =>
				connector.emit( 'onSiteEvent', {
					event: SITE_EVENTS.UPDATED,
					siteId: 'one',
					running: true,
				} )
			);
			expect(
				screen.queryByRole( 'toolbar', { name: 'Preview browser controls' } )
			).not.toBeInTheDocument();
			await waitFor( () => expect( frame() ).toBeInTheDocument() );
			await act( async () => start.resolve() );
			await waitFor( () => expect( frame() ).toBeInTheDocument() );
			expect( screen.getByRole( 'combobox', COMPOSER ) ).toBeVisible();
			expect( panelShown() ).toBe( false );
			if ( runtime === 'desktop' ) {
				loadWebview();
			} else {
				fireEvent.load( frame()! );
			}
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			expect( panelShown() ).toBe( true );
			expect( screen.getByRole( 'combobox', COMPOSER ) ).toBe( composer );
			expect( composer ).toHaveValue( 'Keep this startup draft' );
		}
	);

	it( 'reveals a failed startup preview so it can be retried', async () => {
		useElectron();
		setup( [ site() ], '/sessions/one-chat' );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( frame() ).toBeInTheDocument() );
		fireEvent(
			frame()!,
			Object.assign( new Event( 'did-fail-load' ), { errorCode: -102, isMainFrame: true } )
		);
		expect( await screen.findByText( 'Browser could not load.' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Try again' } ) ).toBeVisible();
		expect( panelShown() ).toBe( true );
	} );

	it.each( [ 'split', 'panel', 'chat' ] )(
		'returns to chat when stopped from the sidebar in %s',
		async ( layout ) => {
			const { connector } = setup( [ site( { running: true } ) ], '/sessions/one-chat' );
			await screen.findByRole( 'textbox', { name: 'Address' } );
			fireEvent.change( screen.getByRole( 'combobox', COMPOSER ), {
				target: { value: 'Keep this site draft' },
			} );
			const composer = screen.getByRole( 'combobox', COMPOSER );
			if ( layout !== 'split' ) {
				fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
			}
			if ( layout === 'chat' ) {
				fireEvent.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
			}
			const stop = deferred();
			connector.stopSite.mockImplementationOnce( () => stop.promise );
			if ( layout !== 'panel' ) {
				expect( composer ).toBeVisible();
			} else {
				await waitFor( () => expect( composer.closest( '[aria-hidden="true"]' ) ).not.toBeNull() );
			}
			fireEvent.click( screen.getByRole( 'button', { name: 'Stop My site' } ) );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
			connector.state.sites = [ site() ];
			await act( async () => stop.resolve() );
			await screen.findByRole( 'button', { name: 'Start My site' } );
			await waitFor( () => expect( panelShown() ).toBe( false ) );
			expect( layoutMotion() ).toBeNull();
			expect( composer ).toBeVisible();
			expect( screen.queryByRole( 'button', { name: 'Show chat' } ) ).not.toBeInTheDocument();
			expect( composer ).toHaveValue( 'Keep this site draft' );
			expect( screen.getByRole( 'combobox', { ...COMPOSER, hidden: true } ) ).toBe( composer );
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it.each( [
		{ layout: 'split', openChatOnSiteStart: false },
		{ layout: 'panel', openChatOnSiteStart: true },
		{ layout: 'chat', openChatOnSiteStart: false },
		{ layout: 'site home', openChatOnSiteStart: true },
	] )(
		'preserves $layout throughout restart with startup chat preference $openChatOnSiteStart',
		async ( { layout, openChatOnSiteStart } ) => {
			const path = layout === 'site home' ? '/sites/one' : '/sessions/one-chat';
			const connector = createFakeConnector( {
				sites: [ site( { running: true } ) ],
				sessions: [ chatFor( site() ) ],
				preferences: { openChatOnSiteStart },
			} );
			const { history } = renderApp( { connector, path } );
			const address = await screen.findByRole( 'textbox', { name: 'Address' } );
			fireEvent.change( address, { target: { value: 'http://localhost:9010/about/' } } );
			fireEvent.submit( address.closest( 'form' )! );
			await waitFor( () => expect( frame()?.getAttribute( 'src' ) ).toContain( '/about/' ) );
			act( () => updateResponsivePreview( 'one', { enabled: true, width: 390, height: 844 } ) );
			if ( layout === 'panel' )
				fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
			if ( layout === 'chat' )
				fireEvent.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
			const layoutControl = screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } );
			const expectedLayout = layout === 'site home' ? 'panel' : layout;
			await waitFor( () =>
				expect( layoutControl ).toHaveAttribute( 'data-workspace-layout', expectedLayout )
			);
			const selectedTabName = screen.queryByRole( 'tab', { selected: true } )?.textContent;
			const stop = deferred();
			const start = deferred();
			const publish = ( running: boolean ) => {
				const next = site( { running } );
				connector.state.sites = [ next ];
				connector.emit( 'onSiteEvent', {
					event: SITE_EVENTS.UPDATED,
					siteId: 'one',
					running,
				} );
			};
			connector.stopSite.mockImplementationOnce( async () => {
				await stop.promise;
				publish( false );
			} );
			connector.startSite.mockImplementationOnce( async () => {
				await start.promise;
				publish( true );
			} );
			const expectPreserved = () => {
				expect( layoutControl ).toHaveAttribute( 'data-workspace-layout', expectedLayout );
				expect( history.location.pathname ).toBe( path );
				if ( layout !== 'chat' ) {
					expect( screen.getByRole( 'tab', { selected: true } ) ).toHaveTextContent(
						selectedTabName!
					);
					expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
						'http://localhost:9010/about/'
					);
					expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeVisible();
				}
			};
			try {
				await restartFromPalette();
				await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
				expectPreserved();
				await act( async () => stop.resolve() );
				await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
				expectPreserved();
				await act( async () => start.resolve() );
				await waitFor( () =>
					expect( screen.queryByText( 'Restarting site…' ) ).not.toBeInTheDocument()
				);
				if ( layout !== 'chat' ) fireEvent.load( frame()! );
				await waitFor( () =>
					expect( layoutControl ).toHaveAttribute( 'data-workspace-layout', expectedLayout )
				);
				expect( history.location.pathname ).toBe( path );
				if ( layout !== 'chat' )
					expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
						'http://localhost:9010/about/'
					);
			} finally {
				act( () => updateResponsivePreview( 'one', { enabled: false } ) );
			}
		}
	);

	it.each( [
		{ stage: 'stop', path: '/sessions/one-chat' },
		{ stage: 'start', path: '/sites/one' },
	] )(
		'keeps full-screen layout when the $stage stage of restart fails at $path',
		async ( { stage, path } ) => {
			const { connector, history } = setup( [ site( { running: true } ) ], path );
			await screen.findByRole( 'textbox', { name: 'Address' } );
			if ( path !== '/sites/one' )
				fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
			if ( stage === 'stop' )
				connector.stopSite.mockRejectedValueOnce( new Error( 'Restart failed' ) );
			else connector.startSite.mockRejectedValueOnce( new Error( 'Restart failed' ) );
			await restartFromPalette();
			await waitFor( () =>
				expect( getVisibleToasts().some( ( notice ) => notice.intent === 'error' ) ).toBe( true )
			);
			await waitFor( () =>
				expect( screen.queryByText( 'Restarting site…' ) ).not.toBeInTheDocument()
			);
			expect( panelShown() ).toBe( true );
			expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toHaveAttribute(
				'data-workspace-layout',
				'panel'
			);
			expect( history.location.pathname ).toBe( path );
			if ( stage === 'stop' ) expect( connector.startSite ).not.toHaveBeenCalled();
		}
	);

	it( 'keeps preview visible until stopping completes without a sidebar loader', async () => {
		const { connector } = setup( [ site( { running: true } ) ] );
		const stop = deferred();
		connector.stopSite.mockImplementation( () => stop.promise );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site menu' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		const action = lifecycle( 'My site' );
		await waitFor( () => expect( panelShown() ).toBe( true ) );
		expect( action ).not.toHaveAttribute( 'aria-busy' );
		expect( action ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		connector.state.sites = [ site() ];
		await act( async () => stop.resolve() );
		await waitFor( () => expect( lifecycle( 'My site' ) ).not.toHaveAttribute( 'aria-busy' ) );
		await waitFor( () => expect( panelShown() ).toBe( false ) );
	} );

	it.each( [ 'start', 'stop' ] as const )(
		'allows concurrent %s actions on different sites',
		async ( action ) => {
			const running = action === 'stop';
			const { connector } = setup( [
				site( { running } ),
				site( { id: 'two', name: 'Second', path: '/sites/two', running } ),
			] );
			const finish = new Map< string, () => void >();
			const method = action === 'start' ? connector.startSite : connector.stopSite;
			method.mockImplementation(
				( id ) =>
					new Promise( ( resolve ) => {
						finish.set( id, resolve );
					} )
			);
			const label = running ? 'Stop' : 'Start';
			fireEvent.click( await screen.findByRole( 'button', { name: `${ label } My site` } ) );
			await waitFor( () =>
				expect( lifecycle( 'My site' ) ).toHaveAttribute( 'aria-disabled', 'true' )
			);
			expect( lifecycle( 'Second' ) ).not.toHaveAttribute( 'aria-disabled', 'true' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Second' } ) );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Site menu' } ) );
			if ( running ) {
				fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
			}
			const menuLabel = running ? 'Stop site' : 'Start';
			expect( await screen.findByRole( 'menuitem', { name: menuLabel } ) ).not.toHaveAttribute(
				'aria-disabled',
				'true'
			);
			fireEvent.click( screen.getByRole( 'menuitem', { name: menuLabel } ) );
			await waitFor( () => expect( method ).toHaveBeenCalledTimes( 2 ) );
			expect( lifecycle( 'My site' ) ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( lifecycle( 'Second' ) ).toHaveAttribute( 'aria-disabled', 'true' );
			await act( async () => finish.get( 'one' )!() );
			await waitFor( () =>
				expect( lifecycle( 'My site' ) ).not.toHaveAttribute( 'aria-disabled', 'true' )
			);
			expect( lifecycle( 'Second' ) ).toHaveAttribute( 'aria-disabled', 'true' );
			await act( async () => finish.get( 'two' )!() );
		}
	);

	it( 'disables each stopping site without showing sidebar loaders', async () => {
		const { connector } = setup( [
			site( { running: true } ),
			site( { id: 'two', name: 'Second', path: '/sites/two', running: true } ),
			site( { id: 'three', name: 'Third', path: '/sites/three', running: true } ),
		] );
		const finish = new Map< string, () => void >();
		connector.stopSite.mockImplementation(
			( id ) =>
				new Promise( ( resolve ) => {
					finish.set( id, resolve );
				} )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site menu' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop other sites' } ) );
		await waitFor( () => {
			expect( lifecycle( 'Second' ) ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( lifecycle( 'Second' ) ).not.toHaveAttribute( 'aria-busy' );
			expect( lifecycle( 'Third' ) ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( lifecycle( 'Third' ) ).not.toHaveAttribute( 'aria-busy' );
		} );
		expect( lifecycle( 'My site' ) ).not.toHaveAttribute( 'aria-busy' );
		await act( async () => finish.get( 'two' )!() );
		await waitFor( () => expect( lifecycle( 'Second' ) ).not.toHaveAttribute( 'aria-busy' ) );
		expect( lifecycle( 'Third' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( lifecycle( 'Third' ) ).not.toHaveAttribute( 'aria-busy' );
		await act( async () => finish.get( 'three' )!() );
		await waitFor( () => expect( lifecycle( 'Third' ) ).not.toHaveAttribute( 'aria-busy' ) );
	} );

	it( 'opens site actions from the stopped preview context menu', async () => {
		const connector = createFakeConnector(
			{ sites: [ site() ] },
			{ getSiteThumbnail: async () => 'data:image/png;base64,preview' }
		);
		renderApp( { connector, path: '/sites/one' } );
		fireEvent.contextMenu( await screen.findByRole( 'group', { name: 'Project tools' } ) );
		const menu = await screen.findByRole( 'menu' );
		expect( within( menu ).getByRole( 'menuitem', { name: 'Settings' } ) ).toBeEnabled();
		expect( within( menu ).getByRole( 'menuitem', { name: /^Rename/ } ) ).toBeEnabled();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /^Start(?:\s|$)/ } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
	} );

	it( 'does not carry a saved screenshot to a site without one', async () => {
		const connector = createFakeConnector(
			{ sites: [ site(), site( { id: 'two', name: 'Second', path: '/sites/two' } ) ] },
			{
				getSiteThumbnail: async ( id ) => ( id === 'one' ? 'data:image/png;base64,preview' : null ),
			}
		);
		renderApp( { connector, path: '/sites/one/new' } );
		await screen.findByRole( 'img', { name: 'Saved site preview' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Second' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toHaveTextContent( 'Second' )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'img', { name: 'Saved site preview' } ) ).not.toBeInTheDocument()
		);
	} );

	it.each( [ 'split', 'fullscreen' ] as const )(
		'keeps an open %s preview visible throughout startup',
		async ( layout ) => {
			const start = deferred();
			const connector = createFakeConnector(
				{ sites: [ site() ], preferences: { openChatOnSiteStart: layout === 'split' } },
				{
					startSite: () => start.promise,
					getSiteThumbnail: async () => 'data:image/png;base64,eA==',
				}
			);
			renderApp( { connector, path: '/sites/one/new' } );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Show panel' } ) );
			if ( layout === 'fullscreen' ) act( () => connector.emit( 'onSetWorkspaceLayout', 'panel' ) );
			const pane = screen.getByRole( 'complementary', { name: 'Panel' } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
			expect( pane ).toBeVisible();
			expect( within( pane ).getByText( 'Loading site preview' ) ).toHaveAttribute(
				'role',
				'status'
			);
			connector.state.sites = [ site( { running: true } ) ];
			await act( async () => start.resolve() );
			await waitFor( () => expect( frame() ).toBeInTheDocument() );
			expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toBe( pane );
			fireEvent.load( frame()! );
			expect( pane ).toBeVisible();
		}
	);

	it.each( [ 'panel', 'sidebar' ] )(
		'hides stopped preview controls while starting from the %s',
		async ( target ) => {
			const start = deferred();
			const connector = createFakeConnector(
				{ sites: [ site() ] },
				{
					getSiteThumbnail: async () => 'data:image/png;base64,preview',
					startSite: () => start.promise,
				}
			);
			renderApp( { connector, path: '/sites/one' } );
			const browser = await screen.findByRole( 'button', { name: 'Browser B' } );
			const startButton = screen.getByRole( 'button', { name: 'Start My site' } );
			expect(
				within( screen.getByRole( 'complementary', { name: 'Panel' } ) ).queryByRole( 'button', {
					name: 'Start',
				} )
			).not.toBeInTheDocument();
			fireEvent.click( target === 'panel' ? browser : startButton );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'img', { name: 'Saved site preview' } )
				).not.toBeInTheDocument()
			);
			await act( async () => start.resolve() );
		}
	);

	it.each( [ 'MacIntel', 'Win32' ] )(
		'toggles only the active site with the lifecycle shortcut on %s',
		async ( platform ) => {
			vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
			const { connector } = setup( [
				site(),
				site( { id: 'two', name: 'Second', path: '/sites/two' } ),
			] );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			const keys = {
				code: 'KeyS',
				altKey: true,
				metaKey: platform === 'MacIntel',
				ctrlKey: platform !== 'MacIntel',
			};
			fireEvent.keyDown( screen.getByRole( 'button', { name: 'Second' } ), keys );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			await screen.findByRole( 'button', { name: 'Stop My site' } );
			fireEvent.keyDown( document.body, keys );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		}
	);

	it( 'ignores the lifecycle shortcut while typing, in dialogs, and during pending operations', async () => {
		vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( 'Linux x86_64' );
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Site menu' } );
		const keys = { code: 'KeyS', altKey: true, ctrlKey: true };
		const input = document.createElement( 'input' );
		document.body.append( input );
		fireEvent.keyDown( input, keys );
		input.remove();
		fireEvent.keyDown( document.body, { ...keys, repeat: true } );
		fireEvent.click( screen.getByRole( 'button', { name: TEST_USER.displayName } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /Settings/ } ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.keyDown( document.body, keys );
		expect( connector.startSite ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument()
		);
		connector.startSite.mockImplementationOnce( () => new Promise( () => {} ) );
		fireEvent.keyDown( document.body, keys );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledOnce() );
		fireEvent.keyDown( document.body, keys );
		expect( connector.startSite ).toHaveBeenCalledOnce();
	} );

	it( 'restarts only sites marked for auto-start once after loading the registry', async () => {
		const { connector } = setup( [
			site( { autoStart: true } ),
			site( { id: 'manual', name: 'Manual site', path: '/sites/manual' } ),
			site( {
				id: 'running',
				name: 'Already running',
				path: '/sites/running',
				autoStart: true,
				running: true,
			} ),
		] );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Stop My site' } ) ).toBeEnabled()
		);
		await act( () =>
			connector.emit( 'onSiteEvent', { event: SITE_EVENTS.UPDATED, siteId: 'one', running: true } )
		);
		expect( connector.startSite ).toHaveBeenCalledTimes( 1 );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it.each( [ false, true ] )(
		'keeps the title menu available during a pending operation (running: %s)',
		async ( running ) => {
			const { connector } = setup( [ site( { running } ) ] );
			const pending = deferred();
			( running ? connector.stopSite : connector.startSite ).mockImplementationOnce(
				() => pending.promise
			);
			const trigger = await screen.findByRole( 'button', { name: 'Site menu' } );
			fireEvent.click( trigger );
			const label = running ? 'Stop' : 'Start';
			fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBeEnabled()
			);
			await waitFor( () => {
				const spinner = lifecycle( 'My site' ).querySelector( '[data-slot=spinner]' );
				if ( running ) expect( spinner ).not.toBeInTheDocument();
				else expect( spinner ).toBeInTheDocument();
				const currentTrigger = screen.getByRole( 'button', { name: 'Site menu' } );
				expect( currentTrigger.querySelector( '[data-slot=spinner]' ) ).not.toBeInTheDocument();
			} );
			fireEvent.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
			expect( await screen.findByRole( 'menuitem', { name: label } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
			expect(
				screen.queryByRole( 'menuitem', { name: 'WordPress credentials' } )
			).not.toBeInTheDocument();
			await act( async () => pending.resolve() );
		}
	);

	it( 'keeps start pending through a selection change, then stops and restarts the site', async () => {
		useElectron();
		const { connector } = setup( [
			site(),
			site( { id: 'two', name: 'Another site', path: '/sites/two' } ),
		] );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		const start = deferred();
		connector.startSite.mockImplementationOnce( () => start.promise );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () =>
			expect( lifecycle( 'My site' ) ).toHaveAttribute( 'aria-disabled', 'true' )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Another site' } ) );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		expect( lifecycle( 'My site' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		connector.state.sites = [ site( { running: true } ), connector.state.sites[ 1 ] ];
		await act( async () => start.resolve() );
		expect( await screen.findByRole( 'button', { name: 'Stop My site' } ) ).toBeEnabled();
		await waitFor( () => expect( frame() ).toHaveAttribute( 'src', 'http://localhost:9010/' ) );
		loadWebview();
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop My site' } ) );
		await screen.findByRole( 'button', { name: 'Start My site' } );
		await waitFor( () => expect( panelShown() ).toBe( false ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start My site' } ) );
		await screen.findByRole( 'button', { name: 'Stop My site' } );
		expect( connector.startSite ).toHaveBeenCalledTimes( 2 );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'shows a failed start without claiming the site is running', async () => {
		const { connector } = setup();
		connector.startSite.mockRejectedValueOnce( new Error( 'Port is unavailable' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start My site' } ) );
		expect( ( await screen.findAllByText( 'Port is unavailable' ) )[ 0 ] ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Start My site' } ) ).toBeEnabled();
		expect( frame() ).not.toBeInTheDocument();
	} );

	it( 'selects a site started from the sidebar and keeps it selected when stopping', async () => {
		const other = site( { id: 'two', name: 'Another site', path: '/sites/two' } );
		const { connector, history } = setup( [ site(), other ] );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		const start = deferred();
		connector.startSite.mockImplementationOnce( () => start.promise );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start Another site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
		expect( lifecycle( 'Another site' ) ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( lifecycle( 'Another site' ) ).toHaveAttribute( 'aria-busy', 'true' );
		expect( screen.getByRole( 'button', { name: 'Start My site' } ) ).toBeEnabled();
		expect( await screen.findByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
		connector.state.sites = [ site(), { ...other, running: true } ];
		await act( async () => start.resolve() );
		expect( await screen.findByRole( 'button', { name: 'Stop Another site' } ) ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Stop Another site' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'two' ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Start Another site' } ) ).toBeEnabled()
		);
		expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
		expect( history.location.pathname ).toContain( 'two' );
		expect( connector.startSite ).toHaveBeenCalledOnce();
	} );

	it( 'updates externally changed sites and unsubscribes when closed', async () => {
		const { connector, unmount } = setup( [ site() ] );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		connector.state.sites = [
			site( { id: 'two', name: 'External site', path: '/sites/external', running: true } ),
		];
		await act( () =>
			connector.emit( 'onSiteEvent', { event: SITE_EVENTS.UPDATED, siteId: 'two', running: true } )
		);
		expect( await screen.findByRole( 'button', { name: 'Stop External site' } ) ).toBeEnabled();
		expect( await screen.findByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
		await waitFor( () => expect( frame() ).toHaveAttribute( 'src', 'http://localhost:9010/' ) );
		unmount();
		expect( connector.listenerCount( 'onSiteEvent' ) ).toBe( 0 );
	} );
} );
