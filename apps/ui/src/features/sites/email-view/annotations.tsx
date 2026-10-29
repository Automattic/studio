import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
	type RefObject,
} from 'react';
import {
	AnnotationMarker,
	escapeAnnotations,
	getSiteAnnotations,
	useSiteAnnotations,
} from '@/features/annotations';
import styles from './style.module.css';
import type { SiteEmail } from '@/data/core';
import type { AnnotationAnchor } from '@/features/annotations';
import type {
	VisualAnnotation,
	VisualAnnotationTarget,
} from '@studio/common/ai/visual-annotations';

export interface EmailAnnotationProps {
	// A part of the body was picked; the anchor is in client coordinates.
	onAnnotationPick?: ( target: VisualAnnotationTarget, anchor: AnnotationAnchor ) => void;
	// The open note's part moved on screen, or left it.
	onAnnotationAnchor?: ( anchor: AnnotationAnchor | null ) => void;
}

const PARAGRAPH_ATTRIBUTE = 'data-email-paragraph';
const COMPUTED_STYLES = [
	'color',
	'background-color',
	'font-size',
	'font-weight',
	'font-family',
	'line-height',
	'padding',
	'margin',
	'border',
	'text-align',
];

type Box = { left: number; top: number; width: number; height: number };
type FrameNote = Pick< VisualAnnotation, 'id' | 'number' | 'selector' | 'point' >;

function pointIn( box: Box, clientX: number, clientY: number ) {
	return {
		x: Math.min( 1, Math.max( 0, ( clientX - box.left ) / Math.max( 1, box.width ) ) ),
		y: Math.min( 1, Math.max( 0, ( clientY - box.top ) / Math.max( 1, box.height ) ) ),
	};
}

function pointOn( box: Box, point: VisualAnnotationTarget[ 'point' ] ): AnnotationAnchor {
	return {
		left: box.left + box.width * ( point?.x ?? 1 ),
		top: box.top + box.height * ( point?.y ?? 0 ),
	};
}

// The frame's elements belong to another window, so `instanceof Element` fails.
function asElement( node: EventTarget | null ): Element | null {
	return node && ( node as Node ).nodeType === Node.ELEMENT_NODE ? ( node as Element ) : null;
}

function findInFrame( document: Document | null | undefined, selector: string | undefined ) {
	try {
		return selector ? document?.querySelector( selector ) ?? null : null;
	} catch {
		return null;
	}
}

// The full path from the body, or from the nearest element with an ID, so it
// finds the same element again in the nested tables emails are made of.
function selectorFor( element: Element ) {
	const parts: string[] = [];
	for (
		let node: Element | null = element;
		node && node !== node.ownerDocument.body;
		node = node.parentElement
	) {
		if ( node.id ) {
			return [ `#${ CSS.escape( node.id ) }`, ...parts ].join( ' > ' );
		}
		const tag = node.tagName;
		const classes = Array.from( node.classList )
			.slice( 0, 3 )
			.map( ( name ) => `.${ CSS.escape( name ) }` )
			.join( '' );
		const siblings = Array.from( node.parentElement?.children ?? [] ).filter(
			( sibling ) => sibling.tagName === tag
		);
		const nth = siblings.length > 1 ? `:nth-of-type(${ siblings.indexOf( node ) + 1 })` : '';
		parts.unshift( `${ tag.toLowerCase() }${ classes }${ nth }` );
	}
	return [ 'body', ...parts ].join( ' > ' );
}

function describeElement( element: Element, clientX: number, clientY: number ) {
	const view = element.ownerDocument.defaultView;
	const style = view?.getComputedStyle( element );
	const box = element.getBoundingClientRect();
	const text = ( element as HTMLElement ).innerText || element.textContent || '';
	return {
		selector: selectorFor( element ),
		tag: element.tagName.toLowerCase(),
		classes: Array.from( element.classList ).slice( 0, 10 ),
		nearbyText: text.replace( /\s+/g, ' ' ).trim().slice( 0, 200 ),
		point: pointIn( box, clientX, clientY ),
		computedStyles: style
			? Object.fromEntries(
					COMPUTED_STYLES.map( ( key ) => [ key, style.getPropertyValue( key ) ] )
			  )
			: undefined,
	};
}

