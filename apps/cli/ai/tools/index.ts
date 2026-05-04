import { isRemoteSessionEnabled } from 'cli/lib/feature-flags';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { importSiteTool } from './import-site';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { previewNavigateTool } from './preview-navigate';
import { previewReloadTool } from './preview-reload';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { shareScreenshotTool } from './share-screenshot';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { runWpCliTool } from './wp-cli';

export { captureCommandOutput } from './utils';

// Preview-steering tools only belong in the toolset when the Studio desktop UI
// is on the other end of the IPC channel — outside of that, navigate/reload
// calls render as noise in the terminal transcript.
const previewSteeringToolDefinitions = [ previewNavigateTool, previewReloadTool ];

export const studioToolDefinitions = [
	createSiteTool,
	listSitesTool,
	getSiteInfoTool,
	startSiteTool,
	stopSiteTool,
	deleteSiteTool,
	createPreviewTool,
	listPreviewsTool,
	updatePreviewTool,
	deletePreviewTool,
	runWpCliTool,
	validateBlocksTool,
	takeScreenshotTool,
	shareScreenshotTool,
	installTaxonomyScriptsTool,
	auditPerformanceTool,
	auditSeoTool,
	pushSiteTool,
	pullSiteTool,
	importSiteTool,
	exportSiteTool,
	...previewSteeringToolDefinitions,
];

export interface CreateStudioToolsOptions {
	// Enable preview_navigate / preview_reload. Only meaningful when a
	// Studio desktop UI is subscribed to the agent event stream — i.e. the
	// CLI child was forked by the Studio main process (`process.send` is
	// available). Defaults to false so standalone CLI runs don't advertise
	// tools whose side effects would vanish into the void.
	enablePreviewSteering?: boolean;
}

export function resolveStudioToolDefinitions( options: CreateStudioToolsOptions = {} ) {
	const excludedNames = new Set< string >();
	if ( ! options.enablePreviewSteering ) {
		for ( const t of previewSteeringToolDefinitions ) {
			excludedNames.add( t.name );
		}
	}
	if ( ! isRemoteSessionEnabled() ) {
		excludedNames.add( shareScreenshotTool.name );
	}
	if ( excludedNames.size === 0 ) {
		return studioToolDefinitions;
	}
	return studioToolDefinitions.filter( ( candidate ) => ! excludedNames.has( candidate.name ) );
}
