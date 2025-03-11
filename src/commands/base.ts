import { spawn, ChildProcess } from 'child_process';
import eventEmitter from 'events';

export abstract class BaseCommand extends eventEmitter {
	protected abstract onError( error: null | string ): void;
	protected abstract onOutput( output: string ): void;
	protected abstract onSuccess(): void;
	protected abstract run(): void;

	protected parseOutput( data: Buffer ): string | null {
		try {
			const output = data.toString();
			const json = JSON.parse( output );
			return json.output;
		} catch ( error ) {
			return null;
		}
	}

	protected runCommand( args: string[] ): ChildProcess {
		const process = spawn( 'studio', [ ...args, '--output-format', 'json' ] );

		process.stdout.on( 'data', ( data: Buffer ) => {
			const output = this.parseOutput( data );
			if ( output ) {
				this.onOutput( output );
			}
		} );

		process.stderr.on( 'data', ( data: Buffer ) => {
			const error = this.parseOutput( data );
			if ( error ) {
				this.onError( error );
			}
		} );

		process.on( 'error', ( error: Error ) => {
			this.onError( error.message );
		} );

		process.on( 'close', ( code: number | null ) => {
			if ( code === 0 ) {
				this.onSuccess();
			} else {
				this.onError( null );
			}
		} );

		return process;
	}
}
