import ora, { Ora } from 'ora';

const isIpcMode = Boolean( process.send );

function canSend(): boolean {
	return isIpcMode && !! process.send && process.connected;
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
	private _spinner: Ora;
	private currentAction: T | 'keyValuePair' | null = null;

	constructor() {
		this._spinner = ora();
	}

	/**
	 * Get the underlying ora spinner instance.
	 * Useful for sharing with other modules that need to update progress.
	 */
	public get spinner(): Ora {
		return this._spinner;
	}

	public reportStart( action: T, message: string ) {
		this.currentAction = action;

		if ( canSend() ) {
			process.send!( { action, status: 'inprogress', message } );
			return;
		}
		this._spinner.start( message );
	}

	public reportProgress( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'inprogress', message } );
			return;
		}

		// Update the spinner text and force render
		this._spinner.text = message;
		if ( ! this._spinner.isSpinning ) {
			this._spinner.start( message );
		} else {
			this._spinner.render();
		}
	}

	public reportSuccess( message: string, shouldClearSpinner = false ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'success', message } );
		} else if ( shouldClearSpinner ) {
			this._spinner.clear();
		} else {
			this._spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportWarning( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'warning', message } );
			return;
		}
		this._spinner.warn( message );
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'fail', message: error.message } );
		} else {
			this._spinner.fail( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		if ( canSend() ) {
			process.send!( { action: 'keyValuePair', key, value } );
		}
	}
}
