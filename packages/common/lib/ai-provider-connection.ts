import { z } from 'zod';
import { runCliCommand, type ExecuteCliCommand } from './cli-process';

let activeConnection: { controller: AbortController; finished: Promise< void > } | undefined;

// pi ships with the CLI. Both app hosts use this operation rather than importing its login runtime.
export async function connectAiProvider(
	execute: ExecuteCliCommand,
	provider: string
): Promise< void > {
	const previous = activeConnection;
	previous?.controller.abort();
	const controller = new AbortController();
	const finished = ( async () => {
		await previous?.finished.catch( () => {} );
		controller.signal.throwIfAborted();
		await runCliCommand(
			execute,
			[ 'code', 'providers', 'login', provider ],
			z.object( { connected: z.literal( true ) } ),
			{ logPrefix: 'ai-provider-login', signal: controller.signal }
		);
	} )();
	activeConnection = { controller, finished };
	try {
		await finished;
	} finally {
		if ( activeConnection?.controller === controller ) activeConnection = undefined;
	}
}
