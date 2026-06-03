import { useEffect, useRef } from 'react';
import styles from './style.module.css';
import logoSrc from './wordpress-logo.webp';

const SIZE = 320;
const PAD = 130;
const CANVAS_SIZE = SIZE + PAD * 2;
const RES = 6;
const RECT_SIZE = 4;
const MOTION_RADIUS = 240;
const MOTION_PUSH = 74;
const MOTION_DRIFT = 34;
const MOTION_SWIRL = 30;
const POINTER_EASE = 0.05;
const SPRING = 0.028;
const DAMPING = 0.88;
const BLUE: [ number, number, number ] = [ 56, 88, 233 ];
const LIGHT_BLUE: [ number, number, number ] = [ 220, 230, 255 ];
const WAVE_INTERVAL = 9000;
const WAVE_DURATION = 2300;
const WAVE_BAND = 0.38;
const RIPPLE_DURATION = 1900;
const RIPPLE_BAND = 22;
const RIPPLE_PUSH = 46;
const MAX_RIPPLES = 4;

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	hx: number;
	hy: number;
	cx: number;
	cy: number;
};
type Ripple = { x: number; y: number; start: number };

export function EmptyBackground() {
	const canvasRef = useRef< HTMLCanvasElement >( null );

	useEffect( () => {
		const canvas = canvasRef.current;
		if ( ! canvas ) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		canvas.width = CANVAS_SIZE * dpr;
		canvas.height = CANVAS_SIZE * dpr;
		canvas.style.setProperty( '--empty-background-canvas-size', `${ CANVAS_SIZE }px` );
		const ctx = canvas.getContext( '2d' );
		if ( ! ctx ) {
			return;
		}
		ctx.scale( dpr, dpr );
		ctx.imageSmoothingEnabled = false;

		const particles: Particle[] = [];
		let mouseX = -9999;
		let mouseY = -9999;
		let targetMouseX = -9999;
		let targetMouseY = -9999;
		let hover = false;
		let raf = 0;
		let cancelled = false;
		const ripples: Ripple[] = [];

		const img = new Image();
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

			const scale = Math.min( SIZE / img.width, SIZE / img.height ) * 0.92;
			const drawW = img.width * scale;
			const drawH = img.height * scale;
			const offsetX = ( CANVAS_SIZE - drawW ) / 2;
			const offsetY = ( CANVAS_SIZE - drawH ) / 2;

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
						} );
					}
				}
			}

			let minX = Infinity,
				minY = Infinity,
				maxX = -Infinity,
				maxY = -Infinity;
			for ( const pt of particles ) {
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
			let logoRadius = 1;
			for ( const pt of particles ) {
				pt.cx = pt.hx - logoMidX;
				pt.cy = pt.hy - logoMidY;
				const r = Math.hypot( pt.cx, pt.cy );
				if ( r > logoRadius ) {
					logoRadius = r;
				}
			}

			const start = performance.now();
			let lastCycle = -1;
			let waveCos = 1;
			let waveSin = 0;

			const tick = () => {
				ctx.clearRect( 0, 0, CANVAS_SIZE, CANVAS_SIZE );
				const timestamp = performance.now();
				const elapsed = timestamp - start;
				for ( let i = ripples.length - 1; i >= 0; i-- ) {
					if ( timestamp - ripples[ i ].start > RIPPLE_DURATION ) {
						ripples.splice( i, 1 );
					}
				}
				const cycleIdx = Math.floor( elapsed / WAVE_INTERVAL );
				if ( cycleIdx !== lastCycle ) {
					lastCycle = cycleIdx;
					const ang = Math.random() * Math.PI * 2;
					waveCos = Math.cos( ang );
					waveSin = Math.sin( ang );
				}
				const cycleMs = elapsed % WAVE_INTERVAL;
				const waveT =
					cycleMs <= WAVE_DURATION
						? ( cycleMs / WAVE_DURATION ) * ( 1 + WAVE_BAND * 2 ) - WAVE_BAND
						: -99;
				let motionX = 0;
				let motionY = 0;
				if ( hover ) {
					const nextMouseX = mouseX + ( targetMouseX - mouseX ) * POINTER_EASE;
					const nextMouseY = mouseY + ( targetMouseY - mouseY ) * POINTER_EASE;
					motionX = nextMouseX - mouseX;
					motionY = nextMouseY - mouseY;
					mouseX = nextMouseX;
					mouseY = nextMouseY;
				}
				const motionDistance = Math.hypot( motionX, motionY );
				const motionEnergy = Math.min( 1, motionDistance / 9 );
				const motionDirX = motionDistance > 0.0001 ? motionX / motionDistance : 0;
				const motionDirY = motionDistance > 0.0001 ? motionY / motionDistance : 0;

				for ( const pt of particles ) {
					let targetX = pt.hx;
					let targetY = pt.hy;
					const dx = pt.hx - mouseX;
					const dy = pt.hy - mouseY;
					const d = Math.hypot( dx, dy ) || 0.0001;
					const proximity = hover ? Math.max( 0, 1 - d / MOTION_RADIUS ) : 0;
					const motionInfluence = proximity * proximity * ( 3 - 2 * proximity );
					const wakeInfluence = motionInfluence * motionEnergy;
					let rippleIntensity = 0;

					if ( motionInfluence > 0 ) {
						targetX += ( dx / d ) * MOTION_PUSH * motionInfluence;
						targetY += ( dy / d ) * MOTION_PUSH * motionInfluence;
					}

					if ( wakeInfluence > 0 && motionDistance > 0.0001 ) {
						const side = Math.sign( dx * motionDirY - dy * motionDirX ) || 1;
						const swirl = MOTION_SWIRL * wakeInfluence * side;
						targetX += motionDirX * MOTION_DRIFT * wakeInfluence - motionDirY * swirl;
						targetY += motionDirY * MOTION_DRIFT * wakeInfluence + motionDirX * swirl;
					}

					for ( const ripple of ripples ) {
						const t = Math.min( 1, ( timestamp - ripple.start ) / RIPPLE_DURATION );
						const eased = 1 - Math.pow( 1 - t, 3 );
						const radius = eased * logoRadius * 2.35;
						const rdx = pt.hx - ripple.x;
						const rdy = pt.hy - ripple.y;
						const rd = Math.hypot( rdx, rdy ) || 0.0001;
						const band = RIPPLE_BAND + t * 12;
						const bandDistance = Math.abs( rd - radius );

						if ( bandDistance < band ) {
							const intensity = ( 1 - bandDistance / band ) * ( 1 - t );
							rippleIntensity = Math.max( rippleIntensity, intensity );
							targetX += ( rdx / rd ) * intensity * RIPPLE_PUSH;
							targetY += ( rdy / rd ) * intensity * RIPPLE_PUSH;
						}
					}

					pt.vx += ( targetX - pt.x ) * SPRING;
					pt.vy += ( targetY - pt.y ) * SPRING;
					pt.vx *= DAMPING;
					pt.vy *= DAMPING;
					pt.x += pt.vx;
					pt.y += pt.vy;

					const proj = ( pt.cx * waveCos + pt.cy * waveSin ) / logoRadius;
					const waveCoord = ( proj + 1 ) / 2;
					let intensity = 0;
					const dw = Math.abs( waveCoord - waveT );
					if ( dw < WAVE_BAND ) {
						intensity = ( 1 - dw / WAVE_BAND ) * ( 0.45 + Math.random() * 0.55 );
					}
					intensity = Math.max( intensity, rippleIntensity, wakeInfluence * 0.65 );
					const r = BLUE[ 0 ] + ( LIGHT_BLUE[ 0 ] - BLUE[ 0 ] ) * intensity;
					const g = BLUE[ 1 ] + ( LIGHT_BLUE[ 1 ] - BLUE[ 1 ] ) * intensity;
					const b = BLUE[ 2 ] + ( LIGHT_BLUE[ 2 ] - BLUE[ 2 ] ) * intensity;
					const size = RECT_SIZE + rippleIntensity * 1.6 + wakeInfluence * 0.8;
					ctx.fillStyle = `rgb(${ r }, ${ g }, ${ b })`;
					ctx.fillRect( pt.x - size / 2, pt.y - size / 2, size, size );
				}
				raf = requestAnimationFrame( tick );
			};
			tick();
		};
		img.src = logoSrc;

		const setPointerFromEvent = ( event: MouseEvent ) => {
			const rect = canvas.getBoundingClientRect();
			const scale = rect.width > 0 ? CANVAS_SIZE / rect.width : 1;
			targetMouseX = ( event.clientX - rect.left ) * scale;
			targetMouseY = ( event.clientY - rect.top ) * scale;
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
			const rect = canvas.getBoundingClientRect();
			const scale = rect.width > 0 ? CANVAS_SIZE / rect.width : 1;
			ripples.push( {
				x: ( event.clientX - rect.left ) * scale,
				y: ( event.clientY - rect.top ) * scale,
				start: performance.now(),
			} );
			if ( ripples.length > MAX_RIPPLES ) {
				ripples.splice( 0, ripples.length - MAX_RIPPLES );
			}
		};
		canvas.addEventListener( 'mousemove', onMove );
		canvas.addEventListener( 'mouseenter', onEnter );
		canvas.addEventListener( 'mouseleave', onLeave );
		canvas.addEventListener( 'click', onClick );

		return () => {
			cancelled = true;
			cancelAnimationFrame( raf );
			canvas.removeEventListener( 'mousemove', onMove );
			canvas.removeEventListener( 'mouseenter', onEnter );
			canvas.removeEventListener( 'mouseleave', onLeave );
			canvas.removeEventListener( 'click', onClick );
		};
	}, [] );

	return (
		<div className={ styles.root } aria-hidden="true">
			<canvas ref={ canvasRef } className={ styles.canvas } />
		</div>
	);
}
