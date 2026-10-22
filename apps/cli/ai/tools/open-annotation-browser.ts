import { formatVisualAnnotationsPrompt } from '@studio/common/ai/visual-annotations';
import { Type } from 'typebox';
import { annotateInBrowser } from 'cli/ai/inspector/inspector-inject';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const openAnnotationBrowserTool = defineTool(
	'open_annotation_browser',
	'Opens a headed browser on a site for the user to annotate, and waits until they are done. ' +
		'The user clicks elements, leaves a note on each (text, pasted images), then clicks "Send" in the bar at the bottom, which closes the browser. ' +
		'Returns the annotations like the ones sent from the Studio preview, with their images attached.',
	{
		url: Type.String( { description: 'The site URL to open (e.g., "http://localhost:8881")' } ),
		// `0` would never time out. 120 minutes is generous for any annotation session.
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
			context.onProgress( `Opening annotation browser at ${ args.url }…` );
			const notes = await annotateInBrowser( args.url, ( args.timeoutMinutes ?? 30 ) * 60 * 1000 );
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
				`Annotation browser: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{ annotations: LOCAL_CHANGE }
);
