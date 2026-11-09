import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	Fragment,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getMotionDuration } from '@/lib/theme';
import { SidebarMenu } from '../sidebar';
import { VisuallyHidden } from '../visually-hidden';
import styles from './style.module.css';

type ActiveDrag = {
	id: string;
	currentY: number;
	dropIndex: number;
	pointerOffsetY: number;
	previewLeft: number;
	previewWidth: number;
	// Dropped: the preview flies into the row's new slot, which stays hidden
	// until it lands.
	landing?: boolean;
};

type DragCandidate = {
	id: string;
	pointerId: number | undefined;
	startX: number;
	startY: number;
	pointerOffsetY: number;
	previewLeft: number;
	previewWidth: number;
};

const DRAG_START_THRESHOLD = 4;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_STEP_PX = 12;

function isSameOrder( a: string[], b: string[] ) {
	return a.length === b.length && a.every( ( id, index ) => id === b[ index ] );
}

function insertIdAtIndex( ids: string[], movedId: string, targetIndex: number ) {
	const fromIndex = ids.indexOf( movedId );
	if ( fromIndex === -1 ) {
		return ids;
	}

	const nextIds = [ ...ids ];
	const [ moved ] = nextIds.splice( fromIndex, 1 );
	nextIds.splice( Math.max( 0, Math.min( targetIndex, nextIds.length ) ), 0, moved );
	return nextIds;
}

// Row geometry in the scroll parent's content coordinates (viewport top +
// scrollTop), so captured rects stay valid while auto-scroll moves the list.
type RowRect = { top: number; height: number };

function measureRowRects( list: HTMLElement | null, scrollOffset: number ) {
	const rects = new Map< string, RowRect >();
	for ( const element of list?.querySelectorAll( ':scope > [data-reorder-id]' ) ?? [] ) {
		const { top, height } = element.getBoundingClientRect();
		rects.set( element.getAttribute( 'data-reorder-id' )!, { top: top + scrollOffset, height } );
	}
	return rects;
}

