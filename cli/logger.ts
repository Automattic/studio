import { OutputFormat } from 'cli/types';

interface LoggerMessage< T extends string > {
	status: T;
	args?: Record< string, unknown >;
}

export class Logger< T extends string > {
	protected readonly outputFormat: OutputFormat;

	constructor( outputFormat: OutputFormat ) {
		this.outputFormat = outputFormat;
	}

	public reportProgress( message: LoggerMessage< T > ) {
		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( message ) );
		} else {
			if ( message.args ) {
				const argsString = Object.entries( message.args )
					.map( ( [ key, value ] ) => `${ key }: ${ value }` )
					.join( ', ' );
				console.log( `${ message.status } (${ argsString })` );
			} else {
				console.log( message.status );
			}
		}
	}

	public reportError( error: string ) {
		if ( this.outputFormat === 'json' ) {
			console.error( JSON.stringify( { error } ) );
		} else {
			console.error( error );
		}
	}
}
