import { isRTL } from '@wordpress/i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePointerDrag } from '@studio/ds/hooks';
import { getMotionDuration } from '@studio/ds/theme';
import type { PreviewTabSplit } from '@/data/preview-tab-state';
import type { CSSProperties, KeyboardEvent } from 'react';

const MIN_PANE_WIDTH = 320;

export function useTabSplit( {
	split,
	selectedId,
	onResize,
	collapsed,
}: {
	split?: PreviewTabSplit;
	selectedId: string;
	onResize: ( weights: number[] ) => void;
	collapsed?: boolean;
} ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const panesRef = useRef< HTMLDivElement >( null );
	const previousLayout = useRef< {
		ids: string[];
		sizes: number[];
		width: number | null;
		collapsed?: boolean;
	} >( undefined );
	const animations = useRef< Animation[] >( [] );
	const animationColumns = useRef< string[] >( [] );
	const [ width, setWidth ] = useState< number | null >( null );
	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) return;
		const measure = () => {
			const next = root.getBoundingClientRect().width;
			if ( next > 0 ) setWidth( Math.round( next ) );
		};
		measure();
		const observer = new ResizeObserver( measure );
		observer.observe( root );
		return () => observer.disconnect();
	}, [] );
	const weights = split?.weights ?? [];
	const splitVisible = !! split;
	const minWidth =
		width !== null && weights.length
			? Math.min( MIN_PANE_WIDTH, Math.floor( width / weights.length ) )
			: 0;
	const sizes = fitPaneWidths( weights, width ?? 100, minWidth );
	const activeBoundary = useRef< number >( 0 );
	const [ resizingBoundary, setResizingBoundary ] = useState( 0 );
	const resize = ( index: number, size: number ) => {
		const maximum = sizes[ index ] + sizes[ index + 1 ] - minWidth;
		const next = Math.max( minWidth, Math.min( maximum, size ) );
		if ( maximum === minWidth ) return next;
		onResize(
			sizes.map( ( value, pane ) => {
				if ( pane === index ) return next;
				if ( pane === index + 1 ) return value + sizes[ index ] - next;
				return value;
			} )
		);
		return next;
	};
	const { isDragging, onMouseDown, cancel } = usePointerDrag( {
		onStart: () =>
			splitVisible && width !== null && ! collapsed ? sizes[ activeBoundary.current ] : null,
		onMove: ( start, delta ) =>
			resize( activeBoundary.current, start + ( isRTL() ? -delta : delta ) ),
		onCommit: () => {},
	} );
	useEffect( () => () => animations.current.forEach( ( animation ) => animation.cancel() ), [] );
	useLayoutEffect( () => {
		const before = previousLayout.current;
		const ids = split?.tabIds ?? [ selectedId ];
		const nextSizes = split ? sizes : [ width ?? 0 ];
		if (
			before?.width === width &&
			before.collapsed === collapsed &&
			before.ids.length === ids.length &&
			before.ids.every(
				( id, index ) => id === ids[ index ] && before.sizes[ index ] === nextSizes[ index ]
			) &&
			! isDragging
		)
			return;
		previousLayout.current = { ids, sizes: nextSizes, width, collapsed };
		const panes = panesRef.current;
		const adding =
			before && ids.length > before.ids.length && before.ids.every( ( id ) => ids.includes( id ) );
		const removing =
			before && ids.length < before.ids.length && ids.every( ( id ) => before.ids.includes( id ) );
		const canAnimate =
			!! panes &&
			!! before &&
			!! width &&
			before.width === width &&
			! collapsed &&
			! before.collapsed &&
			! isDragging &&
			( adding || removing ) &&
			typeof panes.animate === 'function';
		const running = animations.current.some( ( animation ) => animation.playState === 'running' );
		const currentColumnIds = running ? animationColumns.current : before?.ids;
		const currentColumns =
			canAnimate && running
				? getComputedStyle( panes ).gridTemplateColumns.split( ' ' ).map( Number.parseFloat )
				: before?.sizes;
		animations.current.forEach( ( animation ) => animation.cancel() );
		animations.current = [];
		if ( ! canAnimate ) return;
		const duration = getMotionDuration( 'layout' );
		if ( ! duration || window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return;
		const columnIds = [ ...( currentColumnIds ?? [] ) ];
		for ( const [ index, id ] of ids.entries() ) {
			if ( columnIds.includes( id ) ) continue;
			const nextId = ids.slice( index + 1 ).find( ( id ) => columnIds.includes( id ) );
			columnIds.splice( nextId ? columnIds.indexOf( nextId ) : columnIds.length, 0, id );
		}
		animationColumns.current = columnIds;
		const startSizes = columnIds.map(
			( id ) => currentColumns?.[ currentColumnIds?.indexOf( id ) ?? -1 ] ?? 0
		);
		const endSizes = columnIds.map( ( id ) => nextSizes[ ids.indexOf( id ) ] ?? 0 );
		const timing = {
			duration,
			easing: getComputedStyle( document.documentElement )
				.getPropertyValue( '--motion-ease-layout' )
				.trim(),
		};
		animations.current.push(
			panes.animate(
				[
					{ gridTemplateColumns: startSizes.map( ( size ) => `${ size }px` ).join( ' ' ) },
					{ gridTemplateColumns: endSizes.map( ( size ) => `${ size }px` ).join( ' ' ) },
				],
				timing
			)
		);
		for ( const pane of panes.querySelectorAll< HTMLElement >(
			':scope > [data-preview-pane-id]'
		) ) {
			const index = ids.indexOf( pane.dataset.previewPaneId! );
			if ( index < 0 ) continue;
			const column = columnIds.indexOf( ids[ index ] ) + 1;
			if ( column !== index + 1 ) {
				animations.current.push(
					pane.animate( { gridColumn: [ `${ column }`, `${ column }` ] }, timing )
				);
			}
			if ( before.ids.includes( ids[ index ] ) ) continue;
			animations.current.push(
				pane.animate(
					[
						{ opacity: 0, overflow: 'clip' },
						{ opacity: 1, overflow: 'clip' },
					],
					timing
				)
			);
			// Keep the incoming page at its destination width while its column opens.
			const content = pane.firstElementChild;
			if ( content instanceof HTMLElement ) {
				animations.current.push(
					content.animate(
						{ width: [ `${ nextSizes[ index ] }px`, `${ nextSizes[ index ] }px` ] },
						timing
					)
				);
			}
		}
		for ( const divider of panes.querySelectorAll< HTMLElement >( '[data-split-divider]' ) ) {
			const boundary = columnIds.indexOf( ids[ Number( divider.dataset.splitDivider ) + 1 ] );
			const offset = startSizes.slice( 0, boundary ).reduce( ( sum, size ) => sum + size, 0 );
			const destination = endSizes.slice( 0, boundary ).reduce( ( sum, size ) => sum + size, 0 );
			animations.current.push(
				divider.animate(
					[
						{ insetInlineStart: `calc(${ offset }px - var(--space-1))` },
						{ insetInlineStart: `calc(${ destination }px - var(--space-1))` },
					],
					timing
				)
			);
		}
		const header = rootRef.current?.querySelector< HTMLElement >( '[data-preview-shared-header]' );
		if ( removing && ids.length === 1 && header?.childElementCount ) {
			const column = columnIds.indexOf( ids[ 0 ] );
			const offset = startSizes.slice( 0, column ).reduce( ( sum, size ) => sum + size, 0 );
			animations.current.push(
				header.animate(
					[
						{
							width: `${ startSizes[ column ] }px`,
							transform: `translateX(${ isRTL() ? -offset : offset }px)`,
						},
						{ width: `${ width }px`, transform: 'translateX(0px)' },
					],
					timing
				)
			);
		}
	} );
	const splitKey = split?.tabIds.join( ':' );
	useLayoutEffect( () => {
		cancel();
	}, [ cancel, splitKey, collapsed, width ] );
	const onKeyDown = ( index: number, event: KeyboardEvent< HTMLElement > ) => {
		if ( width === null || ! [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ].includes( event.key ) )
			return;
		event.preventDefault();
		const delta = ( event.key === 'ArrowRight' ? 1 : -1 ) * ( event.shiftKey ? 40 : 16 );
		const next =
			event.key === 'Home'
				? minWidth
				: event.key === 'End'
				? sizes[ index ] + sizes[ index + 1 ] - minWidth
				: sizes[ index ] + ( isRTL() ? -delta : delta );
		resize( index, next );
	};
	return {
		rootRef,
		panesRef,
		splitVisible,
		isResizing: isDragging,
		sizes: width === null ? undefined : sizes,
		style: {
			'--tab-split-columns': sizes
				.map( ( size ) => `${ size }${ width === null ? '%' : 'px' }` )
				.join( ' ' ),
		} as CSSProperties,
		handleProps:
			width === null
				? []
				: sizes.slice( 0, -1 ).map( ( size, index ) => ( {
						index,
						resizing: isDragging && resizingBoundary === index,
						offset: sizes.slice( 0, index + 1 ).reduce( ( sum, pane ) => sum + pane, 0 ),
						minWidth,
						maxWidth: size + sizes[ index + 1 ] - minWidth,
						width: size,
						onResizeStart: ( event: Parameters< typeof onMouseDown >[ 0 ] ) => {
							activeBoundary.current = index;
							setResizingBoundary( index );
							onMouseDown( event );
						},
						onKeyDown: ( event: KeyboardEvent< HTMLElement > ) => onKeyDown( index, event ),
						onDoublePress: () => resize( index, Math.round( ( size + sizes[ index + 1 ] ) / 2 ) ),
				  } ) ),
	};
}

function fitPaneWidths( weights: number[], available: number, minWidth: number ) {
	const total = weights.reduce( ( sum, weight ) => sum + weight, 0 );
	const preferred = weights.map(
		( weight ) => available * ( total ? weight / total : 1 / weights.length )
	);
	const extras = preferred.map( ( width ) => Math.max( 0, width - minWidth ) );
	const totalExtra = extras.reduce( ( sum, width ) => sum + width, 0 );
	const remaining = available - weights.length * minWidth;
	let cumulative = 0;
	return extras.map( ( extra ) => {
		const before = Math.round( cumulative );
		cumulative += minWidth + ( totalExtra ? ( remaining * extra ) / totalExtra : 0 );
		return Math.round( cumulative ) - before;
	} );
}
