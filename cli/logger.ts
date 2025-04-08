import ora, { Ora } from 'ora';
import { OutputFormat } from 'cli/types';

export class LoggerError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'LoggerError';
	}
}

export class Logger< T extends string > {
	protected readonly outputFormat: OutputFormat;
	private spinner: Ora;
	private currentAction: T | null;

	constructor( outputFormat: OutputFormat ) {
		this.outputFormat = outputFormat;
		this.spinner = ora();
		this.currentAction = null;
	}

	public reportStart( action: T, message: string ) {
		this.currentAction = action;

		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action, status: 'inprogress', message } ) );
			return;
		}
		this.spinner.start( message );
	}

	public reportProgress( message: string ) {
		if ( this.outputFormat === 'json' ) {
			console.log(
				JSON.stringify( { action: this.currentAction, status: 'inprogress', message } )
			);
			return;
		}

		this.spinner.text = message;
	}

	public reportSuccess( message: string ) {
		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action: this.currentAction, status: 'success', message } ) );
		} else {
			this.spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportError( error: LoggerError ) {
		if ( this.outputFormat === 'json' ) {
			console.error(
				JSON.stringify( { action: this.currentAction, status: 'fail', message: error.message } )
			);
		} else {
			this.spinner.fail( error.message );
		}

		this.currentAction = null;
	}
}
