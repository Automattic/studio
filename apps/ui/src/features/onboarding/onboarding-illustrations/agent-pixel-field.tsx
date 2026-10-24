/**
 * Interactive pixel field for the onboarding tour's "agent" step: a wide
 * rectangle of pixels echoing the welcome screen's pixel W logo. Bands of
 * light wash diagonally through the grid in a continuous cascade. Unlike the
 * W logo toy, the pixels never move — the pointer is a roaming glow that
 * brightens the wave around it, and clicks send a color-only ripple ring
 * through the grid. Reduced motion renders the static grid.
 */

import { useEffect, useRef } from 'react';
import styles from './style.module.css';

// Logical canvas size, scaled down responsively by CSS.
const WIDTH = 880;
const HEIGHT = 150;
const INSET = 12;
const PITCH = 12;
const RECT_SIZE = 7;
const MAX_DPR = 2;

// Pointer glow: a soft light that brightens pixels near the cursor.
const GLOW_RADIUS = 130;
const GLOW_RADIUS_SQUARED = GLOW_RADIUS * GLOW_RADIUS;
const GLOW_STRENGTH = 0.85;
const POINTER_EASE = 0.12;

// Click ripple: an expanding ring of brightness, no displacement.
const RIPPLE_DURATION = 1400;
const RIPPLE_RADIUS = 380;
const RIPPLE_BAND = 46;
const MAX_RIPPLES = 4;

// Two traveling bands at different angles and speeds keep the wash
// continuous — one is always somewhere in the field.
const WASH_1 = { dirX: 0.349, dirY: 0.937, period: 210, speed: 0.085, weight: 1 };
const WASH_2 = { dirX: 0.898, dirY: 0.439, period: 300, speed: 0.05, weight: 0.55 };
const WASH_BAND = 0.45;

// Three-stop blue ramp: deep blue at rest, brand blue mid-wash, light blue
// at the crest — same hues as the W logo toy but anchored darker.
const DARK_BLUE: [ number, number, number ] = [ 30, 44, 140 ];
const BLUE: [ number, number, number ] = [ 56, 88, 233 ];
const LIGHT_BLUE: [ number, number, number ] = [ 220, 230, 255 ];
const COLOR_STEPS = 18;

function lerpChannel( from: number, to: number, t: number ) {
	return Math.round( from + ( to - from ) * t );
}

const COLOR_STYLES = Array.from( { length: COLOR_STEPS + 1 }, ( _, step ) => {
	const t = step / COLOR_STEPS;
	const [ from, to, localT ] =
		t < 0.5 ? [ DARK_BLUE, BLUE, t * 2 ] : [ BLUE, LIGHT_BLUE, ( t - 0.5 ) * 2 ];
	const r = lerpChannel( from[ 0 ], to[ 0 ], localT );
	const g = lerpChannel( from[ 1 ], to[ 1 ], localT );
	const b = lerpChannel( from[ 2 ], to[ 2 ], localT );
	const a = ( 0.6 + 0.4 * t ).toFixed( 3 );
	return `rgba(${ r }, ${ g }, ${ b }, ${ a })`;
} );
const BASE_COLOR = COLOR_STYLES[ 0 ];

function getColorStyle( intensity: number ) {
	const step = Math.min( COLOR_STEPS, Math.max( 0, Math.round( intensity * COLOR_STEPS ) ) );
	return COLOR_STYLES[ step ];
}

function washIntensity( x: number, y: number, elapsed: number, wash: typeof WASH_1 ): number {
	const proj = x * wash.dirX + y * wash.dirY - elapsed * wash.speed;
	const phase = ( ( proj % wash.period ) + wash.period ) % wash.period;
	const d = phase / wash.period;
	if ( d >= WASH_BAND ) {
		return 0;
	}
	// Smooth bell across the band so edges fade in and out.
	return Math.sin( ( d / WASH_BAND ) * Math.PI ) * wash.weight;
}

type Pixel = { x: number; y: number; shimmer: number };
type Ripple = { x: number; y: number; start: number };

