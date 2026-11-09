import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_PAGE_SCRIPT,
} from '@studio/agent/protocol/inspector/page-script';
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

async function setup(
	onStartAnnotating?: () => boolean,
	connector = createFakeConnector( { sites: [ site ] } )
) {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/38.0.0`,
		configurable: true,
	} );
	vi.stubGlobal( 'ipcApi', { clearWebviewCache: vi.fn().mockResolvedValue( undefined ) } );
	const view = renderWithProviders(
		<SessionUIProvider>
			<SiteHeaderActionsProvider host="panel">
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					onStartAnnotating={ onStartAnnotating }
					onSendAnnotations={ () => undefined }
				/>
				<SiteHeaderActions site={ site } />
			</SiteHeaderActionsProvider>
		</SessionUIProvider>,
		{
			connector,
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

// The annotation state last mirrored into the page.
function pageState( preview: { executeJavaScript: ReturnType< typeof vi.fn > } ) {
	const code = preview.executeJavaScript.mock.calls
		.map( ( [ call ] ) => String( call ) )
		.filter( ( call ) => call.includes( '{ detail: ' ) )
		.at( -1 );
	return code ? JSON.parse( code.slice( code.indexOf( '{ detail: ' ) + 10, -4 ) ) : null;
}

describe( 'annotation inspector navigation', () => {
	const selection = {
		id: 'rectangle',
		target: {
			kind: 'region',
			url: 'http://localhost:8881/',
			viewport: { width: 800, height: 600 },
			documentRect: { left: 20, top: 30, width: 200, height: 100 },
		},
		rect: { left: 20, top: 30, width: 200, height: 100 },
		scroll: { left: 0, top: 0 },
	};
	const image = {
		id: 'capture',
		name: 'Selected area.png',
		mimeType: 'image/png' as const,
		size: 1,
		dataBase64: 'eA==',
	};

	it( 'opens a rectangle note and lets an untouched capture be dismissed without an error', async () => {
		const connector = createFakeConnector( { sites: [ site ] } );
		const capture = vi.spyOn( connector, 'captureAnnotationRegion' ).mockResolvedValue( image );
		const { emit, annotate } = await setup( undefined, connector );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		act( () => setAnnotating( site.id, true ) );
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'selection', selection } ),
		} );
		await waitFor( () => expect( getSiteAnnotations( site.id ).notes ).toHaveLength( 1 ) );
		expect( capture ).toHaveBeenCalledWith( {
			guestId: 7,
			selection: expect.objectContaining( { id: selection.id } ),
		} );
		expect( getSiteAnnotations( site.id ) ).toMatchObject( {
			active: true,
			preparing: false,
			notes: [
				{ kind: 'region', documentRect: selection.rect, images: [ { ...image, kind: 'image' } ] },
			],
		} );
		expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeDisabled();
		act( () => escapeAnnotations( site.id ) );
		expect( getSiteAnnotations( site.id ) ).toMatchObject( { active: false, notes: [] } );
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it.each( [
		{ limit: 'image count', saved: 3, size: 1 },
		{ limit: 'combined size', saved: 2, size: 4 * 1024 * 1024 },
	] )( 'replaces an untouched capture at the $limit limit', async ( { saved, size } ) => {
		const connector = createFakeConnector( { sites: [ site ] } );
		const replacement = { ...image, id: 'replacement', size };
		const capture = vi
			.spyOn( connector, 'captureAnnotationRegion' )
			.mockResolvedValue( replacement );
		const { emit, annotate } = await setup( undefined, connector );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		const target = { ...selection.target, kind: 'region' as const };
		const savedIds: string[] = [];
		act( () => {
			setAnnotating( site.id, true );
			for ( let index = 0; index < saved; index++ ) {
				const id = pickAnnotation( site.id, target, {
					images: [ { ...image, id: `saved-${ index }`, size, kind: 'image' } ],
				} )!;
				changeAnnotation( site.id, id, { comment: 'Keep this note' } );
				stageAnnotations( site.id, [ id ], true );
				savedIds.push( id );
			}
			pickAnnotation( site.id, target, {
				images: [ { ...image, id: 'untouched', size, kind: 'image' } ],
			} );
		} );
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'selection', selection } ),
		} );
		await waitFor( () =>
			expect( getSiteAnnotations( site.id ).notes.at( -1 )?.images[ 0 ].id ).toBe( replacement.id )
		);
		expect( capture ).toHaveBeenCalledOnce();
		const notes = getSiteAnnotations( site.id ).notes;
		expect( notes ).toHaveLength( saved + 1 );
		expect( notes.slice( 0, saved ).map( ( note ) => note.id ) ).toEqual( savedIds );
	} );

	it( 'preserves unfinished notes instead of capturing a different rectangle', async () => {
		const connector = createFakeConnector( { sites: [ site ] } );
		const capture = vi.spyOn( connector, 'captureAnnotationRegion' );
		const { emit, annotate } = await setup( undefined, connector );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		act( () => {
			setAnnotating( site.id, true );
			const id = pickAnnotation( site.id, { selector: 'h1', url: selection.target.url } )!;
			changeAnnotation( site.id, id, { comment: 'Keep this draft' } );
		} );
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'selection', selection } ),
		} );
		expect( capture ).not.toHaveBeenCalled();
		expect( getSiteAnnotations( site.id ).notes ).toMatchObject( [
			{ comment: 'Keep this draft' },
		] );
		expect( getSiteAnnotations( site.id ).blockedNavigation ).toBeGreaterThan( 0 );
	} );

	it( 'discards a capture completed after its page navigates', async () => {
		const connector = createFakeConnector( { sites: [ site ] } );
		let finish!: ( value: typeof image ) => void;
		vi.spyOn( connector, 'captureAnnotationRegion' ).mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		const { emit, annotate } = await setup( undefined, connector );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		act( () => setAnnotating( site.id, true ) );
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'selection', selection } ),
		} );
		emit( 'did-start-navigation', { isMainFrame: true, isInPlace: false } );
		await act( async () => finish( image ) );
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [] );
		expect( getSiteAnnotations( site.id ).preparing ).toBe( false );
	} );

	it( 'keeps image-only drafts open until saved and marks them pending', async () => {
		const { preview, emit, annotate } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		let id = '';
		act( () => {
			setAnnotating( site.id, true );
			id = pickAnnotation( site.id, { selector: 'h1', url: 'http://localhost:8881/' } )!;
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
		expect( latestCommand() ).toContain( '"active":true' );
		expect( latestCommand() ).toContain( '"pending":true' );
		act( () => setAnnotating( site.id, true ) );
		expect( latestCommand() ).toContain( '"active":true' );
		act( () => stageAnnotations( site.id, [ id ] ) );
		expect( latestCommand() ).toContain( '"pending":false' );
		act( () => {
			editAnnotation( site.id, id );
		} );
		expect( latestCommand() ).toContain( '"pending":false' );
	} );

	it( 'shows saved markers when annotation mode is reopened from its mode toggle', async () => {
		const { preview, emit, annotate, user } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		let id = '';
		act( () => {
			setAnnotating( site.id, true );
			id = pickAnnotation( site.id, { selector: 'h1', url: 'http://localhost:9010/' } )!;
			changeAnnotation( site.id, id, { comment: 'Make the heading smaller' } );
			stageAnnotations( site.id, [ id ], true );
			setAnnotating( site.id, false );
		} );
		expect( annotate() ).toHaveAccessibleDescription( '1 annotation ready to send' );
		expect( annotate().querySelector( '[data-slot="notification-dot"]' ) ).toBeInTheDocument();
		await user.click( annotate() );
		const command = preview.executeJavaScript.mock.calls.at( -1 )?.[ 0 ];
		expect( command ).toContain( '"active":true' );
		expect( command ).toContain( `"id":"${ id }"` );
		expect( command ).toContain( '"number":1' );
		expect( command ).toContain( '"pending":false' );
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
