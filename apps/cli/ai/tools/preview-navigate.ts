import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { emitEvent } from 'cli/ai/json-events';
import { textResult } from './utils';

function normalizePreviewPath( raw: string ): string {
	const trimmed = raw.trim();
	if ( ! trimmed ) {
		return '/';
	}
	return trimmed.startsWith( '/' ) ? trimmed : `/${ trimmed }`;
}

export const previewNavigateTool = tool(
	'preview_navigate',
	'Point the Studio site preview iframe at a specific page on the active site and reload it. ' +
		'Use this after you finish editing a specific page, post, or template so the user immediately ' +
		'sees the result of your change. Pass a site-relative path (e.g. "/", "/about/", ' +
		'"/wp-admin/post.php?post=42&action=edit"). Does nothing when the preview pane is closed or ' +
		'when running outside the Studio desktop app.',
	{
		path: z
			.string()
			.describe(
				'Site-relative path to show in the preview, e.g. "/", "/about/", "/?p=123". Leading slash is added if missing.'
			),
	},
	async ( args ) => {
		const path = normalizePreviewPath( args.path );
		emitEvent( {
			type: 'preview.command',
			timestamp: new Date().toISOString(),
			kind: 'navigate',
			path,
		} );
		return textResult( `Preview navigated to ${ path }.` );
	}
);