// Where a note on the email on screen sits, in client coordinates.
function anchorFor( note: VisualAnnotation, root: HTMLElement | null ): AnnotationAnchor | null {
	if ( ! note.email || ! root ) {
		return null;
	}
	if ( note.email.part === 'html' ) {
		const frame = root.querySelector( 'iframe' );
		const element = findInFrame( frame?.contentDocument, note.selector );
		if ( ! frame || ! element ) {
			return null;
		}
		const offset = frame.getBoundingClientRect();
		const anchor = pointOn( element.getBoundingClientRect(), note.point );
		return { left: anchor.left + offset.left, top: anchor.top + offset.top };
	}
	const element = root.querySelector( `[${ PARAGRAPH_ATTRIBUTE }="${ note.email.paragraph }"]` );
	return element ? pointOn( element.getBoundingClientRect(), note.point ) : null;
}

/**
 * Annotation mode for an email: the elements of its HTML and the paragraphs of
 * its text are the targets. The notes share the site preview's store, editor
 * and Send bar.
 */
export function useEmailAnnotations( {
	siteId,
	email,
	active,
	rootRef,
	onAnnotationPick,
	onAnnotationAnchor,
}: EmailAnnotationProps & {
	siteId: string;
	email: SiteEmail;
	// On screen, so the open note follows it.
	active: boolean;
	rootRef: RefObject< HTMLElement | null >;
} ) {
	const annotations = useSiteAnnotations( siteId );
	const picking = annotations.active;
	const notes = useMemo(
		() => annotations.notes.filter( ( note ) => note.email?.id === email.id ),
		[ annotations.notes, email.id ]
	);
	const frameNotes = useMemo(
		() => notes.filter( ( note ) => note.email?.part === 'html' ),
		[ notes ]
	);
	const editingId = annotations.editingId;

	const moveAnchor = useEffectEvent(
		( anchor: AnnotationAnchor | null ) => onAnnotationAnchor?.( anchor )
	);
	useEffect( () => {
		if ( ! active || ! editingId ) {
			return;
		}
		const follow = () => {
			const note = getSiteAnnotations( siteId ).notes.find( ( item ) => item.id === editingId );
			if ( note?.email ) {
				moveAnchor( note.email.id === email.id ? anchorFor( note, rootRef.current ) : null );
			}
		};
		follow();
		window.addEventListener( 'scroll', follow, { capture: true, passive: true } );
		window.addEventListener( 'resize', follow );
		return () => {
			window.removeEventListener( 'scroll', follow, { capture: true } );
			window.removeEventListener( 'resize', follow );
		};
	}, [ active, editingId, email.id, rootRef, siteId ] );

	const pick = ( target: VisualAnnotationTarget, anchor: AnnotationAnchor, key: string ) =>
		onAnnotationPick?.( { ...target, targetKey: `email:${ email.id }:${ key }` }, anchor );

	const paragraphProps = ( index: number ) => ( { [ PARAGRAPH_ATTRIBUTE ]: String( index ) } );

	const paragraphMarker = ( index: number ) => {
		const note =
			picking &&
			notes.find( ( item ) => item.email?.part === 'text' && item.email.paragraph === index );
		return note ? (
			<AnnotationMarker className={ styles.annotationMarker } number={ note.number } />
		) : null;
	};

	// Only paragraphs take clicks: the tabs and the back button still work.
	const onClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		if ( ! picking ) {
			return;
		}
		const element = ( event.target as Element ).closest( `[${ PARAGRAPH_ATTRIBUTE }]` );
		if ( ! element ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const paragraph = Number( element.getAttribute( PARAGRAPH_ATTRIBUTE ) );
		pick(
			{
				email: { id: email.id, subject: email.subject, part: 'text', paragraph },
				nearbyText: ( element.textContent ?? '' ).replace( /\s+/g, ' ' ).trim().slice( 0, 200 ),
				point: pointIn( element.getBoundingClientRect(), event.clientX, event.clientY ),
			},
			{ left: event.clientX, top: event.clientY },
			`text:${ paragraph }`
		);
	};

	const frame: EmailFrameAnnotations = {
		active: picking,
		notes: frameNotes,
		onEscape: () => escapeAnnotations( siteId ),
		onPick: ( picked, anchor ) => {
			// A click on the body's margin lands on the root element, outside the body.
			const { body, documentElement } = picked.ownerDocument;
			const element = picked === documentElement ? body : picked;
			const described = describeElement( element, anchor.left, anchor.top );
			const offset = rootRef.current?.querySelector( 'iframe' )?.getBoundingClientRect();
			pick(
				{ ...described, email: { id: email.id, subject: email.subject, part: 'html' } },
				{ left: anchor.left + ( offset?.left ?? 0 ), top: anchor.top + ( offset?.top ?? 0 ) },
				`html:${ described.selector }`
			);
		},
	};

	return { isPicking: picking, paragraphProps, paragraphMarker, onClickCapture, frame };
}

