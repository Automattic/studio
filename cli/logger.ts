import ora, { Ora } from 'ora';
import { OutputFormat } from 'cli/types';

export class LoggerError< T extends string > extends Error {
	constructor(
		message: string,
		public action: T
	) {
		super( message );
		this.name = 'LoggerError';
		this.action = action;
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
		if ( this.currentAction ) {
			throw new Error( 'Cannot report start when an action is already in progress' );
		}

		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action, status: 'inprogress', message } ) );
			return;
		}

		this.currentAction = action;
		this.spinner.start( message );
	}

	public reportProgress( action: T, message: string ) {
		if ( this.currentAction !== action ) {
			throw new Error( 'Cannot report progress for an action that is not currently in progress' );
		}

		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action, status: 'inprogress', message } ) );
			return;
		}

		this.spinner.text = message;
	}

	public reportSuccess( action: T, message: string ) {
		if ( this.currentAction !== action ) {
			throw new Error( 'Cannot report success for an action that is not currently in progress' );
		}

		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { action, status: 'success', message } ) );
			return;
		}

		this.spinner.succeed( message );
		this.currentAction = null;
	}

	public reportError( error: LoggerError< T > ) {
		if ( this.currentAction !== error.action ) {
			throw new Error( 'Cannot report error for an action that is not currently in progress' );
		}

		if ( this.outputFormat === 'json' ) {
			console.error(
				JSON.stringify( { action: error.action, status: 'fail', message: error.message } )
			);
			return;
		}

		this.spinner.fail( error.message );
		this.currentAction = null;
	}
}
