import { isRTL } from '@wordpress/i18n';
import { useLayoutEffect, useState } from 'react';
import { useFullscreen } from '@/data/host/use-fullscreen';
import { useConnector } from '@/data/core';

export function useSidebarWindowButtons( docked: boolean, open: boolean ) {
	const connector = useConnector();
	const fullscreen = useFullscreen();
	const rtl = isRTL();
	const [ contents, setContents ] = useState< HTMLElement | null >( null );
	const setButtons = connector.reservesTrafficLightSpace
		? connector.setTrafficLightState
		: undefined;

	useLayoutEffect( () => {
		if ( ! setButtons ) return;
		const popup = contents?.parentElement;
		// In RTL the sidebar is on the right; macOS controls stay on the physical left.
		if ( fullscreen || docked || ! popup || rtl ) {
			const visible = ! fullscreen && ( docked || ( rtl && open ) );
			const update = () => void setButtons( visible );
			update();
			if ( visible ) {
				window.addEventListener( 'resize', update );
				return () => window.removeEventListener( 'resize', update );
			}
			return;
		}

		let frame = 0;
		let lastX: number | null | undefined;
		let lastY: number | undefined;
		let lastScale: number | undefined;
		// The native buttons live outside the renderer. Follow the popup through
		// both transitions, including an exit that reverses before it finishes.
		const sample = () => {
			cancelAnimationFrame( frame );
			const bounds = popup.getBoundingClientRect();
			const visible =
				! popup.closest( '[hidden]' ) &&
				bounds.width > 0 &&
				bounds.right > 0 &&
				bounds.left < window.innerWidth;
			const x = visible ? Math.round( bounds.left ) : null;
			const y = Math.round( bounds.top );
			const scale = window.devicePixelRatio;
			if ( x !== lastX || y !== lastY || scale !== lastScale ) {
				lastX = x;
				lastY = y;
				lastScale = scale;
				void setButtons( x !== null, x === null ? undefined : { x, y } );
			}
			if ( popup.getAnimations?.().some( ( animation ) => animation.playState === 'running' ) ) {
				frame = requestAnimationFrame( sample );
			}
		};

		const observer = new ResizeObserver( sample );
		observer.observe( popup );
		popup.addEventListener( 'transitionrun', sample );
		popup.addEventListener( 'transitionend', sample );
		window.addEventListener( 'resize', sample );
		frame = requestAnimationFrame( sample );
		return () => {
			cancelAnimationFrame( frame );
			observer.disconnect();
			popup.removeEventListener( 'transitionrun', sample );
			popup.removeEventListener( 'transitionend', sample );
			window.removeEventListener( 'resize', sample );
		};
	}, [ setButtons, contents, docked, open, fullscreen, rtl ] );

	useLayoutEffect(
		() => () => {
			void setButtons?.( false );
		},
		[ setButtons ]
	);
	return setButtons ? setContents : undefined;
}
