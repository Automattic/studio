import { z } from 'zod';
import { SiteCommandLoggerAction } from 'common/logger-actions';
import { executeCliCommand } from './execute-command';
import type { WordPressServerProcess } from 'src/lib/wordpress-provider/types';

const cliEventSchema = z.object( {
	action: z.nativeEnum( SiteCommandLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
	message: z.string(),
} );

/**
 * A WordPressServerProcess implementation that delegates to CLI commands.
 * Used when a site is started via CLI and we need to represent it in the desktop app.
 */
export class CliServerProcess implements WordPressServerProcess {
	url: string;

	private siteId: string;
	private sitePath: string;

	constructor( siteId: string, sitePath: string, siteUrl: string ) {
		this.siteId = siteId;
		this.sitePath = sitePath;
		this.url = siteUrl;
	}

	async start(): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const [ emitter ] = executeCliCommand(
				[ 'site', 'start', '--path', this.sitePath, '--skip-browser' ],
				{ mode: 'capture-stdio', logPrefix: this.siteId }
			);

			emitter.on( 'data', ( { data } ) => {
				const parsed = cliEventSchema.safeParse( data );
				if ( parsed.success && parsed.data.status === 'inprogress' ) {
					console.log( `[CLI - ${ this.siteId }] ${ parsed.data.message }` );
				}
			} );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', () => {
				reject( new Error( `Failed to start site ${ this.siteId }` ) );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}

	async stop(): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const [ emitter ] = executeCliCommand( [ 'site', 'stop', '--path', this.sitePath ] );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', () => {
				reject( new Error( `Failed to stop site ${ this.siteId }` ) );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}

	async runPhp(): Promise< string > {
		throw new Error( 'runPhp is not supported for CLI-managed sites' );
	}

	async delete( deleteFiles: boolean ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const args = [ 'site', 'delete', '--path', this.sitePath ];
			if ( deleteFiles ) {
				args.push( '--files' );
			}
			const [ emitter ] = executeCliCommand( args );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', () => {
				reject( new Error( `Failed to delete site ${ this.siteId }` ) );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}
}