export function AgentPixelField() {
	const canvasRef = useRef< HTMLCanvasElement >( null );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) {
			return;
		}

		const canvasElement = canvas;
		const dpr = Math.min( window.devicePixelRatio || 1, MAX_DPR );
		canvasElement.width = Math.round( WIDTH * dpr );
		canvasElement.height = Math.round( HEIGHT * dpr );

		const ctx = canvasElement.getContext( '2d', { alpha: true } );
		if ( ! ctx ) {
			return;
		}
		const context = ctx;
		context.scale( dpr, dpr );
		context.imageSmoothingEnabled = false;

		const pixels: Pixel[] = [];
		for ( let y = INSET; y <= HEIGHT - INSET - RECT_SIZE; y += PITCH ) {
			for ( let x = INSET; x <= WIDTH - INSET - RECT_SIZE; x += PITCH ) {
				pixels.push( { x, y, shimmer: 0.5 + Math.random() * 0.5 } );
			}
		}

		const ripples: Ripple[] = [];
		const reducedMotionQuery =
			typeof window.matchMedia === 'function'
				? window.matchMedia( '(prefers-reduced-motion: reduce)' )
				: null;
		const animationStart = performance.now();
		const bounds = { left: 0, top: 0, scale: 1 };

		let raf: number | null = null;
		let cancelled = false;
		let hover = false;
		let mouseX = -9999;
		let mouseY = -9999;
		let targetMouseX = -9999;
		let targetMouseY = -9999;
		let pageVisible = ! document.hidden;
		let isIntersecting = true;
		let reducedMotion = reducedMotionQuery?.matches ?? false;

		function canAnimate() {
			return ! cancelled && ! reducedMotion && pageVisible && isIntersecting;
		}

		function updateBounds() {
			const rect = canvasElement.getBoundingClientRect();
			bounds.left = rect.left;
			bounds.top = rect.top;
			bounds.scale = rect.width > 0 ? WIDTH / rect.width : 1;
		}

		function drawStatic() {
			context.clearRect( 0, 0, WIDTH, HEIGHT );
			context.fillStyle = BASE_COLOR;
			for ( let i = 0; i < pixels.length; i++ ) {
				context.fillRect( pixels[ i ].x, pixels[ i ].y, RECT_SIZE, RECT_SIZE );
			}
		}

		function cancelLoop() {
			if ( raf !== null ) {
				cancelAnimationFrame( raf );
				raf = null;
			}
		}

		function ensureLoop() {
			if ( canAnimate() && raf === null ) {
				raf = requestAnimationFrame( tick );
			}
		}

		function syncAnimationState() {
			if ( ! canAnimate() ) {
				cancelLoop();
				ripples.length = 0;
				drawStatic();
				return;
			}
			ensureLoop();
		}

		function tick( timestamp: number ) {
			raf = null;
			if ( ! canAnimate() ) {
				syncAnimationState();
				return;
			}

			const elapsed = timestamp - animationStart;

			if ( hover ) {
				mouseX += ( targetMouseX - mouseX ) * POINTER_EASE;
				mouseY += ( targetMouseY - mouseY ) * POINTER_EASE;
			}

			// Resolve active ripples once per frame.
			const activeRipples: Array< { x: number; y: number; radius: number; fade: number } > = [];
			for ( let i = ripples.length - 1; i >= 0; i-- ) {
				const t = ( timestamp - ripples[ i ].start ) / RIPPLE_DURATION;
				if ( t > 1 ) {
					ripples.splice( i, 1 );
					continue;
				}
				const eased = 1 - Math.pow( 1 - t, 3 );
				activeRipples.push( {
					x: ripples[ i ].x,
					y: ripples[ i ].y,
					radius: eased * RIPPLE_RADIUS,
					fade: 1 - t,
				} );
			}

			context.clearRect( 0, 0, WIDTH, HEIGHT );

			for ( let i = 0; i < pixels.length; i++ ) {
				const px = pixels[ i ];
				let intensity =
					Math.max(
						washIntensity( px.x, px.y, elapsed, WASH_1 ),
						washIntensity( px.x, px.y, elapsed, WASH_2 )
					) * px.shimmer;

				if ( hover ) {
					const dx = px.x - mouseX;
					const dy = px.y - mouseY;
					const distanceSquared = dx * dx + dy * dy;
					if ( distanceSquared < GLOW_RADIUS_SQUARED ) {
						const proximity = 1 - Math.sqrt( distanceSquared ) / GLOW_RADIUS;
						const glow = proximity * proximity * ( 3 - 2 * proximity ) * GLOW_STRENGTH;
						intensity = Math.max( intensity, glow * px.shimmer );
					}
				}

				for ( let r = 0; r < activeRipples.length; r++ ) {
					const ripple = activeRipples[ r ];
					const bandDistance = Math.abs(
						Math.hypot( px.x - ripple.x, px.y - ripple.y ) - ripple.radius
					);
					if ( bandDistance < RIPPLE_BAND ) {
						const rippleIntensity = ( 1 - bandDistance / RIPPLE_BAND ) * ripple.fade;
						intensity = Math.max( intensity, rippleIntensity );
					}
				}

				context.fillStyle = getColorStyle( Math.min( 1, intensity ) );
				context.fillRect( px.x, px.y, RECT_SIZE, RECT_SIZE );
			}

			// The wash never rests, so the loop runs whenever we're visible.
			ensureLoop();
		}

		const setPointerFromEvent = ( event: MouseEvent ) => {
			targetMouseX = ( event.clientX - bounds.left ) * bounds.scale;
			targetMouseY = ( event.clientY - bounds.top ) * bounds.scale;
			if ( mouseX < -1000 || mouseY < -1000 ) {
				mouseX = targetMouseX;
				mouseY = targetMouseY;
			}
		};
		const onMove = ( event: MouseEvent ) => {
			setPointerFromEvent( event );
		};
		const onEnter = ( event: MouseEvent ) => {
			hover = true;
			updateBounds();
			setPointerFromEvent( event );
		};
		const onLeave = () => {
			hover = false;
			mouseX = -9999;
			mouseY = -9999;
			targetMouseX = -9999;
			targetMouseY = -9999;
		};
		const onClick = ( event: MouseEvent ) => {
			if ( ! canAnimate() ) {
				return;
			}
			updateBounds();
			ripples.push( {
				x: ( event.clientX - bounds.left ) * bounds.scale,
				y: ( event.clientY - bounds.top ) * bounds.scale,
				start: performance.now(),
			} );
			if ( ripples.length > MAX_RIPPLES ) {
				ripples.splice( 0, ripples.length - MAX_RIPPLES );
			}
		};
		const onVisibilityChange = () => {
			pageVisible = ! document.hidden;
			syncAnimationState();
		};
		const onReducedMotionChange = ( event: MediaQueryListEvent ) => {
			reducedMotion = event.matches;
			syncAnimationState();
		};

		updateBounds();
		canvasElement.addEventListener( 'mousemove', onMove, { passive: true } );
		canvasElement.addEventListener( 'mouseenter', onEnter, { passive: true } );
		canvasElement.addEventListener( 'mouseleave', onLeave, { passive: true } );
		canvasElement.addEventListener( 'click', onClick );
		document.addEventListener( 'visibilitychange', onVisibilityChange );
		reducedMotionQuery?.addEventListener( 'change', onReducedMotionChange );

		const resizeObserver =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver( () => updateBounds() ) : null;
		resizeObserver?.observe( canvasElement );

		const intersectionObserver =
			typeof IntersectionObserver !== 'undefined'
				? new IntersectionObserver( ( entries ) => {
						isIntersecting = entries.some( ( entry ) => entry.isIntersecting );
						syncAnimationState();
				  } )
				: null;
		intersectionObserver?.observe( canvasElement );

		syncAnimationState();

		return () => {
			cancelled = true;
			cancelLoop();
			canvasElement.removeEventListener( 'mousemove', onMove );
			canvasElement.removeEventListener( 'mouseenter', onEnter );
			canvasElement.removeEventListener( 'mouseleave', onLeave );
			canvasElement.removeEventListener( 'click', onClick );
			document.removeEventListener( 'visibilitychange', onVisibilityChange );
			reducedMotionQuery?.removeEventListener( 'change', onReducedMotionChange );
			resizeObserver?.disconnect();
			intersectionObserver?.disconnect();
		};
	}, [] );

	return <canvas ref={ canvasRef } className={ styles.pixelField } aria-hidden="true" />;
}
