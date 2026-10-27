import { clsx } from 'clsx';
import { useLayoutEffect, useRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

const ROW_SELECTOR = '[data-slot="tabs-trigger"]';
const SPEED = 30; // px per second
const HOLD = 1000;
const RETURN = 180;
const DELAY = 600;

/**
 * A one-line label that truncates, and scrolls once to show the rest when its
 * row (a tab) is hovered, focused or highlighted.
 */
export function MarqueeLabel( { children, className, ...props }: ComponentProps< 'span' > ) {
	const viewportRef = useRef< HTMLSpanElement >( null );
	const textRef = useRef< HTMLSpanElement >( null );

	useLayoutEffect( () => {
		const viewport = viewportRef.current;
		const text = textRef.current;
		const row = viewport?.closest< HTMLElement >( ROW_SELECTOR );
		if ( ! viewport || ! text || ! row || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const reducedMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' );
		const hoverPointer = window.matchMedia( '(hover: hover) and (pointer: fine)' );
		let hovered = false;
		let played = false;
		let distance = 0;
		let timer: ReturnType< typeof setTimeout > | undefined;
		let animation: Animation | undefined;

		const cancel = () => {
			clearTimeout( timer );
			timer = undefined;
			if ( animation ) {
				animation.onfinish = null;
				animation.cancel();
			}
			animation = undefined;
			delete viewport.dataset.playing;
		};
		const update = () => {
			const active =
				! row.matches( ':disabled, [aria-disabled="true"], [data-disabled]' ) &&
				( ( hovered && hoverPointer.matches ) ||
					row.matches( ':focus-visible' ) ||
					row.hasAttribute( 'data-highlighted' ) );
			const nextDistance = Math.max( 0, text.scrollWidth - viewport.clientWidth );
			if ( ! active || reducedMotion.matches || nextDistance !== distance ) {
				cancel();
			}
			if ( ! active ) {
				played = false;
			}
			distance = nextDistance;
			if (
				! active ||
				played ||
				timer !== undefined ||
				reducedMotion.matches ||
				viewport.clientWidth === 0 ||
				distance <= 1 ||
				! text.animate
			) {
				return;
			}
			timer = setTimeout( () => {
				timer = undefined;
				played = true;
				viewport.dataset.playing = '';
				const travel = ( distance / SPEED ) * 1000;
				const duration = travel + HOLD + RETURN;
				animation = text.animate(
					[
						{ transform: 'translateX(0)', offset: 0 },
						{ transform: `translateX(-${ distance }px)`, offset: travel / duration },
						{
							transform: `translateX(-${ distance }px)`,
							offset: ( travel + HOLD ) / duration,
							easing: 'cubic-bezier(.165,.84,.44,1)',
						},
						{ transform: 'translateX(0)', offset: 1 },
					],
					{ duration, easing: 'linear' }
				);
				animation.onfinish = cancel;
			}, DELAY );
		};
		const enter = () => {
			hovered = true;
			update();
		};
		const leave = () => {
			hovered = false;
			update();
		};
		const blur = () => queueMicrotask( update );
		const resize = new ResizeObserver( update );
		resize.observe( viewport );
		resize.observe( text );
		const state = new MutationObserver( update );
		state.observe( row, {
			attributes: true,
			attributeFilter: [ 'data-highlighted', 'disabled', 'aria-disabled', 'data-disabled' ],
		} );
		row.addEventListener( 'mouseenter', enter );
		row.addEventListener( 'mouseleave', leave );
		row.addEventListener( 'focusin', update );
		row.addEventListener( 'focusout', blur );
		reducedMotion.addEventListener( 'change', update );
		update();
		return () => {
			cancel();
			resize.disconnect();
			state.disconnect();
			row.removeEventListener( 'mouseenter', enter );
			row.removeEventListener( 'mouseleave', leave );
			row.removeEventListener( 'focusin', update );
			row.removeEventListener( 'focusout', blur );
			reducedMotion.removeEventListener( 'change', update );
		};
	}, [ children ] );

	return (
		<span
			ref={ viewportRef }
			data-slot="marquee-label"
			title={ typeof children === 'string' ? children : undefined }
			className={ clsx( styles.viewport, className ) }
			{ ...props }
		>
			<span ref={ textRef } className={ styles.text }>
				{ children }
			</span>
		</span>
	);
}
