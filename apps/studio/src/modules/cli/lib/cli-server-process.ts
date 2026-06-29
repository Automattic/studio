import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { z } from 'zod';
import { executeCliCommand } from './execute-command';
import type { PlaygroundMount } from './cli-site-creator';

const cliEventSchema = z.object( {
	action: z.enum( SiteCommandLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
	message: z.string(),
} );

/**
 * A WordPressServerProcess implementation that delegates to CLI commands.
 * Used when a site is started via CLI and we need to represent it in the desktop app.
 */
export class CliServerProcess {
	url: string;

	private siteId: string;
	private sitePath: string;

	constructor( siteId: string, sitePath: string, siteUrl: string ) {
		this.siteId = siteId;
		this.sitePath = sitePath;
		this.url = siteUrl;
	}

	async start(
		options: { mounts?: PlaygroundMount[]; autoStart?: boolean } = {}
	): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const args = [
				'site',
				'start',
				'--path',
				this.sitePath,
				'--skip-browser',
				'--skip-log-details',
			];
			if ( options.mounts && options.mounts.length > 0 ) {
				args.push( '--mounts-json', JSON.stringify( options.mounts ) );
			}
			if ( options.autoStart === false ) {
				args.push( '--no-auto-start' );
			}
			const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: this.siteId } );

			emitter.on( 'data', ( { data } ) => {
				const parsed = cliEventSchema.safeParse( data );
				if ( parsed.success && parsed.data.status === 'inprogress' ) {
					console.log( `[CLI - ${ this.siteId }] ${ parsed.data.message }` );
				}
			} );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', ( { error } ) => {
				error.baseMessage = 'Failed to start site';
				reject( error );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}

	async stop(): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const [ emitter ] = executeCliCommand( [ 'site', 'stop', '--path', this.sitePath ], {
				output: 'capture',
				logPrefix: this.siteId,
			} );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', ( { error } ) => {
				error.baseMessage = 'Failed to stop site';
				reject( error );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}

	async delete( trashFiles: boolean ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const args = [
				'site',
				'delete',
				'--path',
				this.sitePath,
				trashFiles ? '--files' : '--no-files',
			];
			const [ emitter ] = executeCliCommand( args, {
				output: 'capture',
				logPrefix: this.siteId,
			} );

			emitter.on( 'success', () => {
				resolve();
			} );

			emitter.on( 'failure', ( { error } ) => {
				error.baseMessage = 'Failed to delete site';
				reject( error );
			} );

			emitter.on( 'error', ( { error } ) => {
				reject( error );
			} );
		} );
	}
}
