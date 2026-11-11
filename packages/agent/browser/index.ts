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
import {
	findLastAssistant,
	getEmptyStopContinuation,
	isEmptyStop,
	MAX_EMPTY_STOP_CONTINUES,
} from '@studio/agent/protocol/session-events';
import { PendingWork, runWithPendingWork } from '@studio/agent/shared/pending-work';
import { createResultNotes } from '@studio/agent/shared/result-notes';
import { findActiveSiteDesign } from '@studio/agent/shared/site-selection';
import { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
import { assertToolCallAllowed } from '@studio/agent/shared/tool-safety';
import { resolveConversationTools } from '@studio/agent/shared/tools';
import { createCompactor, type Compaction } from './compaction';
import { createFileTools } from './file-tools';
import { buildModel, createStreamFn } from './models';
import type { Message } from '@earendil-works/pi-ai';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { AnyStudioAgentTool } from '@studio/agent/shared/tools/define-tool';
import type { AskUserHandler, SiteInfo } from '@studio/agent/shared/types';

export { compactionSummaryMessage, type Compaction } from './compaction';

interface BrowserAgentTurnConfig {
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

interface BrowserAgentTurnHandle {
	// Settles when the turn ends: with the model's failure, if it reported one.
	result: Promise< { failure?: string } >;
	interrupt(): void;
}

// Runs a Studio tool as the Node runtime does (see runWithPendingWork).
function withPendingWork(
	host: StudioAgentHost,
	tool: AnyStudioAgentTool,
	pendingWork: PendingWork,
	resultNotes?: ( text: string ) => Promise< string >
): AgentTool {
	return {
		...( tool as unknown as AgentTool ),
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			await assertToolCallAllowed( tool.name, params, host, ( file ) =>
				host.path.resolve( host.sitesRoot, file )
			);
			return runWithPendingWork(
				{ settles: tool.settlesPendingWork, pendingWork, resultNotes },
				async () => ( {
					details: undefined,
					...( await tool.execute( toolCallId, params as never, signal, onUpdate ) ),
				} )
			);
		},
	};
}

async function runTurn(
	host: StudioAgentHost,
	pendingWork: PendingWork,
	config: BrowserAgentTurnConfig,
	onAgent: ( agent: Agent ) => void,
	isInterrupted: () => boolean
): Promise< { failure?: string } > {
	const visionEnabled = aiModelSupportsImages( config.model );
	const imageGeneration = Boolean( await host.wpcom.imageToken() );
	const tools = [
		...resolveConversationTools( host, {
			imageGeneration,
			visionEnabled,
			onAskUser: config.onAskUser,
			tracks: getAiTracksIdentity( config.sessionId ),
		} ),
		...createFileTools( host, { visionEnabled } ),
	];

	const site = config.activeSite;
	const systemPrompt = buildSystemPrompt( {
		tools: tools.map( ( tool ) => ( { name: tool.name, promptSnippet: tool.promptSnippet } ) ),
		activeSite: site,
		activeSiteDesignPath: await findActiveSiteDesign( host, site ),
		userInstructions: config.userInstructions,
	} );

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
			tools: tools.map( ( tool ) => withPendingWork( host, tool, pendingWork, resultNotes ) ),
			messages: config.history,
		},
		streamFn,
		transformContext: compactor.transform,
		sessionId: config.sessionId,
	} );
	onAgent( agent );
	// Interrupted before the agent existed to abort.
	if ( isInterrupted() ) {
		return {};
	}

	let finalEvent: AgentEvent | undefined;
	let emptyStopContinues = 0;
	let continuation: string | undefined;
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
				continuation = getEmptyStopContinuation( lastAssistant );
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
	while ( continuation && ! isInterrupted() ) {
		const message = continuation;
		continuation = undefined;
		emptyStopContinues++;
		await agent.prompt( message );
	}
	await pendingWork.settle();
	const failure = finalEvent ? getAgentEndFailure( finalEvent as never ) : null;
	return failure ? { failure: failure.message } : {};
}

// Work tools leave running reports with a later tool result, also in the
// conversation's next turn, so it is kept per conversation.
const pendingWorkBySession = new Map< string, PendingWork >();

/**
 * Studio Code for hosts without Node, such as Studio in a browser: the same
 * tools, skills and system prompt as `createAgent`, with pi-agent-core's loop
 * calling the model from the page, and the file tools over the host's files.
 * The app stores the conversation and passes it in with each turn.
 */
export function createBrowserAgent( { host }: { host: StudioAgentHost } ) {
	return {
		runTurn: ( config: BrowserAgentTurnConfig ): BrowserAgentTurnHandle => {
			const pendingWork = pendingWorkBySession.get( config.sessionId ) ?? new PendingWork();
			pendingWorkBySession.set( config.sessionId, pendingWork );
			let agent: Agent | undefined;
			let interrupted = false;
			return {
				result: runTurn(
					host,
					pendingWork,
					config,
					( created ) => ( agent = created ),
					() => interrupted
				).finally( () => {
					if ( pendingWork.isIdle() ) {
						pendingWorkBySession.delete( config.sessionId );
					}
				} ),
				interrupt: () => {
					interrupted = true;
					agent?.abort();
				},
			};
		},
	};
}

export type {
	HostFiles,
	HostPage,
	HostPages,
	HostPath,
	HostSite,
	StudioAgentHost,
} from '@studio/agent/shared/host';
export type { AskUserQuestion, SiteInfo } from '@studio/agent/shared/types';
export type { Message } from '@earendil-works/pi-ai';
