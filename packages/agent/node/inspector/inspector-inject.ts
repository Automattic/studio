/**
 * Opens a headed Playwright browser on a Studio site for annotating it. The
 * page gets the inspector the Desktop preview uses (markers and picking) and
 * the CLI's note editor on top. The notes live here; Send hands them to
 * `annotateInBrowser()` and closes the browser.
 */

import { randomUUID } from 'crypto';
import { __, _n, isRTL, sprintf } from '@wordpress/i18n';
import { launchChromiumWithInstall } from '@studio/agent/node/browser-utils';
import {
	getStudioChatImageDecodedBytes,
	isStudioChatImageMimeType,
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	STUDIO_CHAT_MAX_IMAGES,
	STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES,
	toImageDataUrl,
	type StudioChatImage,
} from '@studio/agent/protocol/chat-images';
import {
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
	type InspectorEvent,
} from '@studio/agent/protocol/inspector/page-script';
import { NOTE_EDITOR_BINDING, NOTE_EDITOR_EVENT, NOTE_EDITOR_SCRIPT } from './note-editor';
import type { BrowserAnnotation } from '@studio/agent/shared/host';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

interface Anchor {
	left: number;
	top: number;
}

interface Session {
	browser: Browser;
	page: Page;
	notes: BrowserAnnotation[];
	savedIds: Set< string >;
	editingId: string | null;
	anchor: Anchor | null;
	finish: ( notes: BrowserAnnotation[] | null ) => void;
}

let session: Session | null = null;
// Settles with the sent notes, or null when the user cancels or closes the
// window. Kept after the session ends, so a call that timed out still gets them.
let pending: Promise< BrowserAnnotation[] | null > | null = null;
let processExitHookInstalled = false;

const hasContent = ( note: BrowserAnnotation ) =>
	Boolean( note.comment.trim() || note.images.length );

function installProcessExitHook(): void {
	if ( processExitHookInstalled ) {
		return;
	}
	processExitHookInstalled = true;
	// Tear down the chromium process when the CLI exits so its dock icon
	// doesn't linger on macOS.
	const cleanup = () => session?.finish( null );
	process.once( 'exit', cleanup );
	process.once( 'SIGINT', cleanup );
	process.once( 'SIGTERM', cleanup );
	process.once( 'SIGHUP', cleanup );
}

async function dispatch( page: Page, event: string, detail: unknown ): Promise< void > {
	await page
		.evaluate(
			( [ name, data ] ) => window.dispatchEvent( new CustomEvent( name, { detail: data } ) ),
			[ event, detail ] as const
		)
		.catch( () => undefined );
}

// `withEditor` reloads the open note into the editor, images included, so it is
// left out on the high-frequency anchor updates.
async function render( current: Session, withEditor = true ): Promise< void > {
	const { page, notes, editingId } = current;
	const count = notes.filter( hasContent ).length;
	const note = notes.find( ( item ) => item.id === editingId );
	await dispatch( page, INSPECTOR_COMMAND_EVENT, {
		active: true,
		editingId,
		notes: notes.map( ( { id, number, selector, url, documentRect, point } ) => ( {
			id,
			number,
			selector,
			url,
			documentRect,
			point,
			pending: ! current.savedIds.has( id ),
		} ) ),
		annotationLabel: __( 'Annotation' ),
		pendingAnnotationLabel: __( 'Pending annotation' ),
		accent: '#3858e9',
		onAccent: '#eff0f2',
	} );
	if ( ! withEditor ) {
		return;
	}
	await dispatch( page, NOTE_EDITOR_EVENT, {
		anchor: current.anchor,
		count,
		editing: note
			? {
					id: note.id,
					comment: note.comment,
					images: note.images.map( ( image ) => ( {
						id: image.id,
						name: image.name,
						src: toImageDataUrl( image.mimeType, image.dataBase64 ),
					} ) ),
			  }
			: null,
		labels: {
			rtl: isRTL(),
			annotation: __( 'Annotation' ),
			annotations: __( 'Annotations' ),
			placeholder: __( 'Leave a note…' ),
			attach: __( 'Attach image' ),
			remove: __( 'Delete annotation' ),
			removeImage: __( 'Remove attachment' ),
			save: __( 'Save annotation (Enter)' ),
			cancel: __( 'Cancel' ),
			send: __( 'Send' ),
			/* translators: %d: number of annotations. */
			sendCount: sprintf( _n( 'Send %d annotation', 'Send %d annotations', count ), count ),
			status: count
				? /* translators: %d: number of annotations. */
				  sprintf( _n( '%d annotation', '%d annotations', count ), count )
				: __( 'Click anything on the page to leave a note' ),
		},
	} );
}

