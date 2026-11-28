import { getMotionDuration } from '@studio/ds/theme';
import { __, sprintf } from '@wordpress/i18n';
import {
	useEffect,
	useLayoutEffect,
	useCallback,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type MouseEvent as ReactMouseEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

type Slot = { id: string; left: number; top: number; width: number; height: number };
type SplitSide = 'left' | 'right';
type SplitTargets = {
	area: DOMRect;
	targets: { side: SplitSide; bounds: DOMRect }[];
};
type Drag = {
	id: string;
	x: number;
	y: number;
	slots: Slot[];
	target: number;
	step: number;
	landing: boolean;
	committed?: boolean;
	destination: 'reorder' | SplitSide | null;
	splitTargets?: SplitTargets;
};

export function useTabReorder( {
	ids,
	onReorder,
	getLabel,
	getSplitTargets,
	onSplit,
}: {
	ids: string[];
	onReorder: ( ids: string[] ) => void;
	getLabel: ( id: string ) => string;
	getSplitTargets?: () => SplitTargets | undefined;
	onSplit?: ( id: string, side: SplitSide ) => void;
} ) {
	const [ drag, setDrag ] = useState< Drag | null >( null );
	const [ announcement, setAnnouncement ] = useState( '' );
	const dragRef = useRef< Drag | null >( null );
	const cleanup = useRef< () => void >( undefined );
	const landingTimer = useRef< ReturnType< typeof setTimeout > >( undefined );
	const suppressClick = useRef( false );
	const orderKey = ids.join( ':' );
	const landingOrder = useRef( '' );
	const dropRects = useRef< { list: HTMLElement; rects: Map< string, DOMRect > } >( undefined );
	const animations = useRef< Animation[] >( [] );
	const setCurrent = useCallback( ( next: Drag | null ) => {
		dragRef.current = next;
		setDrag( next );
	}, [] );
	useEffect(
		() => () => {
			cleanup.current?.();
			clearTimeout( landingTimer.current );
			animations.current.forEach( ( animation ) => animation.cancel() );
		},
		[]
	);
	useLayoutEffect( () => {
		const active = dragRef.current;
		if ( active && ( ! active.landing || landingOrder.current !== orderKey ) ) {
			cleanup.current?.();
			clearTimeout( landingTimer.current );
			setCurrent( null );
		}
	}, [ orderKey, setCurrent ] );
	useLayoutEffect( () => {
		const before = dropRects.current;
		if ( ! drag?.committed || ! before ) return;
		dropRects.current = undefined;
		const duration = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
			? 0
			: getMotionDuration( 'quick' );
		if ( ! duration ) return;
		animations.current = Array.from(
			before.list.querySelectorAll< HTMLElement >( '[data-tab-reorder-id]' )
		).flatMap( ( element ) => {
			if ( element.dataset.tabReorderId === drag.id || typeof element.animate !== 'function' )
				return [];
			const previous = before.rects.get( element.dataset.tabReorderId! );
			const offset = previous ? previous.left - element.getBoundingClientRect().left : 0;
			return offset
				? [
						element.animate(
							[ { transform: `translateX(${ offset }px)` }, { transform: 'translateX(0px)' } ],
							{ duration, easing: 'ease-in-out' }
						),
				  ]
				: [];
		} );
		return () => animations.current.forEach( ( animation ) => animation.cancel() );
	}, [ orderKey, drag?.committed, drag?.id ] );

	const move = ( id: string, target: number, fromIds = ids ) => {
		const next = fromIds.filter( ( value ) => value !== id );
		next.splice( target, 0, id );
		onReorder( next );
		setAnnouncement(
			sprintf(
				/* translators: 1: tab title, 2: new position, 3: number of tabs. */
				__( '%1$s moved to position %2$d of %3$d' ),
				getLabel( id ),
				target + 1,
				ids.length
			)
		);
	};
	const onPointerDown = ( event: ReactPointerEvent< HTMLElement > ) => {
		const target = event.target as HTMLElement;
		const row = target.closest< HTMLElement >( '[data-tab-reorder-id]' );
		if (
			! row ||
			target.closest( '[data-tab-close]' ) ||
			event.pointerType === 'touch' ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.shiftKey
		)
			return;
		// A new gesture may interrupt the previous chip's landing.
		clearTimeout( landingTimer.current );
		animations.current.forEach( ( animation ) => animation.cancel() );
		cleanup.current?.();
		setCurrent( null );
		suppressClick.current = false;
		const list = event.currentTarget;
		const startX = event.clientX;
		const startY = event.clientY;
		const paired = row.hasAttribute( 'data-preview-tab-pair' );
		let splitTargets: ReturnType< NonNullable< typeof getSplitTargets > >;
		const pointerId = event.pointerId;
		const measureDrag = () => {
			const slots = Array.from(
				list.querySelectorAll< HTMLElement >( '[data-tab-reorder-id]' ),
				( element ) => {
					const { left, top, width, height } = element.getBoundingClientRect();
					return { id: element.dataset.tabReorderId!, left, top, width, height };
				}
			);
			const source = slots.find( ( slot ) => slot.id === row.dataset.tabReorderId );
			if ( ! source ) return;
			const style = getComputedStyle( list );
			return {
				listBox: list.getBoundingClientRect(),
				slots,
				source,
				direction: style.direction === 'rtl' ? -1 : 1,
				gap: Number.parseFloat( style.columnGap ) || 2,
			};
		};
		let geometry: ReturnType< typeof measureDrag >;
		const matches = ( input: PointerEvent ) => input.pointerId === pointerId;
		const finish = ( commit: boolean ) => {
			cleanup.current?.();
			setTimeout( () => {
				suppressClick.current = false;
			}, 0 );
			const active = dragRef.current;
			if ( ! active || ! geometry ) return;
			const { slots, source } = geometry;
			const sourceIndex = slots.indexOf( source );
			if ( commit && ( active.destination === 'left' || active.destination === 'right' ) ) {
				setCurrent( null );
				onSplit?.( source.id, active.destination );
				return;
			}
			const index =
				commit && active.destination === 'reorder' && active.target >= 0
					? active.target
					: sourceIndex;
			const slot = slots[ index ];
			const committed = commit && index !== sourceIndex;
			if ( committed ) {
				dropRects.current = {
					list,
					rects: new Map(
						Array.from(
							list.querySelectorAll< HTMLElement >( '[data-tab-reorder-id]' ),
							( element ) => [ element.dataset.tabReorderId!, element.getBoundingClientRect() ]
						)
					),
				};
			}
			const nextIds = slots.map( ( slot ) => slot.id ).filter( ( id ) => id !== source.id );
			nextIds.splice( index, 0, source.id );
			landingOrder.current = nextIds.join( ':' );
			setCurrent( {
				...active,
				x: slot.left,
				y: slot.top,
				target: index,
				landing: true,
				committed,
			} );
			if ( committed )
				move(
					source.id,
					index,
					slots.map( ( slot ) => slot.id )
				);
			const reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
			landingTimer.current = setTimeout(
				() => setCurrent( null ),
				reduced ? 0 : getMotionDuration( 'quick' )
			);
		};
		const onMove = ( input: PointerEvent ) => {
			if ( ! matches( input ) ) return;
			if ( ! geometry ) {
				if ( Math.hypot( input.clientX - startX, input.clientY - startY ) < 4 ) return;
				geometry = measureDrag();
				if ( ! geometry ) return;
				splitTargets = paired ? undefined : getSplitTargets?.();
			}
			const { slots, source, direction, gap, listBox } = geometry;
			const inStrip =
				input.clientY >= listBox.top &&
				input.clientY <= listBox.bottom &&
				input.clientX >= listBox.left &&
				input.clientX <= listBox.right;
			if ( ! dragRef.current ) {
				suppressClick.current = true;
				if ( paired && ( ! inStrip || Math.abs( input.clientX - startX ) < 4 ) ) return;
				list.setPointerCapture?.( pointerId );
			}
			input.preventDefault();
			suppressClick.current = true;
			const x = source.left + input.clientX - startX;
			const center = x + source.width / 2;
			const splitSide = splitTargets?.targets.find(
				( { bounds } ) =>
					input.clientY >= bounds.top &&
					input.clientY <= bounds.bottom &&
					input.clientX >= bounds.left &&
					input.clientX <= bounds.right
			)?.side;
			const destination = inStrip ? 'reorder' : splitSide ?? null;
			const index = slots.filter(
				( slot ) => slot.id !== source.id && ( center - slot.left - slot.width / 2 ) * direction > 0
			).length;
			setCurrent( {
				id: source.id,
				x: paired ? Math.max( listBox.left, Math.min( x, listBox.right - source.width ) ) : x,
				y: paired ? source.top : source.top + input.clientY - startY,
				slots,
				target: destination === 'reorder' ? index : -1,
				step: ( source.width + gap ) * direction,
				landing: false,
				destination,
				splitTargets,
			} );
		};
		const onUp = ( input: PointerEvent ) => {
			if ( matches( input ) ) {
				if ( dragRef.current ) onMove( input );
				finish( true );
			}
		};
		const onCancel = () => finish( false );
		const onPointerCancel = ( input: PointerEvent ) => {
			if ( matches( input ) ) finish( false );
		};
		const onKeyDown = ( input: KeyboardEvent ) => {
			if ( input.key !== 'Escape' || ! dragRef.current ) return;
			input.preventDefault();
			input.stopPropagation();
			finish( false );
		};
		window.addEventListener( 'pointermove', onMove, { passive: false } );
		window.addEventListener( 'pointerup', onUp );
		window.addEventListener( 'pointercancel', onPointerCancel );
		window.addEventListener( 'keydown', onKeyDown, true );
		window.addEventListener( 'blur', onCancel );
		window.addEventListener( 'resize', onCancel );
		cleanup.current = () => {
			if ( list.hasPointerCapture?.( pointerId ) ) list.releasePointerCapture( pointerId );
			window.removeEventListener( 'pointermove', onMove );
			window.removeEventListener( 'pointerup', onUp );
			window.removeEventListener( 'pointercancel', onPointerCancel );
			window.removeEventListener( 'keydown', onKeyDown, true );
			window.removeEventListener( 'blur', onCancel );
			window.removeEventListener( 'resize', onCancel );
		};
	};
	const getOffset = ( id: string ) => {
		if ( ! drag || drag.target < 0 || drag.committed ) return 0;
		const from = drag.slots.findIndex( ( slot ) => slot.id === drag.id );
		const index = drag.slots.findIndex( ( slot ) => slot.id === id );
		if ( from < drag.target && index > from && index <= drag.target ) return -drag.step;
		if ( from > drag.target && index >= drag.target && index < from ) return drag.step;
		return 0;
	};
	return {
		drag,
		announcement,
		getOffset,
		onPointerDown,
		onClickCapture: ( event: ReactMouseEvent ) => {
			if ( ! suppressClick.current ) return;
			event.preventDefault();
			event.stopPropagation();
			suppressClick.current = false;
		},
		onKeyDown: ( event: ReactKeyboardEvent< HTMLElement >, id: string ) => {
			if (
				! event.altKey ||
				! event.shiftKey ||
				event.metaKey ||
				event.ctrlKey ||
				! [ 'ArrowLeft', 'ArrowRight' ].includes( event.key )
			)
				return;
			event.preventDefault();
			const direction = getComputedStyle( event.currentTarget ).direction === 'rtl' ? -1 : 1;
			const target = ids.indexOf( id ) + ( event.key === 'ArrowRight' ? 1 : -1 ) * direction;
			if ( target >= 0 && target < ids.length ) {
				const trigger = event.currentTarget;
				move( id, target );
				requestAnimationFrame( () => trigger.focus( { preventScroll: true } ) );
			}
		},
	};
}
