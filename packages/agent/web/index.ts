import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
} from '@earendil-works/pi-agent-core';
import { getAiTracksIdentity } from '@studio/common/lib/tracks-identity';
import {
	buildAttachedFilesPromptBlock,
	type StudioChatFileAttachment,
} from '@studio/agent/protocol/chat-files';
import { getAgentEndFailure } from '@studio/agent/protocol/json-events';
import { aiModelSupportsImages, type AiModelId } from '@studio/agent/protocol/models';
import { findLastAssistant, isEmptyStop } from '@studio/agent/protocol/session-events';
import { withDesignSystemPreview } from '@studio/agent/shared/chat-artifacts';
import { PendingWork } from '@studio/agent/shared/pending-work';
import { createResultNotes } from '@studio/agent/shared/result-notes';
import { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
import { resolveStudioTools, type StudioToolsOptions } from '@studio/agent/shared/tools';
import { createAskUserQuestionTool } from '@studio/agent/shared/tools/ask-user-question';
import { bindTool } from '@studio/agent/shared/tools/define-tool';
import { createPresentDesignOptionsTool } from '@studio/agent/shared/tools/present-design-options';
import { createSkillTool } from '@studio/agent/shared/tools/skill';
import { createCompactor, type Compaction } from './compaction';
import { createFileTools } from './file-tools';
import { buildModel, createStreamFn } from './models';
import type { Message } from '@earendil-works/pi-ai';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type {
	AnyStudioAgentTool,
	StudioToolResultDetails,
} from '@studio/agent/shared/tools/define-tool';
import type { AskUserHandler, SiteInfo } from '@studio/agent/shared/types';

export { compactionSummaryMessage, type Compaction } from './compaction';

// A reply with neither text nor a tool call ends the turn with nothing to show
// (see `isEmptyStop`); like the Node runtime, resume it up to this many times.
const MAX_EMPTY_STOP_CONTINUES = 2;

export interface WebAgentTurnConfig {
	// The conversation the turn belongs to, for the model proxy and Tracks.
	sessionId: string;
	prompt: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	// The conversation so far, oldest first; the app stores it.
	history: Message[];
	model: AiModelId;
	credentials: { wpcomToken?: string; anthropicApiKey?: string };
	activeSite?: SiteInfo | null;
	userInstructions?: string;
	onAskUser?: AskUserHandler;
	// The pi agent's events; `agent_end` carries `willRetry` when the turn goes on.
	onEvent( event: AgentEvent ): void;
	// Each finished message, for the app to record.
	onMessage( message: AgentMessage ): Promise< void >;
	// Each compaction, with the number of recent messages it kept.
	onCompaction( compaction: Compaction, kept: number ): Promise< void >;
}

export interface WebAgentTurnHandle {
	// Settles when the turn ends: with the model's failure, if it reported one.
	result: Promise< { failure?: string } >;
	interrupt(): void;
}

export interface StudioWebAgent {
	runTurn( config: WebAgentTurnConfig ): WebAgentTurnHandle;
	tools( options?: StudioToolsOptions ): AnyStudioAgentTool[];
}

// Runs a Studio tool as the Node runtime does: rendering tools wait for
// background work, which reports with the next tool result, and the tool's
// result gets the notes Studio adds.
function withPendingWork(
	tool: AnyStudioAgentTool,
	pendingWork: PendingWork,
	resultNotes?: ( text: string ) => Promise< string >
): AgentTool {
	return {
		...( tool as unknown as AgentTool ),
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			if ( tool.settlesPendingWork ) {
				await pendingWork.settle();
			}
			const result = await tool.execute( toolCallId, params as never, signal, onUpdate );
			const details = result.details as StudioToolResultDetails | undefined;
			if ( details?.pending ) {
				pendingWork.add( details.pending );
				delete details.pending;
			}
			const resultText = result.content
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
				.join( '\n' );
			const notes = [ await resultNotes?.( resultText ), pendingWork.takeReports() ]
				.filter( Boolean )
				.join( '\n' );
			return {
				...result,
				details: result.details,
				content: notes ? [ ...result.content, { type: 'text', text: notes } ] : result.content,
			};
		},
	};
}

