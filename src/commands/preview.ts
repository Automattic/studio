import { BaseCommand } from './base';

export class PreviewCommand extends BaseCommand {
	private siteFolder: string;

	constructor( siteFolder: string ) {
		super();
		this.siteFolder = siteFolder;
	}

	public run(): void {
		this.runCommand( [ 'go', this.siteFolder ] );
	}

	protected onError( error: null | string ): void {
		this.emit( 'error', error );
	}

	protected onOutput( output: string ): void {
		this.emit( 'output', output );
	}

	protected onSuccess(): void {
		this.emit( 'success' );
	}
}
