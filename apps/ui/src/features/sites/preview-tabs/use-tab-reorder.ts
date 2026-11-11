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
import { getMotionDuration } from '@/lib/theme';

type Slot = { id: string; left: number; top: number; width: number; height: number };
type Drag = {
	id: string;
	x: number;
	y: number;
	slots: Slot[];
	target: number;
	step: number;
	landing: boolean;
	committed?: boolean;
};

export function useTabReorder( {
	ids,
	onReorder,
	getLabel,
}: {
	ids: string[];
	onReorder: ( ids: string[] ) => void;
	getLabel: ( id: string ) => string;
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
			: getMotionDuration( 'layout' );
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
		const list = event.currentTarget;
		const slots = Array.from(
			list.querySelectorAll< HTMLElement >( '[data-tab-reorder-id]' ),
			( element ) => {
				const { left, top, width, height } = element.getBoundingClientRect();
				return { id: element.dataset.tabReorderId!, left, top, width, height };
			}
		);
		const source = slots.find( ( slot ) => slot.id === row.dataset.tabReorderId )!;
		const sourceIndex = slots.indexOf( source );
		const startX = event.clientX,
			startY = event.clientY;
		const offsetX = startX - source.left,
			offsetY = startY - source.top;
		const pointerId = event.pointerId;
		const direction = getComputedStyle( list ).direction === 'rtl' ? -1 : 1;
		const gap = Number.parseFloat( getComputedStyle( list ).columnGap ) || 2;
		const matches = ( input: PointerEvent ) => input.pointerId === pointerId;
		const finish = ( commit: boolean ) => {
			cleanup.current?.();
			const active = dragRef.current;
			if ( ! active ) return;
			const index = commit && active.target >= 0 ? active.target : sourceIndex;
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
				reduced ? 0 : getMotionDuration( 'layout' )
			);
			setTimeout( () => {
				suppressClick.current = false;
			}, 0 );
		};
		const onMove = ( input: PointerEvent ) => {
			if ( ! matches( input ) ) return;
			if ( ! dragRef.current && Math.hypot( input.clientX - startX, input.clientY - startY ) < 4 )
				return;
			if ( ! dragRef.current ) list.setPointerCapture?.( pointerId );
			input.preventDefault();
			suppressClick.current = true;
			const x = input.clientX - offsetX;
			const y = input.clientY - offsetY;
			const center = x + source.width / 2;
			const index = slots.filter(
				( slot ) => slot.id !== source.id && ( center - slot.left - slot.width / 2 ) * direction > 0
			).length;
			setCurrent( {
				id: source.id,
				x,
				y,
				slots,
				target: index,
				step: ( source.width + gap ) * direction,
				landing: false,
			} );
		};
		const onUp = ( input: PointerEvent ) => {
			if ( matches( input ) ) finish( true );
		};
		const onCancel = () => finish( false );
		const onPointerCancel = ( input: PointerEvent ) => {
			if ( matches( input ) ) finish( false );
		};
		const onKeyDown = ( input: KeyboardEvent ) => {
			if ( input.key !== 'Escape' ) return;
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
