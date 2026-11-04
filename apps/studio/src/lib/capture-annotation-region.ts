import { webContents, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import {
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	type StudioChatImage,
} from '@studio/agent/protocol/chat-images';
import {
	parseInspectorSelection,
	type InspectorSelection,
} from '@studio/agent/protocol/inspector/selection';

const captures = new Map< number, string >();

export async function captureAnnotationRegion(
	event: IpcMainInvokeEvent,
	request: { guestId: number; selection: InspectorSelection }
): Promise< StudioChatImage > {
	const selection = parseInspectorSelection( request?.selection );
	const guest = Number.isInteger( request?.guestId ) ? webContents.fromId( request.guestId ) : null;
	if (
		! selection ||
		! guest ||
		guest.isDestroyed() ||
		guest.hostWebContents !== event.sender ||
		guest.getURL() !== selection.target.url ||
		captures.has( guest.id )
	) {
		throw new Error( 'The annotated preview is no longer available.' );
	}
	const token = randomUUID();
	captures.set( guest.id, token );
	let timedOut = false;
	let timer: ReturnType< typeof setTimeout > | undefined;
	const input = JSON.stringify( {
		id: selection.id,
		url: selection.target.url,
		viewport: selection.target.viewport,
		scroll: selection.scroll,
	} );
	const check = `const expected = ${ input };
		const host = document.getElementById('__studio-inspector-host');
		if (!host || host.dataset.captureId !== expected.id || location.href !== expected.url ||
			innerWidth !== expected.viewport.width || innerHeight !== expected.viewport.height ||
			Math.abs(scrollX - expected.scroll.left) > 1 || Math.abs(scrollY - expected.scroll.top) > 1)
			throw new Error('The annotated page changed. Select the area again.');`;
	const restore = async () => {
		if ( guest.isDestroyed() ) return;
		await guest
			.executeJavaScript(
				`(() => {
			const host = document.getElementById('__studio-inspector-host');
			if (host?.getAttribute('data-capturing') === ${ JSON.stringify(
				token
			) }) host.removeAttribute('data-capturing');
		})()`
			)
			.catch( () => undefined );
	};
	try {
		const image = await Promise.race( [
			( async () => {
				try {
					await guest.executeJavaScript( `(async () => { ${ check }
					host.setAttribute('data-capturing', ${ JSON.stringify( token ) });
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				})()` );
					if ( timedOut ) throw new Error( 'Annotation capture cancelled.' );
					const { left, top, width, height } = selection.rect;
					const captured = await guest.capturePage( { x: left, y: top, width, height } );
					await guest.executeJavaScript( `(() => { ${ check } })()` );
					return captured;
				} finally {
					await restore();
				}
			} )(),
			new Promise< never >( ( _, reject ) => {
				timer = setTimeout( () => {
					timedOut = true;
					reject( new Error( 'The annotation screenshot timed out. Try again.' ) );
				}, 10_000 );
			} ),
		] );
		if ( image.isEmpty() ) throw new Error( 'The annotation screenshot was empty. Try again.' );
		let output = image;
		const size = output.getSize();
		if ( Math.max( size.width, size.height ) > 2000 ) {
			output = output.resize( size.width >= size.height ? { width: 2000 } : { height: 2000 } );
		}
		let png = output.toPNG();
		while (
			png.length > STUDIO_CHAT_MAX_IMAGE_BYTES &&
			Math.max( output.getSize().width, output.getSize().height ) > 128
		) {
			output = output.resize( {
				width: Math.max( 1, Math.floor( output.getSize().width * 0.75 ) ),
			} );
			png = output.toPNG();
		}
		if ( png.length > STUDIO_CHAT_MAX_IMAGE_BYTES )
			throw new Error( 'The annotation screenshot is too large.' );
		return {
			id: randomUUID(),
			name: selection.target.kind === 'drawing' ? 'Drawing.png' : 'Selected area.png',
			mimeType: 'image/png',
			size: png.length,
			...output.getSize(),
			dataBase64: png.toString( 'base64' ),
		};
	} finally {
		clearTimeout( timer );
		if ( captures.get( guest.id ) === token ) captures.delete( guest.id );
		void restore();
	}
}
