import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

/**
 * Opt-in terminal notifications for `studio code`: writes BEL + OSC 9 to
 * stderr when an agent turn finishes or pauses to ask a question, so
 * terminals that support it (Warp, iTerm2, etc.) can flash a tab or show a
 * system notification. Unsupported terminals just ignore the escape codes.
 *
 * Off by default; enable with the `/notifications` slash command.
 *
 * Suppressed when forked by the Studio desktop app over IPC (it has its own
 * native OS notification path) or when stderr isn't a TTY. Uses stderr
 * rather than stdout because stdout is the documented NDJSON event stream
 * for `studio code --json` — see `tos-notice.ts` for the same split.
 */
export async function areNotificationsEnabled(): Promise< boolean > {
	const config = await readCliConfig();
	return config.notificationsEnabled === true;
}

export async function setNotificationsEnabled( enabled: boolean ): Promise< void > {
	await updateCliConfigWithPartial( { notificationsEnabled: enabled } );
}

export async function notifyTerminal( message: string ): Promise< void > {
	if ( typeof process.send === 'function' ) {
		// Running under the Studio desktop app's IPC — not a real terminal.
		return;
	}

	if ( ! process.stderr.isTTY ) {
		// No attached terminal to notify (piped/redirected stderr).
		return;
	}

	try {
		if ( ! ( await areNotificationsEnabled() ) ) {
			return;
		}
		process.stderr.write( `\x1b]9;${ message }\x07` );
		process.stderr.write( '\x07' );
	} catch {
		// Never let a notification failure break the CLI.
	}
}
