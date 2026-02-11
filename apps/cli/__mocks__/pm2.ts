import { vi } from 'vitest';

export class custom {
	constructor( config?: any ) {}

	connect = vi.fn( ( callback: ( error?: Error ) => void ) => callback() );
	disconnect = vi.fn( ( callback: ( error?: Error ) => void ) => callback() );
	killDaemon = vi.fn( ( callback: ( error?: Error ) => void ) => callback() );
	list = vi.fn( ( callback: ( error?: Error, processes?: any[] ) => void ) =>
		callback( undefined, [] )
	);
	launchBus = vi.fn( ( callback: ( error?: Error, bus?: any ) => void ) =>
		callback( undefined, {} )
	);
	sendDataToProcessId = vi.fn(
		( processId: number, data: any, callback: ( error?: Error ) => void ) => callback()
	);
}

export type StartOptions = any;

export default { custom };
