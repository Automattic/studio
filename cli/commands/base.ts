export type OutputFormat = undefined | 'json';

export abstract class BaseCommand {
	protected abstract readonly STATUSES: Record< string, string >;
	protected readonly outputFormat: OutputFormat;

	constructor( outputFormat: OutputFormat ) {
		this.outputFormat = outputFormat;
	}

	protected reportProgress( status: keyof typeof this.STATUSES ) {
		if ( this.outputFormat === 'json' ) {
			console.log( JSON.stringify( { status } ) );
		} else {
			console.log( status );
		}
	}

	protected reportError( error: string ) {
		if ( this.outputFormat === 'json' ) {
			console.error( JSON.stringify( { error } ) );
		} else {
			console.error( error );
		}
	}
}
