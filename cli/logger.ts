export type OutputFormat = undefined | 'json';

export class Logger< T extends string > {
	protected readonly outputFormat: OutputFormat;

	constructor( outputFormat: OutputFormat ) {
		this.outputFormat = outputFormat;
	}

	public reportProgress( status: T ) {
		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { status } ) );
		} else {
			console.log( status );
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
