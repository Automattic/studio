import {
	isRenderableMediaWidget,
	isStudioChatArtifactData,
	stripMediaWidgetPayloadLines,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import { getToolResultDiff, type NormalizedToolResult } from '@studio/common/ai/tools';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';

export interface AgentQuestionRenderItem {
	key: string;
	question: string;
	options: Array< { label: string; description: string; image?: string } >;
	multiSelect?: boolean;
	pickedLabel?: string;
}

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
			text: string;
			attachments?: StudioChatAttachmentSummary[];
			annotation?: StudioVisualAnnotationSummary;
	  }
	| { kind: 'assistant-text'; key: string; text: string; messageText: string; copyText?: string }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
			running?: boolean;
	  }
	| {
			kind: 'agent-question-batch';
			key: string;
			questions: AgentQuestionRenderItem[];
	  }
	| {
			kind: 'chat-artifact';
			key: string;
			widgets: StudioChatArtifactWidgetDraft[];
	  }
	| { kind: 'progress'; key: string; text: string }
	| { kind: 'interrupted-marker'; key: string }
	| { kind: 'error-marker'; key: string; message: string };

// The line that closes a turn with how long it ran.
export interface TurnActivity {
	kind: 'activity';
	key: string;
	startedAt: number | null;
	endedAt: number | null;
	status: 'running' | 'success' | 'interrupted' | 'error';
}

export type TranscriptItem = Exclude< RenderItem, { kind: 'progress' } > | TurnActivity;

interface PiAssistantContentBlock {
	type: 'text' | 'toolCall' | 'thinking';
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record< string, unknown >;
}

interface PiAssistantMessageLike {
	role: 'assistant';
	content: PiAssistantContentBlock[];
}

interface PiToolResultLike {
	role: 'toolResult';
	toolCallId: string;
	content?: Array< { type: string; text?: string } >;
	details?: unknown;
	isError?: boolean;
}

const HIDDEN_TOOL_ROWS = new Set( [ 'AskUserQuestion', 'present_design_options' ] );
const ANSI_STYLE_SEQUENCE = new RegExp( `${ String.fromCharCode( 27 ) }\\[[\\d;]*m`, 'g' );

function resolveBatchedAnswerForQuestion(
	entries: SessionEntry[],
	entryIndex: number
): string | undefined {
	// Older transcripts store batched question answers as following
	// `ask_user` prompts, in the same order as the question entries.
	let batchPosition = 0;
	for ( let index = entryIndex - 1; index >= 0; index -= 1 ) {
		if ( ! isStudioCustomEntryOfType( entries[ index ], 'studio.agent_question' ) ) {
			break;
		}
		batchPosition += 1;
	}

	let batchSize = batchPosition + 1;
	let index = entryIndex + 1;
	while (
		index < entries.length &&
		isStudioCustomEntryOfType( entries[ index ], 'studio.agent_question' )
	) {
		batchSize += 1;
		index += 1;
	}

	const answers: string[] = [];
	for ( ; index < entries.length && answers.length < batchSize; index += 1 ) {
		const entry = entries[ index ];
		if (
			isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ||
			isStudioCustomEntryOfType( entry, 'studio.turn_closed' )
		) {
			break;
		}
		if ( ! isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			continue;
		}
		const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
		if ( data?.source !== 'ask_user' ) {
			break;
		}
		answers.push( data.text );
	}

	if ( answers.length !== batchSize ) {
		return undefined;
	}
	return answers[ batchPosition ];
}

function isPromptEntry( entry: SessionEntry ): boolean {
	return (
		isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) &&
		( entry as StudioCustomEntry< 'studio.user_prompt' > ).data?.source === 'prompt'
	);
}

