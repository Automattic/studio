import { __ } from '@wordpress/i18n';

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