// An empty note only exists while its editor is open.
function closeEditor( current: Session, keepId?: string ): void {
	current.notes = current.notes.filter( ( note ) => {
		if ( note.id === keepId || hasContent( note ) ) return true;
		current.savedIds.delete( note.id );
		return false;
	} );
	current.editingId = keepId ?? null;
}

function onInspectorEvent( current: Session, event: InspectorEvent ): void {
	switch ( event.type ) {
		case 'pick': {
			closeEditor( current );
			const id = randomUUID();
			const number = Math.max( 0, ...current.notes.map( ( note ) => note.number ) ) + 1;
			current.notes.push( { ...event.target, id, number, comment: '', images: [] } );
			current.editingId = id;
			current.anchor = event.anchor;
			void render( current );
			return;
		}
		case 'edit':
			closeEditor( current, event.id );
			current.anchor = event.anchor;
			void render( current );
			return;
		case 'anchor':
			if ( event.id === current.editingId ) {
				current.anchor = event.anchor;
				void dispatch( current.page, NOTE_EDITOR_EVENT, { anchor: event.anchor } );
			}
			return;
		case 'escape':
			if ( current.editingId ) {
				closeEditor( current );
				void render( current );
			}
			return;
		case 'browser-command': {
			const { page } = current;
			const navigate =
				event.command === 'reload'
					? page.reload()
					: event.command === 'back'
					? page.goBack()
					: page.goForward();
			void navigate.catch( () => undefined );
		}
	}
}

// Keeps the images the model accepts, within one message's limits.
function acceptImages( current: Session, noteId: string, value: unknown ): StudioChatImage[] {
	const others = current.notes
		.filter( ( note ) => note.id !== noteId )
		.flatMap( ( note ) => note.images );
	let count = others.length;
	let total = others.reduce( ( sum, image ) => sum + image.size, 0 );
	const accepted: StudioChatImage[] = [];
	for ( const item of Array.isArray( value ) ? value : [] ) {
		const match =
			typeof item?.src === 'string' ? /^data:([^;,]+);base64,(.+)$/.exec( item.src ) : null;
		if ( ! match || ! isStudioChatImageMimeType( match[ 1 ] ) ) continue;
		const size = getStudioChatImageDecodedBytes( match[ 2 ] );
		if (
			count >= STUDIO_CHAT_MAX_IMAGES ||
			size > STUDIO_CHAT_MAX_IMAGE_BYTES ||
			total + size > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES
		) {
			continue;
		}
		count++;
		total += size;
		accepted.push( {
			id: typeof item.id === 'string' ? item.id.slice( 0, 100 ) : randomUUID(),
			name: typeof item.name === 'string' ? item.name.slice( 0, 200 ) : 'image',
			mimeType: match[ 1 ],
			size,
			dataBase64: match[ 2 ],
		} );
	}
	return accepted;
}

