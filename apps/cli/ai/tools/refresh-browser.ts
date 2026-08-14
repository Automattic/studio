import { emitEvent } from 'cli/ai/json-events';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const refreshBrowserTool = defineTool(
	'refresh_browser',
	'Reloads the site preview browser in the Studio app so the user sees your latest changes. Call this after a change that alters what the site renders (content, options/settings, theme, plugins, activation). It reloads in place — never stop/start the site (site_stop/site_start) just to refresh the preview.',
	{},
	async () => {
		emitEvent( { type: 'preview.reload', timestamp: new Date().toISOString() } );
		return textResult( 'Reloaded the site preview.' );
	}
);
