import { spawn } from 'node:child_process';
import { findOnPath } from '@studio/common/lib/user-settings/installed-apps';
import { resolveLinuxTerminalLaunch } from '@studio/common/lib/user-settings/terminal';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

/**
 * Opens `cwd` in a terminal on Linux. Most terminals keep running until their window closes, so the
 * terminal is detached from Studio: the call settles once it starts, closing Studio (or Ctrl+C on
 * `studio ui`) doesn't close it, and its output isn't buffered.
 */
export async function openLinuxTerminal(
	preferredTerminal: SupportedTerminal,
	cwd: string
): Promise< void > {
	const launch = resolveLinuxTerminalLaunch( preferredTerminal, cwd, findOnPath );
	if ( ! launch ) {
		throw new Error( 'No supported terminal emulator found on $PATH' );
	}

	await new Promise< void >( ( resolve, reject ) => {
		const child = spawn( launch.file, launch.args, {
			cwd: launch.cwd,
			detached: true,
			stdio: 'ignore',
		} );
		child.once( 'error', reject );
		child.once( 'spawn', () => {
			child.unref();
			resolve();
		} );
	} );
}
