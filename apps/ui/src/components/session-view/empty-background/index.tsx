import { useEffect, useRef } from 'react';
import styles from './style.module.css';

// Standard WordPress "W-in-a-circle" mark. Rendered offscreen in black so the
// particle sampler below can threshold against pixel brightness.
const WP_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 122.52 122.523"><path fill="black" d="M8.708,61.26c0,20.802,12.089,38.779,29.619,47.298L13.258,40.165C10.342,46.698,8.708,53.785,8.708,61.26z M96.74,58.608c0-6.495-2.333-10.993-4.334-14.494c-2.664-4.329-5.161-7.995-5.161-12.324c0-4.831,3.664-9.328,8.825-9.328c0.233,0,0.454,0.029,0.681,0.042c-9.35-8.566-21.807-13.796-35.489-13.796c-18.36,0-34.513,9.42-43.91,23.688c1.233,0.037,2.395,0.063,3.382,0.063c5.497,0,14.006-0.667,14.006-0.667c2.833-0.167,3.167,3.994,0.337,4.329c0,0-2.847,0.335-6.015,0.501l19.138,56.925L60.718,72.15l-8.181-22.414c-2.83-0.166-5.511-0.501-5.511-0.501c-2.832-0.166-2.5-4.496,0.332-4.329c0,0,8.679,0.667,13.843,0.667c5.496,0,14.006-0.667,14.006-0.667c2.835-0.167,3.168,3.994,0.337,4.329c0,0-2.853,0.335-6.015,0.501l18.992,56.494l5.242-17.517C95.948,70.801,96.74,64.348,96.74,58.608z M62.184,65.92l-15.768,45.817c4.708,1.384,9.687,2.141,14.846,2.141c6.12,0,11.989-1.058,17.452-2.979c-0.141-0.225-0.269-0.464-0.374-0.724L62.184,65.92z M107.376,36.151c0.23,1.707,0.36,3.538,0.36,5.51c0,5.438-1.018,11.551-4.081,19.192l-16.386,47.38c15.954-9.3,26.69-26.595,26.69-46.396C113.958,52.503,111.596,43.752,107.376,36.151z M61.262,0C27.477,0,0,27.476,0,61.26c0,33.787,27.477,61.263,61.262,61.263c33.783,0,61.265-27.476,61.265-61.263C122.526,27.476,95.045,0,61.262,0z M61.262,119.715c-32.23,0-58.453-26.223-58.453-58.455c0-32.23,26.222-58.451,58.453-58.451c32.229,0,58.45,26.221,58.45,58.451C119.712,93.492,93.491,119.715,61.262,119.715z"/></svg>`;

const LOGO_SIZE = 320;
const PAD = 130;
const CANVAS_SIZE = LOGO_SIZE + PAD * 2;
const SAMPLE_STEP = 5;
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
		canvas.style.width = `${ CANVAS_SIZE }px`;
		canvas.style.height = `${ CANVAS_SIZE }px`;
		const ctx = canvas.getContext( '2d' );
		if ( ! ctx ) {
			return;
		}
		ctx.scale( dpr, dpr );

		const particles: Particle[] = [];
		let mouseX = -9999;
		let mouseY = -9999;
		let hover = false;
		let raf = 0;
		let cancelled = false;

		const off = document.createElement( 'canvas' );
		off.width = LOGO_SIZE;
		off.height = LOGO_SIZE;
		const offCtx = off.getContext( '2d', { willReadFrequently: true } );
		if ( ! offCtx ) {
			return;
		}

		const img = new Image();
		img.onload = () => {
			if ( cancelled ) {
				return;
			}
			const scale = Math.min( LOGO_SIZE / img.width, LOGO_SIZE / img.height ) * 0.92;
			const drawW = img.width * scale;
			const drawH = img.height * scale;
			const insetX = ( LOGO_SIZE - drawW ) / 2;
			const insetY = ( LOGO_SIZE - drawH ) / 2;

			offCtx.clearRect( 0, 0, LOGO_SIZE, LOGO_SIZE );
			offCtx.drawImage( img, insetX, insetY, drawW, drawH );
			const { data } = offCtx.getImageData( 0, 0, LOGO_SIZE, LOGO_SIZE );

			for ( let y = 0; y < LOGO_SIZE; y += SAMPLE_STEP ) {
				for ( let x = 0; x < LOGO_SIZE; x += SAMPLE_STEP ) {
					const idx = 4 * ( y * LOGO_SIZE + x );
					const a = data[ idx + 3 ];
					const brightness = ( data[ idx ] + data[ idx + 1 ] + data[ idx + 2 ] ) / 3;
					if ( a > 128 && brightness < 140 ) {
						particles.push( {
							x: PAD + x,
							y: PAD + y,
							hx: PAD + x,
							hy: PAD + y,
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
					const pull = Math.min( PULL_MAX, ( dh * PULL_MAX ) / PULL_RADIUS );

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
					ctx.fillRect( pt.x - DOT_SIZE / 2, pt.y - DOT_SIZE / 2, DOT_SIZE, DOT_SIZE );
				}
				raf = requestAnimationFrame( tick );
			};
			tick();
		};
		img.src = `data:image/svg+xml;utf8,${ encodeURIComponent( WP_LOGO_SVG ) }`;

		const onMove = ( event: MouseEvent ) => {
			const rect = canvas.getBoundingClientRect();
			mouseX = event.clientX - rect.left;
			mouseY = event.clientY - rect.top;
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
