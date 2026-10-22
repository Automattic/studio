import { useSyncExternalStore } from 'react';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';
import type {
	VisualAnnotation,
	VisualAnnotationTarget,
} from '@studio/common/ai/visual-annotations';

export interface PreviewAnnotation extends VisualAnnotation {
	images: ComposerImageAttachment[];
	// Saved to the chat draft, so the composer sends it with the next message.
	staged?: boolean;
}

export interface SiteAnnotations {
	active: boolean;
	notes: PreviewAnnotation[];
	editingId: string | null;
}

const EMPTY: SiteAnnotations = { active: false, notes: [], editingId: null };
const sites = new Map< string, SiteAnnotations >();
const listeners = new Set< () => void >();

export function hasAnnotationContent( note: PreviewAnnotation ) {
	return Boolean( note.comment.trim() || note.images.length );
}

export function getSiteAnnotations( siteId: string | undefined ): SiteAnnotations {
	return ( siteId && sites.get( siteId ) ) || EMPTY;
}

export function isStagedAnnotation( note: PreviewAnnotation ) {
	return Boolean( note.staged ) && hasAnnotationContent( note );
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
					active,
					notes: active ? current.notes : withoutEmpty( current.notes ),
					editingId: active ? current.editingId : null,
			  }
	);
}

export function pickAnnotation( siteId: string, target: VisualAnnotationTarget ) {
	const existing = target.designKey
		? getSiteAnnotations( siteId ).notes.find( ( note ) => note.designKey === target.designKey )
		: undefined;
	if ( existing ) {
		editAnnotation( siteId, existing.id );
		return existing.id;
	}
	const id = crypto.randomUUID();
	update( siteId, ( current ) => {
		const notes = withoutEmpty( current.notes );
		const number = Math.max( 0, ...notes.map( ( note ) => note.number ) ) + 1;
		return {
			...current,
			notes: [ ...notes, { ...target, id, number, comment: '', images: [] } ],
			editingId: id,
		};
	} );
	return id;
}

export function editAnnotation( siteId: string, id: string ) {
	update( siteId, ( current ) => ( {
		...current,
		notes: withoutEmpty( current.notes, id ),
		editingId: id,
	} ) );
}

export function changeAnnotation(
	siteId: string,
	id: string,
	patch: Partial< Pick< PreviewAnnotation, 'comment' | 'images' > >
) {
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.map( ( note ) => ( note.id === id ? { ...note, ...patch } : note ) ),
	} ) );
}

export function closeAnnotationEditor( siteId: string ) {
	update( siteId, ( current ) =>
		current.editingId
			? { ...current, notes: withoutEmpty( current.notes ), editingId: null }
			: current
	);
}

// With a note open, Escape closes it; otherwise it leaves annotation mode and
// keeps the notes.
export function escapeAnnotations( siteId: string ) {
	if ( getSiteAnnotations( siteId ).editingId ) {
		closeAnnotationEditor( siteId );
	} else {
		setAnnotating( siteId, false );
	}
}

export function stageAnnotations( siteId: string, ids?: string[] ) {
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.map( ( note ) =>
			hasAnnotationContent( note ) && ( ! ids || ids.includes( note.id ) )
				? { ...note, staged: true }
				: note
		),
	} ) );
}

export function removeAnnotations( siteId: string, ids: string[] ) {
	update( siteId, ( current ) => ( {
		...current,
		notes: current.notes.filter( ( note ) => ! ids.includes( note.id ) ),
		editingId: current.editingId && ids.includes( current.editingId ) ? null : current.editingId,
	} ) );
}

export function clearAnnotations( siteId: string ) {
	update( siteId, ( current ) =>
		current.notes.length ? { ...current, notes: [], editingId: null } : current
	);
}

export type AnnotationSendRequest = { siteId: string; noteIds?: string[] };

// A request to send notes from the preview, held until a chat for that site
// takes it. Without `noteIds` it sends the chat draft with every note; with
// them, only those notes, straight away.
let pendingSend: AnnotationSendRequest | null = null;
const sendListeners = new Set< () => void >();

export function requestAnnotationSend( request: AnnotationSendRequest ) {
	pendingSend = request;
	sendListeners.forEach( ( listener ) => listener() );
}

export function subscribeAnnotationSend(
	siteId: string,
	onRequest: ( request: AnnotationSendRequest ) => void
) {
	const listener = () => {
		if ( pendingSend?.siteId === siteId ) {
			const request = pendingSend;
			pendingSend = null;
			onRequest( request );
		}
	};
	sendListeners.add( listener );
	listener();
	return () => {
		sendListeners.delete( listener );
	};
}
