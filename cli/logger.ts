import ora, { Ora } from 'ora';
import { OutputFormat } from 'cli/types';

export class LoggerError extends Error {
	previousError?: Error;
	private errorMessage: string;

	constructor( message: string, previousError?: unknown ) {
		super();
		this.name = 'LoggerError';
		this.errorMessage = message;

		if ( previousError instanceof Error ) {
			this.previousError = previousError;
		}
	}

	get message(): string {
		if ( this.previousError ) {
			return `${ this.errorMessage }: ${ this.previousError.message }`;
		}

		return this.errorMessage;
	}
}

export class Logger< T extends string > {
	protected readonly outputFormat: OutputFormat;
	private spinner: Ora;
	private currentAction: T | 'keyValuePair' | null;

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

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( this.outputFormat === 'json' ) {
			console.error(
				JSON.stringify( { action: this.currentAction, status: 'fail', message: error.message } )
			);
		} else {
			this.spinner.fail( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action: 'keyValuePair', key, value } ) );
		}
	}
}
