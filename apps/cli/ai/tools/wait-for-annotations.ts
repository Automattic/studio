import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { waitForAnnotationsDone } from 'cli/ai/inspector/inspector-inject';
import { emitProgress } from 'cli/logger';
import { errorResult, textResult } from './utils';

export const waitForAnnotationsTool = tool(
	'wait_for_annotations',
	'Blocks until the user clicks "Done" in the annotation inspector toolbar. ' +
		'Returns the annotations the user wrote, captured straight from the page. ' +
		'Call this AFTER `open_annotation_browser`.',
	{
		// Bound the wait — `0` would resolve to `timeout: 0` in Playwright,
		// which means "no timeout" and would block the agent forever. The
		// upper bound of 120 minutes is generous enough for any realistic
		// annotation session.
		timeoutMinutes: z
			.number()
			.int()
			.min( 1 )
			.max( 120 )
			.optional()
			.describe( 'How long to wait for the user to click "Done", in minutes. Defaults to 30.' ),
	},
	async ( args ) => {
		try {
			emitProgress( 'Waiting for the user to click "Done"…' );
			const result = await waitForAnnotationsDone( {
				timeoutMs: ( args.timeoutMinutes ?? 30 ) * 60 * 1000,
			} );
			emitProgress( `Received ${ result.annotations.length } annotation(s)` );
			return textResult( JSON.stringify( result, null, 2 ) );
		} catch ( error ) {
			return errorResult(
				`Failed to read annotations: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
