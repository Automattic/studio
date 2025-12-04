import { executeCliCommand } from './execute-command';
import type { WordPressServerProcess } from 'src/lib/wordpress-provider/types';

/**
 * A WordPressServerProcess implementation that delegates to CLI commands.
 * Used when a site is started via CLI and we need to represent it in the desktop app.
 */
export function createCliServerProcess(
	siteId: string,
	sitePath: string,
	siteUrl: string
): WordPressServerProcess {
	return {
		url: siteUrl,

		async start(): Promise< void > {
			return new Promise( ( resolve, reject ) => {
				const [ emitter ] = executeCliCommand( [
					'site',
					'start',
					'--path',
					sitePath,
					'--skip-browser',
				] );

				emitter.on( 'success', () => {
					resolve();
				} );

				emitter.on( 'failure', () => {
					reject( new Error( `Failed to start site ${ siteId }` ) );
				} );

				emitter.on( 'error', ( { error } ) => {
					reject( error );
				} );
			} );
		},

		async stop(): Promise< void > {
			return new Promise( ( resolve, reject ) => {
				const [ emitter ] = executeCliCommand( [ 'site', 'stop', '--path', sitePath ] );

				emitter.on( 'success', () => {
					resolve();
				} );

				emitter.on( 'failure', () => {
					reject( new Error( `Failed to stop site ${ siteId }` ) );
				} );

				emitter.on( 'error', ( { error } ) => {
					reject( error );
				} );
			} );
		},

		async runPhp(): Promise< string > {
			throw new Error( 'runPhp is not supported for CLI-managed sites' );
		},
	};
}
