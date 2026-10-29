import { useEffect, useRef } from 'react';
import { AnnotationMarker, useSiteAnnotations } from '@/features/annotations';
import styles from './style.module.css';
import type { AnnotationAnchor } from '@/features/annotations';
import type { VisualAnnotationTarget } from '@studio/common/ai/visual-annotations';
import type { MouseEvent } from 'react';

export interface DesignAnnotationProps {
	// A token was picked; the anchor is in client coordinates.
	onAnnotationPick?: ( target: VisualAnnotationTarget, anchor: AnnotationAnchor ) => void;
	// The open note's token moved on screen.
	onAnnotationAnchor?: ( anchor: AnnotationAnchor ) => void;
}

const TARGET_ATTRIBUTE = 'data-annotation-target';

function anchorFor( element: Element, point: VisualAnnotationTarget[ 'point' ] ): AnnotationAnchor {
	const box = element.getBoundingClientRect();
	return {
		left: box.left + box.width * ( point?.x ?? 1 ),
		top: box.top + box.height * ( point?.y ?? 0 ),
	};
}

/**
 * Annotation mode for the design system page: its tokens are the targets, and
 * the notes share the site preview's store, editor and Send bar.
 */
export function useDesignAnnotations( {
	siteId,
	onAnnotationPick,
	onAnnotationAnchor,
}: DesignAnnotationProps & { siteId: string } ) {
	const { active, notes, editingId } = useSiteAnnotations( siteId );
	const targets = useRef( new Map< string, VisualAnnotationTarget >() );
	const editing = notes.find( ( note ) => note.id === editingId && note.targetKey );

	useEffect( () => {
		if ( ! editing?.targetKey || ! onAnnotationAnchor ) return;
		const key = editing.targetKey;
		const point = editing.point;
		const follow = () => {
			const element = document.querySelector( `[${ TARGET_ATTRIBUTE }="${ CSS.escape( key ) }"]` );
			if ( element ) onAnnotationAnchor( anchorFor( element, point ) );
		};
		window.addEventListener( 'scroll', follow, { capture: true, passive: true } );
		return () => window.removeEventListener( 'scroll', follow, { capture: true } );
	}, [ editing?.targetKey, editing?.point, onAnnotationAnchor ] );

	const target = ( key: string, label: string, value?: string, token?: string ) => {
		targets.current.set( key, {
			targetKey: key,
			designToken: token,
			nearbyText: value ? `${ label }: ${ value }` : label,
			path: 'DESIGN.md',
		} );
		return { [ TARGET_ATTRIBUTE ]: key };
	};

	const marker = ( key: string ) => {
		const note = active && notes.find( ( item ) => item.targetKey === key );
		return note ? (
			<AnnotationMarker className={ styles.annotationMarker } number={ note.number } />
		) : null;
	};

	const onClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		if ( ! active ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const element = ( event.target as Element ).closest( `[${ TARGET_ATTRIBUTE }]` );
		const picked = element && targets.current.get( element.getAttribute( TARGET_ATTRIBUTE ) ?? '' );
		if ( ! element || ! picked ) {
			return;
		}
		const box = element.getBoundingClientRect();
		onAnnotationPick?.(
			{
				...picked,
				point: {
					x: Math.min( 1, Math.max( 0, ( event.clientX - box.left ) / Math.max( 1, box.width ) ) ),
					y: Math.min( 1, Math.max( 0, ( event.clientY - box.top ) / Math.max( 1, box.height ) ) ),
				},
			},
			{ left: event.clientX, top: event.clientY }
		);
	};

	return { isPicking: active, target, marker, onClickCapture };
}
