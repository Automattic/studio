import { useEffect, useRef } from 'react';
import logoSrc from './wordpress-logo.webp';

const RES = 3;
const RECT_SIZE = 2.3;
const MAX_DPR = 2;
const POINTER_EASE = 0.16;
const SPRING = 0.05;
const DAMPING = 0.82;
const RIPPLE_DURATION = 1400;
const MAX_RIPPLES = 3;
const WAVE_INTERVAL = 6000;
const WAVE_DURATION = 1600;
const WAVE_BAND = 0.32;
const COLOR_STEPS = 14;
const FALLBACK_BLUE: [ number, number, number ] = [ 56, 88, 233 ];

function parseColor( value: string ): [ number, number, number ] | null {
	const match = /^#?([0-9a-f]{6})$/i.exec( value.trim() );
	if ( ! match ) {
		return null;
	}
	const int = parseInt( match[ 1 ], 16 );
	return [ ( int >> 16 ) & 255, ( int >> 8 ) & 255, int & 255 ];
}

function buildColorStyles( base: [ number, number, number ] ) {
	const light: [ number, number, number ] = [
		Math.round( base[ 0 ] + ( 255 - base[ 0 ] ) * 0.72 ),
		Math.round( base[ 1 ] + ( 255 - base[ 1 ] ) * 0.72 ),
		Math.round( base[ 2 ] + ( 255 - base[ 2 ] ) * 0.72 ),
	];
	return Array.from( { length: COLOR_STEPS + 1 }, ( _, step ) => {
		const intensity = step / COLOR_STEPS;
		const r = Math.round( base[ 0 ] + ( light[ 0 ] - base[ 0 ] ) * intensity );
		const g = Math.round( base[ 1 ] + ( light[ 1 ] - base[ 1 ] ) * intensity );
		const b = Math.round( base[ 2 ] + ( light[ 2 ] - base[ 2 ] ) * intensity );
		return `rgb(${ r }, ${ g }, ${ b })`;
	} );
}

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	hx: number;
	hy: number;
	waveCoord: number;
};

type Ripple = { x: number; y: number; start: number };

interface PixelLogoProps {
	size?: number;
}

