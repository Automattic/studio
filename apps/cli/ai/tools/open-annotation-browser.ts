import { Type } from 'typebox';
import { openAnnotationBrowser } from 'cli/ai/inspector/inspector-inject';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const openAnnotationBrowserTool = defineTool(
	'open_annotation_browser',
	'Opens a headed browser on a site with the Studio annotation inspector. ' +
		'The user clicks "Annotate", picks an element, types feedback, then clicks "Done". ' +
		'After calling this tool, call `wait_for_annotations` to block until the user submits.',
	{
		url: Type.String( { description: 'The site URL to open (e.g., "http://localhost:8881")' } ),
	},
	async ( args, context ) => {
		try {
			context.onProgress( `Opening annotation browser at ${ args.url }…` );
			const message = await openAnnotationBrowser( args.url );
			context.onProgress( 'Annotation browser ready' );
			return textResult( message );
		} catch ( error ) {
			throw new Error(
				`Failed to open annotation browser: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
