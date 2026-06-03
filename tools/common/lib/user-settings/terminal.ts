import { __ } from '@wordpress/i18n';

export const SUPPORTED_TERMINALS = [ 'terminal', 'iterm', 'warp', 'ghostty' ] as const;
export type SupportedTerminal = ( typeof SUPPORTED_TERMINALS )[ number ];

export type TerminalPlatform = 'darwin' | 'win32' | 'linux';

export type TerminalConfig = {
	name: () => string;
	platforms: TerminalPlatform[];
	linuxCommands: string[];
};

export const terminalConfig: Record< SupportedTerminal, TerminalConfig > = {
	terminal: {
		name: () => __( 'Terminal' ),
		platforms: [ 'darwin', 'linux', 'win32' ],
		linuxCommands: [ 'gnome-terminal' ],
	},
	iterm: {
		// translators: "iTerm" is the brand name for a terminal app and does not need to be translated
		name: () => __( 'iTerm' ),
		platforms: [ 'darwin' ],
		linuxCommands: [],
	},
	warp: {
		// translators: "Warp" is the brand name for a terminal app and does not need to be translated
		name: () => __( 'Warp' ),
		platforms: [ 'darwin', 'win32', 'linux' ],
		linuxCommands: [ 'warp-terminal' ],
	},
	ghostty: {
		// translators: "Ghostty" is the brand name for a terminal app and does not need to be translated
		name: () => __( 'Ghostty' ),
		platforms: [ 'darwin', 'linux' ],
		linuxCommands: [ 'ghostty' ],
	},
};

export function getTerminalsSupportedOnPlatform( platform: TerminalPlatform ): SupportedTerminal[] {
	return ( Object.keys( terminalConfig ) as SupportedTerminal[] ).filter( ( terminal ) =>
		terminalConfig[ terminal ].platforms.includes( platform )
	);
}

export function getTerminalName(
	terminal: SupportedTerminal | undefined,
	platform: TerminalPlatform
): string {
	if ( ! terminal ) {
		return '';
	}
	// translators: "Command Prompt" is the name of the terminal app on Windows.
	if ( 'terminal' === terminal && platform === 'win32' ) {
		return __( 'Command Prompt' );
	}
	return terminalConfig[ terminal ].name();
}
