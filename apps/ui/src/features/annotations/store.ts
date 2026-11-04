import { MAX_VISUAL_ANNOTATIONS } from '@studio/agent/protocol/visual-annotations';
import { __ } from '@wordpress/i18n';
import { useSyncExternalStore } from 'react';
import { toast } from '@/data/app-messages';
import { createPendingSlot } from '@/lib/pending-slot';
import type { ComposerImageAttachment } from '@studio/agent/protocol/composer-attachments';
import type { AnnotationDrawing } from '@studio/agent/protocol/inspector/selection';
import type {
	VisualAnnotation,
	VisualAnnotationTarget,
} from '@studio/agent/protocol/visual-annotations';

export interface PreviewAnnotation extends VisualAnnotation {
	drawing?: AnnotationDrawing;
	images: ComposerImageAttachment[];
	// Saved to the chat draft, so the composer sends it with the next message.
	staged?: boolean;
	batched?: boolean;
}

export interface SiteAnnotations {
	active: boolean;
	notes: PreviewAnnotation[];
	editingId: string | null;
	blockedNavigation?: number;
	// A send is on its way to the chat.
	sending?: boolean;
	// Images dropped or pasted into a note are still being read.
	preparing?: boolean;
}

const EMPTY: SiteAnnotations = { active: false, notes: [], editingId: null };

export function isAnnotationsBusy( { sending, preparing }: SiteAnnotations ) {
	return Boolean( sending || preparing );
}
const sites = new Map< string, SiteAnnotations >();
const listeners = new Set< () => void >();
const pendingReview = createPendingSlot< { siteId: string; noteId: string } >();

export function hasAnnotationContent( note: PreviewAnnotation ) {
	return Boolean( note.comment.trim() || note.images.length );
}

export function getSiteAnnotations( siteId: string | undefined ): SiteAnnotations {
	return ( siteId && sites.get( siteId ) ) || EMPTY;
}

export function isStagedAnnotation( note: PreviewAnnotation ) {
	return Boolean( note.staged ) && hasAnnotationContent( note );
}

export function isBatchedAnnotation( note: PreviewAnnotation ) {
	return Boolean( note.batched ) && isStagedAnnotation( note );
}

export function getStagedAnnotations( siteId: string | undefined ) {
	return getSiteAnnotations( siteId ).notes.filter( isStagedAnnotation );
}

function update( siteId: string, change: ( current: SiteAnnotations ) => SiteAnnotations ) {
	const current = getSiteAnnotations( siteId );
	const next = change( current );
	if ( next === current ) return;
	sites.set( siteId, next );
	listeners.forEach( ( listener ) => listener() );
}

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function useSiteAnnotations( siteId: string | undefined ) {
	return useSyncExternalStore( subscribe, () => getSiteAnnotations( siteId ) );
}

// An empty note only exists while its editor is open.
function withoutEmpty( notes: PreviewAnnotation[], keepId?: string ) {
	return notes.filter( ( note ) => note.id === keepId || hasAnnotationContent( note ) );
}

export function setAnnotating( siteId: string, active: boolean ) {
	update( siteId, ( current ) =>
		current.active === active
			? current
			: {
					...current,
					active,
					notes: active ? current.notes : withoutEmpty( current.notes ),
					editingId: active
						? current.editingId ??
						  current.notes.find( ( note ) => ! note.staged && hasAnnotationContent( note ) )?.id ??
						  null
						: null,
			  }
	);
}

export function setAnnotationsPreparing( siteId: string, preparing: boolean ) {
	update( siteId, ( current ) =>
		Boolean( current.preparing ) === preparing ? current : { ...current, preparing }
	);
}

function blockDraftNavigation( siteId: string, nextId?: string ) {
	const current = getSiteAnnotations( siteId );
	const draft =
		current.notes.find(
			( note ) => note.id === current.editingId && ! note.staged && hasAnnotationContent( note )
		) ?? current.notes.find( ( note ) => ! note.staged && hasAnnotationContent( note ) );
	if ( ! draft || draft.id === nextId || draft.staged || ! hasAnnotationContent( draft ) )
		return false;
	update( siteId, ( current ) => ( {
		...current,
		editingId: draft.id,
		blockedNavigation: ( current.blockedNavigation ?? 0 ) + 1,
	} ) );
	return true;
}

export function canPickAnnotation( siteId: string ) {
	const current = getSiteAnnotations( siteId );
	if ( isAnnotationsBusy( current ) || blockDraftNavigation( siteId ) ) return false;
	if ( current.notes.filter( hasAnnotationContent ).length >= MAX_VISUAL_ANNOTATIONS ) {
		toast.error( __( 'Send or delete some annotations before adding more' ) );
		return false;
	}
	return true;
}

