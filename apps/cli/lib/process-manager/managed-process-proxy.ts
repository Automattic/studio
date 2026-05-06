import { getCliEntryPath } from './cli-entry-path';
import { ManagedProcessCallbacks } from './managed-process';
import { ManagedProcessNode } from './managed-process-node';

type ProxyProcessOptions = {
	pmId: number;
	name: string;
	callbacks: ManagedProcessCallbacks;
};

export class ProxyProcess extends ManagedProcessNode {
	constructor( { pmId, name, callbacks }: ProxyProcessOptions ) {
		super( {
			pmId,
			name,
			callbacks,
			scriptPath: getCliEntryPath( 'proxy-daemon.mjs' ),
		} );
	}
}
