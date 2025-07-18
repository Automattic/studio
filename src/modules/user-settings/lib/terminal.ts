import { __ } from '@wordpress/i18n';
import { isWindows } from 'src/lib/app-globals';

export type SupportedTerminal = 'terminal' | 'iterm' | 'warp' | 'ghostty';

export const supportedTerminalNames: Record< SupportedTerminal, string > = {
	terminal: __( 'Terminal' ),
	// translators: "iTerm" is the brand name for a terminal app and does not need to be translated
	iterm: __( 'iTerm' ),
	// translators: "Warp" is the brand name for a terminal app and does not need to be translated
	warp: __( 'Warp' ),
	// translators: "Ghostty" is the brand name for a terminal app and does not need to be translated
	ghostty: __( 'Ghostty' ),
};

export function getTerminalName( terminal: SupportedTerminal | undefined ): string {
	if ( ! terminal ) {
		return '';
	}

	// translators: "Command Prompt" is the name of the terminal app on Windows.
	if ( 'terminal' === terminal && isWindows() ) {
		return __( 'Command Prompt' );
	}

	return supportedTerminalNames[ terminal ];
}
