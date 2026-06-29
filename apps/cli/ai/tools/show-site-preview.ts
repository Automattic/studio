import { Type } from 'typebox';
import { defineTool } from './define-tool';

const description = `Opens Studio's live site preview for the current local site at a specific path.
Use this after a meaningful visible site milestone, useful preview path, or page state worth keeping in view. Do not use it for routine inspection, low-level file reads, internal edits, noisy intermediate steps, summaries, or screenshots.`;

export const showSitePreviewTool = defineTool(
	'show_site_preview',
	description,
	{
		path: Type.String( {
			description: 'Local site path like "/" or "/about".',
		} ),
		message: Type.Optional(
			Type.String( {
				description: 'Optional concise summary of what is being shown.',
			} )
		),
	},
	async ( args ) => {
		const path = args.path.trim();
		if ( ! path ) {
			throw new Error( 'path must be a non-empty string.' );
		}
		if ( ! path.startsWith( '/' ) ) {
			throw new Error( 'path must be a local site path starting with "/".' );
		}

		return {
			content: [
				{
					type: 'text' as const,
					text: args.message?.trim() || `Showing site preview at ${ path }.`,
				},
			],
			sitePreview: { path },
		};
	}
);
