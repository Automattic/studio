import { useEffect, useEffectEvent, type RefObject } from 'react';
import type { WebviewTag } from './preview-surface/webview';

async function readThumbnail( surface: HTMLElement ) {
	const guest = surface.querySelector< WebviewTag >( 'webview' );
	if ( guest ) {
		const width = guest.clientWidth;
		const height = Math.min( guest.clientHeight, Math.round( ( width * 10 ) / 16 ) );
		if ( ! width || ! height ) return null;
		const image = await guest.capturePage( { x: 0, y: 0, width, height } );
		if ( image.isEmpty() ) return null;
		return image.resize( { width: 480 } ).toDataURL();
	}
	const frame = surface.querySelector( 'iframe' );
	const page = frame ? frame.contentDocument?.body : surface;
	if ( ! page || ! page.clientWidth || ! page.clientHeight ) return null;
	const { toJpeg } = await import( 'html-to-image' );
	return toJpeg( page, {
		width: page.clientWidth,
		height: Math.min( page.clientHeight, ( page.clientWidth * 10 ) / 16 ),
		canvasWidth: 480,
		canvasHeight: 480 * Math.min( page.clientHeight / page.clientWidth, 10 / 16 ),
		pixelRatio: 1,
		quality: 0.82,
		skipFonts: true,
	} );
}

export function useTabThumbnail(
	viewport: RefObject< HTMLDivElement | null >,
	path: string,
	active: boolean,
	onThumbnail: ( ( path: string, image: string ) => void ) | undefined,
	rendered: boolean
) {
	const publish = useEffectEvent(
		( capturedPath: string, image: string ) => onThumbnail?.( capturedPath, image )
	);
	useEffect( () => {
		if ( ! active ) return;
		const surface = viewport.current?.querySelector< HTMLElement >(
			'[data-tab-surface]:not([inert])'
		);
		if ( ! surface ) return;
		let disposed = false;
		let revision = 0;
		let timer: ReturnType< typeof setTimeout >;
		const schedule = () => {
			const current = ++revision;
			clearTimeout( timer );
			timer = setTimeout( async () => {
				try {
					const image = await readThumbnail( surface );
					if ( image && ! disposed && revision === current ) publish( path, image );
				} catch {
					// A guest can navigate or close while its frame is being captured.
				}
			}, 250 );
		};
		schedule();
		const observer = rendered ? new MutationObserver( schedule ) : null;
		observer?.observe( surface, { subtree: true, childList: true, characterData: true } );
		surface.addEventListener( 'did-finish-load', schedule, true );
		return () => {
			disposed = true;
			clearTimeout( timer );
			observer?.disconnect();
			surface.removeEventListener( 'did-finish-load', schedule, true );
		};
	}, [ active, path, viewport, rendered ] );
}
