import { act, fireEvent, screen } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SitePreview } from './index';

type Runtime = 'browser' | 'desktop';
type Props = ComponentProps< typeof SitePreview >;

const REAL_USER_AGENT = window.navigator.userAgent;

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	Object.defineProperty( window.navigator, 'userAgent', {
		value: REAL_USER_AGENT,
		configurable: true,
	} );
} );

function createPropsStore( initial: Props ) {
	let props = initial;
	const listeners = new Set< () => void >();
	return {
		get: () => props,
		subscribe: ( listener: () => void ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		update: ( patch: Partial< Props > ) =>
			act( () => {
				props = { ...props, ...patch };
				listeners.forEach( ( listener ) => listener() );
			} ),
	};
}

function Harness( { store }: { store: ReturnType< typeof createPropsStore > } ) {
	const props = useSyncExternalStore( store.subscribe, store.get );
	return (
		<SessionUIProvider>
			<SitePreview { ...props } />
		</SessionUIProvider>
	);
}

async function renderPreview(
	runtime: Runtime,
	props: Partial< Props > = {},
	connector = createFakeConnector()
) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: runtime === 'desktop' ? `${ REAL_USER_AGENT } Electron/38.0.0` : REAL_USER_AGENT,
		configurable: true,
	} );
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response() )
	);
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn( async () => {} ) } );
	const site = makeSite( { id: 'one', port: 9010, running: true } );
	const store = createPropsStore( { site, path: '/', reloadNonce: 0, ...props } );
	const view = renderWithProviders( <Harness store={ store } />, { connector } );
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	return { ...view, update: store.update };
}

type Guest = HTMLElement;

it( 'never exposes the previous site URL, history actions, or late webview events', async () => {
	const first = makeSite( { id: 'one', port: 8001, running: true } );
	const second = makeSite( { id: 'two', port: 8002, running: true } );
	const { update } = await renderPreview( 'desktop', {
		site: first,
		onPathChange: ( path ) => update( { path } ),
	} );
	const address = () => screen.getByRole( 'textbox', { name: 'Address' } );
	const back = () => screen.getByRole( 'button', { name: 'Back' } );
	const previousWebview = document.querySelector( 'webview' ) as Guest;
	Object.assign( previousWebview, {
		executeJavaScript: vi.fn( async () => '' ),
		getWebContentsId: () => 1,
		canGoBack: () => true,
		canGoForward: () => false,
	} );
	fireEvent( previousWebview, new Event( 'dom-ready' ) );
	fireEvent(
		previousWebview,
		Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:8001/page' } )
	);
	expect( address() ).toHaveValue( 'http://localhost:8001/page' );
	expect( back() ).not.toHaveAttribute( 'aria-disabled', 'true' );
	update( { site: second, path: '/' } );
	expect( address() ).toHaveValue( 'http://localhost:8002' );
	expect( back() ).toHaveAttribute( 'aria-disabled', 'true' );
	fireEvent(
		previousWebview,
		Object.assign( new Event( 'did-navigate' ), { url: 'http://localhost:8001/late' } )
	);
	expect( address() ).toHaveValue( 'http://localhost:8002' );
	update( { site: first, path: '/' } );
	expect( address() ).toHaveValue( 'http://localhost:8001' );
	expect( back() ).toHaveAttribute( 'aria-disabled', 'true' );
} );
