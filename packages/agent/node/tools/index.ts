import { emitChatArtifactWidgets } from '@studio/agent/node/chat-artifacts';
import { createPreviewTool } from './create-preview';
import { createSiteTool } from './create-site';
import { bindTool } from './define-tool';
import { deletePreviewTool } from './delete-preview';
import { deleteSiteTool } from './delete-site';
import { exportSiteTool } from './export-site';
import { generateImagesTool } from './generate-images';
import { importSiteTool } from './import-site';
import { createInspectDesignTool, inspectDesignTool } from './inspect-design';
import { installTaxonomyScriptsTool } from './install-taxonomy-scripts';
import { listConnectedRemoteSitesTool } from './list-connected-remote-sites';
import { listPreviewsTool } from './list-previews';
import { listSitesTool } from './list-sites';
import { auditPerformanceTool } from './need-for-speed';
import { openAnnotationBrowserTool } from './open-annotation-browser';
import { createPickDesignTool, pickDesignTool } from './pick-design';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { refreshBrowserTool } from './refresh-browser';
import { scaffoldThemeTool } from './scaffold-theme';
import { getSiteInfoTool } from './site-info';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { createTakeScreenshotTool, takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { runWpCliTool } from './wp-cli';
import { createWpcomRequestTool } from './wpcom-request';
import type {
	AnyStudioAgentTool,
	StudioToolDefinition,
	StudioToolResultDetails,
} from './define-tool';
import type { DesignTracksContext } from '@studio/agent/node/design-tracks';
import type { StudioAgentHost, StudioAgentUi } from '@studio/agent/node/host';

// The tools as defined for `host`.
export function studioToolDefinitions( host: StudioAgentHost ): StudioToolDefinition[] {
	return [
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
		createWpcomRequestTool( host.wpcom.payloadsDirectory ),
		pushSiteTool,
		pullSiteTool,
		importSiteTool,
		exportSiteTool,
		openAnnotationBrowserTool,
		refreshBrowserTool,
	];
}

export interface StudioToolsOptions {
	// Enable generate_images. Callers resolve isImageGenerationAvailable()
	// (async) and pass it; when off, sessions behave exactly as before the tool
	// existed (no tool, no imagery prompt sections).
	imageGeneration?: boolean;
	// False for models that cannot view images. Defaults to true.
	visionEnabled?: boolean;
	// False leaves out wpcom_request, for hosts that don't accept a tool reaching any
	// WordPress.com endpoint. Defaults to true.
	wpcomRequest?: boolean;
	// Lets pick_design offer options to pick from. Defaults to false.
	canAskUser?: boolean;
	// The chat session the design tools record Tracks events for; absent for the MCP server.
	tracks?: DesignTracksContext;
	// How a local image is linked in the agent's reply so the host shows it to the user.
	// Set by hosts without Studio's chat UI, which shows images as chat artifacts instead.
	imageLink?: ( file: string ) => string;
}

// The Studio tools, bound to `host`. Visual results show in the conversation
// only when the host has a UI; otherwise they would leak into terminal transcripts.
export function resolveStudioTools(
	host: StudioAgentHost,
	options: StudioToolsOptions = {}
): AnyStudioAgentTool[] {
	return studioToolDefinitions( host ).flatMap( ( candidate ) => {
		if ( candidate.name === generateImagesTool.name && ! options.imageGeneration ) {
			return [];
		}
		if ( candidate.name === 'wpcom_request' && options.wpcomRequest === false ) {
			return [];
		}
		// Only a Studio UI shows the preview it reloads.
		if ( candidate.name === refreshBrowserTool.name && ! host.ui ) {
			return [];
		}
		if ( candidate.name === openAnnotationBrowserTool.name && ! host.annotate ) {
			return [];
		}
		let tool = candidate;
		if ( candidate.name === takeScreenshotTool.name ) {
			tool = createTakeScreenshotTool( {
				visionEnabled: options.visionEnabled !== false,
				imageLink: options.imageLink,
				userSeesCapture: Boolean( host.ui ) || Boolean( options.imageLink ),
			} );
		}
		if ( candidate.name === inspectDesignTool.name && options.visionEnabled === false ) {
			tool = createInspectDesignTool( { visionEnabled: false } );
		}
		if ( candidate.name === pickDesignTool.name && ( options.canAskUser || options.tracks ) ) {
			tool = createPickDesignTool( {
				canAskUser: options.canAskUser === true,
				tracks: options.tracks,
			} );
		}
		return [ withChatArtifactEmission( bindTool( tool, host ), host.ui ) ];
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
