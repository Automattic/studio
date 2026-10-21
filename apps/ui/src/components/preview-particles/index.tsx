import { Icon, wordpress } from '@wordpress/icons';
import { useEffect, useRef } from 'react';
import { createPreviewDots, getPreviewDotFrame, type PreviewDot } from './frame';
import styles from './style.module.css';

/**
 * A grid of dots filling its positioned parent. While `active` the field
 * ripples and swirls, easing in and out; with `showLogo` the WordPress logo
 * sits in the middle. Static under reduced motion.
 */
export function PreviewParticles( {
	active = false,
	showLogo = false,
}: {
	active?: boolean;
	showLogo?: boolean;
} ) {
	const canvasRef = useRef< HTMLCanvasElement >( null );
	const activeRef = useRef( active );
	const syncRef = useRef< () => void >( undefined );

	useEffect( () => {
		activeRef.current = active;
		syncRef.current?.();
	}, [ active ] );

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
		let frame = 0;
		let lastDraw = 0;

		const draw = ( time: number ) => {
			context.clearRect( 0, 0, width, height );
			context.fillStyle = color;
			const amount = motion.matches ? 0 : strength * strength * ( 3 - 2 * strength );
			for ( const dot of dots ) {
				const point = getPreviewDotFrame( dot, {
					time,
					amount,
					centerX: width / 2,
					centerY: height / 2,
					clearCenter: showLogo,
				} );
				context.globalAlpha = point.opacity;
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
			draw( now );
			lastDraw = now;
			if ( activeRef.current || strength > 0 ) {
				frame = requestAnimationFrame( animate );
			}
		};
		const sync = () => {
			cancelAnimationFrame( frame );
			draw( performance.now() );
			if (
				! motion.matches &&
				! document.hidden &&
				width &&
				height &&
				( activeRef.current || strength > 0 )
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
	}, [ showLogo ] );

	return (
		<>
			<canvas ref={ canvasRef } className={ styles.canvas } aria-hidden="true" />
			{ showLogo ? (
				<span className={ styles.logo } data-active={ active || undefined } aria-hidden="true">
					<Icon icon={ wordpress } size={ 48 } />
				</span>
			) : null }
		</>
	);
}
