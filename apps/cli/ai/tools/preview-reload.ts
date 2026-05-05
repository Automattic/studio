import { emitEvent } from 'cli/ai/json-events';
import { defineTool } from './define-tool';
import { textResult } from './utils';

export const previewReloadTool = defineTool(
	'preview_reload',
	'Reload the Studio site preview iframe at its current URL. Use this after you edit the active ' +
		'theme, CSS, template parts, or anything that affects the page the user is currently viewing, ' +
		'so they see the updated result immediately. Does nothing when the preview pane is closed or ' +
		'when running outside the Studio desktop app.',
	{},
	async () => {
		emitEvent( {
			type: 'preview.command',
			timestamp: new Date().toISOString(),
			kind: 'reload',
		} );
		return textResult( 'Preview reloaded.' );
	}
);
