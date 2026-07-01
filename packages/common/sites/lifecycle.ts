import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// Start / stop a local site's server via the Studio CLI's one-shot `site start`
// / `site stop` commands. The desktop runs sites through its own long-lived
// `SiteServer` and doesn't use these; the `studio ui` server (which has no such
// supervised process) does.

/** Start a local site's server via the Studio CLI. */
export function startSite( execute: ExecuteCliCommand, sitePath: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute(
			[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
			{ output: 'capture' }
		);
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to start site';
			reject( error );
		} );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

/** Stop a local site's server via the Studio CLI. */
export function stopSite( execute: ExecuteCliCommand, sitePath: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute( [ 'site', 'stop', '--path', sitePath ], {
			output: 'capture',
		} );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to stop site';
			reject( error );
		} );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}
