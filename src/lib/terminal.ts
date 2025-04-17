export type SupportedTerminal = 'terminal' | 'iterm';

export const supportedTerminalNames: Record< SupportedTerminal, string > = {
	terminal: 'Terminal',
	iterm: 'iTerm',
};

export const DEFAULT_TERMINAL: SupportedTerminal = 'terminal';
