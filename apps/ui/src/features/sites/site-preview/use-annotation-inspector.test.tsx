import { INSPECTOR_PAGE_SCRIPT } from '@studio/common/ai/inspector/page-script';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import { getSiteAnnotations, pickAnnotation, setAnnotating } from '@/features/annotations';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SitePreview } from '.';

const REAL_USER_AGENT = window.navigator.userAgent;
const site = makeSite( { id: 'site', running: true } );

afterEach( () => {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: REAL_USER_AGENT,
		configurable: true,
	} );
	vi.unstubAllGlobals();
	setAnnotating( site.id, false );
} );

async function setup( onStartAnnotating?: () => boolean ) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/38.0.0`,
		configurable: true,
	} );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn().mockResolvedValue( undefined ) } );
	const view = renderWithProviders(
		<SessionUIProvider>
			<SitePreview
				site={ site }
				path="/"
				reloadNonce={ 0 }
				onStartAnnotating={ onStartAnnotating }
			/>
		</SessionUIProvider>,
		{
			connector: createFakeConnector( { sites: [ site ] } ),
		}
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const preview = view.container.querySelector( 'webview' ) as HTMLElement & {
		executeJavaScript: ReturnType< typeof vi.fn >;
	};
	Object.assign( preview, {
		loadURL: vi.fn().mockResolvedValue( undefined ),
		reload: vi.fn(),
		executeJavaScript: vi.fn().mockResolvedValue( undefined ),
		getWebContentsId: vi.fn().mockReturnValue( 7 ),
	} );
	const emit = ( type: string, details = {} ) =>
		act( () => {
			fireEvent( preview, Object.assign( new Event( type ), details ) );
		} );
	const annotate = () => screen.getByRole( 'button', { name: /^Annotate/ } );
	return { ...view, preview, emit, annotate };
}

const injections = ( preview: { executeJavaScript: ReturnType< typeof vi.fn > } ) =>
	preview.executeJavaScript.mock.calls.filter( ( [ code ] ) => code === INSPECTOR_PAGE_SCRIPT );

// The annotation state last mirrored into the page.
function pageState( preview: { executeJavaScript: ReturnType< typeof vi.fn > } ) {
	const code = preview.executeJavaScript.mock.calls
		.map( ( [ call ] ) => String( call ) )
		.filter( ( call ) => call.includes( '{ detail: ' ) )
		.at( -1 );
	return code ? JSON.parse( code.slice( code.indexOf( '{ detail: ' ) + 10, -4 ) ) : null;
}

describe( 'annotation inspector navigation', () => {
	it( 'asks before entering annotation mode and leaves it inactive when a provider is required', async () => {
		const onStartAnnotating = vi.fn().mockReturnValue( false );
		const { emit, annotate } = await setup( onStartAnnotating );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		expect( onStartAnnotating ).toHaveBeenCalledOnce();
		expect( getSiteAnnotations( site.id ).active ).toBe( false );
		onStartAnnotating.mockReturnValue( true );
		fireEvent.click( annotate() );
		expect( getSiteAnnotations( site.id ).active ).toBe( true );
		fireEvent.click( annotate() );
		expect( getSiteAnnotations( site.id ).active ).toBe( false );
		expect( onStartAnnotating ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'resets readiness for a new main document and reinjects when it is ready', async () => {
		const { preview, emit, annotate } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		act( () => setAnnotating( site.id, true ) );
		emit( 'did-start-navigation', { isMainFrame: true, isInPlace: false } );
		emit( 'did-start-loading' );
		expect( annotate() ).toBeDisabled();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		expect( getSiteAnnotations( site.id ).active ).toBe( true );
		expect( injections( preview ) ).toHaveLength( 2 );
	} );

	it( 'ignores an injection failure from the previous document', async () => {
		const { preview, emit, annotate } = await setup();
		let reject!: ( error: Error ) => void;
		preview.executeJavaScript.mockImplementation( ( code: string ) =>
			code === INSPECTOR_PAGE_SCRIPT && ! reject
				? new Promise( ( _resolve, rejectRequest ) => {
						reject = rejectRequest;
				  } )
				: Promise.resolve( undefined )
		);
		emit( 'dom-ready' );
		emit( 'did-start-navigation', { isMainFrame: true, isInPlace: false } );
		emit( 'did-start-loading' );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		await act( async () => reject( new Error( 'Document destroyed' ) ) );
		expect( annotate() ).toBeEnabled();
	} );

	it( 'leaves the notes on an email or the design system out of the page', async () => {
		const { preview, emit, annotate } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		act( () => setAnnotating( site.id, true ) );
		act( () => {
			pickAnnotation( site.id, {
				email: { id: 'reset.eml', subject: 'Password Reset', part: 'text', paragraph: 0 },
			} );
		} );

		await waitFor( () =>
			expect( pageState( preview ) ).toMatchObject( { active: true, editingId: null, notes: [] } )
		);
	} );
} );
