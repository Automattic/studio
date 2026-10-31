import { emitChatArtifactWidgets } from '@studio/agent/node/chat-artifacts';
import { convertToBlocksTool } from './convert-to-blocks';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { createThemeTool } from './create-theme';
import { bindTool } from './define-tool';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { generateImagesTool } from './generate-images';
import { importSiteTool } from './import-site';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { publishTargetsTool } from './publish-targets';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { runWpCliTool } from './wp-cli';
import type {
	AnyStudioAgentTool,
	StudioToolDefinition,
	StudioToolResultDetails,
	StudioToolsOptions,
} from './define-tool';
export type { StudioToolsOptions } from './define-tool';
import type { StudioAgentHost, StudioAgentUi } from '@studio/agent/node/host';

export const studioToolDefinitions: StudioToolDefinition[] = [
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
	createThemeTool,
	convertToBlocksTool,
	takeScreenshotTool,
	generateImagesTool,
	installTaxonomyScriptsTool,
	auditPerformanceTool,
	auditSeoTool,
	publishTargetsTool,
	pushSiteTool,
	pullSiteTool,
	importSiteTool,
	exportSiteTool,
	openAnnotationBrowserTool,
];

// The Studio tools as they appear to an agent, bound to `host`: each decides
// for itself. Visual results show in the conversation only when the host has a
// UI; otherwise they would leak into terminal transcripts.
export function resolveStudioTools(
	host: StudioAgentHost,
	options: StudioToolsOptions = {}
): AnyStudioAgentTool[] {
	return studioToolDefinitions.flatMap( ( definition ) => {
		const tool = definition.forHost ? definition.forHost( options, host ) : definition;
		return tool ? [ withChatArtifactEmission( bindTool( tool, host ), host.ui ) ] : [];
	} );
}

export function withChatArtifactEmission< TTool extends AnyStudioAgentTool >(
	tool: TTool,
	ui: StudioAgentUi | undefined
): TTool {
	if ( ! ui ) {
		return tool;
	}
	return {
		...tool,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			const details = result.details as StudioToolResultDetails | undefined;
			try {
				await emitChatArtifactWidgets( ui, details?.studioArtifacts );
			} catch ( error ) {
				// Artifacts are presentation-only; a failed emit (e.g. session file
				// unwritable) must never turn a successful tool result into an error.
				console.warn( `[chat-artifacts] failed to emit artifact for ${ tool.name }:`, error );
			}
			return result;
		},
	};
}
