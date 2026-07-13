import { clsx } from 'clsx';
import {
	Fragment,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react';
import styles from './style.module.css';

type ActiveDrag = {
	id: string;
	currentY: number;
	dropIndex: number;
	pointerOffsetY: number;
	previewLeft: number;
	previewWidth: number;
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
const DRAG_REORDER_DURATION_MS = 160;
const DRAG_REORDER_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const DRAG_REORDER_DISTANCE_EPSILON = 0.5;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_STEP_PX = 12;

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
type RowRect = { top: number; left: number; width: number; height: number };

function measureRowRects( rowElements: Map< string, HTMLDivElement >, scrollOffset: number ) {
	const rects = new Map< string, RowRect >();
	for ( const [ id, element ] of rowElements ) {
		const { top, left, width, height } = element.getBoundingClientRect();
		rects.set( id, { top: top + scrollOffset, left, width, height } );
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

function getRowAnimationTarget( rowElement: HTMLDivElement ) {
	const target = rowElement.firstElementChild;
	return target instanceof HTMLElement ? target : rowElement;
}

function prefersReducedMotion() {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
}

export type ReorderableListProps< T > = {
	/** Full ordered list, dragged item included. */
	items: T[];
	getItemId: ( item: T ) => string;
	/** Renders a row; also used for the floating drag preview. */
	renderItem: ( item: T ) => ReactNode;
	onReorder: ( nextIds: string[] ) => void;
	className?: string;
	itemClassName?: string;
	placeholderClassName?: string;
	previewClassName?: string;
	/** Pointer-downs inside a match of this selector never start a drag. */
	excludeSelector?: string;
};

export function ReorderableList< T >( {
	items,
	getItemId,
	renderItem,
	onReorder,
	className,
	itemClassName,
	placeholderClassName,
	previewClassName,
	excludeSelector,
}: ReorderableListProps< T > ) {
	const [ activeDrag, setActiveDrag ] = useState< ActiveDrag | null >( null );
	const [ settleOrder, setSettleOrder ] = useState< string[] | null >( null );
	const activeDragRef = useRef< ActiveDrag | null >( null );
	const dragCandidateRef = useRef< DragCandidate | null >( null );
	const dragStartOrderRef = useRef< string[] >( [] );
	const rowElementsRef = useRef< Map< string, HTMLDivElement > >( new Map() );
	const previousRowRectsRef = useRef< Map< string, RowRect > >( new Map() );
	const dragStartRowRectsRef = useRef< Map< string, RowRect > >( new Map() );
	const rowMoveAnimationsRef = useRef< Map< string, Animation > >( new Map() );
	const suppressNextClickRef = useRef( false );
	const removeDragListenersRef = useRef< ( () => void ) | null >( null );
	const containerRef = useRef< HTMLDivElement | null >( null );
	const scrollParentRef = useRef< HTMLElement | null >( null );
	const placeholderElementRef = useRef< HTMLDivElement | null >( null );
	const wasDraggingRef = useRef( false );
	const autoScrollRef = useRef< { step: number; rafId: number } | null >( null );
	const lastDroppedIdRef = useRef< string | null >( null );

	// After a drop, keep rendering the dropped order until the parent hands us
	// new items — the reordered data usually lands a tick later (e.g. via a
	// query-cache notification), and rendering the raw prop order in between
	// flashes the pre-drag order for a frame.
	const orderedItems = useMemo( () => {
		if ( ! settleOrder ) {
			return items;
		}
		const rank = new Map( settleOrder.map( ( id, index ) => [ id, index ] ) );
		if ( items.some( ( item ) => ! rank.has( getItemId( item ) ) ) ) {
			return items;
		}
		return [ ...items ].sort(
			( a, b ) => ( rank.get( getItemId( a ) ) ?? 0 ) - ( rank.get( getItemId( b ) ) ?? 0 )
		);
	}, [ items, settleOrder, getItemId ] );

	// Once the parent hands us new items its order is authoritative again.
	const previousItemsRef = useRef( items );
	useEffect( () => {
		if ( previousItemsRef.current !== items ) {
			previousItemsRef.current = items;
			setSettleOrder( null );
		}
	}, [ items ] );

	const itemIds = useMemo( () => orderedItems.map( getItemId ), [ orderedItems, getItemId ] );
	const activeDragId = activeDrag?.id;
	const activeDropIndex = activeDrag?.dropIndex;
	const isDragging = activeDrag !== null;
	const displayItems = useMemo(
		() => orderedItems.filter( ( item ) => getItemId( item ) !== activeDragId ),
		[ orderedItems, getItemId, activeDragId ]
	);
	const draggedItem = activeDragId
		? items.find( ( item ) => getItemId( item ) === activeDragId )
		: undefined;

	useLayoutEffect( () => {
		const scrollOffset = scrollParentRef.current?.scrollTop ?? 0;
		const nextRowRects = measureRowRects( rowElementsRef.current, scrollOffset );
		const previousRowRects = previousRowRectsRef.current;

		const dragJustStarted = isDragging && ! wasDraggingRef.current;
		const dragJustEnded = ! isDragging && wasDraggingRef.current;
		wasDraggingRef.current = isDragging;

		// Move focus to the dropped row (unless it is already inside it) so
		// keyboard interaction continues from the item the user just moved.
		if ( dragJustEnded && lastDroppedIdRef.current ) {
			const rowElement = rowElementsRef.current.get( lastDroppedIdRef.current );
			lastDroppedIdRef.current = null;
			if ( rowElement && ! rowElement.contains( document.activeElement ) ) {
				rowElement
					.querySelector< HTMLElement >( 'button, a[href], [tabindex]' )
					?.focus( { preventScroll: true } );
			}
		}

		// Activating the drag can restyle rows (consumers may collapse them via
		// [data-dragging]), so the rects captured on pointerdown no longer match
		// the layout. Recapture them, minus the placeholder's offset on the rows
		// sitting below it.
		if ( dragJustStarted ) {
			const placeholderRect = placeholderElementRef.current?.getBoundingClientRect();
			const placeholderTop = placeholderRect ? placeholderRect.top + scrollOffset : Infinity;
			const settledRects = new Map< string, RowRect >();
			for ( const [ id, rect ] of nextRowRects ) {
				settledRects.set(
					id,
					rect.top > placeholderTop
						? { ...rect, top: rect.top - ( placeholderRect?.height ?? 0 ) }
						: rect
				);
			}
			dragStartRowRectsRef.current = settledRects;
		}

		const shouldAnimateRows = isDragging && ! prefersReducedMotion();

		if ( shouldAnimateRows ) {
			for ( const [ id, nextRect ] of nextRowRects ) {
				const previousRect = previousRowRects.get( id );
				const rowElement = rowElementsRef.current.get( id );
				if ( ! previousRect || ! rowElement ) {
					continue;
				}

				const deltaX = previousRect.left - nextRect.left;
				const deltaY = previousRect.top - nextRect.top;
				if (
					Math.abs( deltaX ) < DRAG_REORDER_DISTANCE_EPSILON &&
					Math.abs( deltaY ) < DRAG_REORDER_DISTANCE_EPSILON
				) {
					continue;
				}

				const animationTarget = getRowAnimationTarget( rowElement );
				if ( typeof animationTarget.animate !== 'function' ) {
					continue;
				}

				rowMoveAnimationsRef.current.get( id )?.cancel();
				const animation = animationTarget.animate(
					[
						{ transform: `translate(${ deltaX }px, ${ deltaY }px)` },
						{ transform: 'translate(0, 0)' },
					],
					{
						duration: DRAG_REORDER_DURATION_MS,
						easing: DRAG_REORDER_EASING,
					}
				);

				rowMoveAnimationsRef.current.set( id, animation );
				const clearAnimation = () => {
					if ( rowMoveAnimationsRef.current.get( id ) === animation ) {
						rowMoveAnimationsRef.current.delete( id );
					}
				};
				animation.onfinish = clearAnimation;
				animation.oncancel = clearAnimation;
			}
		}

		previousRowRectsRef.current = nextRowRects;
	}, [ activeDragId, activeDropIndex, displayItems, isDragging ] );

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

	const resetDragState = () => {
		dragCandidateRef.current = null;
		dragStartOrderRef.current = [];
		updateActiveDrag( null );
	};

	// Hit-test against the rows' settled positions captured at drag start, not
	// their live rects. The placeholder shifting rows around mid-drag would make
	// live measurement circular, and reading `getBoundingClientRect` per row on
	// every pointermove forces a layout reflow each frame.
	const getDropIndex = ( clientY: number, draggedId: string ) => {
		const sourceOrder = dragStartOrderRef.current.length > 0 ? dragStartOrderRef.current : itemIds;
		const rowRects = dragStartRowRectsRef.current;
		const pointerY = clientY + ( scrollParentRef.current?.scrollTop ?? 0 );

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
		if ( active ) {
			const sourceOrder =
				dragStartOrderRef.current.length > 0 ? dragStartOrderRef.current : itemIds;
			const nextIds = insertIdAtIndex( sourceOrder, active.id, active.dropIndex );
			setSettleOrder( nextIds );
			lastDroppedIdRef.current = active.id;
			onReorder( nextIds );
			suppressNextClickRef.current = true;
			// The rows' click-capture consumes the flag, but a drop outside any
			// row never reaches it — clear on the next click wherever it lands
			// so it can't swallow a later, legitimate one.
			window.addEventListener(
				'click',
				() => {
					suppressNextClickRef.current = false;
				},
				{ once: true }
			);
		}
		stopAutoScroll();
		resetDragState();
		removeDragListenersRef.current?.();
	};

	// An interrupted pointer (touch cancel, system gesture) never delivers
	// pointerup — abort the drag without reordering.
	const handleWindowPointerCancel = ( event: PointerEvent ) => {
		if ( ! getDragCandidate( event ) ) {
			return;
		}
		stopAutoScroll();
		resetDragState();
		removeDragListenersRef.current?.();
	};

	const handlePointerDown = ( event: ReactPointerEvent< HTMLElement >, id: string ) => {
		if (
			event.button !== 0 ||
			( excludeSelector && ( event.target as HTMLElement ).closest( excludeSelector ) )
		) {
			return;
		}
		const rowRect = event.currentTarget.getBoundingClientRect();
		scrollParentRef.current = findScrollParent( containerRef.current );
		dragStartOrderRef.current = itemIds;
		const dragStartRowRects = measureRowRects(
			rowElementsRef.current,
			scrollParentRef.current?.scrollTop ?? 0
		);
		previousRowRectsRef.current = dragStartRowRects;
		dragStartRowRectsRef.current = dragStartRowRects;
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
		removeDragListenersRef.current = () => {
			window.removeEventListener( 'pointermove', handleWindowPointerMove );
			window.removeEventListener( 'pointerup', handleWindowPointerUp );
			window.removeEventListener( 'pointercancel', handleWindowPointerCancel );
			removeDragListenersRef.current = null;
		};
	};

	const handleClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		if ( ! suppressNextClickRef.current ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		suppressNextClickRef.current = false;
	};

	const dropPlaceholder = (
		<div
			ref={ placeholderElementRef }
			className={ clsx( styles.placeholder, placeholderClassName ) }
			data-testid="drop-placeholder"
			aria-hidden="true"
		/>
	);

	return (
		<div
			ref={ containerRef }
			className={ clsx( className, isDragging && styles.dragging ) }
			data-dragging={ isDragging || undefined }
		>
			{ displayItems.map( ( item, index ) => {
				const id = getItemId( item );
				return (
					<Fragment key={ id }>
						{ activeDrag && activeDrag.dropIndex === index ? dropPlaceholder : null }
						<div
							ref={ ( node ) => {
								if ( node ) {
									rowElementsRef.current.set( id, node );
								} else {
									rowElementsRef.current.delete( id );
								}
							} }
							className={ clsx( styles.itemWrapper, itemClassName ) }
							data-reorder-id={ id }
							onPointerDown={ ( event ) => handlePointerDown( event, id ) }
							onClickCapture={ handleClickCapture }
						>
							{ renderItem( item ) }
						</div>
					</Fragment>
				);
			} ) }
			{ activeDrag && activeDrag.dropIndex === displayItems.length ? dropPlaceholder : null }
			{ activeDrag && draggedItem !== undefined ? (
				<div
					className={ clsx( styles.dragPreview, previewClassName ) }
					style={
						{
							inlineSize: activeDrag.previewWidth,
							insetBlockStart: activeDrag.currentY - activeDrag.pointerOffsetY,
							insetInlineStart: activeDrag.previewLeft,
						} as CSSProperties
					}
					aria-hidden="true"
				>
					{ renderItem( draggedItem ) }
				</div>
			) : null }
		</div>
	);
}
