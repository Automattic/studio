import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { createCliRunner, type CliRunner } from '@studio/common/lib/cli-process';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

// The spawn mechanics now live in `@studio/common/lib/cli-process` so the
// desktop app and the `studio ui` local server fork the CLI exactly the same
// way. This module is the desktop's thin binding: it injects how the desktop
// resolves the bundled CLI + Node binaries, routes errors to Sentry, and tears
// down forked children on app quit. Re-exports keep existing imports
// (`executeCliCommand`, `CliCommandError`, `CliCommandResult`) unchanged.
export { CliCommandError, type CliCommandResult } from '@studio/common/lib/cli-process';

let runner: CliRunner | undefined;

function getRunner(): CliRunner {
	if ( ! runner ) {
		const cliRunner = createCliRunner( {
			cliBinary: getCliPath(),
			nodeBinary: getBundledNodeBinaryPath(),
			onError: ( error ) => Sentry.captureException( error ),
		} );
		// `child.kill()` only terminates the forked CLI; the runner's killAll walks
		// the tree on Windows so php.exe descendants don't orphan.
		app.on( 'will-quit', () => cliRunner.killAll() );
		runner = cliRunner;
	}
	return runner;
}

export const executeCliCommand: CliRunner[ 'executeCliCommand' ] = ( (
	args: string[],
	options?: Parameters< CliRunner[ 'executeCliCommand' ] >[ 1 ]
) => getRunner().executeCliCommand( args, options ) ) as CliRunner[ 'executeCliCommand' ];
