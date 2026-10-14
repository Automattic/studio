import { SupportedTerminal, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { findOnPath } from 'src/lib/find-on-path';

/**
 * Finds the executable path for a given terminal on Linux by walking $PATH.
 */
export async function linuxFindTerminalPath(
	terminalKey: SupportedTerminal
): Promise< string | null > {
	const terminal = terminalConfig[ terminalKey ];
	if ( ! terminal?.linuxCommands?.length ) {
		return null;
	}

	for ( const command of terminal.linuxCommands ) {
		const found = findOnPath( command );
		if ( found ) {
			return found;
		}
	}

	return null;
}
