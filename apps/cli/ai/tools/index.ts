import { emitChatArtifactWidgets } from 'cli/ai/chat-artifacts';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { dataLiberationTool } from './data-liberation';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { importSiteTool } from './import-site';
import { inspectDesignTool } from './inspect-design';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listConnectedRemoteSitesTool } from './list-connected-remote-sites';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { refreshBrowserTool } from './refresh-browser';
import { scaffoldThemeTool } from './scaffold-theme';
import { shareScreenshotTool } from './share-screenshot';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { studioPresentTool } from './studio-present';
import { takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { waitForAnnotationsTool } from './wait-for-annotations';
import { runWpCliTool } from './wp-cli';
import type { AnyStudioAgentTool, StudioToolResultDetails } from './define-tool';

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
	refreshBrowserTool,
	scaffoldThemeTool,
	validateBlocksTool,
	takeScreenshotTool,
	inspectDesignTool,
	shareScreenshotTool,
	installTaxonomyScriptsTool,
	dataLiberationTool,
	auditPerformanceTool,
	auditSeoTool,
	listConnectedRemoteSitesTool,
	pushSiteTool,
	pullSiteTool,
	importSiteTool,
	exportSiteTool,
	openAnnotationBrowserTool,
	waitForAnnotationsTool,
];

export interface CreateStudioToolsOptions {
	// Enable automatic chat artifact emission from tool results. Desktop agent
	// runs set this; standalone CLI/MCP runs leave it off so visual artifacts are
	// ignored instead of leaking into terminal transcripts.
	emitChatArtifacts?: boolean;
	// Enable share_screenshot. Only meaningful when the agent is actually
	// being driven by the remote-session daemon (Telegram bridge), signaled
	// by `STUDIO_REMOTE_SESSION=1`. Direct `studio code` invocations leave
	// this off because the image would have nowhere to go.
	remoteSession?: boolean;
}

export function resolveStudioToolDefinitions(
	options: CreateStudioToolsOptions = {}
): AnyStudioAgentTool[] {
	const emitChatArtifacts = options.emitChatArtifacts === true && options.remoteSession !== true;
	const definitions = emitChatArtifacts
		? [ ...studioToolDefinitions, studioPresentTool ]
		: studioToolDefinitions;

	return definitions.flatMap( ( candidate ) => {
		if ( candidate.name === shareScreenshotTool.name && ! options.remoteSession ) {
			return [];
		}
		return [ withChatArtifactEmission( candidate, emitChatArtifacts ) ];
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
