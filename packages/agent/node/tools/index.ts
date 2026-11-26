import { emitChatArtifactWidgets } from '@studio/agent/node/chat-artifacts';
import { createResultNotes } from '@studio/agent/node/result-notes';
import { createAskUserQuestionTool } from './ask-user-question';
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
import { createPresentDesignOptionsTool } from './present-design-options';
import { pullSiteTool } from './pull-site';
import { pushSiteTool } from './push-site';
import { auditSeoTool } from './rank-me-up';
import { refreshBrowserTool } from './refresh-browser';
import { saveSkillTool } from './save-skill';
import { scaffoldThemeTool } from './scaffold-theme';
import { sendFeedbackTool } from './send-feedback';
import { getSiteInfoTool } from './site-info';
import { createSkillTool } from './skill';
import { startSiteTool } from './start-site';
import { stopSiteTool } from './stop-site';
import { createStudioInstructionsTool, type HostSkills } from './studio-instructions';
import { createTakeScreenshotTool, takeScreenshotTool } from './take-screenshot';
import { updatePreviewTool } from './update-preview';
import { validateBlocksTool } from './validate-blocks';
import { runWpCliTool } from './wp-cli';
import { createWpcomRequestTool, WPCOM_REQUEST_TOOL_NAME } from './wpcom-request';
import type {
	AnyStudioAgentTool,
	StudioToolDefinition,
	StudioToolResultDetails,
} from './define-tool';
import type { DesignTracksContext } from '@studio/agent/node/design-tracks';
import type { StudioAgentHost, StudioAgentUi } from '@studio/agent/node/host';
import type { AskUserHandler } from '@studio/agent/node/types';
import type { UserSkill } from '@studio/common/lib/user-skills';

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
		sendFeedbackTool,
	];
}

export interface StudioToolsOptions {
	// Enable generate_images, when the host has an image generator.
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
		if ( candidate.name === WPCOM_REQUEST_TOOL_NAME && options.wpcomRequest === false ) {
			return [];
		}
		// Only a Studio UI shows the preview it reloads.
		if ( candidate.name === refreshBrowserTool.name && ! host.ui ) {
			return [];
		}
		if ( candidate.name === sendFeedbackTool.name && ! host.sendFeedback ) {
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

// The tools of a conversation with the model: Studio's, the questions when the
// user can answer them, and the skills, with save_skill for the create-skill skill.
export function resolveConversationTools(
	host: StudioAgentHost,
	{
		onAskUser,
		tracks,
		userSkills,
		...options
	}: Pick< StudioToolsOptions, 'imageGeneration' | 'visionEnabled' > & {
		onAskUser?: AskUserHandler;
		tracks: DesignTracksContext;
		// The user's own skills, for the active site and for all sites, offered next to Studio's.
		userSkills?: UserSkill[];
	}
): AnyStudioAgentTool[] {
	// The feedback skill only works through send_feedback.
	const skillTool = createSkillTool( host.sendFeedback ? [] : [ 'feedback' ], userSkills );
	return [
		...resolveStudioTools( host, { ...options, canAskUser: Boolean( onAskUser ), tracks } ),
		...( onAskUser ? [ bindTool( createAskUserQuestionTool( onAskUser ), host ) ] : [] ),
		...( onAskUser && host.ui
			? [ bindTool( createPresentDesignOptionsTool( { onAskUser, tracks } ), host ) ]
			: [] ),
		...( skillTool ? [ bindTool( skillTool, host ), bindTool( saveSkillTool, host ) ] : [] ),
	] as AnyStudioAgentTool[];
}

export interface ExternalToolsOptions
	extends Pick<
		StudioToolsOptions,
		'imageGeneration' | 'wpcomRequest' | 'canAskUser' | 'tracks' | 'imageLink'
	> {
	// The host shows present_design_options' options as a clickable picker (an MCP App).
	picker?: boolean;
	// The skills the host offers and loads itself: studio_instructions leaves them to it.
	hostSkills?: HostSkills;
}

// The tools of an agent that runs them itself, such as one connected to `studio
// mcp`: studio_instructions, which hands it the prompt and the skills, and
// Studio's tools, whose results carry the notes and background reports the
// runtime adds in a conversation.
export function resolveExternalTools(
	host: StudioAgentHost,
	{ picker, hostSkills, ...options }: ExternalToolsOptions = {}
): AnyStudioAgentTool[] {
	const tools = [
		...resolveStudioTools( host, options ),
		bindTool(
			createPresentDesignOptionsTool( {
				imageLink: options.imageLink,
				picker,
				tracks: options.tracks,
			} ),
			host
		),
	] as AnyStudioAgentTool[];
	const notes = createResultNotes();
	return [ bindTool( createStudioInstructionsTool( tools, hostSkills ), host ), ...tools ].map(
		( tool ) => ( {
			...tool,
			rawHandler: async ( args: never, context ) => {
				const result = await tool.rawHandler( args, context );
				const text = result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) );
				const site = await siteNamed( host, args );
				const added = [
					site && ( await notes( site.path, text.join( '\n' ) ) ),
					await result.pending,
				]
					.filter( Boolean )
					.join( '\n' );
				return {
					...result,
					content: added ? [ ...result.content, { type: 'text', text: added } ] : result.content,
					pending: undefined,
				};
			},
		} )
	) as AnyStudioAgentTool[];
}

// The site a call names, if any.
async function siteNamed( host: StudioAgentHost, args: { nameOrPath?: unknown } ) {
	if ( typeof args.nameOrPath !== 'string' ) {
		return undefined;
	}
	return host.sites.resolve( args.nameOrPath ).catch( () => undefined );
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
