import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

/**
 * Terminal notifications for `studio code`: writes OSC 9 to stderr when an
 * agent turn finishes or pauses to ask a question, so terminals that
 * support it (Warp, iTerm2, etc.) can show a system notification.
 * Unsupported terminals just ignore the escape code.
 *
 * Auto-enabled on terminals known to render OSC 9 well (see
 * NOTIFICATION_CAPABLE_TERM_PROGRAMS below); silent everywhere else by
 * default. The `/notifications` command cycles a three-way override on top
 * of detection: unset (auto-detect) → true (always on) → false (always
 * off) → back to unset.
 *
 * Suppressed when forked by the Studio desktop app over IPC (it has its own
 * native OS notification path) or when stderr isn't a TTY. Uses stderr
 * rather than stdout because stdout is the documented NDJSON event stream
 * for `studio code --json` — see `tos-notice.ts` for the same split.
 */

// Terminals confirmed to render OSC 9 as a system notification rather than
// ignoring it outright. Matched against `TERM_PROGRAM`, which each of these
// sets to identify itself.
const NOTIFICATION_CAPABLE_TERM_PROGRAMS = new Set( [
	'WarpTerminal',
	'iTerm.app',
	'WezTerm',
	'ghostty',
] );

// Kitty doesn't set TERM_PROGRAM; it identifies itself via TERM instead. Ghostty
// is matched here too as a fallback: TERM_PROGRAM isn't forwarded over SSH by
// default, but TERM always is, so this still catches Ghostty-over-SSH.
const NOTIFICATION_CAPABLE_TERMS = new Set( [ 'xterm-ghostty', 'xterm-kitty' ] );

export function isNotificationCapableTerminal(): boolean {
	const termProgram = process.env.TERM_PROGRAM;
	if ( termProgram !== undefined && NOTIFICATION_CAPABLE_TERM_PROGRAMS.has( termProgram ) ) {
		return true;
	}
	const term = process.env.TERM;
	return term !== undefined && NOTIFICATION_CAPABLE_TERMS.has( term );
}

export async function getNotificationsPreference(): Promise< boolean | undefined > {
	const config = await readCliConfig();
	return config.notificationsEnabled;
}

export async function areNotificationsEnabled(): Promise< boolean > {
	const preference = await getNotificationsPreference();
	if ( preference !== undefined ) {
		return preference;
	}
	return isNotificationCapableTerminal();
}

export async function setNotificationsEnabled( enabled: boolean | undefined ): Promise< void > {
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
		// No bare BEL: on unsupported terminals it's an audible beep, unlike
		// OSC 9 alone, which is silently ignored.
		process.stderr.write( `\x1b]9;${ message }\x07` );
	} catch {
		// Never let a notification failure break the CLI.
	}
}
