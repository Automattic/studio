import { emitEvent } from 'cli/ai/json-events';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const refreshBrowserTool = defineTool(
	'refresh_browser',
	'Requests a reload of the embedded site preview attached to a WordPress Studio desktop or `studio ui` conversation. It does not reload standalone browsers, including the browser opened by `open_annotation_browser`. Use it after a rendered change only when this conversation is running in one of those Studio interfaces. It reloads in place — never stop/start the site just to refresh the preview.',
	{},
	async () => {
		emitEvent( { type: 'preview.reload', timestamp: new Date().toISOString() } );
		return textResult( 'Requested a reload of the attached Studio site preview.' );
	}
);
