import { __ } from '@wordpress/i18n';
import { getAppGlobals, isWindows } from 'src/lib/app-globals';

export type SupportedTerminal = 'terminal' | 'iterm' | 'warp' | 'ghostty';

type TerminalPlatform = 'darwin' | 'win32' | 'linux';

type TerminalConfig = {
	name: string;
	platforms: TerminalPlatform[];
};

export const terminalConfig: Record< SupportedTerminal, TerminalConfig > = {
	terminal: {
		name: __( 'Terminal' ),
		platforms: [ 'darwin', 'linux', 'win32' ],
	},
	iterm: {
		// translators: "iTerm" is the brand name for a terminal app and does not need to be translated
		name: __( 'iTerm' ),
		platforms: [ 'darwin' ],
	},
	warp: {
		// translators: "Warp" is the brand name for a terminal app and does not need to be translated
		name: __( 'Warp' ),
		platforms: [ 'darwin', 'win32', 'linux' ],
	},
	ghostty: {
		// translators: "Ghostty" is the brand name for a terminal app and does not need to be translated
		name: __( 'Ghostty' ),
		platforms: [ 'darwin', 'linux' ],
	},
};

export function getTerminalsSupportedOnPlatform(): SupportedTerminal[] {
	const platform = getAppGlobals().platform as TerminalPlatform;
	return ( Object.keys( terminalConfig ) as SupportedTerminal[] ).filter( ( terminal ) =>
		terminalConfig[ terminal ].platforms.includes( platform )
	);
}

export function getTerminalName( terminal: SupportedTerminal | undefined ): string {
	if ( ! terminal ) {
		return '';
	}

	// translators: "Command Prompt" is the name of the terminal app on Windows.
	if ( 'terminal' === terminal && isWindows() ) {
		return __( 'Command Prompt' );
	}

	return terminalConfig[ terminal ].name;
}
