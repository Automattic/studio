export type SupportedTerminal = 'terminal' | 'iterm' | 'warp' | 'ghostty';

export const supportedTerminalNames: Record< SupportedTerminal, string > = {
	terminal: 'Terminal',
	iterm: 'iTerm',
	warp: 'Warp',
	ghostty: 'Ghostty',
};

export const DEFAULT_TERMINAL: SupportedTerminal = 'terminal';
