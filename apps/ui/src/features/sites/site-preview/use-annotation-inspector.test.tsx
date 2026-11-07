import {
	INSPECTOR_PAGE_SCRIPT,
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
} from '@studio/agent/protocol/inspector/page-script';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import {
	changeAnnotation,
	finishTextEdits,
	editAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
	setAnnotationsPreparing,
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
		setAnnotationsPreparing( site.id, false );
		finishTextEdits(
			site.id,
			( getSiteAnnotations( site.id ).textEdits ?? [] ).map( ( edit ) => edit.id )
		);
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
	const connector = createFakeConnector( { sites: [ site ] } );
	const onSendAnnotations = vi.fn();
	const view = renderWithProviders(
		<SessionUIProvider>
			<SiteHeaderActionsProvider host="panel">
				<SitePreview
					site={ site }
					path="/"
					reloadNonce={ 0 }
					onStartAnnotating={ onStartAnnotating }
					onSendAnnotations={ onSendAnnotations }
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
	return { ...view, preview, emit, annotate, connector, onSendAnnotations };
}

const injections = ( preview: { executeJavaScript: ReturnType< typeof vi.fn > } ) =>
	preview.executeJavaScript.mock.calls.filter( ( [ code ] ) =>
		code.startsWith( INSPECTOR_PAGE_SCRIPT )
	);

// The annotation state last mirrored into the page.
function pageState( preview: { executeJavaScript: ReturnType< typeof vi.fn > } ) {
	const code = preview.executeJavaScript.mock.calls
		.map( ( [ call ] ) => String( call ) )
		.filter( ( call ) => call.includes( INSPECTOR_COMMAND_EVENT ) && call.includes( '{ detail: ' ) )
		.at( -1 );
	return code ? JSON.parse( code.slice( code.indexOf( '{ detail: ' ) + 10, -4 ) ) : null;
}

describe( 'annotation inspector navigation', () => {
	it( 'keeps tools in the preview while annotating and provides an explicit Select tool', async () => {
		const { emit, annotate, preview } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		expect( screen.queryByRole( 'group', { name: 'Annotation tools' } ) ).not.toBeInTheDocument();
		fireEvent.click( annotate() );
		const tools = screen.getByRole( 'group', { name: 'Annotation tools' } );
		expect( tools.closest( 'aside' ) ).toHaveAccessibleName( 'Panel' );
		const select = within( tools ).getByRole( 'button', { name: 'Select' } );
		expect( select ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( within( tools ).getByRole( 'button', { name: 'Send annotations' } ) ).toBeDisabled();
		for ( const tool of [ 'Draw', 'Edit text' ] ) {
			fireEvent.click( within( tools ).getByRole( 'button', { name: tool } ) );
			expect( select ).toHaveAttribute( 'aria-pressed', 'false' );
			fireEvent.click( select );
			expect( select ).toHaveAttribute( 'aria-pressed', 'true' );
			expect( pageState( preview ).tool ).toBe( 'select' );
		}
		let id = '';
		act( () => {
			id = pickAnnotation( site.id, { selector: 'h1', url: 'http://localhost:8881/' } )!;
			changeAnnotation( site.id, id, { comment: 'Keep this note' } );
		} );
		fireEvent.click( within( tools ).getByRole( 'button', { name: 'Exit annotation mode' } ) );
		expect( screen.queryByRole( 'group', { name: 'Annotation tools' } ) ).not.toBeInTheDocument();
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( { id, comment: 'Keep this note' } ),
		] );
		fireEvent.click( annotate() );
		expect( screen.getByRole( 'button', { name: 'Send annotations' } ) ).toBeEnabled();
	} );

	it( 'sends queued notes and the current note together from the floating bar, after capture finishes', async () => {
		const { emit, annotate, onSendAnnotations } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		let queued = '';
		let current = '';
		act( () => {
			queued = pickAnnotation( site.id, { selector: 'h1', url: 'http://localhost:8881/' } )!;
			changeAnnotation( site.id, queued, { comment: 'Change the heading' } );
			stageAnnotations( site.id, [ queued ], true );
			current = pickAnnotation( site.id, { selector: 'p', url: 'http://localhost:8881/' } )!;
			changeAnnotation( site.id, current, { comment: 'Change the paragraph' } );
			setAnnotationsPreparing( site.id, true );
		} );
		const send = screen.getByRole( 'button', { name: 'Send annotations' } );
		expect( send ).toBeDisabled();
		fireEvent.click( send );
		expect( onSendAnnotations ).not.toHaveBeenCalled();
		act( () => setAnnotationsPreparing( site.id, false ) );
		fireEvent.click( send );
		expect( onSendAnnotations ).toHaveBeenCalledExactlyOnceWith( site.id, [ queued, current ] );
		expect( getSiteAnnotations( site.id ).editingId ).toBeNull();
	} );

	it( 'includes the pending text edit when sending queued annotations from the bar', async () => {
		const { emit, annotate, onSendAnnotations } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		let queued = '';
		act( () => {
			queued = pickAnnotation( site.id, { selector: 'p', url: 'http://localhost:8881/' } )!;
			changeAnnotation( site.id, queued, { comment: 'Change the paragraph' } );
			stageAnnotations( site.id, [ queued ], true );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit text' } ) );
		emit( 'console-message', {
			message:
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( {
					type: 'text-edit',
					edit: {
						id: 'inline-title',
						originalText: 'Old title',
						text: 'New title',
						target: { selector: 'h1', tag: 'h1', url: 'http://localhost:8881/' },
					},
					anchor: { left: 200, top: 100 },
				} ),
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send annotations' } ) );
		const note = getSiteAnnotations( site.id ).notes.at( -1 )!;
		expect( onSendAnnotations ).toHaveBeenCalledExactlyOnceWith( site.id, [ queued, note.id ] );
		expect( note.comment ).toBe( 'Change the text from “Old title” to “New title”.' );
		expect( getSiteAnnotations( site.id ).textEdits ).toEqual( [
			expect.objectContaining( { id: note.id, pending: true } ),
		] );
	} );

	it( 'shows only Cancel and Send while editing text and lets Cancel discard it', async () => {
		const { emit, annotate, preview, onSendAnnotations } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit text' } ) );
		expect( pageState( preview ).tool ).toBe( 'text' );
		const edit = {
			id: 'inline-title',
			originalText: 'Old title',
			text: 'Old title',
			target: { selector: 'h1', tag: 'h1', url: 'http://localhost:8881/', nearbyText: 'Old title' },
		};
		emit( 'console-message', {
			message:
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( { type: 'text-edit', edit, anchor: { left: 200, top: 100 } } ),
		} );
		expect( screen.getByRole( 'button', { name: 'Send text change' } ) ).toBeDisabled();
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
		emit( 'console-message', {
			message:
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( {
					type: 'text-edit',
					edit: { ...edit, text: 'New title' },
					anchor: { left: 200, top: 100 },
				} ),
		} );
		expect( screen.getByRole( 'button', { name: 'Send text change' } ) ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel text change' } ) );
		expect( screen.queryByRole( 'group', { name: 'Text annotation' } ) ).not.toBeInTheDocument();
		expect( preview.executeJavaScript.mock.calls.at( -1 )?.[ 0 ] ).toContain( 'cancel-text' );
		expect( onSendAnnotations ).not.toHaveBeenCalled();
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [] );
	} );

	it( 'sends a typed replacement immediately through regular annotations and keeps its preview pending', async () => {
		const { emit, annotate, preview, onSendAnnotations } = await setup();
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit text' } ) );
		const edit = {
			id: 'inline-title',
			originalText: 'Old title',
			text: 'New title',
			target: { selector: 'h1', tag: 'h1', url: 'http://localhost:8881/', nearbyText: 'Old title' },
		};
		emit( 'console-message', {
			message:
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( { type: 'text-edit', edit, anchor: { left: 200, top: 100 } } ),
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send text change' } ) );
		const note = getSiteAnnotations( site.id ).notes.at( -1 )!;
		expect( onSendAnnotations ).toHaveBeenCalledExactlyOnceWith( site.id, [ note.id ] );
		expect( note ).toMatchObject( {
			selector: 'h1',
			nearbyText: 'Old title',
			comment: 'Change the text from “Old title” to “New title”.',
			images: [],
		} );
		expect( getSiteAnnotations( site.id ).editingId ).toBeNull();
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: 'Text annotation' } ) ).not.toBeInTheDocument();
		expect( pageState( preview ).textEdits ).toEqual( [
			expect.objectContaining( {
				id: note.id,
				originalText: 'Old title',
				text: 'New title',
				pending: true,
			} ),
		] );
		act( () => removeAnnotations( site.id, [ note.id ] ) );
		expect( pageState( preview ).textEdits[ 0 ].pending ).toBe( true );
		expect( pageState( preview ).notes ).toEqual( [] );
		emit( 'did-start-navigation', { isMainFrame: true, isInPlace: false } );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		expect( pageState( preview ).tool ).toBe( 'text' );
		expect( pageState( preview ).textEdits[ 0 ].pending ).toBe( true );
		expect( injections( preview ).at( -1 )?.[ 0 ] ).toContain( '"originalText":"Old title"' );
		act( () => finishTextEdits( site.id, [ note.id ] ) );
		expect( pageState( preview ).textEdits[ 0 ].pending ).toBe( false );
	} );

	it( 'captures an area into an empty draft that Escape discards', async () => {
		const { connector, emit, annotate, preview } = await setup();
		connector.captureAnnotationRegion.mockResolvedValue( {
			id: 'area-image',
			name: 'Selected area.png',
			mimeType: 'image/png',
			size: 3,
			dataBase64: 'cG5n',
		} );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		expect( screen.getByRole( 'button', { name: 'Draw' } ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		const selection = {
			id: 'area-selection',
			target: {
				kind: 'region',
				url: 'http://localhost:8881/',
				viewport: { width: 800, height: 600 },
				documentRect: { left: 20, top: 30, width: 200, height: 100 },
			},
			rect: { left: 20, top: 30, width: 200, height: 100 },
			scroll: { left: 0, top: 0 },
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'selection', selection } ),
		} );
		await screen.findByRole( 'textbox', { name: 'Describe the change' } );
		expect( connector.captureAnnotationRegion ).toHaveBeenCalledWith( {
			guestId: 7,
			selection: expect.objectContaining( { id: 'area-selection' } ),
		} );
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( {
				kind: 'region',
				images: [ expect.objectContaining( { id: 'area-image' } ) ],
			} ),
		] );
		expect( screen.queryByRole( 'img', { name: 'Selected area.png' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Send annotations' } ) ).toBeDisabled();
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Describe the change' } ), {
			key: 'Escape',
		} );
		expect( getSiteAnnotations( site.id ) ).toMatchObject( {
			active: false,
			editingId: null,
			notes: [],
		} );
		expect( pageState( preview ) ).toMatchObject( { active: false, notes: [] } );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens the normal note as soon as a pen stroke finishes, keeping its drawing and screenshot', async () => {
		const { connector, emit, annotate } = await setup();
		connector.captureAnnotationRegion.mockResolvedValue( {
			id: 'circle-image',
			name: 'Drawing.png',
			mimeType: 'image/png',
			size: 3,
			dataBase64: 'cG5n',
		} );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Draw' } ) );
		const selection = {
			id: 'circle',
			target: {
				kind: 'drawing',
				url: 'http://localhost:8881/',
				viewport: { width: 800, height: 600 },
				documentRect: { left: 20, top: 30, width: 200, height: 100 },
			},
			rect: { left: 20, top: 30, width: 200, height: 100 },
			scroll: { left: 0, top: 0 },
			drawing: {
				color: '#3858e9',
				width: 3,
				strokes: [
					[
						{ x: 40, y: 50 },
						{ x: 180, y: 100 },
						{ x: 40, y: 50 },
					],
				],
			},
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'drawing', selection } ),
		} );
		await screen.findByRole( 'textbox', { name: 'Describe the change' } );
		expect( screen.queryByRole( 'img', { name: 'Drawing.png' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add note' } ) ).not.toBeInTheDocument();
		expect( connector.captureAnnotationRegion ).toHaveBeenCalledTimes( 1 );
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( {
				number: 1,
				kind: 'drawing',
				drawing: selection.drawing,
				images: [ expect.objectContaining( { id: 'circle-image' } ) ],
			} ),
		] );
		expect( screen.getByRole( 'button', { name: 'Draw' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		const input = screen.getByRole( 'textbox', { name: 'Describe the change' } );
		fireEvent.change( input, { target: { value: 'Change the circled area' } } );
		fireEvent.keyDown( input, { key: 'Escape' } );
		expect( input ).toBeVisible();
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Add or delete this annotation' );
		expect( getSiteAnnotations( site.id ).notes[ 0 ].comment ).toBe( 'Change the circled area' );
		fireEvent.change( input, { target: { value: '   ' } } );
		fireEvent.keyDown( input, { key: 'Escape' } );
		expect( getSiteAnnotations( site.id ) ).toMatchObject( {
			active: false,
			editingId: null,
			notes: [],
		} );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
	} );

	it( 'undoes a cleaned-up shape in the same note and refreshes only its automatic screenshot', async () => {
		const { connector, emit, annotate, preview } = await setup();
		const image = {
			id: 'shape-image',
			name: 'Drawing.png',
			mimeType: 'image/png' as const,
			size: 3,
			dataBase64: 'cG5n',
		};
		connector.captureAnnotationRegion
			.mockResolvedValueOnce( image )
			.mockResolvedValueOnce( { ...image, id: 'freehand-image' } );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Draw' } ) );
		const originalStroke = [
			{ x: 40, y: 50 },
			{ x: 180, y: 100 },
			{ x: 45, y: 55 },
		];
		const drawing = {
			color: '#3858e9',
			width: 3,
			strokes: [
				[
					{ x: 40, y: 50 },
					{ x: 180, y: 100 },
					{ x: 40, y: 50 },
				],
			],
		};
		const selection = {
			id: 'shape',
			target: {
				kind: 'drawing',
				url: 'http://localhost:8881/',
				viewport: { width: 800, height: 600 },
				documentRect: { left: 20, top: 30, width: 200, height: 100 },
			},
			rect: { left: 20, top: 30, width: 200, height: 100 },
			scroll: { left: 0, top: 0 },
			drawing: { ...drawing, originalStroke },
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'drawing', selection } ),
		} );
		const input = await screen.findByRole( 'textbox', { name: 'Describe the change' } );
		fireEvent.change( input, { target: { value: 'Keep this note' } } );
		const note = getSiteAnnotations( site.id ).notes[ 0 ];
		act( () =>
			changeAnnotation( site.id, note.id, {
				images: [ ...note.images, { ...image, id: 'manual-image', kind: 'image' } ],
			} )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Undo shape' } ) );
		expect( preview.executeJavaScript.mock.calls.at( -1 )?.[ 0 ] ).toContain( 'undo' );
		emit( 'console-message', {
			message:
				INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( {
					type: 'drawing',
					selection: {
						...selection,
						id: 'restored',
						replaces: note.id,
						drawing: { ...drawing, strokes: [ originalStroke ] },
					},
				} ),
		} );
		await waitFor( () => expect( connector.captureAnnotationRegion ).toHaveBeenCalledTimes( 2 ) );
		await waitFor( () =>
			expect( getSiteAnnotations( site.id ).notes[ 0 ].images[ 0 ].id ).toBe( 'freehand-image' )
		);
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( {
				id: note.id,
				comment: 'Keep this note',
				drawing: { ...drawing, strokes: [ originalStroke ] },
				images: [
					expect.objectContaining( { id: 'freehand-image' } ),
					expect.objectContaining( { id: 'manual-image' } ),
				],
			} ),
		] );
		expect( screen.queryByRole( 'button', { name: 'Undo shape' } ) ).not.toBeInTheDocument();
		expect( input ).toHaveValue( 'Keep this note' );
	} );

	it( 'opens the note for the newest drawing when another stroke finishes during capture', async () => {
		const { connector, emit, annotate } = await setup();
		const image = {
			id: 'latest-image',
			name: 'Drawing.png',
			mimeType: 'image/png' as const,
			size: 3,
			dataBase64: 'cG5n',
		};
		let finishCapture!: ( value: typeof image ) => void;
		connector.captureAnnotationRegion
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finishCapture = resolve;
					} )
			)
			.mockResolvedValue( image );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Draw' } ) );
		const first = {
			id: 'first-stroke',
			target: {
				kind: 'drawing',
				url: 'http://localhost:8881/',
				viewport: { width: 800, height: 600 },
				documentRect: { left: 20, top: 30, width: 200, height: 100 },
			},
			rect: { left: 20, top: 30, width: 200, height: 100 },
			scroll: { left: 0, top: 0 },
			drawing: {
				color: '#3858e9',
				width: 3,
				strokes: [
					[
						{ x: 40, y: 50 },
						{ x: 180, y: 100 },
					],
				],
			},
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'drawing', selection: first } ),
		} );
		await waitFor( () => expect( connector.captureAnnotationRegion ).toHaveBeenCalledOnce() );
		const latest = {
			...first,
			id: 'second-stroke',
			drawing: {
				...first.drawing,
				strokes: [
					...first.drawing.strokes,
					[
						{ x: 60, y: 70 },
						{ x: 100, y: 90 },
					],
				],
			},
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'drawing', selection: latest } ),
		} );
		await act( async () => finishCapture( { ...image, id: 'stale-image' } ) );
		await screen.findByRole( 'textbox', { name: 'Describe the change' } );
		expect( connector.captureAnnotationRegion ).toHaveBeenCalledTimes( 2 );
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( {
				kind: 'drawing',
				drawing: latest.drawing,
				images: [ expect.objectContaining( { id: 'latest-image' } ) ],
			} ),
		] );
	} );

	it( 'keeps a failed drawing available for retry and sends its screenshot with one note', async () => {
		const { connector, emit, annotate } = await setup();
		connector.captureAnnotationRegion
			.mockRejectedValueOnce( new Error( 'Capture failed' ) )
			.mockResolvedValue( {
				id: 'drawing-image',
				name: 'Drawing.png',
				mimeType: 'image/png',
				size: 3,
				dataBase64: 'cG5n',
			} );
		emit( 'dom-ready' );
		await waitFor( () => expect( annotate() ).toBeEnabled() );
		fireEvent.click( annotate() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Draw' } ) );
		const selection = {
			id: 'drawing-selection',
			target: {
				kind: 'drawing',
				url: 'http://localhost:8881/',
				viewport: { width: 800, height: 600 },
				documentRect: { left: 20, top: 30, width: 200, height: 100 },
			},
			rect: { left: 20, top: 30, width: 200, height: 100 },
			scroll: { left: 0, top: 0 },
			drawing: {
				color: '#3858e9',
				width: 3,
				strokes: [
					[
						{ x: 40, y: 50 },
						{ x: 180, y: 100 },
					],
					[ { x: 60, y: 70 } ],
				],
			},
		};
		emit( 'console-message', {
			message: INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'drawing', selection } ),
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Retry capture' } ) );
		await screen.findByRole( 'textbox', { name: 'Describe the change' } );
		expect( connector.captureAnnotationRegion ).toHaveBeenCalledTimes( 2 );
		expect( getSiteAnnotations( site.id ).notes ).toEqual( [
			expect.objectContaining( {
				kind: 'drawing',
				drawing: selection.drawing,
				images: [ expect.objectContaining( { id: 'drawing-image' } ) ],
			} ),
		] );
		expect( screen.getByRole( 'button', { name: 'Draw' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
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
