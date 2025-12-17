import { executeCliCommand } from './execute-command';
import type { WordPressServerProcess } from 'src/lib/wordpress-server-types';

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
			const [ emitter ] = executeCliCommand( [
				'site',
				'start',
				'--path',
				this.sitePath,
				'--skip-browser',
			] );

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
}
