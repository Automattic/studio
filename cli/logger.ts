import ora, { Ora } from 'ora';

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
	private spinner: Ora;
	private currentAction: T | 'keyValuePair' | null = null;

	constructor() {
		this.spinner = ora();
	}

	public reportStart( action: T, message: string ) {
		this.currentAction = action;

		if ( process.send ) {
			process.send( { action, status: 'inprogress', message } );
			return;
		}
		this.spinner.start( message );
	}

	public reportProgress( message: string ) {
		if ( process.send ) {
			process.send( { action: this.currentAction, status: 'inprogress', message } );
			return;
		}

		this.spinner.text = message;
	}

	public reportSuccess( message: string, shouldClearSpinner = false ) {
		if ( process.send ) {
			process.send( { action: this.currentAction, status: 'success', message } );
		} else if ( shouldClearSpinner ) {
			this.spinner.clear();
		} else {
			this.spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportWarning( message: string ) {
		if ( process.send ) {
			process.send( { action: this.currentAction, status: 'warning', message } );
		} else {
			this.spinner.warn( message );
		}
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( process.send ) {
			process.send( { action: this.currentAction, status: 'fail', message: error.message } );
		} else {
			this.spinner.fail( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		if ( process.send ) {
			process.send( { action: 'keyValuePair', key, value } );
		}
	}
}
