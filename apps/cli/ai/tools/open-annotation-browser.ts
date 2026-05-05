import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { openAnnotationBrowser } from 'cli/ai/inspector/inspector-inject';
import { emitProgress } from 'cli/logger';
import { errorResult, textResult } from './utils';

export const openAnnotationBrowserTool = tool(
	'open_annotation_browser',
	'Opens a headed browser on a site with the Studio annotation inspector. ' +
		'The user clicks "Annotate", picks an element, types feedback, then clicks "Done". ' +
		'After calling this tool, call `wait_for_annotations` to block until the user submits.',
	{
		url: z.string().describe( 'The site URL to open (e.g., "http://localhost:8881")' ),
	},
	async ( args ) => {
		try {
			emitProgress( `Opening annotation browser at ${ args.url }…` );
			const message = await openAnnotationBrowser( args.url );
			emitProgress( 'Annotation browser ready' );
			return textResult( message );
		} catch ( error ) {
			return errorResult(
				`Failed to open annotation browser: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
