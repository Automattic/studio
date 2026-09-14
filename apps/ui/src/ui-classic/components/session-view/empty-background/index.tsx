import { useEffect, useRef } from 'react';
import styles from './style.module.css';
import logoSrc from './wordpress-logo.webp';

const DEFAULT_LOGO_SIZE = 320;
const DEFAULT_PADDING = 130;
const RES = 6;
const RECT_SIZE = 4;
const MAX_DPR = 2;
const MOTION_RADIUS = 240;
const MOTION_RADIUS_SQUARED = MOTION_RADIUS * MOTION_RADIUS;
const MOTION_PUSH = 74;
const MOTION_DRIFT = 34;
const MOTION_SWIRL = 30;
const ORBIT_OFFSET = 12;
const ORBIT_FORCE = 0.18;
const ORBIT_SPEED = 0.0016;
const POINTER_EASE = 0.05;
const SPRING = 0.028;
const DAMPING = 0.88;
const BLUE: [ number, number, number ] = [ 56, 88, 233 ];
const LIGHT_BLUE: [ number, number, number ] = [ 220, 230, 255 ];
const WAVE_INTERVAL = 9000;
const WAVE_DURATION = 2300;
const WAVE_BAND = 0.38;
const WAVE_PAUSE = WAVE_INTERVAL - WAVE_DURATION;
const RIPPLE_DURATION = 1900;
const RIPPLE_BAND = 22;
const RIPPLE_PUSH = 46;
const MAX_RIPPLES = 4;
const COLOR_STEPS = 18;
const VELOCITY_EPSILON_SQUARED = 0.001;
const DISPLACEMENT_EPSILON_SQUARED = 0.04;
const REFERENCE_FRAME_MS = 1000 / 120;
const MIN_FRAME_FACTOR = 0.5;
const MAX_FRAME_FACTOR = 4;

const COLOR_STYLES = Array.from( { length: COLOR_STEPS + 1 }, ( _, step ) => {
	const intensity = step / COLOR_STEPS;
	const r = Math.round( BLUE[ 0 ] + ( LIGHT_BLUE[ 0 ] - BLUE[ 0 ] ) * intensity );
	const g = Math.round( BLUE[ 1 ] + ( LIGHT_BLUE[ 1 ] - BLUE[ 1 ] ) * intensity );
	const b = Math.round( BLUE[ 2 ] + ( LIGHT_BLUE[ 2 ] - BLUE[ 2 ] ) * intensity );

	return `rgb(${ r }, ${ g }, ${ b })`;
} );

const BASE_COLOR = COLOR_STYLES[ 0 ];

function getColorStyle( intensity: number ) {
	const step = Math.min( COLOR_STEPS, Math.max( 0, Math.round( intensity * COLOR_STEPS ) ) );

	return COLOR_STYLES[ step ];
}

function getFrameFactor( timestamp: number, previousTimestamp: number | null ) {
	if ( previousTimestamp === null ) {
		return 1;
	}

	const frameFactor = ( timestamp - previousTimestamp ) / REFERENCE_FRAME_MS;

	return Math.min( MAX_FRAME_FACTOR, Math.max( MIN_FRAME_FACTOR, frameFactor ) );
}

function scaleEasingForFrameFactor( value: number, frameFactor: number ) {
	return 1 - Math.pow( 1 - value, frameFactor );
}

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	hx: number;
	hy: number;
	cx: number;
	cy: number;
	waveCoord: number;
	shimmer: number;
	orbitPhaseOffset: number;
};

type Ripple = { x: number; y: number; start: number };

type ActiveRipple = {
	x: number;
	y: number;
	radius: number;
	band: number;
	fade: number;
	minRadiusSquared: number;
	maxRadiusSquared: number;
};

interface EmptyBackgroundProps {
	/** Rendered logo size in CSS pixels. */
	logoSize?: number;
	/** Room around the logo for displaced particles to roam. */
	padding?: number;
	/**
	 * Default true: clip painting to the host box (`contain: paint`). Set
	 * false when the host box is smaller than the canvas so the effect can
	 * spread beyond it without getting cut off.
	 */
	contained?: boolean;
}

