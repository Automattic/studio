import { act, fireEvent, screen } from '@testing-library/react';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SitePreview } from './index';

type Runtime = 'browser' | 'desktop';
type Props = ComponentProps< typeof SitePreview >;

const REAL_USER_AGENT = window.navigator.userAgent;
const SITE_URL = 'http://localhost:9010';

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

const site = ( overrides: Partial< Props[ 'site' ] > = {} ) =>
	makeSite( { id: 'one', port: 9010, running: true, ...overrides } );
const address = () => screen.getByRole( 'textbox', { name: 'Address' } ) as HTMLInputElement;
const submit = ( value: string ) => {
	fireEvent.change( address(), { target: { value } } );
	fireEvent.submit( address().closest( 'form' )! );
};

describe( 'preview address bar', () => {
	it( 'shows immediate startup feedback and restores the address when running', async () => {
		const { update } = await renderPreview( 'browser', {
			site: site( { running: false, operation: { pid: 1, kind: 'start' } } ),
		} );
		expect( screen.getByText( 'Starting site…' ) ).toHaveAttribute( 'role', 'status' );
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		update( { site: site() } );
		expect( screen.queryByText( 'Starting site…' ) ).not.toBeInTheDocument();
		expect( address() ).toHaveValue( SITE_URL );
	} );

	it( 'shows stopping feedback until shutdown completes, even after the preview is hidden', async () => {
		const stopping = { pid: 1, kind: 'stop' } as const;
		const { update } = await renderPreview( 'browser', {
			path: '/about/',
			site: site( { operation: stopping } ),
		} );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Stopping site…' );
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		update( { site: site( { running: false, operation: stopping } ) } );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Stopping site…' );
		update( { site: site( { running: false } ) } );
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
	} );

	it( 'opens site settings directly from the address field', async () => {
		const onPathChange = vi.fn();
		const { history, user } = await renderPreview( 'browser', { onPathChange } );
		await user.click( screen.getByRole( 'button', { name: 'Site settings' } ) );
		expect( history.location.search ).toBe( '?settings=site&settingsSite=one' );
		expect( onPathChange ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps root addresses stable after loading and preserves page paths', async () => {
		const { update } = await renderPreview( 'browser', { path: '' } );
		const input = address();
		update( { path: '/' } );
		expect( input ).toHaveValue( SITE_URL );
		for ( const path of [ '/about/', '/?page=2', '/#section' ] ) {
			update( { path } );
			expect( input ).toHaveValue( SITE_URL + path );
		}
	} );

	it( 'opens database addresses in the desktop preview', async () => {
		const onPathChange = vi.fn();
		const connector = createFakeConnector();
		await renderPreview( 'desktop', { onPathChange }, connector );
		const path = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';
		submit( path );
		expect( onPathChange ).toHaveBeenCalledWith( path );
		expect( connector.openSiteUrl ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );

	it( 'keeps an empty pill while stopped and restores the editable address when started', async () => {
		const { update } = await renderPreview( 'browser', { path: '/about/' } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		update( { site: site( { running: false } ) } );
		expect( document.querySelector( '[class*="browserLocation"]' ) ).toBeEmptyDOMElement();
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start site' } ) ).not.toBeInTheDocument();
		update( { site: site( { running: false, operation: { pid: 1, kind: 'settings' } } ) } );
		expect( screen.queryByRole( 'button', { name: 'Site settings' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Open this page in your browser' } )
		).not.toBeInTheDocument();
		update( { site: site() } );
		expect( address() ).toHaveValue( `${ SITE_URL }/about/` );
		expect( address() ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Site settings' } ) ).toBeInTheDocument();
	} );

	it( 'selects the whole address on first pointer focus without overriding later clicks', async () => {
		await renderPreview( 'browser', { path: '/about/' } );
		const input = address();
		fireEvent.focus( input );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( input.value.length );
		input.focus();
		input.setSelectionRange( 7, 7 );
		fireEvent.pointerDown( input, { button: 0 } );
		expect( input.selectionStart ).toBe( 7 );
		expect( input.selectionEnd ).toBe( 7 );
	} );

	it( 'submits addresses, restores the current address on Escape, and disables unavailable navigation', async () => {
		const onPathChange = vi.fn();
		await renderPreview( 'browser', { onPathChange } );
		submit( '/about/' );
		expect( onPathChange ).toHaveBeenCalledWith( '/about/' );
		fireEvent.keyDown( address(), { key: 'Escape' } );
		expect( address() ).toHaveValue( SITE_URL );
	} );
} );
