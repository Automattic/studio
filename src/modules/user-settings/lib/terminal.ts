import { __ } from '@wordpress/i18n';

export type SupportedTerminal = 'terminal' | 'iterm' | 'warp' | 'ghostty';

const getPlatform = (): NodeJS.Platform | null => {
	if ( typeof window !== 'undefined' && window?.studio?.platform ) {
		// Renderer process
		return window.studio.platform;
	} else if ( typeof process !== 'undefined' ) {
		// Main process
		return process.platform;
	}

	return null;
};

export const supportedTerminalNames: Record< SupportedTerminal, string > = {
	terminal: getPlatform() === 'win32' ? __( 'Command Prompt' ) : __( 'Terminal' ),
	// translators: "iTerm" is the brand name for a terminal app and does not need to be translated
	iterm: __( 'iTerm' ),
	// translators: "Warp" is the brand name for a terminal app and does not need to be translated
	warp: __( 'Warp' ),
	// translators: "Ghostty" is the brand name for a terminal app and does not need to be translated
	ghostty: __( 'Ghostty' ),
};

export const DEFAULT_TERMINAL: SupportedTerminal = 'terminal';