export function EmptyBackground( {
	logoSize = DEFAULT_LOGO_SIZE,
	padding = DEFAULT_PADDING,
	contained = true,
}: EmptyBackgroundProps = {} ) {
	const canvasSize = logoSize + padding * 2;
	const canvasRef = useRef< HTMLCanvasElement >( null );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) {
			return;
		}

		const canvasElement = canvas;
		const dpr = Math.min( window.devicePixelRatio || 1, MAX_DPR );
		canvasElement.width = Math.round( canvasSize * dpr );
		canvasElement.height = Math.round( canvasSize * dpr );
		canvasElement.style.setProperty( '--empty-background-canvas-size', `${ canvasSize }px` );

		const ctx = canvasElement.getContext( '2d', { alpha: true } );
		if ( ! ctx ) {
			return;
		}

		const context = ctx;
		context.scale( dpr, dpr );
		context.imageSmoothingEnabled = false;

		const particles: Particle[] = [];
		const ripples: Ripple[] = [];
		const reducedMotionQuery =
			typeof window.matchMedia === 'function'
				? window.matchMedia( '(prefers-reduced-motion: reduce)' )
				: null;
		const animationStart = performance.now();
		const bounds = {
			left: 0,
			top: 0,
			right: 0,
			bottom: 0,
			scale: 1,
		};

		let mouseX = -9999;
		let mouseY = -9999;
		let targetMouseX = -9999;
		let targetMouseY = -9999;
		let hover = false;
		let raf: number | null = null;
		let waveTimeout: number | null = null;
		let cancelled = false;
		let imageReady = false;
		let pageVisible = ! document.hidden;
		let isIntersecting = true;
		let reducedMotion = reducedMotionQuery?.matches ?? false;
		let logoRadius = 1;
		let currentWaveStart = 0;
		let currentWaveActive = false;
		let waveCos = 1;
		let waveSin = 0;
		let previousFrameTimestamp: number | null = null;

		function canAnimate() {
			return (
				imageReady &&
				particles.length > 0 &&
				! cancelled &&
				! reducedMotion &&
				pageVisible &&
				isIntersecting
			);
		}

		function updateBounds() {
			const rect = canvasElement.getBoundingClientRect();
			bounds.left = rect.left;
			bounds.top = rect.top;
			bounds.right = rect.right;
			bounds.bottom = rect.bottom;
			bounds.scale = rect.width > 0 ? canvasSize / rect.width : 1;
		}

		function clearScheduledWave() {
			if ( waveTimeout === null ) {
				return;
			}

			window.clearTimeout( waveTimeout );
			waveTimeout = null;
		}

		function cancelLoop() {
			if ( raf !== null ) {
				cancelAnimationFrame( raf );
				raf = null;
			}
			previousFrameTimestamp = null;
		}

		function resetParticles() {
			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				pt.x = pt.hx;
				pt.y = pt.hy;
				pt.vx = 0;
				pt.vy = 0;
			}
		}

		function drawStatic() {
			context.clearRect( 0, 0, canvasSize, canvasSize );
			context.fillStyle = BASE_COLOR;

			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				context.fillRect( pt.hx - RECT_SIZE / 2, pt.hy - RECT_SIZE / 2, RECT_SIZE, RECT_SIZE );
			}
		}

		function scheduleNextWave( delay = WAVE_PAUSE ) {
			if ( ! canAnimate() || waveTimeout !== null ) {
				return;
			}

			waveTimeout = window.setTimeout( () => {
				waveTimeout = null;
				beginWave();
			}, delay );
		}

		function ensureLoop() {
			if ( ! canAnimate() || raf !== null ) {
				return;
			}

			raf = requestAnimationFrame( tick );
		}

		function beginWave() {
			if ( ! canAnimate() ) {
				return;
			}

			clearScheduledWave();
			currentWaveStart = performance.now();
			currentWaveActive = true;

			const ang = Math.random() * Math.PI * 2;
			waveCos = Math.cos( ang );
			waveSin = Math.sin( ang );

			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				const proj = ( pt.cx * waveCos + pt.cy * waveSin ) / logoRadius;
				pt.waveCoord = ( proj + 1 ) / 2;
				pt.shimmer = 0.45 + Math.random() * 0.55;
			}

			ensureLoop();
		}

		function pauseAnimation() {
			cancelLoop();
			clearScheduledWave();
			currentWaveActive = false;
			resetParticles();
			drawStatic();
		}

		function syncAnimationState() {
			if ( ! imageReady ) {
				return;
			}

			if ( ! canAnimate() ) {
				pauseAnimation();
				return;
			}

			if ( raf !== null || currentWaveActive || hover || ripples.length > 0 ) {
				ensureLoop();
				return;
			}

			drawStatic();
			scheduleNextWave( 0 );
		}

		function tick( timestamp: number ) {
			raf = null;
			if ( ! canAnimate() ) {
				pauseAnimation();
				return;
			}

			const frameFactor = getFrameFactor( timestamp, previousFrameTimestamp );
			previousFrameTimestamp = timestamp;
			const pointerEase = scaleEasingForFrameFactor( POINTER_EASE, frameFactor );
			const spring = SPRING * frameFactor;
			const damping = Math.pow( DAMPING, frameFactor );
			context.clearRect( 0, 0, canvasSize, canvasSize );

			const activeRipples: ActiveRipple[] = [];
			for ( let i = ripples.length - 1; i >= 0; i-- ) {
				const t = ( timestamp - ripples[ i ].start ) / RIPPLE_DURATION;
				if ( t > 1 ) {
					ripples.splice( i, 1 );
					continue;
				}

				const eased = 1 - Math.pow( 1 - t, 3 );
				const radius = eased * logoRadius * 2.35;
				const band = RIPPLE_BAND + t * 12;
				const minRadius = Math.max( 0, radius - band );
				const maxRadius = radius + band;
				activeRipples.push( {
					x: ripples[ i ].x,
					y: ripples[ i ].y,
					radius,
					band,
					fade: 1 - t,
					minRadiusSquared: minRadius * minRadius,
					maxRadiusSquared: maxRadius * maxRadius,
				} );
			}

			let waveT = -99;
			if ( currentWaveActive ) {
				const waveElapsed = timestamp - currentWaveStart;
				if ( waveElapsed <= WAVE_DURATION ) {
					waveT = ( waveElapsed / WAVE_DURATION ) * ( 1 + WAVE_BAND * 2 ) - WAVE_BAND;
				} else {
					currentWaveActive = false;
					scheduleNextWave();
				}
			}

			let motionX = 0;
			let motionY = 0;
			if ( hover ) {
				const nextMouseX = mouseX + ( targetMouseX - mouseX ) * pointerEase;
				const nextMouseY = mouseY + ( targetMouseY - mouseY ) * pointerEase;
				motionX = nextMouseX - mouseX;
				motionY = nextMouseY - mouseY;
				mouseX = nextMouseX;
				mouseY = nextMouseY;
			}

			const motionDistance = Math.hypot( motionX, motionY );
			const motionEnergy = Math.min( 1, motionDistance / frameFactor / 9 );
			const motionDirX = motionDistance > 0.0001 ? motionX / motionDistance : 0;
			const motionDirY = motionDistance > 0.0001 ? motionY / motionDistance : 0;
			const elapsed = timestamp - animationStart;
			const orbitAngle = elapsed * ORBIT_SPEED;
			const orbitCos = hover ? Math.cos( orbitAngle ) : 1;
			const orbitSin = hover ? Math.sin( orbitAngle ) : 0;
			const orbitPulsePhase = elapsed * 0.002;
			let hasPointerInfluence = false;
			let maxVelocitySquared = 0;
			let maxDisplacementSquared = 0;

			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				let targetX = pt.hx;
				let targetY = pt.hy;
				let wakeInfluence = 0;
				let orbitForceX = 0;
				let orbitForceY = 0;
				let rippleIntensity = 0;

				if ( hover ) {
					const dx = pt.hx - mouseX;
					const dy = pt.hy - mouseY;
					const distanceSquared = dx * dx + dy * dy;

					if ( distanceSquared < MOTION_RADIUS_SQUARED ) {
						const d = Math.sqrt( distanceSquared ) || 0.0001;
						const unitX = dx / d;
						const unitY = dy / d;
						const proximity = 1 - d / MOTION_RADIUS;
						const motionInfluence = proximity * proximity * ( 3 - 2 * proximity );

						if ( motionInfluence > 0 ) {
							hasPointerInfluence = true;
							wakeInfluence = motionInfluence * motionEnergy;

							targetX += unitX * MOTION_PUSH * motionInfluence;
							targetY += unitY * MOTION_PUSH * motionInfluence;

							const orbitOffset = ORBIT_OFFSET * motionInfluence;
							const rotatedX = unitX * orbitCos - unitY * orbitSin;
							const rotatedY = unitY * orbitCos + unitX * orbitSin;
							targetX += ( rotatedX - unitX ) * orbitOffset;
							targetY += ( rotatedY - unitY ) * orbitOffset;

							if ( wakeInfluence > 0 && motionDistance > 0.0001 ) {
								const side = Math.sign( dx * motionDirY - dy * motionDirX ) || 1;
								const swirl = MOTION_SWIRL * wakeInfluence * side;
								targetX += motionDirX * MOTION_DRIFT * wakeInfluence - motionDirY * swirl;
								targetY += motionDirY * MOTION_DRIFT * wakeInfluence + motionDirX * swirl;
							}

							const orbitPulse = 0.7 + 0.3 * Math.sin( orbitPulsePhase + pt.orbitPhaseOffset );
							const orbitForce = ORBIT_FORCE * motionInfluence * orbitPulse;
							orbitForceX = -unitY * orbitForce;
							orbitForceY = unitX * orbitForce;
						}
					}
				}

				for ( let rippleIndex = 0; rippleIndex < activeRipples.length; rippleIndex++ ) {
					const ripple = activeRipples[ rippleIndex ];
					const rdx = pt.hx - ripple.x;
					const rdy = pt.hy - ripple.y;
					const rippleDistanceSquared = rdx * rdx + rdy * rdy;
					if (
						rippleDistanceSquared < ripple.minRadiusSquared ||
						rippleDistanceSquared > ripple.maxRadiusSquared
					) {
						continue;
					}

					const rd = Math.sqrt( rippleDistanceSquared ) || 0.0001;
					const bandDistance = Math.abs( rd - ripple.radius );

					if ( bandDistance < ripple.band ) {
						const intensity = ( 1 - bandDistance / ripple.band ) * ripple.fade;
						rippleIntensity = Math.max( rippleIntensity, intensity );
						targetX += ( rdx / rd ) * intensity * RIPPLE_PUSH;
						targetY += ( rdy / rd ) * intensity * RIPPLE_PUSH;
					}
				}

				pt.vx += ( targetX - pt.x ) * spring;
				pt.vy += ( targetY - pt.y ) * spring;
				pt.vx += orbitForceX * frameFactor;
				pt.vy += orbitForceY * frameFactor;
				pt.vx *= damping;
				pt.vy *= damping;
				pt.x += pt.vx * frameFactor;
				pt.y += pt.vy * frameFactor;

				let intensity = 0;
				if ( currentWaveActive ) {
					const dw = Math.abs( pt.waveCoord - waveT );
					if ( dw < WAVE_BAND ) {
						intensity = ( 1 - dw / WAVE_BAND ) * pt.shimmer;
					}
				}
				intensity = Math.max( intensity, rippleIntensity, wakeInfluence * 0.65 );

				const size = RECT_SIZE + rippleIntensity * 1.6 + wakeInfluence * 0.8;
				context.fillStyle = getColorStyle( intensity );
				context.fillRect( pt.x - size / 2, pt.y - size / 2, size, size );

				const velocitySquared = pt.vx * pt.vx + pt.vy * pt.vy;
				if ( velocitySquared > maxVelocitySquared ) {
					maxVelocitySquared = velocitySquared;
				}

				const displacementX = pt.x - pt.hx;
				const displacementY = pt.y - pt.hy;
				const displacementSquared = displacementX * displacementX + displacementY * displacementY;
				if ( displacementSquared > maxDisplacementSquared ) {
					maxDisplacementSquared = displacementSquared;
				}
			}

			const shouldContinue =
				currentWaveActive ||
				activeRipples.length > 0 ||
				hasPointerInfluence ||
				maxVelocitySquared > VELOCITY_EPSILON_SQUARED ||
				maxDisplacementSquared > DISPLACEMENT_EPSILON_SQUARED;

			if ( shouldContinue ) {
				ensureLoop();
				return;
			}

			resetParticles();
			previousFrameTimestamp = null;
			drawStatic();
			scheduleNextWave();
		}

		const img = new Image();
		img.decoding = 'async';
		img.onload = () => {
			if ( cancelled ) {
				return;
			}

			const off = document.createElement( 'canvas' );
			off.width = img.width;
			off.height = img.height;
			const offCtx = off.getContext( '2d', { willReadFrequently: true } );
			if ( ! offCtx ) {
				return;
			}
			offCtx.drawImage( img, 0, 0 );
			const { data } = offCtx.getImageData( 0, 0, img.width, img.height );

			const scale = Math.min( logoSize / img.width, logoSize / img.height ) * 0.92;
			const drawW = img.width * scale;
			const drawH = img.height * scale;
			const offsetX = ( canvasSize - drawW ) / 2;
			const offsetY = ( canvasSize - drawH ) / 2;

			for ( let y = 0; y < drawH; y += RES ) {
				for ( let x = 0; x < drawW; x += RES ) {
					const ix = Math.floor( x / scale );
					const iy = Math.floor( y / scale );
					const idx = 4 * ( iy * img.width + ix );
					const r = data[ idx ];
					const g = data[ idx + 1 ];
					const b = data[ idx + 2 ];
					const a = data[ idx + 3 ];
					if ( a > 128 && ( r + g + b ) / 3 < 140 ) {
						particles.push( {
							x: offsetX + x,
							y: offsetY + y,
							vx: 0,
							vy: 0,
							hx: offsetX + x,
							hy: offsetY + y,
							cx: 0,
							cy: 0,
							waveCoord: 0,
							shimmer: 1,
							orbitPhaseOffset: 0,
						} );
					}
				}
			}

			imageReady = true;
			if ( particles.length === 0 ) {
				drawStatic();
				return;
			}

			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				if ( pt.hx < minX ) {
					minX = pt.hx;
				}
				if ( pt.hx > maxX ) {
					maxX = pt.hx;
				}
				if ( pt.hy < minY ) {
					minY = pt.hy;
				}
				if ( pt.hy > maxY ) {
					maxY = pt.hy;
				}
			}

			const logoMidX = ( minX + maxX ) / 2;
			const logoMidY = ( minY + maxY ) / 2;
			for ( let i = 0; i < particles.length; i++ ) {
				const pt = particles[ i ];
				pt.cx = pt.hx - logoMidX;
				pt.cy = pt.hy - logoMidY;
				pt.orbitPhaseOffset = pt.cx * 0.03 + pt.cy * 0.02;
				const r = Math.hypot( pt.cx, pt.cy );
				if ( r > logoRadius ) {
					logoRadius = r;
				}
			}

			drawStatic();
			beginWave();
		};
		img.src = logoSrc;

		const setPointerFromEvent = ( event: MouseEvent ) => {
			targetMouseX = ( event.clientX - bounds.left ) * bounds.scale;
			targetMouseY = ( event.clientY - bounds.top ) * bounds.scale;
			if ( mouseX < -1000 || mouseY < -1000 ) {
				mouseX = targetMouseX;
				mouseY = targetMouseY;
			}
		};
		const onLeave = () => {
			hover = false;
			mouseX = -9999;
			mouseY = -9999;
			targetMouseX = -9999;
			targetMouseY = -9999;
			ensureLoop();
		};
		const onWindowMove = ( event: MouseEvent ) => {
			const isOverCanvas =
				event.clientX >= bounds.left &&
				event.clientX <= bounds.right &&
				event.clientY >= bounds.top &&
				event.clientY <= bounds.bottom;

			if ( ! isOverCanvas ) {
				if ( hover ) {
					onLeave();
				}
				return;
			}

			hover = true;
			setPointerFromEvent( event );
			ensureLoop();
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
			ensureLoop();
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
		window.addEventListener( 'mousemove', onWindowMove, { passive: true } );
		window.addEventListener( 'blur', onLeave );
		canvasElement.addEventListener( 'click', onClick );
		document.addEventListener( 'visibilitychange', onVisibilityChange );
		reducedMotionQuery?.addEventListener( 'change', onReducedMotionChange );

		const resizeObserver =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver( () => updateBounds() ) : null;
		resizeObserver?.observe( canvasElement );
		// The canvas holds its fixed size while the column resizes around it, so it
		// only ever moves — observe the wrapper, which does resize, or bounds go
		// stale when the preview panel, sidebar, or window changes width.
		if ( canvasElement.parentElement ) {
			resizeObserver?.observe( canvasElement.parentElement );
		}

		const intersectionObserver =
			typeof IntersectionObserver !== 'undefined'
				? new IntersectionObserver( ( entries ) => {
						isIntersecting = entries.some( ( entry ) => entry.isIntersecting );
						syncAnimationState();
				  } )
				: null;
		intersectionObserver?.observe( canvasElement );

		return () => {
			cancelled = true;
			cancelLoop();
			clearScheduledWave();
			window.removeEventListener( 'mousemove', onWindowMove );
			window.removeEventListener( 'blur', onLeave );
			canvasElement.removeEventListener( 'click', onClick );
			document.removeEventListener( 'visibilitychange', onVisibilityChange );
			reducedMotionQuery?.removeEventListener( 'change', onReducedMotionChange );
			resizeObserver?.disconnect();
			intersectionObserver?.disconnect();
		};
	}, [ canvasSize, logoSize ] );

	return (
		<div
			className={ contained ? styles.root : `${ styles.root } ${ styles.spill }` }
			aria-hidden="true"
		>
			<canvas ref={ canvasRef } className={ styles.canvas } />
		</div>
	);
}