export function PixelLogo( { size = 56 }: PixelLogoProps ) {
	const canvasRef = useRef< HTMLCanvasElement >( null );

	// The canvas is padded well beyond the logo so pixels pushed outward by hover
	// and ripples aren't clipped at the edge. The component's layout footprint stays
	// `size`; the larger canvas overflows it, centered on the logo.
	const canvasSize = size + Math.round( size * 0.4 ) * 2;

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) {
			return;
		}

		const motionRadius = size * 0.5;
		const motionRadiusSquared = motionRadius * motionRadius;
		const motionPush = size * 0.18;
		const rippleBand = size * 0.07;
		const ripplePush = size * 0.12;

		const dpr = Math.min( window.devicePixelRatio || 1, MAX_DPR );
		canvas.width = Math.round( canvasSize * dpr );
		canvas.height = Math.round( canvasSize * dpr );

		const context = canvas.getContext( '2d', { alpha: true } );
		if ( ! context ) {
			return;
		}
		context.scale( dpr, dpr );
		context.imageSmoothingEnabled = false;

		const particles: Particle[] = [];
		const ripples: Ripple[] = [];
		const reducedMotionQuery =
			typeof window.matchMedia === 'function'
				? window.matchMedia( '(prefers-reduced-motion: reduce)' )
				: null;
		const bounds = { left: 0, top: 0, scale: 1 };

		let mouseX = -9999;
		let mouseY = -9999;
		let targetMouseX = -9999;
		let targetMouseY = -9999;
		let hover = false;
		let raf: number | null = null;
		let waveTimeout: number | null = null;
		let cancelled = false;
		let imageReady = false;
		let reducedMotion = reducedMotionQuery?.matches ?? false;
		let logoRadius = 1;
		let logoMidX = 0;
		let logoMidY = 0;
		let waveStart = 0;
		let waveActive = false;

		let colorStyles: string[] = [];
		let baseColor = '';

		function readColors() {
			const themeValue = getComputedStyle( document.documentElement ).getPropertyValue(
				'--color-frame-theme'
			);
			colorStyles = buildColorStyles( parseColor( themeValue ) ?? FALLBACK_BLUE );
			baseColor = colorStyles[ 0 ];
		}

		function getColorStyle( intensity: number ) {
			const step = Math.min( COLOR_STEPS, Math.max( 0, Math.round( intensity * COLOR_STEPS ) ) );
			return colorStyles[ step ];
		}

		readColors();

		function canAnimate() {
			return imageReady && particles.length > 0 && ! cancelled && ! reducedMotion;
		}

		function updateBounds() {
			if ( ! canvas ) {
				return;
			}
			const rect = canvas.getBoundingClientRect();
			bounds.left = rect.left;
			bounds.top = rect.top;
			bounds.scale = rect.width > 0 ? canvasSize / rect.width : 1;
		}

		function resetParticles() {
			for ( const pt of particles ) {
				pt.x = pt.hx;
				pt.y = pt.hy;
				pt.vx = 0;
				pt.vy = 0;
			}
		}

		function drawStatic() {
			context!.clearRect( 0, 0, canvasSize, canvasSize );
			context!.fillStyle = baseColor;
			for ( const pt of particles ) {
				context!.fillRect( pt.hx - RECT_SIZE / 2, pt.hy - RECT_SIZE / 2, RECT_SIZE, RECT_SIZE );
			}
		}

		function ensureLoop() {
			if ( ! canAnimate() || raf !== null ) {
				return;
			}
			raf = requestAnimationFrame( tick );
		}

		function scheduleWave( delay: number ) {
			if ( ! canAnimate() || waveTimeout !== null ) {
				return;
			}
			waveTimeout = window.setTimeout( () => {
				waveTimeout = null;
				beginWave();
			}, delay );
		}

		function beginWave() {
			if ( ! canAnimate() ) {
				return;
			}
			waveStart = performance.now();
			waveActive = true;
			// Sweep each wave across the logo from a different angle.
			const ang = Math.random() * Math.PI * 2;
			const waveCos = Math.cos( ang );
			const waveSin = Math.sin( ang );
			for ( const pt of particles ) {
				const proj =
					( ( pt.hx - logoMidX ) * waveCos + ( pt.hy - logoMidY ) * waveSin ) / logoRadius;
				pt.waveCoord = ( proj + 1 ) / 2;
			}
			ensureLoop();
		}

		function tick( timestamp: number ) {
			raf = null;
			if ( ! canAnimate() ) {
				resetParticles();
				drawStatic();
				return;
			}

			context!.clearRect( 0, 0, canvasSize, canvasSize );

			let waveT = -99;
			if ( waveActive ) {
				const elapsed = timestamp - waveStart;
				if ( elapsed <= WAVE_DURATION ) {
					waveT = ( elapsed / WAVE_DURATION ) * ( 1 + WAVE_BAND * 2 ) - WAVE_BAND;
				} else {
					waveActive = false;
					scheduleWave( WAVE_INTERVAL - WAVE_DURATION );
				}
			}

			if ( hover ) {
				mouseX += ( targetMouseX - mouseX ) * POINTER_EASE;
				mouseY += ( targetMouseY - mouseY ) * POINTER_EASE;
			}

			const activeRipples = ripples.filter( ( r ) => timestamp - r.start <= RIPPLE_DURATION );
			ripples.length = 0;
			ripples.push( ...activeRipples );

			let energetic = waveActive || activeRipples.length > 0;

			for ( const pt of particles ) {
				let targetX = pt.hx;
				let targetY = pt.hy;
				let intensity = 0;

				if ( hover ) {
					const dx = pt.hx - mouseX;
					const dy = pt.hy - mouseY;
					const distSq = dx * dx + dy * dy;
					if ( distSq < motionRadiusSquared ) {
						const d = Math.sqrt( distSq ) || 0.0001;
						const proximity = 1 - d / motionRadius;
						const influence = proximity * proximity;
						targetX += ( dx / d ) * motionPush * influence;
						targetY += ( dy / d ) * motionPush * influence;
						intensity = Math.max( intensity, influence * 0.7 );
						energetic = true;
					}
				}

				for ( const ripple of activeRipples ) {
					const t = ( timestamp - ripple.start ) / RIPPLE_DURATION;
					const radius = ( 1 - Math.pow( 1 - t, 3 ) ) * logoRadius * 2;
					const rdx = pt.hx - ripple.x;
					const rdy = pt.hy - ripple.y;
					const rd = Math.hypot( rdx, rdy ) || 0.0001;
					const bandDist = Math.abs( rd - radius );
					if ( bandDist < rippleBand ) {
						const rippleIntensity = ( 1 - bandDist / rippleBand ) * ( 1 - t );
						targetX += ( rdx / rd ) * rippleIntensity * ripplePush;
						targetY += ( rdy / rd ) * rippleIntensity * ripplePush;
						intensity = Math.max( intensity, rippleIntensity );
					}
				}

				if ( waveActive ) {
					const dw = Math.abs( pt.waveCoord - waveT );
					if ( dw < WAVE_BAND ) {
						intensity = Math.max( intensity, 1 - dw / WAVE_BAND );
					}
				}

				pt.vx += ( targetX - pt.x ) * SPRING;
				pt.vy += ( targetY - pt.y ) * SPRING;
				pt.vx *= DAMPING;
				pt.vy *= DAMPING;
				pt.x += pt.vx;
				pt.y += pt.vy;

				if ( Math.abs( pt.vx ) > 0.02 || Math.abs( pt.vy ) > 0.02 ) {
					energetic = true;
				}

				context!.fillStyle = intensity > 0 ? getColorStyle( intensity ) : baseColor;
				context!.fillRect( pt.x - RECT_SIZE / 2, pt.y - RECT_SIZE / 2, RECT_SIZE, RECT_SIZE );
			}

			if ( energetic || hover ) {
				ensureLoop();
				return;
			}

			resetParticles();
			drawStatic();
			scheduleWave( WAVE_INTERVAL );
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

			const scale = ( size / Math.max( img.width, img.height ) ) * 0.92;
			const drawW = img.width * scale;
			const drawH = img.height * scale;
			const offsetX = Math.round( ( canvasSize - drawW ) / 2 );
			const offsetY = Math.round( ( canvasSize - drawH ) / 2 );

			for ( let y = 0; y < drawH; y += RES ) {
				for ( let x = 0; x < drawW; x += RES ) {
					const ix = Math.floor( x / scale );
					const iy = Math.floor( y / scale );
					const idx = 4 * ( iy * img.width + ix );
					const a = data[ idx + 3 ];
					const luminance = ( data[ idx ] + data[ idx + 1 ] + data[ idx + 2 ] ) / 3;
					if ( a > 128 && luminance < 140 ) {
						particles.push( {
							x: offsetX + x,
							y: offsetY + y,
							vx: 0,
							vy: 0,
							hx: offsetX + x,
							hy: offsetY + y,
							waveCoord: 0,
						} );
					}
				}
			}

			imageReady = true;
			if ( particles.length === 0 ) {
				return;
			}

			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for ( const pt of particles ) {
				minX = Math.min( minX, pt.hx );
				maxX = Math.max( maxX, pt.hx );
				minY = Math.min( minY, pt.hy );
				maxY = Math.max( maxY, pt.hy );
			}
			logoMidX = ( minX + maxX ) / 2;
			logoMidY = ( minY + maxY ) / 2;
			for ( const pt of particles ) {
				logoRadius = Math.max( logoRadius, Math.hypot( pt.hx - logoMidX, pt.hy - logoMidY ) );
			}

			drawStatic();
			scheduleWave( WAVE_INTERVAL );
		};
		img.src = logoSrc;

		const setPointer = ( event: MouseEvent ) => {
			targetMouseX = ( event.clientX - bounds.left ) * bounds.scale;
			targetMouseY = ( event.clientY - bounds.top ) * bounds.scale;
			if ( mouseX < -1000 ) {
				mouseX = targetMouseX;
				mouseY = targetMouseY;
			}
		};
		const onMove = ( event: MouseEvent ) => {
			setPointer( event );
			ensureLoop();
		};
		const onEnter = ( event: MouseEvent ) => {
			hover = true;
			updateBounds();
			setPointer( event );
			ensureLoop();
		};
		const onLeave = () => {
			hover = false;
			mouseX = -9999;
			mouseY = -9999;
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
		const onReducedMotionChange = ( event: MediaQueryListEvent ) => {
			reducedMotion = event.matches;
			if ( reducedMotion ) {
				resetParticles();
				drawStatic();
			} else {
				scheduleWave( WAVE_INTERVAL );
			}
		};
		const onThemeChange = () => {
			readColors();
			if ( ! canAnimate() ) {
				drawStatic();
			} else {
				ensureLoop();
			}
		};

		const colorSchemeQuery =
			typeof window.matchMedia === 'function'
				? window.matchMedia( '(prefers-color-scheme: dark)' )
				: null;
		const themeObserver = new MutationObserver( onThemeChange );

		updateBounds();
		canvas.addEventListener( 'mousemove', onMove, { passive: true } );
		canvas.addEventListener( 'mouseenter', onEnter, { passive: true } );
		canvas.addEventListener( 'mouseleave', onLeave, { passive: true } );
		canvas.addEventListener( 'click', onClick );
		reducedMotionQuery?.addEventListener( 'change', onReducedMotionChange );
		colorSchemeQuery?.addEventListener( 'change', onThemeChange );
		themeObserver.observe( document.documentElement, {
			attributes: true,
			attributeFilter: [ 'class' ],
		} );

		return () => {
			cancelled = true;
			if ( raf !== null ) {
				cancelAnimationFrame( raf );
			}
			if ( waveTimeout !== null ) {
				window.clearTimeout( waveTimeout );
			}
			canvas.removeEventListener( 'mousemove', onMove );
			canvas.removeEventListener( 'mouseenter', onEnter );
			canvas.removeEventListener( 'mouseleave', onLeave );
			canvas.removeEventListener( 'click', onClick );
			reducedMotionQuery?.removeEventListener( 'change', onReducedMotionChange );
			colorSchemeQuery?.removeEventListener( 'change', onThemeChange );
			themeObserver.disconnect();
		};
	}, [ size, canvasSize ] );

	return (
		<div style={ { position: 'relative', width: size, height: size } }>
			<canvas
				ref={ canvasRef }
				width={ canvasSize }
				height={ canvasSize }
				style={ {
					position: 'absolute',
					top: '50%',
					left: '50%',
					width: canvasSize,
					height: canvasSize,
					transform: 'translate(-50%, -50%)',
					cursor: 'pointer',
					touchAction: 'none',
				} }
				aria-hidden="true"
			/>
		</div>
	);
}
