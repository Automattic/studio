import { textResult } from './utils';
import type { CommandOutput } from '@studio/agent/node/host';

// Shared wrapper around the four preview commands: surface non-zero exits as
// tool errors.
export async function runPreviewCommand(
	fn: () => Promise< CommandOutput >,
	fallbackMessage: string,
	errorPrefix: string
) {
	try {
		const result = await fn();
		const output = result.consoleOutput || result.progressOutput || fallbackMessage;

		if ( result.exitCode ) {
			throw new Error( output );
		}

		return textResult( output );
	} catch ( error ) {
		throw new Error(
			`${ errorPrefix }: ${ error instanceof Error ? error.message : String( error ) }`
		);
	}
}