export function entriesToRenderItems( entries: SessionEntry[] ): RenderItem[] {
	// First pass: collect tool_call_id → tool_result pairings so each
	// `toolCall` row can render its output inline.
	const resultsByToolCallId = new Map< string, NormalizedToolResult >();
	for ( const entry of entries ) {
		if ( entry.type !== 'message' ) continue;
		const message = ( entry as { message?: unknown } ).message as PiToolResultLike | undefined;
		if ( ! message || message.role !== 'toolResult' ) continue;
		const text = ( message.content ?? [] )
			.filter( ( b ) => b.type === 'text' && typeof b.text === 'string' )
			.map( ( b ) => b.text as string )
			.join( '\n' );
		resultsByToolCallId.set( message.toolCallId, {
			// Old transcripts embed media widget payload markers in screenshot
			// results; strip them from every tool's display text.
			text: stripMediaWidgetPayloadLines( text ).replace( ANSI_STYLE_SEQUENCE, '' ),
			isError: message.isError === true,
			diff: message.isError === true ? undefined : getToolResultDiff( message.details ),
		} );
	}

	const items: RenderItem[] = [];
	for ( let entryIndex = 0; entryIndex < entries.length; entryIndex += 1 ) {
		const entry = entries[ entryIndex ];
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) continue;
			if ( data.visualAnnotations?.length ) {
				// Each note shows its own images; the first bubble takes the rest.
				const noteImageIds = new Set(
					data.visualAnnotations.flatMap( ( annotation ) => annotation.imageIds ?? [] )
				);
				data.visualAnnotations.forEach( ( annotation, annotationIndex ) => {
					items.push( {
						kind: 'user-text',
						key: `${ entryIndex }:annotation:${ annotationIndex }`,
						text: annotation.comment,
						attachments: data.attachments?.filter( ( attachment ) =>
							attachment.kind === 'image' && noteImageIds.has( attachment.id )
								? annotation.imageIds?.includes( attachment.id )
								: annotationIndex === 0
						),
						annotation,
					} );
				} );
				continue;
			}
			items.push( {
				kind: 'user-text',
				key: `${ entryIndex }:user`,
				text: data.text,
				attachments: data.attachments,
			} );
			continue;
		}

		if ( entry.type === 'message' ) {
			const message = ( entry as { message?: unknown } ).message as
				| PiAssistantMessageLike
				| undefined;
			if ( ! message || message.role !== 'assistant' || ! Array.isArray( message.content ) ) {
				continue;
			}
			// A single assistant message can hold several text blocks split by tool
			// calls. Copy must yield the whole message, so join every text block and
			// hang one copy button off the last one rather than one per fragment.
			const textBlocks = message.content.filter(
				( block ) => block.type === 'text' && typeof block.text === 'string' && block.text.trim()
			);
			const fullMessageText = textBlocks
				.map( ( block ) => ( block.text as string ).trim() )
				.join( '\n\n' );
			const lastTextBlock = textBlocks[ textBlocks.length - 1 ];

			message.content.forEach( ( block, blockIndex ) => {
				if ( block.type === 'text' && typeof block.text === 'string' ) {
					const text = block.text.trim();
					if ( text ) {
						items.push( {
							kind: 'assistant-text',
							key: `${ entryIndex }:${ blockIndex }:text`,
							text,
							messageText: fullMessageText,
							copyText: block === lastTextBlock ? fullMessageText : undefined,
						} );
					}
				} else if (
					block.type === 'toolCall' &&
					typeof block.id === 'string' &&
					typeof block.name === 'string' &&
					! HIDDEN_TOOL_ROWS.has( block.name )
				) {
					items.push( {
						kind: 'tool-use',
						key: `${ entryIndex }:${ blockIndex }:tool`,
						name: block.name,
						input: ( block.arguments as Record< string, unknown > ) ?? {},
						result: resultsByToolCallId.get( block.id ),
					} );
				}
			} );
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
			const batchStartIndex = entryIndex;
			const questions: AgentQuestionRenderItem[] = [];
			for (
				;
				entryIndex < entries.length &&
				isStudioCustomEntryOfType( entries[ entryIndex ], 'studio.agent_question' );
				entryIndex += 1
			) {
				const data = ( entries[ entryIndex ] as StudioCustomEntry< 'studio.agent_question' > ).data;
				if ( ! data ) {
					continue;
				}
				questions.push( {
					key: `${ entryIndex }:question`,
					question: data.question,
					options: data.options,
					multiSelect: data.multiSelect,
					pickedLabel: data.selectedLabel ?? resolveBatchedAnswerForQuestion( entries, entryIndex ),
				} );
			}
			entryIndex -= 1;
			if ( questions.length === 0 ) {
				continue;
			}
			items.push( {
				kind: 'agent-question-batch',
				key: `${ batchStartIndex }:question-batch`,
				questions,
			} );
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.chat_artifact' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.chat_artifact' > ).data;
			// Guard against malformed persisted entries so one bad line can't
			// take down the whole transcript.
			if ( ! isStudioChatArtifactData( data ) ) {
				continue;
			}
			const widgets = data.widgets.filter( isRenderableMediaWidget );
			if ( widgets.length > 0 ) {
				items.push( {
					kind: 'chat-artifact',
					key: `${ entryIndex }:chat-artifact`,
					widgets,
				} );
			}
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.tool_progress' ) ) {
			const text = ( entry as StudioCustomEntry< 'studio.tool_progress' > ).data?.message?.trim();
			if ( text ) {
				items.push( { kind: 'progress', key: `${ entryIndex }:progress`, text } );
			}
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.turn_closed' > ).data;
			if ( data?.status === 'interrupted' ) {
				items.push( {
					kind: 'interrupted-marker',
					key: `${ entryIndex }:interrupted`,
				} );
			} else if ( data?.status === 'error' ) {
				items.push( {
					kind: 'error-marker',
					key: `${ entryIndex }:error`,
					message: ( data.errorMessage ?? '' ).replace( ANSI_STYLE_SEQUENCE, '' ),
				} );
			}
			continue;
		}
	}

	return items;
}

