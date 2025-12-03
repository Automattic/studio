import ora, { Ora } from 'ora';

const isIpcMode = Boolean( process.send );

function safeSend( message: unknown ): boolean {
	if ( process.send && process.connected ) {
		process.send( message );
		return true;
	}
	return isIpcMode;
}

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

		if ( safeSend( { action, status: 'inprogress', message } ) ) {
			return;
		}
		this.spinner.start( message );
	}

	public reportProgress( message: string ) {
		if ( safeSend( { action: this.currentAction, status: 'inprogress', message } ) ) {
			return;
		}

		this.spinner.text = message;
	}

	public reportSuccess( message: string, shouldClearSpinner = false ) {
		if ( safeSend( { action: this.currentAction, status: 'success', message } ) ) {
			// Message sent via IPC
		} else if ( shouldClearSpinner ) {
			this.spinner.clear();
		} else {
			this.spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportWarning( message: string ) {
		if ( ! safeSend( { action: this.currentAction, status: 'warning', message } ) ) {
			this.spinner.warn( message );
		}
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( ! safeSend( { action: this.currentAction, status: 'fail', message: error.message } ) ) {
			this.spinner.fail( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		safeSend( { action: 'keyValuePair', key, value } );
	}
}
