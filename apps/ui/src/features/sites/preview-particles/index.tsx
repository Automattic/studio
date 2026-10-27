import { useEffect, useRef } from 'react';
import { WordPressIcon } from '@/lib/icons';
import {
	createPreviewDots,
	getPreviewDotFrame,
	getSelectionWave,
	SELECTION_WAVE_DURATION,
	type PreviewDot,
} from './frame';
import styles from './style.module.css';

/**
 * A grid of dots filling its positioned parent. While `active` the field
 * ripples and swirls, easing in and out; with `showLogo` the WordPress logo
 * sits in the middle. A `selectionTime` sends a wave down a still field.
 * Static under reduced motion.
 */
export function PreviewParticles( {
	active = false,
	showLogo = false,
	selectionTime,
}: {
	active?: boolean;
	showLogo?: boolean;
	selectionTime?: number;
} ) {
	const canvasRef = useRef< HTMLCanvasElement >( null );
	const activeRef = useRef( active );
	const showLogoRef = useRef( showLogo );
	const selectionTimeRef = useRef( selectionTime );
	const syncRef = useRef< () => void >( undefined );

	useEffect( () => {
		activeRef.current = active;
		showLogoRef.current = showLogo;
		selectionTimeRef.current = selectionTime;
		syncRef.current?.();
	}, [ active, showLogo, selectionTime ] );

	useEffect( () => {
		const canvas = canvasRef.current;
		const host = canvas?.parentElement;
		const context = canvas?.getContext( '2d' );
		if ( ! canvas || ! host || ! context ) {
			return;
		}
		const motion = window.matchMedia( '(prefers-reduced-motion: reduce)' );
		let width = 0;
		let height = 0;
		let dots: PreviewDot[] = [];
		let color = '';
		let strength = activeRef.current ? 1 : 0;
		let logoStrength = activeRef.current && showLogoRef.current ? 1 : 0;
		let frame = 0;
		let lastDraw = 0;
		const waving = ( time: number ) =>
			! motion.matches &&
			! activeRef.current &&
			selectionTimeRef.current !== undefined &&
			time - selectionTimeRef.current < SELECTION_WAVE_DURATION;

		const draw = ( time: number ) => {
			context.clearRect( 0, 0, width, height );
			context.fillStyle = color;
			const amount = motion.matches ? 0 : strength * strength * ( 3 - 2 * strength );
			const logoAmount = logoStrength * logoStrength * ( 3 - 2 * logoStrength );
			for ( const dot of dots ) {
				const point = getPreviewDotFrame( dot, {
					time,
					amount,
					centerX: width / 2,
					centerY: height / 2,
					logoAmount,
				} );
				const highlight = waving( time )
					? getSelectionWave( dot, {
							elapsed: time - selectionTimeRef.current!,
							height,
							centerX: width / 2,
					  } )
					: 0;
				context.globalAlpha = Math.min( 1, point.opacity * ( 1 + highlight * 3 ) );
				context.beginPath();
				context.arc( point.x, point.y, 1, 0, Math.PI * 2 );
				context.fill();
			}
		};
		const animate = ( now: number ) => {
			const delta = Math.min( now - lastDraw, 64 );
			strength = Math.max(
				0,
				Math.min( 1, strength + ( activeRef.current ? delta / 400 : -delta / 300 ) )
			);
			logoStrength = Math.max(
				0,
				Math.min(
					1,
					logoStrength + ( activeRef.current && showLogoRef.current ? delta / 400 : -delta / 300 )
				)
			);
			draw( now );
			lastDraw = now;
			if ( activeRef.current || strength > 0 || logoStrength > 0 || waving( now ) ) {
				frame = requestAnimationFrame( animate );
			}
		};
		const sync = () => {
			cancelAnimationFrame( frame );
			if ( motion.matches ) {
				strength = 0;
				logoStrength = activeRef.current && showLogoRef.current ? 1 : 0;
			}
			draw( performance.now() );
			if (
				! motion.matches &&
				! document.hidden &&
				width &&
				height &&
				( activeRef.current || strength > 0 || logoStrength > 0 || waving( performance.now() ) )
			) {
				lastDraw = performance.now();
				frame = requestAnimationFrame( animate );
			}
		};
		const resize = () => {
			width = host.clientWidth;
			height = host.clientHeight;
			const scale = Math.min( window.devicePixelRatio || 1, 2 );
			canvas.width = Math.round( width * scale );
			canvas.height = Math.round( height * scale );
			context.setTransform( scale, 0, 0, scale, 0, 0 );
			color = getComputedStyle( canvas ).color;
			dots = createPreviewDots( width, height );
			sync();
		};
		syncRef.current = sync;
		const sizeObserver = new ResizeObserver( resize );
		const themeObserver = new MutationObserver( resize );
		sizeObserver.observe( host );
		themeObserver.observe( document.documentElement, { attributes: true } );
		motion.addEventListener( 'change', sync );
		document.addEventListener( 'visibilitychange', sync );
		resize();
		return () => {
			syncRef.current = undefined;
			cancelAnimationFrame( frame );
			sizeObserver.disconnect();
			themeObserver.disconnect();
			motion.removeEventListener( 'change', sync );
			document.removeEventListener( 'visibilitychange', sync );
		};
	}, [] );

	return (
		<>
			<canvas ref={ canvasRef } className={ styles.canvas } aria-hidden="true" />
			{ showLogo ? (
				<span className={ styles.logo } data-active={ active || undefined } aria-hidden="true">
					<WordPressIcon />
				</span>
			) : null }
		</>
	);
}
