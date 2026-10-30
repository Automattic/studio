import { INSPECTOR_PAGE_SCRIPT } from '@studio/agent/protocol/inspector/page-script';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	editAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
	setAnnotating,
	stageAnnotations,
} from '@/features/annotations';
import { SiteHeaderActions, SiteHeaderActionsProvider } from '@/features/sites/site-header-actions';
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
	act( () => {
		removeAnnotations(
			site.id,
			getSiteAnnotations( site.id ).notes.map( ( note ) => note.id )
		);
		setAnnotating( site.id, false );
	} );
} );

async function setup( onStartAnnotating?: () => boolean ) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/38.0.0`,
		configurable: true,
	} );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn().mockResolvedValue( undefined ) } );
	const view = renderWithProviders(
		<SessionUIProvider>
			<SiteHeaderActionsProvider host="preview">
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					onStartAnnotating={ onStartAnnotating }
				/>
				<SiteHeaderActions site={ site } onStartAnnotating={ onStartAnnotating } />
			</SiteHeaderActionsProvider>
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
	preview.executeJavaScript.mock.calls.filter( ( [ code ] ) =>
		code.startsWith( INSPECTOR_PAGE_SCRIPT )
	);

describe( 'annotation inspector navigation', () => {
	it( 'marks notes pending until saved, including image-only and dismissed drafts', async () => {
		const { preview, emit, annotate } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		let id = '';
		act( () => {
			setAnnotating( site.id, true );
			id = pickAnnotation( site.id, { selector: 'h1' } )!;
			changeAnnotation( site.id, id, {
				images: [
					{
						id: 'image',
						kind: 'image',
						name: 'reference.png',
						mimeType: 'image/png',
						size: 1,
						dataBase64: 'eA==',
					},
				],
			} );
		} );
		const latestCommand = () => preview.executeJavaScript.mock.calls.at( -1 )?.[ 0 ];
		expect( latestCommand() ).toContain( '"pending":true' );
		expect( latestCommand() ).toContain( '"pendingAnnotationLabel":"Pending annotation"' );
		act( () => escapeAnnotations( site.id ) );
		expect( latestCommand() ).toContain( '"active":false' );
		expect( latestCommand() ).toContain( '"pending":true' );
		act( () => setAnnotating( site.id, true ) );
		expect( latestCommand() ).toContain( '"active":true' );
		act( () => stageAnnotations( site.id, [ id ] ) );
		expect( latestCommand() ).toContain( '"pending":false' );
		act( () => editAnnotation( site.id, id ) );
		expect( latestCommand() ).toContain( '"pending":false' );
	} );

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
			code.startsWith( INSPECTOR_PAGE_SCRIPT ) && ! reject
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
} );