async function runTurn(
	host: StudioAgentHost,
	config: WebAgentTurnConfig,
	onAgent: ( agent: Agent ) => void,
	isInterrupted: () => boolean
): Promise< { failure?: string } > {
	const visionEnabled = aiModelSupportsImages( config.model );
	const imageGeneration = Boolean( await host.wpcom.imageToken() );
	const tracks = getAiTracksIdentity( config.sessionId );
	const { ui } = host;
	const designSystemPreview = < TTool extends AnyStudioAgentTool >( tool: TTool ) =>
		ui ? withDesignSystemPreview( tool, host, ui ) : tool;
	const skillTool = createSkillTool();
	const tools: AnyStudioAgentTool[] = [
		...resolveStudioTools( host, {
			imageGeneration,
			visionEnabled,
			canAskUser: Boolean( config.onAskUser ),
			tracks,
		} ),
		...( config.onAskUser
			? [ bindTool( createAskUserQuestionTool( config.onAskUser ), host ) ]
			: [] ),
		...( config.onAskUser && ui
			? [
					bindTool(
						createPresentDesignOptionsTool( { onAskUser: config.onAskUser, tracks } ),
						host
					),
			  ]
			: [] ),
		...( skillTool ? [ bindTool( skillTool, host ) ] : [] ),
		...createFileTools( host, { visionEnabled } ).map( ( definition ) => {
			const tool = bindTool( definition, host );
			return definition.name === 'Write' || definition.name === 'Edit'
				? designSystemPreview( tool )
				: tool;
		} ),
	] as AnyStudioAgentTool[];

	const site = config.activeSite;
	const designPath = site && ! site.remote ? host.path.join( site.path, 'DESIGN.md' ) : undefined;
	const systemPrompt = buildSystemPrompt( {
		tools: tools.map( ( tool ) => ( { name: tool.name, promptSnippet: tool.promptSnippet } ) ),
		activeSite: site,
		activeSiteDesignPath:
			designPath && ( await host.files.exists( designPath ) ) ? designPath : undefined,
		userInstructions: config.userInstructions,
	} );

	const pendingWork = new PendingWork();
	const notes = createResultNotes( host );
	const resultNotes =
		site && ! site.remote ? ( text: string ) => notes( site.path, text ) : undefined;
	const credentials = { ...config.credentials, sessionId: config.sessionId };
	const model = buildModel( config.model, credentials );
	const streamFn = createStreamFn( config.model, credentials );
	const compactor = createCompactor( model, streamFn, config.onCompaction );
	const agent = new Agent( {
		initialState: {
			systemPrompt,
			model,
			thinkingLevel: 'medium',
			tools: tools.map( ( tool ) => withPendingWork( tool, pendingWork, resultNotes ) ),
			messages: config.history,
		},
		streamFn,
		transformContext: compactor.transform,
		sessionId: config.sessionId,
	} );
	onAgent( agent );

	let finalEvent: AgentEvent | undefined;
	let emptyStopContinues = 0;
	let cutOffReasoning: string | undefined;
	agent.subscribe( async ( event ) => {
		if ( event.type === 'message_end' ) {
			await config.onMessage( event.message );
		}
		let willRetry = false;
		if ( event.type === 'agent_end' ) {
			const lastAssistant = findLastAssistant( event.messages );
			if (
				! isInterrupted() &&
				emptyStopContinues < MAX_EMPTY_STOP_CONTINUES &&
				isEmptyStop( lastAssistant )
			) {
				willRetry = true;
				cutOffReasoning = ( lastAssistant?.content ?? [] )
					.map( ( block ) => ( block.type === 'thinking' ? block.thinking : '' ) )
					.join( '' )
					.trim();
			}
		}
		const forwarded = event.type === 'agent_end' ? { ...event, willRetry } : event;
		if ( event.type === 'agent_end' ) {
			finalEvent = forwarded;
		}
		config.onEvent( forwarded );
	} );

	await agent.prompt(
		`${ config.prompt }${ buildAttachedFilesPromptBlock( config.files ?? [] ) }`,
		config.images?.map( ( image ) => ( {
			type: 'image' as const,
			data: image.dataBase64,
			mimeType: image.mimeType,
		} ) )
	);
	while ( cutOffReasoning !== undefined && ! isInterrupted() ) {
		const reasoning = cutOffReasoning;
		cutOffReasoning = undefined;
		emptyStopContinues++;
		await agent.prompt(
			reasoning
				? `Your reasoning was cut off before you replied. Continue from where it stopped:\n\n${ reasoning }`
				: 'continue'
		);
	}
	await pendingWork.settle();
	const failure = finalEvent ? getAgentEndFailure( finalEvent as never ) : null;
	return failure ? { failure: failure.message } : {};
}

/**
 * Studio Code for hosts without Node, such as Studio in a browser: the same
 * tools, skills and system prompt as `createAgent`, with pi-agent-core's loop
 * calling the model from the page, and pi's file tools rebuilt over the host's
 * files. The app stores the conversation and passes it in with each turn.
 */
export function createWebAgent( { host }: { host: StudioAgentHost } ): StudioWebAgent {
	return {
		runTurn: ( config ) => {
			let agent: Agent | undefined;
			let interrupted = false;
			return {
				result: runTurn(
					host,
					config,
					( created ) => ( agent = created ),
					() => interrupted
				),
				interrupt: () => {
					interrupted = true;
					agent?.abort();
				},
			};
		},
		tools: ( options ) => resolveStudioTools( host, options ),
	};
}

export type {
	HostFiles,
	HostPage,
	HostPages,
	HostPath,
	HostSite,
	StudioAgentHost,
	StudioAgentUi,
} from '@studio/agent/shared/host';
export type { AskUserQuestion, SiteInfo } from '@studio/agent/shared/types';
export type { Message } from '@earendil-works/pi-ai';
