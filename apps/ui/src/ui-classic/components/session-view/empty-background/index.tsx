import { useEffect, useRef } from 'react';
import styles from './style.module.css';
import logoSrc from './wordpress-logo.webp';

const SIZE = 320;
const PAD = 130;
const CANVAS_SIZE = SIZE + PAD * 2;
const RES = 5;
const DOT_SIZE = 5;
const REPEL_RADIUS = 120;
const REPEL_MAX = 28;
const PULL_RADIUS = 120;
const PULL_MAX = 6;
const BLUE: [ number, number, number ] = [ 56, 88, 233 ];
const LIGHT_BLUE: [ number, number, number ] = [ 220, 230, 255 ];
const WAVE_INTERVAL = 9000;
const WAVE_DURATION = 2300;
const WAVE_BAND = 0.38;

type Particle = { x: number; y: number; hx: number; hy: number; cx: number; cy: number };

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
		let hover = false;
		let raf = 0;
		let cancelled = false;

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
				const now = performance.now() - start;
				const cycleIdx = Math.floor( now / WAVE_INTERVAL );
				if ( cycleIdx !== lastCycle ) {
					lastCycle = cycleIdx;
					const ang = Math.random() * Math.PI * 2;
					waveCos = Math.cos( ang );
					waveSin = Math.sin( ang );
				}
				const cycleMs = now % WAVE_INTERVAL;
				const waveT =
					cycleMs <= WAVE_DURATION
						? ( cycleMs / WAVE_DURATION ) * ( 1 + WAVE_BAND * 2 ) - WAVE_BAND
						: -99;

				for ( const pt of particles ) {
					const dx = pt.x - mouseX;
					const dy = pt.y - mouseY;
					const d = Math.hypot( dx, dy ) || 0.0001;
					const hdx = pt.hx - pt.x;
					const hdy = pt.hy - pt.y;
					const dh = Math.hypot( hdx, hdy ) || 0.0001;

					const push = hover
						? Math.max( 0, Math.min( REPEL_MAX, REPEL_MAX - ( d * REPEL_MAX ) / REPEL_RADIUS ) )
						: 0;
					const pull = ( dh * PULL_MAX ) / PULL_RADIUS;

					pt.x += ( dx / d ) * push + ( hdx / dh ) * pull;
					pt.y += ( dy / d ) * push + ( hdy / dh ) * pull;

					const proj = ( pt.cx * waveCos + pt.cy * waveSin ) / logoRadius;
					const waveCoord = ( proj + 1 ) / 2;
					let intensity = 0;
					const dw = Math.abs( waveCoord - waveT );
					if ( dw < WAVE_BAND ) {
						intensity = ( 1 - dw / WAVE_BAND ) * ( 0.45 + Math.random() * 0.55 );
					}
					const r = BLUE[ 0 ] + ( LIGHT_BLUE[ 0 ] - BLUE[ 0 ] ) * intensity;
					const g = BLUE[ 1 ] + ( LIGHT_BLUE[ 1 ] - BLUE[ 1 ] ) * intensity;
					const b = BLUE[ 2 ] + ( LIGHT_BLUE[ 2 ] - BLUE[ 2 ] ) * intensity;
					ctx.fillStyle = `rgb(${ r }, ${ g }, ${ b })`;
					ctx.beginPath();
					ctx.arc( pt.x, pt.y, DOT_SIZE / 2, 0, Math.PI * 2 );
					ctx.fill();
				}
				raf = requestAnimationFrame( tick );
			};
			tick();
		};
		img.src = logoSrc;

		const onMove = ( event: MouseEvent ) => {
			const rect = canvas.getBoundingClientRect();
			const scale = rect.width > 0 ? CANVAS_SIZE / rect.width : 1;
			mouseX = ( event.clientX - rect.left ) * scale;
			mouseY = ( event.clientY - rect.top ) * scale;
		};
		const onEnter = () => {
			hover = true;
		};
		const onLeave = () => {
			hover = false;
			mouseX = -9999;
			mouseY = -9999;
		};
		canvas.addEventListener( 'mousemove', onMove );
		canvas.addEventListener( 'mouseenter', onEnter );
		canvas.addEventListener( 'mouseleave', onLeave );

		return () => {
			cancelled = true;
			cancelAnimationFrame( raf );
			canvas.removeEventListener( 'mousemove', onMove );
			canvas.removeEventListener( 'mouseenter', onEnter );
			canvas.removeEventListener( 'mouseleave', onLeave );
		};
	}, [] );

	return (
		<div className={ styles.root } aria-hidden="true">
			<canvas ref={ canvasRef } className={ styles.canvas } />
		</div>
	);
}
