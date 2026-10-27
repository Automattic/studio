import { emitChatArtifactWidgets } from 'cli/ai/chat-artifacts';
import { convertToBlocksTool } from './convert-to-blocks';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
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
import type { AnyStudioAgentTool, StudioToolHost, StudioToolResultDetails } from './define-tool';

export { captureCommandOutput } from './utils';

export const studioToolDefinitions: AnyStudioAgentTool[] = [
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

// The Studio tools as they appear on a host: each decides for itself.
export function resolveStudioToolDefinitions( host: StudioToolHost = {} ): AnyStudioAgentTool[] {
	return studioToolDefinitions.flatMap( ( definition ) => {
		const tool = definition.forHost ? definition.forHost( host ) : definition;
		return tool ? [ withChatArtifactEmission( tool, host.emitChatArtifacts === true ) ] : [];
	} );
}

export function withChatArtifactEmission< TTool extends AnyStudioAgentTool >(
	tool: TTool,
	emitChatArtifacts: boolean
): TTool {
	if ( ! emitChatArtifacts ) {
		return tool;
	}
	return {
		...tool,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			const details = result.details as StudioToolResultDetails | undefined;
			try {
				await emitChatArtifactWidgets( details?.studioArtifacts );
			} catch ( error ) {
				// Artifacts are presentation-only; a failed emit (e.g. session file
				// unwritable) must never turn a successful tool result into an error.
				console.warn( `[chat-artifacts] failed to emit artifact for ${ tool.name }:`, error );
			}
			return result;
		},
	};
}
