import { Spinner } from 'picospinner';

const isIpcMode = Boolean( process.send );

type ProgressCallback = ( message: string, update?: boolean ) => void;
let progressCallback: ProgressCallback | null = null;

export function setProgressCallback( callback: ProgressCallback | null ): void {
	progressCallback = callback;
}

export function getProgressCallback(): ProgressCallback | null {
	return progressCallback;
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
	public spinner: Spinner;
	private currentAction: T | 'keyValuePair' | null = null;

	constructor() {
		this.spinner = new Spinner();
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
		this.spinner.setText( message );
		if ( ! this.spinner.running ) {
			this.spinner.start();
		}
	}

	public reportProgress( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'inprogress', message } );
			return;
		}

		if ( progressCallback ) {
			progressCallback!( message, true );
			return;
		}

		// Update the spinner text and force render
		this.spinner.setText( message );
		if ( ! this.spinner.running ) {
			this.spinner.start();
		} else {
			this.spinner.refresh();
		}
	}

	public reportSuccess( message: string, shouldClearSpinner = false ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'success', message } );
		} else if ( progressCallback ) {
			progressCallback!( message );
		} else if ( shouldClearSpinner ) {
			this.spinner.stop();
		} else if ( this.spinner.running ) {
			this.spinner.succeed( message );
		} else {
			console.log( message );
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
		if ( this.spinner.running ) {
			this.spinner.warn( message );
		} else {
			console.warn( message );
		}
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'fail', message: error.message } );
		} else if ( progressCallback ) {
			progressCallback!( error.message );
		} else if ( this.spinner.running ) {
			this.spinner.fail( error.message );
		} else {
			console.error( error.message );
		}

		this.currentAction = null;
	}

	public reportKeyValuePair( key: string, value: string ) {
		if ( canSend() ) {
			process.send!( { action: 'keyValuePair', key, value } );
		}
	}
}
