import type { WebContents } from 'electron';

export type AppZoomCommand = 'reset' | 'in' | 'out';

export function getAppZoomCommand(
	input: Electron.Input,
	platform: NodeJS.Platform = process.platform
): AppZoomCommand | null {
	if ( input.type !== 'keyDown' || input.isComposing || input.alt ) {
		return null;
	}

	const hasPrimaryModifier =
		platform === 'darwin' ? input.meta && ! input.control : input.control && ! input.meta;
	if ( ! hasPrimaryModifier ) {
		return null;
	}

	if ( input.key === '+' || input.key === '=' ) {
		return 'in';
	}
	if ( input.key === '-' || input.key === '_' ) {
		return 'out';
	}
	if ( input.key === '0' && ! input.shift ) {
		return 'reset';
	}

	return null;
}

export function applyAppZoomCommand( contents: WebContents, command: AppZoomCommand ) {
	if ( command === 'reset' ) {
		contents.setZoomLevel( 0 );
		return;
	}

	contents.setZoomLevel( contents.getZoomLevel() + ( command === 'in' ? 0.5 : -0.5 ) );
}
