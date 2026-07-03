import { useEffect, useRef } from 'react';
import styles from './style.module.css';

/**
 * Animated dot-grid backdrop, ported from the desktop renderer's
 * `DotGrid`. Renders a grid of crosses joined by dashed lines on a canvas;
 * dots spring away from the cursor, mouse-down focuses the repulsion radius,
 * and mouse-up emits a ripple. Honors `prefers-reduced-motion` by drawing a
 * static grid instead. The draw color comes from the canvas' computed CSS
 * `color`, so it tracks light/dark token changes for free.
 */

interface DotGridProps {
	opacity?: number;
	repulsion?: number;
	rippleStrength?: number;
	spacing?: number;
	crossSize?: number;
	crossThickness?: number;
	className?: string;
	/**
	 * Set false while the grid is hidden (e.g. faded out behind a sub-page)
	 * to pause the physics/render loop instead of burning CPU on invisible
	 * frames. The simulation state survives, so re-activating doesn't replay
	 * the intro sweep.
	 */
	active?: boolean;
	/**
	 * Set false to skip the corner reveal sweep and render the grid fully
	 * visible from the first frame.
	 */
	intro?: boolean;
}

const SPRING_K = 0.07;
const DAMPING = 0.8;
const SLEEP_EPS = 0.08;

const RADIUS_BASE = 150;
const RADIUS_EXPANDED = 30;
const RADIUS_EXPAND_SPEED = 0.28;
const RADIUS_CONTRACT_SPEED = 0.1;

const RIPPLE_SPEED = 9;
const RIPPLE_HALF_WIDTH = 32;

const INTRO_SPEED = 18;
const INTRO_FADE_WIDTH = 80;

const TARGET_MS = 1000 / 60;

interface Ripple {
	x: number;
	y: number;
	radius: number;
	maxRadius: number;
}