export interface EmailFrameAnnotations {
	active: boolean;
	notes: FrameNote[];
	onEscape: () => void;
	// The anchor is in the frame's coordinates.
	onPick: ( element: Element, anchor: AnnotationAnchor ) => void;
}

const sameBox = ( a: Box | null, b: Box | null ) =>
	a === b ||
	( !! a &&
		!! b &&
		a.left === b.left &&
		a.top === b.top &&
		a.width === b.width &&
		a.height === b.height );

/**
 * Picking inside the HTML body. The frame runs no scripts, so Studio listens
 * to its document from outside, and draws the hover box and the markers over it.
 */
export function EmailFrameAnnotationLayer( {
	frameRef,
	loads,
	annotations,
}: {
	frameRef: RefObject< HTMLIFrameElement | null >;
	// Bumped on each load of the frame.
	loads: number;
	annotations: EmailFrameAnnotations;
} ) {
	const { active, notes } = annotations;
	const [ hover, setHover ] = useState< Box | null >( null );
	const [ layout, setLayout ] = useState( 0 );
	const [ markers, setMarkers ] = useState< Array< FrameNote & { at: AnnotationAnchor } > >( [] );
	const latest = useRef( annotations );
	useEffect( () => {
		latest.current = annotations;
	} );

	useEffect( () => {
		const document = frameRef.current?.contentDocument;
		if ( ! active || ! loads || ! document?.documentElement ) {
			setHover( null );
			return;
		}
		const cursor = document.createElement( 'style' );
		cursor.textContent = '*{cursor:pointer!important}';
		document.documentElement.append( cursor );
		const onMove = ( event: PointerEvent ) => {
			const box = asElement( event.target )?.getBoundingClientRect();
			const next = box
				? { left: box.left, top: box.top, width: box.width, height: box.height }
				: null;
			setHover( ( current ) => ( sameBox( current, next ) ? current : next ) );
		};
		// Out of the frame, not just into another of its elements.
		const onLeave = ( event: PointerEvent ) => {
			if ( ! event.relatedTarget ) setHover( null );
		};
		const onClick = ( event: globalThis.MouseEvent ) => {
			event.preventDefault();
			event.stopPropagation();
			const element = asElement( event.target );
			if ( element ) {
				latest.current.onPick( element, { left: event.clientX, top: event.clientY } );
			}
		};
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' ) {
				event.preventDefault();
				latest.current.onEscape();
			}
		};
		document.addEventListener( 'pointermove', onMove, true );
		document.addEventListener( 'pointerout', onLeave, true );
		document.addEventListener( 'click', onClick, true );
		document.addEventListener( 'keydown', onKeyDown, true );
		return () => {
			cursor.remove();
			document.removeEventListener( 'pointermove', onMove, true );
			document.removeEventListener( 'pointerout', onLeave, true );
			document.removeEventListener( 'click', onClick, true );
			document.removeEventListener( 'keydown', onKeyDown, true );
		};
	}, [ active, frameRef, loads ] );

	// Images that load late and a narrower preview move the email's elements.
	useEffect( () => {
		const root = frameRef.current?.contentDocument?.documentElement;
		if ( ! loads || ! root || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( () => setLayout( ( count ) => count + 1 ) );
		observer.observe( root );
		return () => observer.disconnect();
	}, [ frameRef, loads ] );

	useLayoutEffect( () => {
		const document = frameRef.current?.contentDocument;
		setMarkers(
			active && loads
				? notes.flatMap( ( note ) => {
						const element = findInFrame( document, note.selector );
						return element
							? [ { ...note, at: pointOn( element.getBoundingClientRect(), note.point ) } ]
							: [];
				  } )
				: []
		);
	}, [ active, frameRef, layout, loads, notes ] );

	if ( ! active ) {
		return null;
	}
	return (
		<div className={ styles.frameLayer } aria-hidden="true">
			{ hover ? <div className={ styles.frameHover } style={ hover } /> : null }
			{ markers.map( ( marker ) => (
				<AnnotationMarker
					key={ marker.id }
					className={ styles.frameMarker }
					style={ { left: marker.at.left, top: marker.at.top } }
					number={ marker.number }
				/>
			) ) }
		</div>
	);
}
