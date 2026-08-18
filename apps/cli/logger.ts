import 'cli/lib/picospinner-stderr-patch';
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
	// Machine-readable failure code for analytics classification (see `classifyImportFailure` /
	// `classifyExportFailure`). The message is `__()`-translated display text and unsafe to match on.
	readonly code?: string;
	private errorMessage: string;

	constructor( message: string, previousError?: unknown, code?: string ) {
		super();
		this.name = 'LoggerError';
		this.errorMessage = message;
		this.code = code;

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
		} else if ( progressCallback ) {
			progressCallback( message );
		} else {
			this.spinner.setText( message );
			if ( ! this.spinner.running ) {
				this.spinner.start();
			}
		}
	}

	public reportProgress( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'inprogress', message } );
		} else if ( progressCallback ) {
			progressCallback( message, true );
		} else {
			if ( ! this.spinner.running ) {
				this.spinner.start();
			}
			this.spinner.setText( message );
		}
	}

	public reportSuccess( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'success', message } );
		} else if ( progressCallback ) {
			progressCallback( message );
		} else {
			if ( ! this.spinner.running ) {
				this.spinner.start();
			}
			this.spinner.succeed( message );
		}

		this.currentAction = null;
	}

	public reportWarning( message: string ) {
		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'warning', message } );
		} else if ( progressCallback ) {
			progressCallback( message );
		} else {
			if ( ! this.spinner.running ) {
				this.spinner.start();
			}
			this.spinner.warn( message );
		}
	}

	public reportError( error: LoggerError, isFatal = true ) {
		if ( isFatal ) {
			process.exitCode = 1;
		}

		if ( canSend() ) {
			process.send!( { action: this.currentAction, status: 'fail', message: error.message } );
		} else if ( progressCallback ) {
			progressCallback( error.message );
		} else {
			if ( ! this.spinner.running ) {
				this.spinner.start();
			}
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