export function DotGrid( {
	opacity = 0.25,
	repulsion = 0.25,
	rippleStrength = 1,
	spacing = 24,
	crossSize = 4,
	crossThickness = 0.75,
	className,
	active = true,
	intro = true,
}: DotGridProps ) {
	const canvasRef = useRef< HTMLCanvasElement >( null );
	// Bridges the `active` prop into the long-lived effect below without
	// tearing the simulation down (the effect's deps stay layout-only).
	const setActiveRef = useRef< ( value: boolean ) => void >( () => {} );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) return;

		let ctx: CanvasRenderingContext2D | null = null;
		let isActive = true;
		let color = '';
		let mouseX = -9999;
		let mouseY = -9999;
		let rafId: number | null = null;
		let lastTimestamp = 0;

		let currentRadius = RADIUS_BASE;
		let targetRadius = RADIUS_BASE;
		let ripples: Ripple[] = [];

		let introRadius = 0;
		let introComplete = ! intro;

		let cols = 0;
		let rows = 0;
		let ox: Float32Array;
		let oy: Float32Array;
		let vx: Float32Array;
		let vy: Float32Array;

		function readColor() {
			if ( ! canvas ) return;
			color = getComputedStyle( canvas ).color;
		}

		function initDots() {
			if ( ! canvas ) return;
			cols = Math.ceil( canvas.offsetWidth / spacing ) + 1;
			rows = Math.ceil( canvas.offsetHeight / spacing ) + 1;
			const n = cols * rows;
			ox = new Float32Array( n );
			oy = new Float32Array( n );
			vx = new Float32Array( n );
			vy = new Float32Array( n );
		}

		function tick( timestamp: number ): boolean {
			if ( ! ctx || ! canvas ) return false;
			const rawDt = lastTimestamp === 0 ? TARGET_MS : timestamp - lastTimestamp;
			lastTimestamp = timestamp;
			const dt = Math.min( rawDt / TARGET_MS, 3 );

			const cssW = canvas.offsetWidth;
			const cssH = canvas.offsetHeight;
			ctx.clearRect( 0, 0, cssW, cssH );
			ctx.fillStyle = color;

			const expandFactor = 1 - Math.pow( 1 - RADIUS_EXPAND_SPEED, dt );
			const contractFactor = 1 - Math.pow( 1 - RADIUS_CONTRACT_SPEED, dt );
			const lerpFactor = currentRadius < targetRadius ? expandFactor : contractFactor;
			currentRadius += ( targetRadius - currentRadius ) * lerpFactor;
			const radiusAnimating = Math.abs( currentRadius - targetRadius ) > 0.3;

			if ( ! introComplete ) {
				introRadius += INTRO_SPEED * dt;
				const diag = Math.sqrt( cssW * cssW + cssH * cssH );
				if ( introRadius > diag + INTRO_FADE_WIDTH ) {
					introComplete = true;
					ctx.globalAlpha = 1;
				}
			}

			const dampFactor = Math.pow( DAMPING, dt );
			const cursorActive = isActive && mouseX > -9998;
			let anyActive = false;

			for ( let r = 0; r < rows; r++ ) {
				for ( let c = 0; c < cols; c++ ) {
					const i = r * cols + c;
					const rx = c * spacing;
					const ry = r * spacing;

					let dvx = vx[ i ];
					let dvy = vy[ i ];
					let dox = ox[ i ];
					let doy = oy[ i ];

					// Hover repulsion
					if ( cursorActive ) {
						const cx2 = rx + dox;
						const cy2 = ry + doy;
						const ddx = cx2 - mouseX;
						const ddy = cy2 - mouseY;
						const dist = Math.sqrt( ddx * ddx + ddy * ddy );
						if ( dist < currentRadius && dist > 0.5 ) {
							const force = ( repulsion * ( 1 - dist / currentRadius ) ) / dist;
							dvx += force * ddx * dt;
							dvy += force * ddy * dt;
						}
					}

					// Ripple wavefronts
					for ( const ripple of ripples ) {
						const cx2 = rx + dox;
						const cy2 = ry + doy;
						const ddx = cx2 - ripple.x;
						const ddy = cy2 - ripple.y;
						const dist = Math.sqrt( ddx * ddx + ddy * ddy );
						if ( dist > 0.5 ) {
							const delta = dist - ripple.radius;
							const falloff = Math.exp( -0.5 * ( delta / RIPPLE_HALF_WIDTH ) ** 2 );
							const force = ( rippleStrength * falloff ) / dist;
							dvx += force * ddx * dt;
							dvy += force * ddy * dt;
						}
					}

					// Spring toward rest
					dvx += SPRING_K * -dox * dt;
					dvy += SPRING_K * -doy * dt;

					// Damping
					dvx *= dampFactor;
					dvy *= dampFactor;

					// Integrate
					dox += dvx * dt;
					doy += dvy * dt;

					ox[ i ] = dox;
					oy[ i ] = doy;
					vx[ i ] = dvx;
					vy[ i ] = dvy;

					if (
						Math.abs( dvx ) > SLEEP_EPS ||
						Math.abs( dvy ) > SLEEP_EPS ||
						Math.abs( dox ) > SLEEP_EPS ||
						Math.abs( doy ) > SLEEP_EPS
					) {
						anyActive = true;
					}
				}
			}

			// Draw dotted connecting lines
			ctx.strokeStyle = color;
			ctx.lineWidth = crossThickness;
			ctx.setLineDash( [ 1, 4 ] );
			for ( let r = 0; r < rows; r++ ) {
				for ( let c = 0; c < cols; c++ ) {
					const i = r * cols + c;
					const x = c * spacing + ox[ i ];
					const y = r * spacing + oy[ i ];

					if ( ! introComplete ) {
						const distFromCorner = Math.sqrt( ( c * spacing ) ** 2 + ( r * spacing ) ** 2 );
						ctx.globalAlpha = Math.max(
							0,
							Math.min( 1, ( introRadius - distFromCorner ) / INTRO_FADE_WIDTH )
						);
					}

					// Horizontal line to right neighbor
					if ( c < cols - 1 ) {
						const ni = r * cols + ( c + 1 );
						const nx = ( c + 1 ) * spacing + ox[ ni ];
						const ny = r * spacing + oy[ ni ];
						ctx.beginPath();
						ctx.moveTo( x + crossSize, y );
						ctx.lineTo( nx - crossSize, ny );
						ctx.stroke();
					}
					// Vertical line to bottom neighbor
					if ( r < rows - 1 ) {
						const ni = ( r + 1 ) * cols + c;
						const nx = c * spacing + ox[ ni ];
						const ny = ( r + 1 ) * spacing + oy[ ni ];
						ctx.beginPath();
						ctx.moveTo( x, y + crossSize );
						ctx.lineTo( nx, ny - crossSize );
						ctx.stroke();
					}
				}
			}
			ctx.setLineDash( [] );

			// Draw crosses on top
			ctx.fillStyle = color;
			for ( let r = 0; r < rows; r++ ) {
				for ( let c = 0; c < cols; c++ ) {
					const i = r * cols + c;
					const x = c * spacing + ox[ i ];
					const y = r * spacing + oy[ i ];

					if ( ! introComplete ) {
						const distFromCorner = Math.sqrt( ( c * spacing ) ** 2 + ( r * spacing ) ** 2 );
						ctx.globalAlpha = Math.max(
							0,
							Math.min( 1, ( introRadius - distFromCorner ) / INTRO_FADE_WIDTH )
						);
					}

					ctx.fillRect( x - crossSize, y - crossThickness / 2, crossSize * 2, crossThickness );
					ctx.fillRect( x - crossThickness / 2, y - crossSize, crossThickness, crossSize * 2 );
				}
			}

			if ( ! introComplete ) ctx.globalAlpha = 1;

			for ( const ripple of ripples ) ripple.radius += RIPPLE_SPEED * dt;
			ripples = ripples.filter( ( rip ) => rip.radius < rip.maxRadius );

			return anyActive || cursorActive || radiusAnimating || ripples.length > 0 || ! introComplete;
		}

		function loop( timestamp: number ) {
			if ( tick( timestamp ) ) {
				rafId = requestAnimationFrame( loop );
			} else {
				rafId = null;
				lastTimestamp = 0;
			}
		}

		function ensureLoop() {
			if ( rafId === null ) {
				lastTimestamp = 0;
				rafId = requestAnimationFrame( loop );
			}
		}

		function drawStatic() {
			if ( ! ctx || ! canvas ) return;
			const cssW = canvas.offsetWidth;
			const cssH = canvas.offsetHeight;
			ctx.clearRect( 0, 0, cssW, cssH );

			ctx.strokeStyle = color;
			ctx.lineWidth = crossThickness;
			ctx.setLineDash( [ 1, 4 ] );
			for ( let r = 0; r < rows; r++ ) {
				for ( let c = 0; c < cols; c++ ) {
					const x = c * spacing;
					const y = r * spacing;
					if ( c < cols - 1 ) {
						ctx.beginPath();
						ctx.moveTo( x + crossSize, y );
						ctx.lineTo( ( c + 1 ) * spacing - crossSize, y );
						ctx.stroke();
					}
					if ( r < rows - 1 ) {
						ctx.beginPath();
						ctx.moveTo( x, y + crossSize );
						ctx.lineTo( x, ( r + 1 ) * spacing - crossSize );
						ctx.stroke();
					}
				}
			}
			ctx.setLineDash( [] );

			ctx.fillStyle = color;
			for ( let r = 0; r < rows; r++ ) {
				for ( let c = 0; c < cols; c++ ) {
					const x = c * spacing;
					const y = r * spacing;
					ctx.fillRect( x - crossSize, y - crossThickness / 2, crossSize * 2, crossThickness );
					ctx.fillRect( x - crossThickness / 2, y - crossSize, crossThickness, crossSize * 2 );
				}
			}
		}

		function setupCanvas() {
			if ( ! canvas ) return;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.round( canvas.offsetWidth * dpr );
			canvas.height = Math.round( canvas.offsetHeight * dpr );
			ctx = canvas.getContext( '2d' )!;
			ctx.scale( dpr, dpr );
			readColor();
			initDots();
		}

		function resize() {
			setupCanvas();
			ensureLoop();
		}

		function resizeStatic() {
			setupCanvas();
			drawStatic();
		}

		const prefersReducedMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

		if ( prefersReducedMotion ) {
			resizeStatic();

			const resizeObserver = new ResizeObserver( resizeStatic );
			resizeObserver.observe( canvas );

			const mediaQuery = window.matchMedia( '(prefers-color-scheme: dark)' );
			const onColorChange = () => {
				readColor();
				drawStatic();
			};
			mediaQuery.addEventListener( 'change', onColorChange );

			return () => {
				resizeObserver.disconnect();
				mediaQuery.removeEventListener( 'change', onColorChange );
			};
		}

		function onMouseMove( e: MouseEvent ) {
			if ( ! canvas || ! isActive ) return;
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
			mouseX = inside ? x : -9999;
			mouseY = inside ? y : -9999;
			ensureLoop();
		}

		function onMouseDown( e: MouseEvent ) {
			if ( ! canvas || ! isActive ) return;
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			if ( x >= 0 && x <= rect.width && y >= 0 && y <= rect.height ) {
				targetRadius = RADIUS_EXPANDED;
				ensureLoop();
			}
		}

		function onMouseUp( e: MouseEvent ) {
			if ( ! canvas || ! isActive ) return;
			targetRadius = RADIUS_BASE;
			if ( mouseX > -9998 ) {
				const rect = canvas.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;
				const diag = Math.sqrt( rect.width ** 2 + rect.height ** 2 );
				ripples.push( {
					x,
					y,
					radius: currentRadius * 0.85,
					maxRadius: diag + RIPPLE_HALF_WIDTH * 4,
				} );
			}
			ensureLoop();
		}

		setActiveRef.current = ( value: boolean ) => {
			if ( isActive === value ) return;
			isActive = value;
			if ( ! value ) {
				// Forget the cursor and any pressed state so the springs settle
				// to rest in a few frames and the loop goes to sleep.
				mouseX = -9999;
				mouseY = -9999;
				targetRadius = RADIUS_BASE;
			}
			ensureLoop();
		};

		resize();

		document.addEventListener( 'mousemove', onMouseMove );
		document.addEventListener( 'mousedown', onMouseDown );
		document.addEventListener( 'mouseup', onMouseUp );

		const resizeObserver = new ResizeObserver( resize );
		resizeObserver.observe( canvas );

		const mediaQuery = window.matchMedia( '(prefers-color-scheme: dark)' );
		// Wake the loop for at least one frame so a sleeping grid repaints in
		// the new color (the reduced-motion branch does the drawStatic
		// equivalent above).
		const onColorChange = () => {
			readColor();
			ensureLoop();
		};
		mediaQuery.addEventListener( 'change', onColorChange );

		return () => {
			if ( rafId !== null ) cancelAnimationFrame( rafId );
			setActiveRef.current = () => {};
			document.removeEventListener( 'mousemove', onMouseMove );
			document.removeEventListener( 'mousedown', onMouseDown );
			document.removeEventListener( 'mouseup', onMouseUp );
			resizeObserver.disconnect();
			mediaQuery.removeEventListener( 'change', onColorChange );
		};
	}, [ spacing, repulsion, rippleStrength, crossSize, crossThickness, intro ] );

	useEffect( () => {
		setActiveRef.current( active );
	}, [ active ] );

	return (
		<canvas
			ref={ canvasRef }
			className={ className ? `${ styles.canvas } ${ className }` : styles.canvas }
			style={ { opacity } }
		/>
	);
}
