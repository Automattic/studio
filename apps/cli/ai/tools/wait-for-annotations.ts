import { Type } from 'typebox';
import { waitForAnnotationsDone } from 'cli/ai/inspector/inspector-inject';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const waitForAnnotationsTool = defineTool(
	'wait_for_annotations',
	'Blocks until the user clicks "Done" in the annotation inspector toolbar. ' +
		'Returns the annotations the user wrote, captured straight from the page. ' +
		'Call this AFTER `open_annotation_browser`.',
	{
		// `0` would resolve to Playwright's "no timeout" and block forever.
		// 120 minutes is generous enough for any realistic annotation session.
		timeoutMinutes: Type.Optional(
			Type.Integer( {
				minimum: 1,
				maximum: 120,
				description: 'How long to wait for the user to click "Done", in minutes. Defaults to 30.',
			} )
		),
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
			throw new Error(
				`Failed to read annotations: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
