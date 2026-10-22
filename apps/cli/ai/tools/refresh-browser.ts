import { emitEvent } from 'cli/ai/json-events';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const refreshBrowserTool = defineTool(
	'refresh_browser',
	'Reloads the site preview in the Studio app so the user sees your latest changes; it never reloads on its own. Call it after a change that alters what the site renders (content, settings, theme, plugins). It reloads in place: never stop and start the site to refresh the preview.',
	{},
	async () => {
		emitEvent( { type: 'preview.reload', timestamp: new Date().toISOString() } );
		return textResult( 'Reloaded the site preview.' );
	},
	{
		promptSnippet: 'Reload the in-app site preview so the user sees your latest changes',
		annotations: READ_ONLY,
	}
);