function getTimestamp( entry: SessionEntry | undefined ): number | null {
	const timestamp = entry ? Date.parse( entry.timestamp ) : NaN;
	return Number.isFinite( timestamp ) ? timestamp : null;
}

/**
 * Keeps each turn's items in the order they ran and closes the turn with a
 * line for how long it took. Tool progress shows only under a running turn.
 */
export function entriesToTranscriptItems(
	entries: SessionEntry[],
	run: { running: boolean; startedAt: number | null } = { running: false, startedAt: null }
): TranscriptItem[] {
	const items = entriesToRenderItems( entries );
	const entryIndexOf = ( item: RenderItem ) => Number.parseInt( item.key, 10 );
	const turns: Array< [ number, number ] > = [];
	let turnStart = 0;
	entries.forEach( ( entry, index ) => {
		if ( isPromptEntry( entry ) && index > turnStart ) {
			turns.push( [ turnStart, index ] );
			turnStart = index;
		}
		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			turns.push( [ turnStart, index + 1 ] );
			turnStart = index + 1;
		}
	} );
	if ( turnStart < entries.length ) {
		turns.push( [ turnStart, entries.length ] );
	}

	return turns.flatMap( ( [ start, end ], turnIndex ) => {
		const turnEntries = entries.slice( start, end );
		const turnItems = items.filter(
			( item ) => entryIndexOf( item ) >= start && entryIndexOf( item ) < end
		);
		const prompt = turnEntries.find( isPromptEntry );
		const closed = turnEntries.find( ( entry ) =>
			isStudioCustomEntryOfType( entry, 'studio.turn_closed' )
		) as StudioCustomEntry< 'studio.turn_closed' > | undefined;
		const running = run.running && turnIndex === turns.length - 1 && ! closed;
		const worked = turnItems.some(
			( item ) => item.kind === 'tool-use' || item.kind === 'progress'
		);
		const visible = turnItems.flatMap( ( item ): TranscriptItem[] => {
			if ( item.kind === 'progress' ) {
				return [];
			}
			return [ item.kind === 'tool-use' && running ? { ...item, running } : item ];
		} );
		if (
			! worked &&
			! running &&
			( ! prompt || ( ! closed && ! visible.some( ( item ) => item.kind === 'assistant-text' ) ) )
		) {
			return visible;
		}
		const status = closed?.data?.status;
		visible.push( {
			kind: 'activity',
			key: `${ start }:activity`,
			startedAt: ( running ? run.startedAt : null ) ?? getTimestamp( prompt ),
			endedAt: running ? null : getTimestamp( closed ?? turnEntries[ turnEntries.length - 1 ] ),
			status: running
				? 'running'
				: status === 'interrupted'
				? 'interrupted'
				: status === 'error' || status === 'max_turns'
				? 'error'
				: 'success',
		} );
		return visible;
	} );
}

// The running tool's latest progress, while it is the last thing in the transcript.
export function getProgressMessage( entries: SessionEntry[] ): string | null {
	const last = entries[ entries.length - 1 ];
	return last && isStudioCustomEntryOfType( last, 'studio.tool_progress' )
		? ( last as StudioCustomEntry< 'studio.tool_progress' > ).data?.message ?? null
		: null;
}

// Consecutive messages from the same side read as one group.
export function getSender( item: TranscriptItem | undefined ) {
	if ( item?.kind === 'user-text' ) {
		return 'user';
	}
	return item?.kind === 'assistant-text' || item?.kind === 'agent-question-batch'
		? 'assistant'
		: undefined;
}
