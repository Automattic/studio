import { formatVisualAnnotationsPrompt } from '@studio/common/ai/visual-annotations';
import { Type } from 'typebox';
import { waitForAnnotationsDone } from 'cli/ai/inspector/inspector-inject';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const waitForAnnotationsTool = defineTool(
	'wait_for_annotations',
	'Blocks until the user clicks "Send" in the annotation browser, which then closes. ' +
		'Returns the annotations like the ones sent from the Studio preview, with their images attached. ' +
		'Call this AFTER `open_annotation_browser`.',
	{
		// `0` would resolve to Playwright's "no timeout" and block forever.
		// 120 minutes is generous enough for any realistic annotation session.
		timeoutMinutes: Type.Optional(
			Type.Integer( {
				minimum: 1,
				maximum: 120,
				description: 'How long to wait for the user to click "Send", in minutes. Defaults to 30.',
			} )
		),
	},
	async ( args, context ) => {
		try {
			context.onProgress( 'Waiting for the user to click "Send"…' );
			const notes = await waitForAnnotationsDone( {
				timeoutMs: ( args.timeoutMinutes ?? 30 ) * 60 * 1000,
			} );
			if ( ! notes ) {
				return textResult( 'The user closed the annotation browser without sending annotations.' );
			}
			context.onProgress( `Received ${ notes.length } annotation(s)` );
			const images = notes.flatMap( ( note ) => note.images );
			return {
				content: [
					{ type: 'text' as const, text: formatVisualAnnotationsPrompt( notes, images ) },
					...images.map( ( image ) => ( {
						type: 'image' as const,
						data: image.dataBase64,
						mimeType: image.mimeType,
					} ) ),
				],
			};
		} catch ( error ) {
			throw new Error(
				`Failed to read annotations: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{ annotations: READ_ONLY }
);
