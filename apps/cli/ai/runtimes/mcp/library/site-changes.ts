import { fork, type ChildProcess } from 'child_process';
import { cliSiteEventSchema } from '@studio/common/lib/cli-events';

const SITE_CHANGES_WAIT_MS = 50_000;
const SITE_CHANGES_SETTLE_MS = 300;

// Site changes made anywhere (the agent, a terminal, the desktop app) arrive
// through `_events`; each settled burst bumps `revision`, which the page waits on.
export function createSiteWatcher() {
	let revision = 0;
	let events: ChildProcess | undefined;
	let settling: NodeJS.Timeout | undefined;
	const waiters = new Set< () => void >();

	return async ( since?: number ) => {
		if ( ! events ) {
			events = fork( process.argv[ 1 ], [ '_events', '--listener', 'mcp' ], {
				stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
			} );
			events.on( 'message', ( message ) => {
				if ( cliSiteEventSchema.safeParse( message ).success ) {
					clearTimeout( settling );
					settling = setTimeout( () => {
						revision += 1;
						waiters.forEach( ( wake ) => wake() );
					}, SITE_CHANGES_SETTLE_MS );
				}
			} );
			events.on( 'exit', () => ( events = undefined ) );
		}
		if ( since === revision ) {
			await new Promise< void >( ( resolve ) => {
				const wake = () => {
					clearTimeout( timer );
					waiters.delete( wake );
					resolve();
				};
				const timer = setTimeout( wake, SITE_CHANGES_WAIT_MS );
				waiters.add( wake );
			} );
		}
		return revision;
	};
}