export function pickAnnotation(
	siteId: string,
	target: VisualAnnotationTarget,
	initial?: Pick< PreviewAnnotation, 'images' | 'drawing' >
) {
	const current = getSiteAnnotations( siteId );
	if ( isAnnotationsBusy( current ) ) {
		return null;
	}
	const existing = target.targetKey
		? current.notes.find( ( note ) => note.targetKey === target.targetKey )
		: undefined;
	if ( existing ) {
		return editAnnotation( siteId, existing.id ) ? existing.id : null;
	}
	if ( ! canPickAnnotation( siteId ) ) return null;
	const id = crypto.randomUUID();
	update( siteId, ( current ) => {
		const notes = withoutEmpty( current.notes );
		const number = Math.max( 0, ...notes.map( ( note ) => note.number ) ) + 1;
		return {
			...current,
			notes: [ ...notes, { ...target, id, number, comment: '', images: [], ...initial } ],
			editingId: id,
		};
	} );
	return id;
}

export function editAnnotation( siteId: string, id: string ) {
	if ( blockDraftNavigation( siteId, id ) ) return false;
	update( siteId, ( current ) => ( {
		...current,
		notes: withoutEmpty( current.notes, id ),
		editingId: id,
	} ) );
	return true;
}

export function changeAnnotation(
	siteId: string,
	id: string,
	patch: Partial< Pick< PreviewAnnotation, 'comment' | 'images' > >
) {
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.map( ( note ) => {
			if ( note.id !== id ) return note;
			const changed =
				( patch.comment !== undefined && patch.comment !== note.comment ) ||
				( patch.images !== undefined &&
					( patch.images.length !== note.images.length ||
						patch.images.some( ( image, index ) => image.id !== note.images[ index ]?.id ) ) );
			return changed ? { ...note, ...patch, ...( note.staged ? { staged: false } : {} ) } : note;
		} ),
	} ) );
}

export function closeAnnotationEditor( siteId: string ) {
	update( siteId, ( current ) =>
		current.editingId
			? { ...current, notes: withoutEmpty( current.notes ), editingId: null }
			: current
	);
}

// Empty selections can be dismissed; unfinished notes must be added or deleted.
export function escapeAnnotations( siteId: string ) {
	const current = getSiteAnnotations( siteId );
	if ( isAnnotationsBusy( current ) || blockDraftNavigation( siteId ) ) {
		return;
	}
	setAnnotating( siteId, false );
}

export function stageAnnotations( siteId: string, ids?: string[], batch = false ) {
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.map( ( note ) =>
			hasAnnotationContent( note ) && ( ! ids || ids.includes( note.id ) )
				? { ...note, staged: true, ...( batch ? { batched: true } : {} ) }
				: note
		),
	} ) );
}

export function removeAnnotations( siteId: string, ids: string[] ) {
	const review = pendingReview.getSnapshot();
	if ( review?.siteId === siteId && ids.includes( review.noteId ) ) pendingReview.clear( review );
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.filter( ( note ) => ! ids.includes( note.id ) ),
		editingId: current.editingId && ids.includes( current.editingId ) ? null : current.editingId,
	} ) );
}

type AnnotationSendRequest = { siteId: string; noteIds?: string[] };

// A request to send notes from the preview, held until a chat for that site
// takes it. Without `noteIds` it sends the chat draft with every note; with
// them, only those notes, straight away.
let pendingSend: AnnotationSendRequest | null = null;
const sendListeners = new Set< () => void >();

const setSending = ( siteId: string, sending: boolean ) =>
	update( siteId, ( current ) => ( { ...current, sending } ) );

export function requestAnnotationSend( request: AnnotationSendRequest ) {
	pendingSend = request;
	setSending( request.siteId, true );
	sendListeners.forEach( ( listener ) => listener() );
}

// `onRequest` returns the send, if it starts one, so the preview can show it in flight.
export function subscribeAnnotationSend(
	siteId: string,
	onRequest: ( request: AnnotationSendRequest ) => Promise< unknown > | void
) {
	const listener = () => {
		if ( pendingSend?.siteId === siteId ) {
			const request = pendingSend;
			pendingSend = null;
			void Promise.resolve( onRequest( request ) )
				.catch( () => undefined )
				.finally( () => setSending( siteId, false ) );
		}
	};
	sendListeners.add( listener );
	listener();
	return () => {
		sendListeners.delete( listener );
	};
}

export function requestAnnotationReview( siteId: string, noteId: string ) {
	pendingReview.set( { siteId, noteId } );
}

export function subscribeAnnotationReview( siteId: string, onReview: ( noteId: string ) => void ) {
	const listener = () => {
		const request = pendingReview.getSnapshot();
		if ( request?.siteId !== siteId ) return;
		pendingReview.clear( request );
		onReview( request.noteId );
	};
	const unsubscribe = pendingReview.subscribe( listener );
	listener();
	return () => {
		unsubscribe();
	};
}
