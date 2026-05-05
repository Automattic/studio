import { captureCommandOutput, errorResult, textResult } from './utils';

/**
 * Wrap a `runCommand` call from `cli/commands/preview/*` so its console +
 * progress output is captured and returned as a tool result.
 *
 * Shared by the four preview-tool implementations (create / update / delete /
 * list) — the pattern is identical: run the underlying command, surface its
 * output, treat a non-zero exit code as a tool error.
 *
 * Sized in its own helper file (rather than inline in each preview tool or
 * pooled with general utils) because it's domain-specific to the preview
 * subset and not useful elsewhere.
 */
export async function runPreviewCommand(
	fn: () => Promise< void >,
	fallbackMessage: string,
	errorPrefix: string
) {
	try {
		const result = await captureCommandOutput( fn );
		const output = result.consoleOutput || result.progressOutput || fallbackMessage;

		if ( result.exitCode ) {
			return errorResult( output );
		}

		return textResult( output );
	} catch ( error ) {
		return errorResult(
			`${ errorPrefix }: ${ error instanceof Error ? error.message : String( error ) }`
		);
	}
}
