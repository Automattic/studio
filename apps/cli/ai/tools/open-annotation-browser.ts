import { Type } from 'typebox';
import { openAnnotationBrowser } from 'cli/ai/inspector/inspector-inject';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const openAnnotationBrowserTool = defineTool(
	'open_annotation_browser',
	'Opens a headed browser on a site with the Studio clip inspector. ' +
		'The user clips elements (with optional comments), drags regions, or captures the page, ' +
		'then clicks "Send to agent". Element clips include a selector, computed styles, and a ' +
		'screenshot path; region/page clips include a screenshot path. ' +
		'After calling this tool, call `wait_for_annotations` to block until the user submits.',
	{
		url: Type.String( { description: 'The site URL to open (e.g., "http://localhost:8881")' } ),
	},
	async ( args ) => {
		try {
			emitProgress( `Opening annotation browser at ${ args.url }…` );
			const message = await openAnnotationBrowser( args.url );
			emitProgress( 'Annotation browser ready' );
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
