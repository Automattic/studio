import ora, { Ora } from 'ora';

const isIpcMode = Boolean( process.send );

type ProgressCallback = ( message: string ) => void;
let progressCallback: ProgressCallback | null = null;

export function setProgressCallback( callback: ProgressCallback | null ): void {
	progressCallback = callback;
}

export function emitProgress( message: string ): void {
	progressCallback?.( message );
}

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
	public spinner: Ora;
	private currentAction: T | 'keyValuePair' | null = null;

	constructor() {
		this.spinner = ora();
	}

	public reportStart( action: T, message: string ) {
		this.currentAction = action;

		if ( canSend() ) {
			process.send!( { action, status: 'inprogress', message } );
			return;
		}
		if ( progressCallback ) {
			progressCallback!( message );
			return;
		}
		this.spinner.start( message );
	}

	public reportProgress( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'inprogress', message } );
			return;
		}

		if ( progressCallback ) {
			progressCallback!( message );
			return;
		}

		// Update the spinner text and force render
		this.spinner.text = message;
		if ( ! this.spinner.isSpinning ) {
			this.spinner.start( message );
		} else {
			this.spinner.render();
		}
	}

	public reportSuccess( message: string, shouldClearSpinner = false ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'success', message } );
		} else if ( progressCallback ) {
			progressCallback!( message );
		} else if ( shouldClearSpinner ) {
			this.spinner.clear();
		} else {
			this.spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportWarning( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'warning', message } );
			return;
		}
		if ( progressCallback ) {
			progressCallback!( message );
			return;
		}
		this.spinner.warn( message );
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'fail', message: error.message } );
		} else if ( progressCallback ) {
			progressCallback!( error.message );
		} else {
			this.spinner.fail( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		if ( canSend() ) {
			process.send!( { action: 'keyValuePair', key, value } );
		}
	}
}
