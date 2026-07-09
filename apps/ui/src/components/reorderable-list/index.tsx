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

function measureRowRects( rowElements: Map< string, HTMLDivElement > ) {
	const rects = new Map< string, DOMRectReadOnly >();
	for ( const [ id, element ] of rowElements ) {
		rects.set( id, element.getBoundingClientRect() );
	}
	return rects;
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
	/** Called on drop with the list's new id order. */
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
	const activeDragRef = useRef< ActiveDrag | null >( null );
	const dragCandidateRef = useRef< DragCandidate | null >( null );
	const dragStartOrderRef = useRef< string[] >( [] );
	const rowElementsRef = useRef< Map< string, HTMLDivElement > >( new Map() );
	const previousRowRectsRef = useRef< Map< string, DOMRectReadOnly > >( new Map() );
	const dragStartRowRectsRef = useRef< Map< string, DOMRectReadOnly > >( new Map() );
	const rowMoveAnimationsRef = useRef< Map< string, Animation > >( new Map() );
	const suppressNextClickRef = useRef( false );
	const removeDragListenersRef = useRef< ( () => void ) | null >( null );

	const itemIds = useMemo( () => items.map( getItemId ), [ items, getItemId ] );
	const activeDragId = activeDrag?.id;
	const activeDropIndex = activeDrag?.dropIndex;
	const isDragging = activeDrag !== null;
	const displayItems = useMemo(
		() => items.filter( ( item ) => getItemId( item ) !== activeDragId ),
		[ items, getItemId, activeDragId ]
	);
	const draggedItem = activeDragId
		? items.find( ( item ) => getItemId( item ) === activeDragId )
		: undefined;

	useLayoutEffect( () => {
		const nextRowRects = measureRowRects( rowElementsRef.current );
		const previousRowRects = previousRowRectsRef.current;
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

	// Tear down the window drag listeners if the list unmounts mid-drag.
	useEffect( () => () => removeDragListenersRef.current?.(), [] );

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

		let index = 0;
		for ( const id of sourceOrder ) {
			if ( id === draggedId ) {
				continue;
			}
			const rowRect = rowRects.get( id );
			if ( ! rowRect ) {
				continue;
			}
			if ( clientY < rowRect.top + rowRect.height / 2 ) {
				return index;
			}
			index += 1;
		}
		return index;
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
	};

	const handleWindowPointerUp = ( event: PointerEvent ) => {
		if ( ! getDragCandidate( event ) ) {
			return;
		}
		const active = activeDragRef.current;
		if ( active ) {
			const sourceOrder =
				dragStartOrderRef.current.length > 0 ? dragStartOrderRef.current : itemIds;
			onReorder( insertIdAtIndex( sourceOrder, active.id, active.dropIndex ) );
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
		resetDragState();
		removeDragListenersRef.current?.();
	};

	// An interrupted pointer (touch cancel, system gesture) never delivers
	// pointerup — abort the drag without reordering.
	const handleWindowPointerCancel = ( event: PointerEvent ) => {
		if ( ! getDragCandidate( event ) ) {
			return;
		}
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
		dragStartOrderRef.current = itemIds;
		const dragStartRowRects = measureRowRects( rowElementsRef.current );
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
			className={ clsx( styles.placeholder, placeholderClassName ) }
			data-testid="drop-placeholder"
			aria-hidden="true"
		/>
	);

	return (
		<div className={ clsx( className, isDragging && styles.dragging ) }>
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
