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
	if (
		input.type !== 'keyDown' ||
		! [ 'KeyK', 'KeyT' ].includes( input.code ) ||
		input.isAutoRepeat ||
		input.isComposing ||
		input.alt ||
		input.shift ||
		! primary ||
		! host ||
		host.isDestroyed()
	) {
		return false;
	}
	host.focus();
	host.sendInputEvent( {
		type: 'keyDown',
		keyCode: input.code.slice( 3 ),
		modifiers: [ platform === 'darwin' ? 'meta' : 'control' ],
	} );
	return true;
}
