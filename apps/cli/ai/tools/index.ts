import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { isRemoteSessionEnabled } from 'cli/lib/feature-flags';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { generatePanelTool } from './generate-panel';
import { importSiteTool } from './import-site';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listConnectedRemoteSitesTool } from './list-connected-remote-sites';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { previewNavigateTool } from './preview-navigate';
import { previewReloadTool } from './preview-reload';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { shareScreenshotTool } from './share-screenshot';
import { showPanelTool } from './show-panel';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { waitForAnnotationsTool } from './wait-for-annotations';
import { runWpCliTool } from './wp-cli';
import { createWpcomRequestTool } from './wpcom-request';

export { captureCommandOutput } from './utils';
export { showPanelTool, composePanelUrl } from './show-panel';
export { generatePanelTool, validateScratchSource } from './generate-panel';
export type { PanelIntent, ComposedPanelUrl } from './show-panel';

// Preview-steering tools only belong in the toolset when the Studio desktop UI
// is on the other end of the IPC channel — outside of that, navigate/reload
// calls render as noise in the terminal transcript. The studio_show_panel and
// studio_generate_panel tools also emit `preview.command` events, so they
// belong here too.
const previewSteeringToolDefinitions = [
	previewNavigateTool,
	previewReloadTool,
	showPanelTool,
	generatePanelTool,
];

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
	listConnectedRemoteSitesTool,
	pushSiteTool,
	pullSiteTool,
	importSiteTool,
	exportSiteTool,
	openAnnotationBrowserTool,
	waitForAnnotationsTool,
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

export function createStudioTools( options: CreateStudioToolsOptions = {} ) {
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: resolveStudioToolDefinitions( options ),
	} );
}

/**
 * Creates an MCP server for remote WordPress.com sites, combining WP.com REST API tools
 * with URL-based tools (screenshot) that work with any site.
 */
export function createRemoteSiteTools( token: string, siteId: number ) {
	const wpcomRequest = createWpcomRequestTool( token, siteId );
	const screenshotTools = isRemoteSessionEnabled()
		? [ takeScreenshotTool, shareScreenshotTool ]
		: [ takeScreenshotTool ];
	return createSdkMcpServer( {
		name: 'studio',
		version: '1.0.0',
		tools: [ wpcomRequest, ...screenshotTools, createSiteTool, pullSiteTool ],
	} );
}
