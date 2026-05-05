import { captureCommandOutput, textResult } from './utils';

// Shared wrapper around the four preview-command implementations: run, capture
// output, surface non-zero exits as tool errors.
export async function runPreviewCommand(
	fn: () => Promise< void >,
	fallbackMessage: string,
	errorPrefix: string
) {
	try {
		const result = await captureCommandOutput( fn );
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
