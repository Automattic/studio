import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
	type AnnotationAnchor,
	editAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
} from '@/features/annotations';
import type { PreviewSurfaceKey } from './surfaces';
import type { InspectorEvent } from '@studio/common/ai/inspector/page-script';
import type { VisualAnnotationTarget } from '@studio/common/ai/visual-annotations';

type AnnotationEvent = Exclude< InspectorEvent, { type: 'browser-command' } >;

// Where the note being written sits over the preview, from the picks and
// moves the annotated surface reports.
export function usePreviewAnnotations( {
	siteId,
	surfaceKey,
	canAnnotateSurface,
	viewportRef,
	onSendAnnotations,
}: {
	siteId: string;
	surfaceKey: PreviewSurfaceKey;
	canAnnotateSurface: boolean;
	viewportRef: RefObject< HTMLDivElement | null >;
	onSendAnnotations?: ( siteId: string, noteIds?: string[] ) => void;
} ) {
	const [ annotationAnchor, setAnnotationAnchor ] = useState< AnnotationAnchor | null >( null );
	useEffect( () => {
		if ( ! canAnnotateSurface ) {
			setAnnotating( siteId, false );
		}
	}, [ canAnnotateSurface, siteId ] );
	useEffect( () => {
		setAnnotationAnchor( null );
	}, [ surfaceKey, siteId ] );
	// Anchors arrive in client coordinates; the overlay sits on the viewport.
	const toViewportAnchor = useCallback(
		( anchor: AnnotationAnchor | null ) => {
			const box = viewportRef.current?.getBoundingClientRect();
			return anchor && box ? { left: anchor.left - box.left, top: anchor.top - box.top } : null;
		},
		[ viewportRef ]
	);
	const handleAnnotationPick = useCallback(
		( target: VisualAnnotationTarget, anchor: AnnotationAnchor ) => {
			if ( pickAnnotation( siteId, target ) ) {
				setAnnotationAnchor( toViewportAnchor( anchor ) );
			}
		},
		[ siteId, toViewportAnchor ]
	);
	const sendAnnotations = useCallback(
		( noteIds?: string[] ) => {
			onSendAnnotations?.( siteId, noteIds );
			if ( ! noteIds ) {
				setAnnotating( siteId, false );
			}
		},
		[ onSendAnnotations, siteId ]
	);
	const handleAnnotationEvent = useCallback(
		( event: AnnotationEvent ) => {
			const editingId = getSiteAnnotations( siteId ).editingId;
			if ( event.type === 'escape' ) {
				escapeAnnotations( siteId );
			} else if ( event.type === 'pick' ) {
				handleAnnotationPick( event.target, event.anchor );
			} else if ( event.type === 'edit' ) {
				editAnnotation( siteId, event.id );
				setAnnotationAnchor( toViewportAnchor( event.anchor ) );
			} else if ( event.id === editingId ) {
				const next = toViewportAnchor( event.anchor );
				setAnnotationAnchor( ( current ) =>
					current?.left === next?.left && current?.top === next?.top ? current : next
				);
			}
		},
		[ handleAnnotationPick, siteId, toViewportAnchor ]
	);

	return {
		annotationAnchor,
		setAnnotationAnchor,
		toViewportAnchor,
		handleAnnotationPick,
		handleAnnotationEvent,
		sendAnnotations,
	};
}
