import type { WebContents } from 'electron';

// Hand app shortcuts back to the window when the preview page has focus.
export function forwardPreviewShortcut(
	guest: WebContents,
	input: Electron.Input,
	platform: NodeJS.Platform = process.platform
) {
	const primary =
		platform === 'darwin' ? input.meta && ! input.control : input.control && ! input.meta;
	const host = guest.hostWebContents;
	const annotation = input.code === 'Period' && input.shift;
	if (
		input.type !== 'keyDown' ||
		( ! [ 'KeyK', 'KeyT' ].includes( input.code ) && ! annotation ) ||
		input.isAutoRepeat ||
		input.isComposing ||
		input.alt ||
		( input.shift && ! annotation ) ||
		! primary ||
		! host ||
		host.isDestroyed()
	) {
		return false;
	}
	host.focus();
	host.sendInputEvent( {
		type: 'keyDown',
		keyCode: annotation ? '.' : input.code.slice( 3 ),
		modifiers: [
			platform === 'darwin' ? 'meta' : 'control',
			...( annotation ? [ 'shift' as const ] : [] ),
		],
	} );
	return true;
}
