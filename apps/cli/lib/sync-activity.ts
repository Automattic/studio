import { spawnSync } from 'node:child_process';
import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { CLI_ACCEPTS_STOP_REQUESTS, isCliStopRequest } from '@studio/common/lib/cli-process';
import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import { emitCliEvent } from 'cli/lib/daemon-client';
import type { SyncActivity, SyncEvent } from '@studio/common/lib/sync/activity';

let latest: SyncEvent | undefined;

export function reportSyncActivity( siteId: string, activity: SyncActivity ): Promise< void > {
	latest = { siteId, activity };
	return emitCliEvent( { event: SYNC_EVENTS.ACTIVITY, data: latest } );
}

/**
 * Hosts cancel a sync by asking the CLI process running it to stop: SIGTERM, or on Windows, where
 * signals can't be caught, a stop request over IPC. Other SIGTERM listeners suppress Node's default
 * exit, so exit here, unless the sync is past the point where stopping is safe.
 */
export function exitOnCancel(): void {
	// A host that quits mid-sync closes our output pipes. Writing to them would crash a sync that
	// has to finish, like a pull halfway through rewriting the local site.
	for ( const stream of [ process.stdout, process.stderr ] ) {
		stream.on( 'error', () => undefined );
	}
	const cancel = () => {
		if ( ! latest ) {
			exit();
			return;
		}
		const { siteId, activity } = latest;
		if ( ! canCancelSyncActivity( activity ) ) {
			return;
		}
		void reportSyncActivity( siteId, { kind: 'cancelled', direction: activity.direction } ).finally(
			exit
		);
	};
	process.on( 'SIGTERM', cancel );
	if ( process.send ) {
		process.on( 'message', ( message ) => isCliStopRequest( message ) && cancel() );
		// Listening for messages would otherwise keep the process alive once the sync is done.
		process.channel?.unref();
		process.send( CLI_ACCEPTS_STOP_REQUESTS );
	}
}

function exit() {
	// php.exe's own subprocesses aren't in the job object Windows ends with this process, so end
	// the whole tree, as hosts do when they stop a command outright.
	if ( process.platform === 'win32' ) {
		spawnSync( 'taskkill', [ '/F', '/T', '/PID', String( process.pid ) ], {
			windowsHide: true,
			stdio: 'ignore',
		} );
	}
	process.exit( 1 );
}
