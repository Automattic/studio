import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import type { WebviewTag } from './preview-surface/webview';

async function drawEmbeddedFrame(
	surface: HTMLElement,
	height: number,
	canvas: HTMLCanvasElement,
	toCanvas: typeof import('html-to-image').toCanvas
) {
	const frame = surface.querySelector( 'iframe' );
	const body = frame?.contentDocument?.body;
	if ( ! body || ! frame?.clientWidth || ! frame.clientHeight ) return;
	const context = canvas.getContext( '2d' );
	if ( ! context ) return;
	const surfaceBox = surface.getBoundingClientRect();
	const frameBox = frame.getBoundingClientRect();
	const scale = surfaceBox.width ? canvas.width / surfaceBox.width : 0;
	const frameScale = frameBox.height / frame.clientHeight;
	const top = Math.max( surfaceBox.top, frameBox.top );
	const bottom = Math.min( surfaceBox.top + height, frameBox.bottom );
	if ( ! scale || ! frameScale || bottom <= top ) return;
	try {
		// html-to-image loses the iframe body's background when it clones the frame.
		const image = await toCanvas( body, {
			width: frame.clientWidth,
			height: ( bottom - top ) / frameScale,
			style: {
				height: `${ frame.clientHeight }px`,
				transform: `translateY(-${ ( top - frameBox.top ) / frameScale }px)`,
			},
			canvasWidth: frameBox.width * scale,
			canvasHeight: ( bottom - top ) * scale,
			pixelRatio: 1,
			skipFonts: true,
		} );
		const x = ( frameBox.left - surfaceBox.left ) * scale;
		const y = ( frameBox.top - surfaceBox.top ) * scale;
		const radius = parseFloat( getComputedStyle( frame ).borderRadius ) * scale || 0;
		context.save();
		context.beginPath();
		context.roundRect( x, y, frameBox.width * scale, frameBox.height * scale, radius );
		context.clip();
		context.drawImage( image, x, ( top - surfaceBox.top ) * scale );
		context.restore();
	} catch {
		// An email can contain resources that the browser cannot capture.
	}
}

async function readThumbnail( surface: HTMLElement, rendered: boolean ) {
	const guest = rendered ? null : surface.querySelector< WebviewTag >( 'webview' );
	if ( guest ) {
		const width = guest.clientWidth;
		const height = Math.min( guest.clientHeight, Math.round( ( width * 10 ) / 16 ) );
		if ( ! width || ! height ) return null;
		const image = await guest.capturePage( { x: 0, y: 0, width, height } );
		if ( image.isEmpty() ) return null;
		return image.resize( { width: 480 } ).toDataURL();
	}
	const frame = rendered ? null : surface.querySelector( 'iframe' );
	const design = surface.querySelector< HTMLElement >( '[data-design-surface]' );
	const page =
		( design?.firstElementChild as HTMLElement | null ) ??
		( frame ? frame.contentDocument?.body : surface );
	const viewport = design ?? page;
	if ( ! page || ! viewport?.clientWidth || ! viewport.clientHeight ) return null;
	const height = Math.min( viewport.clientHeight, ( viewport.clientWidth * 10 ) / 16 );
	const { toCanvas } = await import( 'html-to-image' );
	const canvas = await toCanvas( page, {
		width: viewport.clientWidth,
		height,
		canvasWidth: 480,
		canvasHeight: ( 480 * height ) / viewport.clientWidth,
		pixelRatio: 1,
		skipFonts: true,
		style: design?.scrollTop
			? { height: `${ page.scrollHeight }px`, transform: `translateY(-${ design.scrollTop }px)` }
			: undefined,
	} );
	if ( rendered ) await drawEmbeddedFrame( surface, height, canvas, toCanvas );
	return canvas.toDataURL( 'image/jpeg', 0.82 );
}

export function useTabThumbnail(
	viewport: RefObject< HTMLDivElement | null >,
	path: string,
	active: boolean,
	onThumbnail: ( ( path: string, image: string ) => void ) | undefined,
	rendered: boolean
) {
	const captureState = useRef( { revision: 0 } );
	const publish = useEffectEvent(
		( capturedPath: string, image: string ) => onThumbnail?.( capturedPath, image )
	);
	useLayoutEffect( () => {
		if ( ! active ) return;
		const state = captureState.current;
		const surface = viewport.current?.querySelector< HTMLElement >(
			'[data-tab-surface]:not([inert])'
		);
		if ( ! surface ) return;
		let disposed = false;
		let timer: ReturnType< typeof setTimeout >;
		const capture = async ( current: number, outgoing = false ) => {
			try {
				const image = await readThumbnail( surface, rendered );
				if (
					image &&
					state.revision === current &&
					( ! disposed || ( outgoing && surface.isConnected ) )
				)
					publish( path, image );
			} catch {
				// A guest can navigate or close while its frame is being captured.
			}
		};
		const schedule = () => {
			const current = ++state.revision;
			clearTimeout( timer );
			timer = setTimeout( () => void capture( current ), 250 );
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
			const pane = surface.closest< HTMLElement >( '[data-active-tab]' );
			if ( ! pane?.isConnected ) return;
			const current = ++state.revision;
			// A hidden webview cannot finish capturing; keep it paintable until this settles.
			pane.dataset.capturingThumbnail = String( current );
			const release = () => {
				if ( pane.dataset.capturingThumbnail === String( current ) )
					pane.removeAttribute( 'data-capturing-thumbnail' );
			};
			const timeout = setTimeout( () => {
				if ( state.revision === current ) state.revision++;
				release();
			}, 1500 );
			void capture( current, true ).finally( () => {
				clearTimeout( timeout );
				release();
			} );
		};
	}, [ active, path, viewport, rendered ] );
}