function findScrollParent( element: HTMLElement | null ): HTMLElement | null {
	for ( let node = element?.parentElement; node; node = node.parentElement ) {
		if (
			/(auto|scroll)/.test( getComputedStyle( node ).overflowY ) &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
	}
	return null;
}

function prefersReducedMotion() {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
}

/** Props for the list item a row renders: its drag state, or the drag preview's placement. */
export type ReorderableItemProps = {
	className: string;
	style?: CSSProperties;
	'aria-hidden'?: true;
	inert?: boolean;
} & Record< `data-${ string }`, string | true | undefined >;

export type ReorderableListProps< T > = {
	/** Full ordered list, dragged item included. */
	items: T[];
	getItemId: ( item: T ) => string;
	/** Renders a row as a `SidebarMenuItem` spread with `props`; also used for the floating drag preview. */
	renderItem: ( item: T, props: ReorderableItemProps ) => ReactNode;
	onReorder: ( nextIds: string[] ) => void;
	className?: string;
	itemClassName?: string;
	previewClassName?: string;
	/** Pointer-downs inside a match of this selector never start a drag. */
	excludeSelector?: string;
	/** Restricts dragging and keyboard reordering to this handle. */
	handleSelector?: string;
	/** Places the preview outside a floating surface's positioning container. */
	portalPreview?: boolean;
	onReorderingChange?: ( active: boolean ) => void;
	/** No drag starts, e.g. while rows are being multi-selected. */
	disabled?: boolean;
	/** Names a dropped row when its new position is announced. */
	getItemLabel?: ( item: T ) => string;
	/** A drag starts on this item, before the rows are measured for it. */
	onDragStart?: ( item: T ) => void;
	/** Rows after the reorderable ones, like Show more. */
	children?: ReactNode;
};

export function ReorderableList< T >( {
	items,
	getItemId,
	renderItem,
	onReorder,
	className,
	itemClassName,
	previewClassName,
	excludeSelector,
	handleSelector,
	portalPreview = false,
	onReorderingChange,
	disabled = false,
	getItemLabel,
	onDragStart,
	children,
}: ReorderableListProps< T > ) {
	const [ activeDrag, setActiveDrag ] = useState< ActiveDrag | null >( null );
	const [ announcement, setAnnouncement ] = useState( '' );
	const activeDragRef = useRef< ActiveDrag | null >( null );
	const dragCandidateRef = useRef< DragCandidate | null >( null );
	const dragStartOrderRef = useRef< string[] >( [] );
	const dragStartRowRectsRef = useRef< Map< string, RowRect > >( new Map() );
	const suppressNextClickRef = useRef( false );
	const removeDragListenersRef = useRef< ( () => void ) | null >( null );
	const containerRef = useRef< HTMLUListElement | null >( null );
	const scrollParentRef = useRef< HTMLElement | null >( null );
	const autoScrollRef = useRef< { step: number; rafId: number } | null >( null );
	const previewId = useId();
	const reordering = activeDrag !== null;
	const notifyReordering = useEffectEvent( ( active: boolean ) => onReorderingChange?.( active ) );
	useEffect( () => {
		notifyReordering( reordering );
		return () => notifyReordering( false );
	}, [ reordering ] );

	// A dropped order shows until `items` changes: a parent reading its order
	// from the query cache renders it a tick after the drop, and the landing
	// must fly to the new slot.
	const [ dropped, setDropped ] = useState< { ids: string[]; over: string[] } | null >( null );
	const parentIds = useMemo( () => items.map( getItemId ), [ items, getItemId ] );
	const droppedIds = dropped && isSameOrder( dropped.over, parentIds ) ? dropped.ids : undefined;
	if ( dropped && ! droppedIds ) {
		setDropped( null );
	}
	const itemIds = droppedIds ?? parentIds;
	const orderedItems = droppedIds
		? droppedIds.map( ( id ) => items[ parentIds.indexOf( id ) ] )
		: items;
	const sourceIndex = activeDrag ? itemIds.indexOf( activeDrag.id ) : -1;
	const draggedItem = activeDrag
		? items.find( ( item ) => getItemId( item ) === activeDrag.id )
		: undefined;
	const landingId = activeDrag?.landing ? activeDrag.id : undefined;
	const draggingId = activeDrag && ! activeDrag.landing ? activeDrag.id : undefined;

	// Rows can move as the drag starts (a dragged site folds its chats).
	useLayoutEffect( () => {
		if ( draggingId ) {
			dragStartRowRectsRef.current = measureRowRects(
				containerRef.current,
				scrollParentRef.current?.scrollTop ?? 0
			);
		}
	}, [ draggingId ] );

	useLayoutEffect( () => {
		if ( ! landingId ) {
			return;
		}
		// Keyboard interaction continues from the item the user just moved.
		const list = containerRef.current;
		const row = [ ...( list?.querySelectorAll( ':scope > [data-reorder-id]' ) ?? [] ) ].find(
			( element ) => element.getAttribute( 'data-reorder-id' ) === landingId
		);
		if ( row && ! row.contains( document.activeElement ) ) {
			row
				.querySelector< HTMLElement >( 'button, a[href], [tabindex]' )
				?.focus( { preventScroll: true } );
		}
		const land = () => {
			activeDragRef.current = null;
			setActiveDrag( null );
		};
		const preview = document.querySelector( `[data-reorder-preview="${ previewId }"]` );
		const duration = prefersReducedMotion() ? 0 : getMotionDuration( 'surface' );
		if ( ! row || ! preview || ! duration || typeof preview.animate !== 'function' ) {
			land();
			return;
		}
		const from = preview.getBoundingClientRect();
		const to = row.getBoundingClientRect();
		const animation = preview.animate(
			[
				{ transform: 'none' },
				{ transform: `translate(${ to.left - from.left }px, ${ to.top - from.top }px)` },
			],
			{
				duration,
				easing: getComputedStyle( document.documentElement )
					.getPropertyValue( '--motion-ease-enter' )
					.trim(),
				fill: 'forwards',
			}
		);
		animation.onfinish = land;
		return () => animation.cancel();
	}, [ landingId, previewId ] );

	// Tear down the window drag listeners and auto-scroll if the list unmounts
	// mid-drag.
	useEffect(
		() => () => {
			removeDragListenersRef.current?.();
			if ( autoScrollRef.current ) {
				cancelAnimationFrame( autoScrollRef.current.rafId );
			}
		},
		[]
	);

	const updateActiveDrag = ( nextDrag: ActiveDrag | null ) => {
		activeDragRef.current = nextDrag;
		setActiveDrag( nextDrag );
	};

	const endDrag = ( landing: ActiveDrag | null ) => {
		stopAutoScroll();
		dragCandidateRef.current = null;
		dragStartOrderRef.current = [];
		updateActiveDrag( landing && { ...landing, landing: true } );
		removeDragListenersRef.current?.();
	};

	// Hit-test against the rows' positions captured at drag start: reading
	// `getBoundingClientRect` per row on every pointermove forces a layout
	// reflow each frame. Outside the rows there is no drop target (-1).
	const getDropIndex = ( clientY: number, draggedId: string ) => {
		const sourceOrder = dragStartOrderRef.current.length > 0 ? dragStartOrderRef.current : itemIds;
		const rowRects = dragStartRowRectsRef.current;
		const pointerY = clientY + ( scrollParentRef.current?.scrollTop ?? 0 );
		const rects = [ ...rowRects.values() ];
		if (
			pointerY < Math.min( ...rects.map( ( rect ) => rect.top ) ) ||
			pointerY > Math.max( ...rects.map( ( rect ) => rect.top + rect.height ) )
		) {
			return -1;
		}

		let index = 0;
		for ( const id of sourceOrder ) {
			if ( id === draggedId ) {
				continue;
			}
			const rowRect = rowRects.get( id );
			if ( ! rowRect ) {
				continue;
			}
			if ( pointerY < rowRect.top + rowRect.height / 2 ) {
				return index;
			}
			index += 1;
		}
		return index;
	};

	const stopAutoScroll = () => {
		if ( autoScrollRef.current ) {
			cancelAnimationFrame( autoScrollRef.current.rafId );
			autoScrollRef.current = null;
		}
	};

	const runAutoScroll = () => {
		const state = autoScrollRef.current;
		const scrollParent = scrollParentRef.current;
		const active = activeDragRef.current;
		if ( ! state || ! scrollParent || ! active ) {
			stopAutoScroll();
			return;
		}
		const previousScrollTop = scrollParent.scrollTop;
		scrollParent.scrollTop = previousScrollTop + state.step;
		if ( scrollParent.scrollTop === previousScrollTop ) {
			// Hit the end of the scroll range.
			stopAutoScroll();
			return;
		}
		const nextDropIndex = getDropIndex( active.currentY, active.id );
		if ( nextDropIndex !== active.dropIndex ) {
			updateActiveDrag( { ...active, dropIndex: nextDropIndex } );
		}
		state.rafId = requestAnimationFrame( runAutoScroll );
	};

	// Scroll the list when the drag pointer nears the scroll parent's top or
	// bottom edge, speeding up toward the edge and continuing while the
	// pointer rests inside the zone.
	const updateAutoScroll = ( clientY: number ) => {
		const scrollParent = scrollParentRef.current;
		if ( ! scrollParent ) {
			return;
		}
		const parentRect = scrollParent.getBoundingClientRect();
		const intoBottomZone = clientY - ( parentRect.bottom - AUTO_SCROLL_EDGE_PX );
		const intoTopZone = parentRect.top + AUTO_SCROLL_EDGE_PX - clientY;
		let step = 0;
		if ( intoBottomZone > 0 ) {
			step = Math.min( 1, intoBottomZone / AUTO_SCROLL_EDGE_PX ) * AUTO_SCROLL_MAX_STEP_PX;
		} else if ( intoTopZone > 0 ) {
			step = -Math.min( 1, intoTopZone / AUTO_SCROLL_EDGE_PX ) * AUTO_SCROLL_MAX_STEP_PX;
		}
		if ( step === 0 ) {
			stopAutoScroll();
		} else if ( autoScrollRef.current ) {
			autoScrollRef.current.step = step;
		} else {
			autoScrollRef.current = { step, rafId: requestAnimationFrame( runAutoScroll ) };
		}
	};

	const getDragCandidate = ( event: PointerEvent ) => {
		const candidate = dragCandidateRef.current;
		if (
			! candidate ||
			( candidate.pointerId !== undefined &&
				event.pointerId !== undefined &&
				event.pointerId !== candidate.pointerId )
		) {
			return null;
		}
		return candidate;
	};

	const handleWindowPointerMove = ( event: PointerEvent ) => {
		const candidate = getDragCandidate( event );
		if ( ! candidate ) {
			return;
		}
		const active = activeDragRef.current;
		const deltaX = event.clientX - candidate.startX;
		const deltaY = event.clientY - candidate.startY;
		if ( ! active && Math.hypot( deltaX, deltaY ) < DRAG_START_THRESHOLD ) {
			return;
		}

		event.preventDefault();
		if ( ! active ) {
			const item = items.find( ( value ) => getItemId( value ) === candidate.id );
			if ( item !== undefined ) {
				onDragStart?.( item );
			}
		}
		updateActiveDrag( {
			id: candidate.id,
			currentY: event.clientY,
			dropIndex: getDropIndex( event.clientY, candidate.id ),
			pointerOffsetY: candidate.pointerOffsetY,
			previewLeft: candidate.previewLeft,
			previewWidth: candidate.previewWidth,
		} );
		updateAutoScroll( event.clientY );
	};

	const handleWindowPointerUp = ( event: PointerEvent ) => {
		if ( ! getDragCandidate( event ) ) {
			return;
		}
		const active = activeDragRef.current;
		if ( active && active.dropIndex !== -1 ) {
			const sourceOrder =
				dragStartOrderRef.current.length > 0 ? dragStartOrderRef.current : itemIds;
			const nextIds = insertIdAtIndex( sourceOrder, active.id, active.dropIndex );
			onReorder( nextIds );
			setDropped( {
				ids: insertIdAtIndex( itemIds, active.id, active.dropIndex ),
				over: parentIds,
			} );
			const item = items.find( ( value ) => getItemId( value ) === active.id );
			if ( item !== undefined && getItemLabel ) {
				setAnnouncement(
					sprintf(
						/* translators: 1: name of the moved item, 2: its new position, 3: number of items. */
						__( '%1$s moved to position %2$d of %3$d' ),
						getItemLabel( item ),
						nextIds.indexOf( active.id ) + 1,
						nextIds.length
					)
				);
			}
		}
		if ( active ) {
			suppressNextClickRef.current = true;
			// Only suppress the click generated by this pointerup. A browser
			// may omit it when the drop moves the row under the pointer.
			setTimeout( () => {
				suppressNextClickRef.current = false;
			}, 0 );
		}
		endDrag( active );
	};

	// An interrupted pointer (touch cancel, system gesture) never delivers
	// pointerup — abort the drag without reordering.
	const handleWindowPointerCancel = ( event: PointerEvent ) => {
		if ( getDragCandidate( event ) ) {
			endDrag( activeDragRef.current );
		}
	};
	const cancelDrag = () => endDrag( null );
	const handleWindowKeyDown = ( event: globalThis.KeyboardEvent ) => {
		if ( event.key !== 'Escape' ) return;
		event.preventDefault();
		event.stopPropagation();
		cancelDrag();
	};
	const cancelDisabledDrag = useEffectEvent( () => {
		if ( disabled ) cancelDrag();
	} );
	useEffect( () => cancelDisabledDrag(), [ disabled ] );

	const handlePointerDown = ( event: ReactPointerEvent< HTMLElement > ) => {
		const row = ( event.target as Element ).closest( '[data-reorder-id]' );
		if (
			! row ||
			row.parentElement !== event.currentTarget ||
			disabled ||
			activeDragRef.current ||
			dragCandidateRef.current ||
			event.button !== 0 ||
			event.isPrimary === false ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			( handleSelector && ! ( event.target as Element ).closest( handleSelector ) ) ||
			( excludeSelector && ( event.target as HTMLElement ).closest( excludeSelector ) )
		) {
			return;
		}
		// A list nested in a row drags its own rows, not the row around it.
		event.stopPropagation();
		const id = row.getAttribute( 'data-reorder-id' )!;
		const rowRect = row.getBoundingClientRect();
		scrollParentRef.current = findScrollParent( containerRef.current );
		dragStartOrderRef.current = itemIds;
		dragStartRowRectsRef.current = measureRowRects(
			containerRef.current,
			scrollParentRef.current?.scrollTop ?? 0
		);
		dragCandidateRef.current = {
			id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			pointerOffsetY: event.clientY - rowRect.top,
			previewLeft: rowRect.left,
			previewWidth: rowRect.width,
		};
		window.addEventListener( 'pointermove', handleWindowPointerMove, { passive: false } );
		window.addEventListener( 'pointerup', handleWindowPointerUp );
		window.addEventListener( 'pointercancel', handleWindowPointerCancel );
		window.addEventListener( 'keydown', handleWindowKeyDown, true );
		window.addEventListener( 'blur', cancelDrag );
		window.addEventListener( 'resize', cancelDrag );
		removeDragListenersRef.current = () => {
			window.removeEventListener( 'pointermove', handleWindowPointerMove );
			window.removeEventListener( 'pointerup', handleWindowPointerUp );
			window.removeEventListener( 'pointercancel', handleWindowPointerCancel );
			window.removeEventListener( 'keydown', handleWindowKeyDown, true );
			window.removeEventListener( 'blur', cancelDrag );
			window.removeEventListener( 'resize', cancelDrag );
			removeDragListenersRef.current = null;
		};
	};
	const handleKeyDown = ( event: KeyboardEvent< HTMLUListElement > ) => {
		if (
			disabled ||
			activeDragRef.current ||
			! handleSelector ||
			! ( event.target as Element ).closest( handleSelector ) ||
			! [ 'ArrowUp', 'ArrowDown' ].includes( event.key )
		)
			return;
		const row = ( event.target as Element ).closest( '[data-reorder-id]' );
		if ( row?.parentElement !== event.currentTarget ) return;
		event.preventDefault();
		event.stopPropagation();
		const id = row.getAttribute( 'data-reorder-id' )!;
		const index = itemIds.indexOf( id );
		const target = Math.max(
			0,
			Math.min( itemIds.length - 1, index + ( event.key === 'ArrowUp' ? -1 : 1 ) )
		);
		if ( target === index ) return;
		const nextIds = insertIdAtIndex( itemIds, id, target );
		onReorder( nextIds );
		setDropped( { ids: nextIds, over: parentIds } );
		const item = items.find( ( value ) => getItemId( value ) === id );
		if ( item !== undefined && getItemLabel ) {
			setAnnouncement(
				sprintf(
					__( '%1$s moved to position %2$d of %3$d' ),
					getItemLabel( item ),
					target + 1,
					nextIds.length
				)
			);
		}
		queueMicrotask( () => row.scrollIntoView( { block: 'nearest' } ) );
	};

	const handleClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		if ( ! suppressNextClickRef.current ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		suppressNextClickRef.current = false;
	};

	const getDropPosition = ( index: number ) => {
		if (
			! activeDrag ||
			activeDrag.landing ||
			activeDrag.dropIndex !== index ||
			index === sourceIndex
		) {
			return undefined;
		}
		return index < sourceIndex ? 'before' : 'after';
	};

	const preview =
		activeDrag && draggedItem !== undefined
			? renderItem( draggedItem, {
					'data-reorder-preview': previewId,
					className: clsx( styles.dragPreview, previewClassName ),
					style: {
						inlineSize: activeDrag.previewWidth,
						insetBlockStart: activeDrag.currentY - activeDrag.pointerOffsetY,
						insetInlineStart: activeDrag.previewLeft,
					},
					'aria-hidden': true,
					inert: true,
			  } )
			: null;
	return (
		<>
			<SidebarMenu
				ref={ containerRef }
				className={ className }
				data-reordering={ reordering || undefined }
				onPointerDown={ handlePointerDown }
				onKeyDown={ handleKeyDown }
				onClickCapture={ handleClickCapture }
			>
				{ orderedItems.map( ( item, index ) => {
					const id = getItemId( item );
					return (
						<Fragment key={ id }>
							{ renderItem( item, {
								className: clsx( styles.itemWrapper, itemClassName ),
								'data-reorder-id': id,
								'data-drag-source': ( activeDrag?.id === id && ! landingId ) || undefined,
								'data-dropping': landingId === id || undefined,
								'data-drop-position': getDropPosition( index ),
							} ) }
						</Fragment>
					);
				} ) }
				{ ! portalPreview ? preview : null }
				{ children }
			</SidebarMenu>
			{ portalPreview && preview ? createPortal( preview, document.body ) : null }
			{ getItemLabel ? <VisuallyHidden role="status">{ announcement }</VisuallyHidden> : null }
		</>
	);
}
