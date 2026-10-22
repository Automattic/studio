import { __ } from '@wordpress/i18n';

export const SUPPORTED_TERMINALS = [ 'terminal', 'iterm', 'warp', 'ghostty' ] as const;
export type SupportedTerminal = ( typeof SUPPORTED_TERMINALS )[ number ];

// What an unset terminal preference resolves to.
export const DEFAULT_TERMINAL: SupportedTerminal = 'terminal';

export type TerminalPlatform = 'darwin' | 'win32' | 'linux';

// Terminal emulators tried, in order, when "Terminal" is chosen on Linux, where there's no single
// system terminal. The standard launchers come first so the desktop's default wins; the rest cover
// the common desktop environments' own terminals. Every launch also gets the folder as its cwd, so
// a terminal whose working-directory flag we don't know (or that has none) still opens there.
const LINUX_SYSTEM_TERMINALS: { command: string; args: ( cwd: string ) => string[] }[] = [
	{ command: 'xdg-terminal-exec', args: () => [] },
	{ command: 'x-terminal-emulator', args: () => [] },
	{ command: 'gnome-terminal', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'ptyxis', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'kgx', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'konsole', args: ( cwd ) => [ '--workdir', cwd ] },
	{ command: 'xfce4-terminal', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'mate-terminal', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'tilix', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'terminator', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'lxterminal', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'qterminal', args: ( cwd ) => [ '--workdir', cwd ] },
	{ command: 'alacritty', args: ( cwd ) => [ '--working-directory', cwd ] },
	{ command: 'kitty', args: ( cwd ) => [ '--directory', cwd ] },
	{ command: 'foot', args: ( cwd ) => [ `--working-directory=${ cwd }` ] },
	{ command: 'wezterm', args: ( cwd ) => [ 'start', '--cwd', cwd ] },
	{ command: 'xterm', args: () => [] },
];

export type TerminalConfig = {
	name: () => string;
	platforms: TerminalPlatform[];
	linuxCommands: string[];
	// Arguments that open the terminal in `cwd` on Linux. "Terminal" has none: it resolves to the
	// first of `LINUX_SYSTEM_TERMINALS` found, each with its own.
	linuxArgs?: ( cwd: string ) => string[];
};

export const terminalConfig: Record< SupportedTerminal, TerminalConfig > = {
	terminal: {
		name: () => __( 'Terminal' ),
		platforms: [ 'darwin', 'linux', 'win32' ],
		linuxCommands: LINUX_SYSTEM_TERMINALS.map( ( { command } ) => command ),
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
		// Warp ignores `--working-directory`, its URL scheme's `path=` and the spawn cwd
		// (warpdotdev/Warp#4974, #6357); launching with `cwd` set is the best we can do.
		linuxArgs: () => [],
	},
	ghostty: {
		// translators: "Ghostty" is the brand name for a terminal app and does not need to be translated
		name: () => __( 'Ghostty' ),
		platforms: [ 'darwin', 'linux' ],
		linuxCommands: [ 'ghostty' ],
		linuxArgs: ( cwd ) => [ `--working-directory=${ cwd }` ],
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

export type LinuxTerminalLaunch = { file: string; args: string[]; cwd: string };

/**
 * Resolves how to open `cwd` in a terminal on Linux: the preferred terminal if it's on $PATH, else
 * the first system terminal found. `findOnPath` returns a command's absolute path, or `null`.
 * Returns `null` when no known terminal is installed.
 */
export function resolveLinuxTerminalLaunch(
	preferredTerminal: SupportedTerminal,
	cwd: string,
	findOnPath: ( command: string ) => string | null
): LinuxTerminalLaunch | null {
	const { linuxCommands, linuxArgs } = terminalConfig[ preferredTerminal ];
	if ( linuxArgs ) {
		for ( const command of linuxCommands ) {
			const file = findOnPath( command );
			if ( file ) {
				return { file, args: linuxArgs( cwd ), cwd };
			}
		}
	}

	for ( const { command, args } of LINUX_SYSTEM_TERMINALS ) {
		const file = findOnPath( command );
		if ( file ) {
			return { file, args: args( cwd ), cwd };
		}
	}

	return null;
}
