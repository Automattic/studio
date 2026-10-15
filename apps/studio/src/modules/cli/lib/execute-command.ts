import { app } from 'electron';
import * as Sentry from '@sentry/electron/main';
import {
	createCliRunner,
	type CliRunner,
	type ExecuteCliCommand,
} from '@studio/common/lib/cli-process';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

// Origin tag passed to every app-spawned CLI process so its Tracks events are attributed to the
// desktop app (v2, the Agentic UI). Read by the CLI in `apps/cli/lib/tracks.ts`.
// Also used by agent runs, which fork the CLI through `ai/run-manager.ts` instead.
export function getTracksOriginEnv(): string {
	return 'studio-ui:v2';
}

let runner: CliRunner | undefined;

function getRunner(): CliRunner {
	if ( ! runner ) {
		const cliRunner = createCliRunner( {
			cliBinary: getCliPath(),
			nodeBinary: getBundledNodeBinaryPath(),
			env: { STUDIO_TRACKS_ORIGIN: getTracksOriginEnv() },
			echoStderr: true,
			onError: ( error ) => Sentry.captureException( error ),
		} );
		app.on( 'will-quit', () => cliRunner.killAll() );
		runner = cliRunner;
	}
	return runner;
}

export const executeCliCommand = ( ( args, options ) =>
	getRunner().executeCliCommand( args, options ) ) as ExecuteCliCommand;
