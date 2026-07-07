import fs from 'fs';
import chalk from '@studio/common/lib/chalk';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import { renderBannerBox } from 'cli/lib/banner-box';
import { updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

export const TOS_URL = 'https://wordpress.com/tos/';
export const PRIVACY_POLICY_URL = 'https://automattic.com/privacy/';

// Commands whose UI renders the notice natively (Studio Code TUI / JSON adapter).
const TUI_COMMANDS = new Set( [ 'code', 'ai' ] );

/**
 * Reads tosNoticeShownAt from cli.json synchronously (same pattern as
 * update-notifier's readUpdateCheck) so the banner can print before any
 * command output.
 */
export function readTosNoticeShownAt(): number | null {
	try {
		const content = fs.readFileSync( getCliConfigPath(), 'utf8' );
		const data = JSON.parse( content );
		return typeof data?.tosNoticeShownAt === 'number' ? data.tosNoticeShownAt : null;
	} catch {
		// File doesn't exist or is invalid — treat as never shown
	}
	return null;
}

export async function markTosNoticeShown(): Promise< void > {
	try {
		await updateCliConfigWithPartial( { tosNoticeShownAt: Date.now() } );
	} catch {
		// Non-critical; the notice will simply show again next run
	}
}

/**
 * Shared disclaimer copy. Used by the CLI stderr banner and the
 * Studio Code TUI welcome flow.
 */
export function formatTosNoticeLines(): string[] {
	return [
		__( 'By continuing, you agree to our Terms of Service and have read our Privacy Policy.' ),
		'',
		sprintf(
			/* translators: %s: Terms of Service URL */
			__( 'Terms of Service: %s' ),
			chalk.cyan( TOS_URL )
		),
		sprintf(
			/* translators: %s: Privacy Policy URL */
			__( 'Privacy Policy: %s' ),
			chalk.cyan( PRIVACY_POLICY_URL )
		),
	];
}

/**
 * Runs the Studio Code first-run gate: renders the notice via the provided
 * callback and persists the flag, unless running headless (IPC-spawned by the
 * desktop app, a remote-session daemon turn, or stderr is not a TTY — nobody
 * would see the notice, so it defers to the next visible run) or already shown.
 */
export async function maybeShowTosNotice( render: () => void ): Promise< void > {
	if (
		Boolean( process.send ) ||
		process.env.STUDIO_REMOTE_SESSION ||
		! process.stderr.isTTY ||
		readTosNoticeShownAt() !== null
	) {
		return;
	}
	try {
		render();
	} catch {
		// Rendering must never break the command; defer the notice.
		return;
	}
	await markTosNoticeShown();
}

/**
 * Prints a one-time ToS/Privacy disclaimer to stderr before any command runs.
 *
 * Suppressed when:
 * - spawned by the Studio desktop app (IPC mode) — the app shows its own disclaimer
 * - running the `code`/`ai` commands — the Studio Code UI renders it natively
 * - stderr is not a TTY (headless spawn, log redirect) — nobody would see the
 *   notice, so it defers to the next visible run
 * - the notice was already shown (tosNoticeShownAt set in cli.json)
 *
 * Unlike the update banner, this is NOT suppressed for --json: it writes to
 * stderr, which never corrupts machine-readable stdout.
 */
export async function setupTosNotice(): Promise< void > {
	// Scan all args rather than argv[2]: yargs accepts global options before the
	// command (e.g. `studio --path /tmp code`). A positional that happens to be
	// named "code"/"ai" only delays the notice to the next run, which is harmless.
	const isTuiCommand = process.argv.slice( 2 ).some( ( arg ) => TUI_COMMANDS.has( arg ) );
	if ( Boolean( process.send ) || isTuiCommand || ! process.stderr.isTTY ) {
		return;
	}

	if ( readTosNoticeShownAt() !== null ) {
		return;
	}

	const lines = formatTosNoticeLines().map( ( line, index ) =>
		index === 0 ? line : chalk.dim( line )
	);
	try {
		process.stderr.write( renderBannerBox( [ '', ...lines, '' ], chalk.blue ) );
	} catch {
		// EPIPE on a closed stderr must not crash startup; defer the notice.
		return;
	}
	await markTosNoticeShown();
}