function onEditorAction( current: Session, action: unknown ): void {
	if ( typeof action !== 'object' || action === null ) return;
	const data = action as Record< string, unknown >;
	switch ( data.type ) {
		case 'change': {
			const note = current.notes.find( ( item ) => item.id === data.id );
			if ( ! note ) return;
			if ( typeof data.comment === 'string' ) note.comment = data.comment.slice( 0, 10_000 );
			if ( 'images' in data ) {
				note.images = acceptImages( current, note.id, data.images );
				if ( note.images.length !== ( data.images as unknown[] ).length ) void render( current );
			}
			return;
		}
		case 'save':
			if (
				current.editingId &&
				current.notes.some( ( note ) => note.id === current.editingId && hasContent( note ) )
			) {
				current.savedIds.add( current.editingId );
			}
			closeEditor( current );
			void render( current );
			return;
		case 'delete':
			if ( typeof data.id === 'string' ) current.savedIds.delete( data.id );
			current.notes = current.notes.filter( ( note ) => note.id !== data.id );
			closeEditor( current );
			void render( current );
			return;
		case 'send': {
			const notes = current.notes.filter( hasContent );
			if ( notes.length ) current.finish( notes );
			return;
		}
		case 'cancel':
			current.finish( null );
	}
}

async function inject( current: Session ): Promise< void > {
	await current.page.evaluate( INSPECTOR_PAGE_SCRIPT );
	await current.page.evaluate( NOTE_EDITOR_SCRIPT );
	await render( current );
}

/**
 * Opens the annotation browser on `siteUrl`, or brings back the open one, and
 * blocks until the user clicks Send. Resolves to null when the user cancels or
 * closes the browser. After a timeout the browser stays open with its notes,
 * so calling this again keeps waiting.
 */
export async function annotateInBrowser(
	siteUrl: string,
	timeoutMs = 30 * 60 * 1000
): Promise< BrowserAnnotation[] | null > {
	if ( session ) {
		await session.page.bringToFront().catch( () => undefined );
		await inject( session ).catch( () => undefined );
	} else if ( ! pending ) {
		await launch( siteUrl );
	}
	const done = pending as Promise< BrowserAnnotation[] | null >;
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise< never >( ( _, reject ) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						'The user has not sent annotations yet. The browser is still open: call open_annotation_browser again to keep waiting.'
					)
				),
			timeoutMs
		);
	} );
	try {
		const notes = await Promise.race( [ done, timeout ] );
		if ( pending === done ) pending = null;
		return notes;
	} finally {
		clearTimeout( timer );
	}
}

async function launch( siteUrl: string ): Promise< void > {
	const browser = await launchChromiumWithInstall(
		{
			headless: false,
			// 1280x800 fits a 13" MacBook once the macOS and Chrome chrome are
			// accounted for, so the bottom Send bar stays on screen.
			args: [ '--ignore-certificate-errors', '--window-size=1280,800' ],
		},
		'the Studio annotation browser'
	);
	// `viewport: null` makes the page follow the window size, so the fixed
	// editor and bar land inside the visible region.
	const page = await browser.newPage( { viewport: null, ignoreHTTPSErrors: true } );
	let finish: Session[ 'finish' ] = () => undefined;
	pending = new Promise( ( resolve ) => {
		let finished = false;
		finish = ( notes ) => {
			if ( finished ) return;
			finished = true;
			resolve( notes );
			if ( session?.browser === browser ) session = null;
			void browser.close().catch( () => undefined );
		};
	} );
	const current: Session = {
		browser,
		page,
		notes: [],
		savedIds: new Set(),
		editingId: null,
		anchor: null,
		finish,
	};
	session = current;

	await page.exposeFunction( NOTE_EDITOR_BINDING, ( action: unknown ) =>
		onEditorAction( current, action )
	);
	page.on( 'console', ( message ) => {
		const event = parseInspectorMessage( message.text() );
		if ( event ) onInspectorEvent( current, event );
	} );
	page.on( 'domcontentloaded', () => {
		closeEditor( current );
		void inject( current ).catch( () => undefined );
	} );
	// Playwright's chromium has no app menu, so closing the window is how the
	// user quits it; the whole process has to go or its dock icon stays.
	page.on( 'close', () => finish( null ) );
	browser.on( 'disconnected', () => finish( null ) );
	installProcessExitHook();

	await page.goto( siteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 } );
	// macOS chromium often opens behind the terminal.
	await page.bringToFront();
}
