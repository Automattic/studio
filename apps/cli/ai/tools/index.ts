import { emitChatArtifactWidgets } from 'cli/ai/chat-artifacts';
import { createAskUserQuestionTool } from './ask-user-question';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import {
	createImageHandoffTool,
	generateImagesTool,
	importImagesTool,
	lookImageFirst,
} from './generate-images';
import { importSiteTool } from './import-site';
import { createInspectDesignTool, inspectDesignTool } from './inspect-design';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listConnectedRemoteSitesTool } from './list-connected-remote-sites';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { createPickDesignTool, pickDesignTool } from './pick-design';
import { createPresentDesignOptionsTool } from './present-design-options';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { createRefreshBrowserTool, refreshBrowserTool } from './refresh-browser';
import { scaffoldThemeTool } from './scaffold-theme';
import { getSiteInfoTool } from './site-info';
import { createSkillTool } from './skill';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { createTakeScreenshotTool, takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { waitForAnnotationsTool } from './wait-for-annotations';
import { runWpCliTool } from './wp-cli';
import type { AnyStudioAgentTool, StudioToolResultDetails } from './define-tool';
import type { HostCapabilities } from './host-capabilities';

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
	pickDesignTool,
	validateBlocksTool,
	takeScreenshotTool,
	inspectDesignTool,
	generateImagesTool,
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
];

export type { HostCapabilities } from './host-capabilities';

export function resolveStudioToolDefinitions( host: HostCapabilities = {} ): AnyStudioAgentTool[] {
	const tools = studioToolDefinitions.flatMap( ( candidate ): AnyStudioAgentTool[] => {
		if ( candidate.name === refreshBrowserTool.name ) {
			return host.reloadPreview ? [ createRefreshBrowserTool( host.reloadPreview ) ] : [];
		}
		if ( candidate.name === generateImagesTool.name && host.hostImageTool ) {
			return [ createImageHandoffTool( host.hostImageTool, host.imageGeneration === true ) ];
		}
		if ( candidate.name === generateImagesTool.name && ! host.imageGeneration ) {
			return [];
		}
		if ( candidate.name === takeScreenshotTool.name && host.visionEnabled === false ) {
			return [ createTakeScreenshotTool( { visionEnabled: false } ) ];
		}
		if ( candidate.name === inspectDesignTool.name && host.visionEnabled === false ) {
			return [ createInspectDesignTool( { visionEnabled: false } ) ];
		}
		if ( candidate.name === pickDesignTool.name && ( host.canAskUser || host.tracks ) ) {
			return [
				createPickDesignTool( {
					canAskUser: host.canAskUser === true,
					presentsOptions: host.designPreviews === 'return',
					tracks: host.tracks,
				} ),
			];
		}
		return [ candidate ];
	} );
	if ( host.importImages ) {
		tools.push( importImagesTool );
	}
	if ( host.askUser ) {
		tools.push( createAskUserQuestionTool( host.askUser ) );
	}
	if ( host.designPreviews ) {
		tools.push(
			createPresentDesignOptionsTool( {
				askUser: host.designPreviews === 'ask' ? host.askUser : undefined,
				displayDirectory: host.displayDirectory,
				view: host.designOptionsView,
				tracks: host.tracks,
			} ) as unknown as AnyStudioAgentTool
		);
	}
	const skillTool = host.skills
		? createSkillTool(
				host.hostImageTool ? { 'site-spec': lookImageFirst( host.hostImageTool ) } : undefined
		  )
		: null;
	if ( skillTool ) {
		tools.push( skillTool as unknown as AnyStudioAgentTool );
	}
	return tools.map( ( tool ) => withChatArtifactEmission( tool, host.chatArtifacts === true ) );
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
