export type SupportedTerminal = 'terminal' | 'iterm' | 'warp';

export const supportedTerminalNames: Record< SupportedTerminal, string > = {
	terminal: 'Terminal',
	iterm: 'iTerm',
	warp: 'Warp',
};

export const DEFAULT_TERMINAL: SupportedTerminal = 'terminal';
