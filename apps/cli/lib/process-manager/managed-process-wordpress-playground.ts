import { getCliEntryPath } from './cli-entry-path';
import { ManagedProcessCallbacks } from './managed-process';
import { ManagedProcessNode } from './managed-process-node';

type PlaygroundWordPressServerProcessOptions = {
	pmId: number;
	name: string;
	callbacks: ManagedProcessCallbacks;
};

export class ManagedProcessWordPressPlayground extends ManagedProcessNode {
	constructor( { pmId, name, callbacks }: PlaygroundWordPressServerProcessOptions ) {
		super( {
			pmId,
			name,
			callbacks,
			scriptPath: getCliEntryPath( 'playground-server-child.mjs' ),
		} );
	}
}
