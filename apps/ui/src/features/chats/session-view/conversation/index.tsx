import {
	getLocalMediaPath,
	getMediaAltText,
	getSafeMediaUrl,
	isRenderableMediaWidget,
	isStudioChatArtifactData,
	stripMediaWidgetPayloadLines,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import {
	isAiAccessRequiredError,
	isAiBlockedError,
	isOutOfCreditsError,
	isUsageCapError,
} from '@studio/common/ai/json-events';
import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	getFreeFormOptionDescription,
	getFreeFormOptionLabel,
	getInputString,
	getToolDetail,
	getToolDisplayName,
	getToolResultDiff,
	findOwnFreeFormOptionLabel,
	STOPPED_WITHOUT_ANSWER,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { formatUsageCapNotice } from '@studio/common/lib/studio-assistant-quota';
import { useReducedMotion } from '@wordpress/compose';
import { __, isRTL, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleStopIcon,
	FileTextIcon,
	ImageIcon,
	SearchIcon,
} from 'lucide-react';
import {
	useEffect,
	useEffectEvent,
	useId,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from 'react';
import { AiAccessRequiredNotice, AiBlockedNotice } from '@/components/ai-access-required-notice';
import { CodeBlock } from '@/components/code-block';
import { CopyButton } from '@/components/copy-button';
import { Markdown } from '@/components/markdown';
import { Button, IconButton } from '@/components/ui/button';
import { CollapsiblePanel } from '@/components/ui/collapsible';
import { Dialog, DialogClose, DialogContent, DialogDismissButton } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { MESSAGE_TEXT_ATTRIBUTE, QUOTABLE_TEXT_ATTRIBUTE } from '@/hooks/use-text-context-menu';
import { isTextEntry } from '@/lib/shortcuts';
import { SCROLL_ANCHOR_ATTRIBUTE } from '../use-anchored-scroll';
import styles from './style.module.css';
import type { LoadedAiSession } from '@/data/core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';

interface AgentQuestionRenderItem {
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
interface TurnActivity {
	kind: 'activity';
	key: string;
	startedAt: number | null;
	endedAt: number | null;
	status: 'running' | 'success' | 'interrupted' | 'error';
}

type TranscriptItem = Exclude< RenderItem, { kind: 'progress' } > | TurnActivity;

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
const QUESTION_COLLAPSE_DELAY_MS = 650;
const QUESTION_SCROLL_TOP_MARGIN_PX = 12;
// Only a pre-layout fallback. The scroller spans the full column with the
// composer floating over it, so the space to actually keep clear is the
// scroller's reserved bottom padding, which tracks the live composer height.
const QUESTION_SCROLL_BOTTOM_CLEARANCE_PX = 96;

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
function getProgressMessage( entries: SessionEntry[] ): string | null {
	const last = entries[ entries.length - 1 ];
	return last && isStudioCustomEntryOfType( last, 'studio.tool_progress' )
		? ( last as StudioCustomEntry< 'studio.tool_progress' > ).data?.message ?? null
		: null;
}

interface Joined {
	joinedAbove?: boolean;
	joinedBelow?: boolean;
}

function joinedAttributes( { joinedAbove, joinedBelow }: Joined ) {
	return {
		'data-joined-above': joinedAbove || undefined,
		'data-joined-below': joinedBelow || undefined,
	};
}

// Consecutive messages from the same side read as one group.
function getSender( item: TranscriptItem | undefined ) {
	if ( item?.kind === 'user-text' ) {
		return 'user';
	}
	return item?.kind === 'assistant-text' || item?.kind === 'agent-question-batch'
		? 'assistant'
		: undefined;
}

function UserTurn( {
	text,
	attachments,
	annotation,
	...joined
}: {
	text: string;
	attachments?: StudioChatAttachmentSummary[];
	annotation?: StudioVisualAnnotationSummary;
} & Joined ) {
	return (
		<div
			className={ styles.userTurn }
			{ ...joinedAttributes( joined ) }
			{ ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: text, [ SCROLL_ANCHOR_ATTRIBUTE ]: '' } }
		>
			{ text || attachments?.length ? (
				<div className={ styles.userTextRow }>
					{ text ? (
						<CopyButton
							className={ styles.messageActions }
							size="icon-sm"
							text={ text }
							label={ __( 'Copy message' ) }
						/>
					) : null }
					<div className={ styles.userText }>
						{ text ? <div className={ styles.userTextBody }>{ text }</div> : null }
						{ attachments?.length ? (
							<ul className={ styles.userAttachments }>
								{ attachments.map( ( attachment, index ) => (
									<li key={ `${ attachment.name }:${ index }` } className={ styles.userAttachment }>
										<span className={ styles.userAttachmentPreview }>
											{ attachment.kind === 'image' && attachment.previewDataUrl ? (
												<img src={ attachment.previewDataUrl } alt="" />
											) : attachment.kind === 'image' ? (
												<ImageIcon />
											) : (
												<FileTextIcon />
											) }
										</span>
										<span className={ styles.userAttachmentName } title={ attachment.name }>
											{ attachment.name }
										</span>
									</li>
								) ) }
							</ul>
						) : null }
					</div>
				</div>
			) : null }
			{ annotation?.elementLabel || annotation?.tag ? (
				<div className={ styles.annotationAttachment }>
					<span className={ styles.annotationElementTag }>
						{ annotation.elementLabel ?? `<${ annotation.tag }>` }
					</span>
					{ annotation.nearbyText ? (
						<span className={ styles.annotationElementText }>{ annotation.nearbyText }</span>
					) : null }
				</div>
			) : null }
		</div>
	);
}

function AssistantText( {
	text,
	messageText,
	copyText,
	...joined
}: {
	text: string;
	messageText: string;
	copyText?: string;
} & Joined ) {
	return (
		<div
			className={ styles.assistantTurn }
			{ ...joinedAttributes( joined ) }
			{ ...{
				[ MESSAGE_TEXT_ATTRIBUTE ]: messageText,
				[ QUOTABLE_TEXT_ATTRIBUTE ]: true,
			} }
		>
			<div className={ styles.assistantBubble }>
				<Markdown>{ text }</Markdown>
			</div>
			{ copyText ? (
				<CopyButton
					className={ styles.messageActions }
					size="icon-sm"
					text={ copyText }
					label={ __( 'Copy message' ) }
				/>
			) : null }
		</div>
	);
}

function TraceTrigger( { children, ...props }: ComponentProps< 'button' > ) {
	return (
		<button type="button" className={ styles.traceTrigger } { ...props }>
			{ children }
			<ChevronRightIcon className={ styles.traceChevron } />
		</button>
	);
}

const TOOL_DETAIL_MAX_LENGTH = 96;

interface ClassicToolDisplay {
	label: string;
	detail: string;
	inputText: string;
}

function truncateToolDetail( value: string, maxLength = TOOL_DETAIL_MAX_LENGTH ): string {
	if ( value.length <= maxLength ) {
		return value;
	}
	return value.slice( 0, maxLength - 1 ).trimEnd() + '…';
}

function stringifyToolInput( input: Record< string, unknown > ): string {
	try {
		return JSON.stringify( input, null, 2 );
	} catch {
		return String( input );
	}
}

function getClassicToolInputText(
	name: string,
	input: Record< string, unknown > | undefined
): string {
	if ( ! input || Object.keys( input ).length === 0 ) {
		return '';
	}

	if ( name === 'wp_cli' ) {
		const command = getInputString( input, 'command' );
		return command ? `wp ${ command }` : '';
	}

	if ( name === 'Bash' ) {
		return getInputString( input, 'command' );
	}

	return stringifyToolInput( input );
}

function getClassicToolDisplay(
	name: string,
	input: Record< string, unknown > | undefined
): ClassicToolDisplay {
	const genericDetail = getToolDetail( name, input );
	const display: ClassicToolDisplay = {
		label: getToolDisplayName( name, input ),
		detail: genericDetail,
		inputText: getClassicToolInputText( name, input ),
	};

	switch ( name ) {
		case 'wp_cli':
			display.detail = '';
			break;
		case 'Bash':
			display.label = __( 'Run terminal command' );
			display.detail = '';
			break;
		case 'take_screenshot':
		case 'inspect_design':
		case 'open_annotation_browser':
			display.detail = '';
			break;
	}

	display.detail = truncateToolDetail( display.detail );
	return display;
}

function ToolUseRow( {
	name,
	input,
	result,
	isRunning,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
	isRunning: boolean;
} ) {
	const display = getClassicToolDisplay( name, input );
	const detailsId = useId();
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const hasInput = display.inputText.length > 0;
	const hasDiff = Boolean( result?.diff );
	const hasExpandableDetails = hasInput || hasOutput || hasDiff;
	const [ toggledOpen, setToggledOpen ] = useState< boolean | null >( null );
	const expanded = toggledOpen ?? result?.isError === true;
	const running = isRunning && ! result;
	const line = (
		<span className={ styles.traceLine } data-status={ result?.isError ? 'error' : undefined }>
			{ result?.isError ? (
				<CircleAlertIcon />
			) : result ? (
				<CircleCheckIcon />
			) : running ? (
				<Spinner aria-hidden="true" />
			) : (
				<CircleStopIcon />
			) }
			<span className={ clsx( styles.traceTitle, running && 'studio-shimmer' ) }>
				{ display.detail ? `${ display.label } ${ display.detail }` : display.label }
			</span>
		</span>
	);

	return (
		<div className={ styles.toolRow }>
			{ hasExpandableDetails ? (
				<TraceTrigger
					aria-expanded={ expanded }
					aria-controls={ detailsId }
					onClick={ () => setToggledOpen( ! expanded ) }
				>
					{ line }
				</TraceTrigger>
			) : (
				line
			) }
			<CollapsiblePanel open={ hasExpandableDetails && expanded } id={ detailsId }>
				<div className={ styles.toolDetails }>
					{ hasInput ? (
						<CodeBlock
							className={ styles.toolCode }
							code={ display.inputText }
							language={ name === 'wp_cli' || name === 'Bash' ? 'shell' : 'json' }
						/>
					) : null }
					{ hasOutput ? <pre className={ styles.toolOutput }>{ resultText }</pre> : null }
					{ hasDiff ? (
						<CodeBlock
							className={ styles.toolCode }
							code={ result!.diff!.replace( /\n$/, '' ) }
							language="diff"
						/>
					) : null }
				</div>
			</CollapsiblePanel>
		</div>
	);
}

function ChatArtifact( { widgets }: { widgets: StudioChatArtifactWidgetDraft[] } ) {
	return (
		<div className={ styles.mediaArtifacts }>
			{ widgets.map( ( widget, index ) => (
				<MediaArtifactImage key={ `${ widget.type }:${ index }` } widget={ widget } />
			) ) }
		</div>
	);
}

function MediaArtifactImage( { widget }: { widget: StudioChatArtifactWidgetDraft } ) {
	const localPath = getLocalMediaPath( widget );
	const safeUrl = getSafeMediaUrl( widget );
	const localFileQuery = useLocalMediaDataUrl( localPath );

	const src = localPath ? localFileQuery.data ?? null : safeUrl;

	if ( src ) {
		return (
			<img
				className={ styles.mediaArtifactImage }
				src={ src }
				alt={ getMediaAltText( widget, __( 'Image' ) ) }
			/>
		);
	}
	return (
		<div className={ styles.marker } role="status">
			{ localFileQuery.isError || ! localPath
				? __( 'Image could not load' )
				: __( 'Loading image…' ) }
		</div>
	);
}

function getAnswerLetter(
	options: AgentQuestionRenderItem[ 'options' ],
	pickedLabel: string
): string | undefined {
	const index = options.findIndex( ( option ) => option.label === pickedLabel );
	return index < 0 ? undefined : String.fromCharCode( 65 + index );
}

function QuestionAnswer( { letter, label }: { letter?: string; label: string } ) {
	return (
		<span className={ styles.questionAnswer }>
			{ letter ? (
				<span className={ styles.questionLetter } aria-hidden="true">
					{ letter }
				</span>
			) : null }
			<span className={ styles.questionAnswerLabel }>{ label }</span>
			<CheckIcon aria-hidden="true" />
		</span>
	);
}

function AgentQuestion( {
	question,
	options,
	multiSelect = false,
	isInteractive,
	pickedLabel,
	isCollapsing = false,
	freeFormActive = false,
	progress,
	onAnswer,
	onChooseFreeForm,
	...joined
}: {
	question: string;
	options: Array< { label: string; description: string; image?: string } >;
	multiSelect?: boolean;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	isCollapsing?: boolean;
	freeFormActive?: boolean;
	progress?: string;
	onAnswer: ( label: string ) => void;
	onChooseFreeForm: () => void;
} & Joined ) {
	const optionsId = useId();
	const isFolding = isCollapsing && Boolean( pickedLabel );
	// The stop marker is written by the app, not the user.
	const answered =
		!! pickedLabel && pickedLabel !== STOPPED_WITHOUT_ANSWER && ! isInteractive && ! isFolding;
	const answering = isInteractive && ! isFolding;
	const freeFormLabel = getFreeFormOptionLabel();
	// An off-contract model writes its own escape hatch. Drive the composer from
	// that one rather than appending a second, so either way the user types the
	// answer instead of sending the label back as one.
	const ownFreeFormLabel = answering ? findOwnFreeFormOptionLabel( options ) : undefined;
	const showFreeForm = answering && ! ownFreeFormLabel;
	const viewable = options.filter( ( option ) => option.image );
	const hasImages = viewable.length > 0;
	const [ draft, setDraft ] = useState< { pickedLabel?: string; labels: string[] } | null >( null );
	const [ viewing, setViewing ] = useState< number | null >( null );
	const answeredLabels = multiSelect ? pickedLabel?.split( ', ' ) ?? [] : [ pickedLabel ];
	const pickedLabels = draft && draft.pickedLabel === pickedLabel ? draft.labels : answeredLabels;
	const toggle = ( label: string ) =>
		setDraft( {
			pickedLabel,
			labels: options
				.map( ( option ) => option.label )
				.filter( ( other ) => ( other === label ) !== pickedLabels.includes( other ) ),
		} );
	const choose = ( label: string ) => {
		if ( label === ownFreeFormLabel ) {
			onChooseFreeForm();
		} else if ( multiSelect ) {
			toggle( label );
		} else {
			onAnswer( label );
		}
	};
	// The letter keys pick the options they're lettered with.
	const onKeyDown = useEffectEvent( ( event: KeyboardEvent ) => {
		if (
			! /^[a-z]$/i.test( event.key ) ||
			event.defaultPrevented ||
			event.repeat ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			isTextEntry( event.target ) ||
			( event.target instanceof Element &&
				event.target.closest( '[role="dialog"], [role="menu"]' ) )
		) {
			return;
		}
		const index = event.key.toUpperCase().charCodeAt( 0 ) - 65;
		if ( options[ index ] ) {
			choose( options[ index ].label );
		} else if ( showFreeForm && index === options.length ) {
			onChooseFreeForm();
		} else {
			return;
		}
		event.preventDefault();
	} );
	useEffect( () => {
		if ( ! answering ) {
			return;
		}
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ answering ] );

	const choice = (
		index: number,
		label: string,
		description: string | undefined,
		picked: boolean,
		{ image, freeForm = false }: { image?: string; freeForm?: boolean } = {}
	) => {
		const descriptionId = description ? `${ optionsId }-option-${ index }-description` : undefined;
		return (
			<button
				type="button"
				className={ clsx( styles.questionChoice, freeForm && styles.questionChoiceFreeForm ) }
				disabled={ ! isInteractive }
				onClick={ freeForm ? onChooseFreeForm : () => choose( label ) }
				aria-label={ label }
				aria-describedby={ descriptionId }
				aria-pressed={ picked }
				data-has-image={ image ? 'true' : undefined }
			>
				{ image ? <QuestionOptionImage path={ image } /> : null }
				{ answering ? (
					<span className={ styles.questionLetter } aria-hidden="true">
						{ String.fromCharCode( 65 + index ) }
					</span>
				) : null }
				<span className={ styles.questionChoiceLabel }>
					<span>{ label }</span>
					{ description ? (
						<span id={ descriptionId } className={ styles.questionChoiceDescription }>
							{ description }
						</span>
					) : null }
				</span>
				{ picked ? <CheckIcon aria-hidden="true" /> : null }
			</button>
		);
	};

	return (
		<div
			className={ styles.questionCard }
			data-state={ isFolding ? 'folding' : undefined }
			{ ...joinedAttributes( joined ) }
		>
			{ progress ? <span className={ styles.questionProgress }>{ progress }</span> : null }
			<p className={ styles.questionText }>{ question }</p>
			{ answered ? (
				<QuestionAnswer
					letter={ multiSelect ? undefined : getAnswerLetter( options, pickedLabel ) }
					label={ pickedLabel }
				/>
			) : (
				<>
					{ multiSelect ? (
						<span className={ styles.questionHint }>{ __( 'Select all that apply.' ) }</span>
					) : null }
					<ol className={ styles.questionChoices } data-layout={ hasImages ? 'grid' : undefined }>
						{ options.map( ( option, index ) => {
							const isOwnFreeForm = option.label === ownFreeFormLabel;
							const picked = isOwnFreeForm ? freeFormActive : pickedLabels.includes( option.label );
							return (
								<li
									key={ index }
									className={ styles.questionChoiceItem }
									data-picked={ picked ? 'true' : undefined }
									data-wide={ hasImages && ! option.image ? 'true' : undefined }
								>
									{ choice(
										index,
										option.label,
										isOwnFreeForm ? getFreeFormOptionDescription() : option.description,
										picked,
										{ image: option.image, freeForm: isOwnFreeForm }
									) }
									{ option.image ? (
										<IconButton
											className={ styles.questionOptionZoom }
											size="icon-2xs"
											icon={ <SearchIcon /> }
											label={ sprintf(
												// translators: %s: name of a design option.
												__( 'View %s larger' ),
												option.label
											) }
											onClick={ () => setViewing( viewable.indexOf( option ) ) }
										/>
									) : null }
								</li>
							);
						} ) }
						{ showFreeForm ? (
							<li
								className={ styles.questionChoiceItem }
								data-picked={ freeFormActive ? 'true' : undefined }
								data-wide={ hasImages ? 'true' : undefined }
							>
								{ choice(
									options.length,
									freeFormLabel,
									getFreeFormOptionDescription(),
									freeFormActive,
									{ freeForm: true }
								) }
							</li>
						) : null }
					</ol>
					{ hasImages ? (
						<QuestionOptionViewer
							options={ viewable }
							index={ viewing }
							onIndexChange={ setViewing }
							onChoose={ isInteractive && ! multiSelect ? onAnswer : undefined }
						/>
					) : null }
					{ multiSelect && isInteractive ? (
						<div>
							<Button
								variant="outline"
								disabled={ pickedLabels.length === 0 }
								onClick={ () => onAnswer( pickedLabels.join( ', ' ) ) }
							>
								{ __( 'Submit choices' ) }
							</Button>
						</div>
					) : null }
				</>
			) }
		</div>
	);
}

function QuestionOptionImage( { path }: { path: string | undefined } ) {
	const localFileQuery = useLocalMediaDataUrl( path ?? null );

	if ( ! path || localFileQuery.isError ) {
		return (
			<span className={ styles.questionOptionImageUnavailable } aria-hidden="true">
				{ path ? __( 'Preview unavailable' ) : null }
			</span>
		);
	}
	if ( ! localFileQuery.data ) {
		return <span className={ styles.questionOptionImageLoading } aria-hidden="true" />;
	}
	return <img className={ styles.questionOptionImage } src={ localFileQuery.data } alt="" />;
}

function QuestionOptionViewer( {
	options,
	index,
	onIndexChange,
	onChoose,
}: {
	options: Array< { label: string; description: string; image?: string } >;
	index: number | null;
	onIndexChange: ( index: number | null ) => void;
	onChoose?: ( label: string ) => void;
} ) {
	const option = index === null ? undefined : options[ index ];
	const localFileQuery = useLocalMediaDataUrl( option?.image ?? null );
	const step = ( delta: number ) =>
		index !== null && onIndexChange( ( index + delta + options.length ) % options.length );
	const previousIcon = isRTL() ? <ChevronRightIcon /> : <ChevronLeftIcon />;
	const nextIcon = isRTL() ? <ChevronLeftIcon /> : <ChevronRightIcon />;

	return (
		<Dialog
			open={ option !== undefined }
			onOpenChange={ ( open ) => ! open && onIndexChange( null ) }
		>
			<DialogContent
				className={ styles.questionOptionZoomPopup }
				aria-label={ option?.label }
				onKeyDown={ ( event ) => {
					if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
						event.preventDefault();
						step( ( event.key === 'ArrowRight' ) !== isRTL() ? 1 : -1 );
					}
				} }
			>
				{ localFileQuery.data ? (
					<img
						className={ styles.questionOptionZoomImage }
						src={ localFileQuery.data }
						alt={ option?.label }
					/>
				) : null }
				<DialogClose
					className={ styles.questionOptionZoomClose }
					render={ <DialogDismissButton variant="ghost" size="icon-2xs" /> }
				/>
				<IconButton
					className={ clsx( styles.questionOptionZoomStep, styles.questionOptionZoomPrevious ) }
					size="icon-2xs"
					icon={ previousIcon }
					label={ __( 'Previous option' ) }
					onClick={ () => step( -1 ) }
				/>
				<IconButton
					className={ clsx( styles.questionOptionZoomStep, styles.questionOptionZoomNext ) }
					size="icon-2xs"
					icon={ nextIcon }
					label={ __( 'Next option' ) }
					onClick={ () => step( 1 ) }
				/>
				{ option && onChoose ? (
					<Button
						className={ styles.questionOptionZoomChoose }
						variant="accent"
						size="header"
						onClick={ () => {
							onIndexChange( null );
							onChoose( option.label );
						} }
					>
						{ __( 'Choose' ) }
					</Button>
				) : null }
			</DialogContent>
		</Dialog>
	);
}

function getQuestionPickedLabel(
	question: AgentQuestionRenderItem,
	pendingAnswers: Record< string, string >
): string | undefined {
	return pendingAnswers[ question.question ] ?? question.pickedLabel;
}

function findFirstUnansweredQuestionIndex(
	questions: AgentQuestionRenderItem[],
	pendingQuestions: Set< string >,
	pendingAnswers: Record< string, string >
): number {
	for ( let index = 0; index < questions.length; index += 1 ) {
		const question = questions[ index ];
		const pickedLabel = getQuestionPickedLabel( question, pendingAnswers );
		if ( pendingQuestions.has( question.question ) && ! pickedLabel ) {
			return index;
		}
	}
	return -1;
}

function getNearestScrollContainer( element: HTMLElement ): HTMLElement | null {
	let parent = element.parentElement;
	while ( parent ) {
		const style = window.getComputedStyle( parent );
		const overflow = `${ style.overflow } ${ style.overflowY }`;
		if ( /(auto|scroll|overlay)/.test( overflow ) && parent.scrollHeight > parent.clientHeight ) {
			return parent;
		}
		parent = parent.parentElement;
	}
	return null;
}

function getPaddingBottom( element: HTMLElement ): number {
	const paddingBottom = parseFloat( window.getComputedStyle( element ).paddingBottom );
	return Number.isFinite( paddingBottom ) ? paddingBottom : 0;
}

function getReservedBottomSpace( element: HTMLElement, container: HTMLElement | null ): number {
	if ( ! container ) {
		return QUESTION_SCROLL_BOTTOM_CLEARANCE_PX;
	}
	// The scroller's padding holds content clear of the floating composer; the
	// column's own trailing space keeps the card from settling flush against it.
	let column = element;
	while ( column.parentElement && column.parentElement !== container ) {
		column = column.parentElement;
	}
	return getPaddingBottom( container ) + getPaddingBottom( column );
}

export function getQuestionScrollDelta( {
	elementTop,
	elementBottom,
	containerTop,
	containerBottom,
	reservedBottomSpace,
}: {
	elementTop: number;
	elementBottom: number;
	containerTop: number;
	containerBottom: number;
	reservedBottomSpace: number;
} ): number {
	const topOverflow = elementTop - ( containerTop + QUESTION_SCROLL_TOP_MARGIN_PX );
	const bottomOverflow = elementBottom - ( containerBottom - reservedBottomSpace );
	return topOverflow < 0 ? topOverflow : Math.max( bottomOverflow, 0 );
}

function scrollElementIntoViewIfNeeded( element: HTMLElement, prefersReducedMotion: boolean ) {
	const container = getNearestScrollContainer( element );
	const elementRect = element.getBoundingClientRect();
	const containerRect = container
		? container.getBoundingClientRect()
		: {
				top: 0,
				right: window.innerWidth || document.documentElement.clientWidth,
				bottom: window.innerHeight || document.documentElement.clientHeight,
				left: 0,
		  };
	const scrollDelta = getQuestionScrollDelta( {
		elementTop: elementRect.top,
		elementBottom: elementRect.bottom,
		containerTop: containerRect.top,
		containerBottom: containerRect.bottom,
		reservedBottomSpace: getReservedBottomSpace( element, container ),
	} );

	if ( scrollDelta !== 0 ) {
		const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
		if ( container ) {
			container.scrollBy( {
				top: scrollDelta,
				behavior,
			} );
			return;
		}
		window.scrollBy( {
			top: scrollDelta,
			behavior,
		} );
	}
}

function QuestionSummary( {
	index,
	total,
	question,
	options,
	pickedLabel,
	canEdit,
	onClick,
	...joined
}: {
	index: number;
	total: number;
	question: string;
	options: AgentQuestionRenderItem[ 'options' ];
	pickedLabel: string;
	canEdit: boolean;
	onClick: () => void;
} & Joined ) {
	const content = (
		<>
			<span className={ styles.questionText }>{ question }</span>
			<QuestionAnswer letter={ getAnswerLetter( options, pickedLabel ) } label={ pickedLabel } />
		</>
	);

	if ( ! canEdit ) {
		return (
			<div className={ styles.questionCard } { ...joinedAttributes( joined ) }>
				{ content }
			</div>
		);
	}

	return (
		<button
			type="button"
			className={ clsx( styles.questionCard, styles.questionSummary ) }
			{ ...joinedAttributes( joined ) }
			onClick={ onClick }
			aria-label={ sprintf(
				__( 'Edit question %1$d of %2$d: %3$s. Selected answer: %4$s' ),
				index + 1,
				total,
				question,
				pickedLabel
			) }
		>
			{ content }
		</button>
	);
}

function AgentQuestionBatch( {
	questions,
	pendingQuestions,
	pendingAnswers,
	freeFormQuestion,
	onAnswer,
	onChooseFreeForm,
	joinedAbove,
	joinedBelow,
}: {
	questions: AgentQuestionRenderItem[];
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	freeFormQuestion: string | null;
	onAnswer: ( question: string, label: string ) => void;
	onChooseFreeForm: ( question: string ) => void;
} & Joined ) {
	const [ expandedIndex, setExpandedIndex ] = useState< number | null >( null );
	const [ settlingIndex, setSettlingIndex ] = useState< number | null >( null );
	const prefersReducedMotion = useReducedMotion();
	const activeQuestionRef = useRef< HTMLDivElement | null >( null );
	const shouldFocusActiveQuestionRef = useRef( false );
	const total = questions.length;
	const firstUnansweredIndex = findFirstUnansweredQuestionIndex(
		questions,
		pendingQuestions,
		pendingAnswers
	);
	const activeIndex = settlingIndex ?? expandedIndex ?? firstUnansweredIndex;
	const visibleQuestionCount = activeIndex === -1 ? total : Math.min( activeIndex + 1, total );

	useEffect( () => {
		setExpandedIndex( ( index ) =>
			index === null || index < total ? index : Math.max( total - 1, 0 )
		);
		setSettlingIndex( ( index ) =>
			index === null || index < total ? index : Math.max( total - 1, 0 )
		);
	}, [ total ] );

	useEffect( () => {
		if ( settlingIndex === null ) {
			return;
		}
		if ( prefersReducedMotion ) {
			setSettlingIndex( null );
			return;
		}
		const timeoutId = window.setTimeout(
			() => setSettlingIndex( null ),
			QUESTION_COLLAPSE_DELAY_MS
		);
		return () => window.clearTimeout( timeoutId );
	}, [ prefersReducedMotion, settlingIndex ] );

	useEffect( () => {
		if ( activeIndex === -1 || settlingIndex !== null ) {
			if ( activeIndex === -1 && settlingIndex === null ) {
				shouldFocusActiveQuestionRef.current = false;
			}
			return;
		}
		const animationFrameId = window.requestAnimationFrame( () => {
			const element = activeQuestionRef.current;
			if ( element ) {
				scrollElementIntoViewIfNeeded( element, prefersReducedMotion );
				if ( shouldFocusActiveQuestionRef.current ) {
					element.focus( { preventScroll: true } );
					shouldFocusActiveQuestionRef.current = false;
				}
			}
		} );
		return () => window.cancelAnimationFrame( animationFrameId );
	}, [ activeIndex, prefersReducedMotion, settlingIndex ] );

	if ( total === 0 ) {
		return null;
	}

	if ( total === 1 ) {
		const question = questions[ 0 ];
		// The scroll-into-view effect needs a target here too, or a lone question
		// stays half-hidden behind the composer when the agent asks it.
		return (
			<div
				ref={ activeIndex === 0 ? activeQuestionRef : undefined }
				{ ...joinedAttributes( { joinedAbove, joinedBelow } ) }
			>
				<AgentQuestion
					question={ question.question }
					options={ question.options }
					multiSelect={ question.multiSelect }
					isInteractive={ pendingQuestions.has( question.question ) }
					pickedLabel={ getQuestionPickedLabel( question, pendingAnswers ) }
					freeFormActive={ freeFormQuestion === question.question }
					onAnswer={ ( label ) => onAnswer( question.question, label ) }
					onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
					joinedAbove={ joinedAbove }
					joinedBelow={ joinedBelow }
				/>
			</div>
		);
	}

	const handleAnswer = ( question: AgentQuestionRenderItem, index: number, label: string ) => {
		shouldFocusActiveQuestionRef.current = true;
		setExpandedIndex( null );
		setSettlingIndex( index );
		onAnswer( question.question, label );
	};

	return (
		<div className={ styles.questionBatch } { ...joinedAttributes( { joinedAbove, joinedBelow } ) }>
			{ questions.slice( 0, visibleQuestionCount ).map( ( question, index ) => {
				const pickedLabel = getQuestionPickedLabel( question, pendingAnswers );
				const isActive = index === activeIndex;
				const joined = {
					joinedAbove: joinedAbove || index > 0,
					joinedBelow: joinedBelow || index < visibleQuestionCount - 1,
				};
				if ( ! isActive && pickedLabel ) {
					return (
						<QuestionSummary
							key={ question.key }
							index={ index }
							total={ total }
							question={ question.question }
							options={ question.options }
							pickedLabel={ pickedLabel }
							canEdit={ pendingQuestions.has( question.question ) }
							onClick={ () => setExpandedIndex( index ) }
							{ ...joined }
						/>
					);
				}
				return (
					<div
						key={ question.key }
						ref={ isActive ? activeQuestionRef : undefined }
						className={ styles.questionBatchStep }
						data-state={ settlingIndex === index ? 'answered' : 'asking' }
						tabIndex={ isActive ? -1 : undefined }
						aria-label={
							isActive ? sprintf( __( 'Current question: %s' ), question.question ) : undefined
						}
					>
						<AgentQuestion
							progress={ sprintf( __( 'Asking question %1$d of %2$d' ), index + 1, total ) }
							question={ question.question }
							options={ question.options }
							multiSelect={ question.multiSelect }
							isInteractive={ pendingQuestions.has( question.question ) && settlingIndex !== index }
							pickedLabel={ pickedLabel }
							isCollapsing={ settlingIndex === index }
							freeFormActive={ freeFormQuestion === question.question }
							onAnswer={ ( label ) => handleAnswer( question, index, label ) }
							onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
							{ ...joined }
						/>
					</div>
				);
			} ) }
		</div>
	);
}

function TurnActivityLine( {
	activity: { startedAt, endedAt, status },
	waitingOnUser,
	progressMessage,
}: {
	activity: TurnActivity;
	waitingOnUser: boolean;
	progressMessage: string | null;
} ) {
	const running = status === 'running';
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		if ( ! running ) {
			return;
		}
		setNow( Date.now() );
		const timer = window.setInterval( () => setNow( Date.now() ), 1000 );
		return () => window.clearInterval( timer );
	}, [ running ] );
	const end = running ? now : endedAt;
	const seconds =
		startedAt === null || end === null
			? null
			: Math.max( 0, Math.floor( ( end - startedAt ) / 1000 ) );
	const label =
		seconds === null && status !== 'running'
			? { success: __( 'Worked' ), interrupted: __( 'Stopped' ), error: __( 'Failed' ) }[ status ]
			: sprintf(
					{
						/* translators: %d: number of seconds. */
						running: __( 'Working for %ds' ),
						/* translators: %d: number of seconds. */
						success: __( 'Worked for %ds' ),
						/* translators: %d: number of seconds. */
						interrupted: __( 'Stopped after %ds' ),
						/* translators: %d: number of seconds. */
						error: __( 'Failed after %ds' ),
					}[ status ],
					seconds ?? 0
			  );
	return (
		<div className={ styles.activity }>
			<span className={ styles.traceLine } data-status={ status === 'error' ? 'error' : undefined }>
				<span
					className={ clsx( styles.traceTitle, running && ! waitingOnUser && 'studio-shimmer' ) }
				>
					{ label }
				</span>
			</span>
			{ running && progressMessage ? (
				<span className={ styles.activityProgress }>{ progressMessage }</span>
			) : null }
		</div>
	);
}

// In-flow marker for a turn that ended in an error. The proxy's quota
// refusals get dedicated copy instead of the raw provider message: the
// monthly usage cap shows the reset date once the quota query resolves, and
// out-of-credits (STU-2236) points at buying credits — waiting doesn't fix
// that one.
function TurnErrorMarker( { message }: { message: string } ) {
	const isUsageCap = isUsageCapError( message );
	const isAccessRequired = isAiAccessRequiredError( message );
	const { data: quota } = useStudioAssistantQuota( { enabled: isUsageCap || isAccessRequired } );

	// Out of credits says nothing here: the purchase card has already taken
	// the composer's place, and repeating it in the transcript is noise.
	if ( isOutOfCreditsError( message ) ) {
		return null;
	}
	let text: ReactNode;
	if ( isAiBlockedError( message ) ) {
		text = <AiBlockedNotice />;
	} else if ( isAccessRequired ) {
		text = <AiAccessRequiredNotice quota={ quota } />;
	} else if ( isUsageCap ) {
		text = formatUsageCapNotice( quota?.costResetDate );
	} else {
		text = message || __( 'Something went wrong and this turn was stopped. Please try again.' );
	}
	return (
		<div className={ styles.marker } role="alert">
			{ text }
		</div>
	);
}

export function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	freeFormQuestion,
	onAnswerQuestion,
	onChooseFreeForm,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	// Question whose "Something else" option is armed; its answer arrives from
	// the composer rather than from an option click.
	freeFormQuestion: string | null;
	onAnswerQuestion: ( question: string, label: string ) => void;
	onChooseFreeForm: ( question: string ) => void;
} ) {
	const entries = data.entries;
	const items = useMemo(
		() => entriesToTranscriptItems( entries, { running: isRunning, startedAt } ),
		[ entries, isRunning, startedAt ]
	);
	const progressMessage = useMemo( () => getProgressMessage( entries ), [ entries ] );

	return (
		<div className={ styles.root }>
			{ items.map( ( item, index ) => {
				const sender = getSender( item );
				const joined = {
					joinedAbove: !! sender && getSender( items[ index - 1 ] ) === sender,
					joinedBelow: !! sender && getSender( items[ index + 1 ] ) === sender,
				};
				switch ( item.kind ) {
					case 'user-text':
						return (
							<UserTurn
								key={ item.key }
								text={ item.text }
								attachments={ item.attachments }
								annotation={ item.annotation }
								{ ...joined }
							/>
						);
					case 'assistant-text':
						return (
							<AssistantText
								key={ item.key }
								text={ item.text }
								messageText={ item.messageText }
								copyText={ item.copyText }
								{ ...joined }
							/>
						);
					case 'tool-use':
						return (
							<ToolUseRow
								key={ item.key }
								name={ item.name }
								input={ item.input }
								result={ item.result }
								isRunning={ item.running ?? false }
							/>
						);
					case 'agent-question-batch':
						return (
							<AgentQuestionBatch
								key={ item.key }
								questions={ item.questions }
								pendingQuestions={ pendingQuestions }
								pendingAnswers={ pendingAnswers }
								freeFormQuestion={ freeFormQuestion }
								onAnswer={ onAnswerQuestion }
								onChooseFreeForm={ onChooseFreeForm }
								{ ...joined }
							/>
						);
					case 'chat-artifact':
						return <ChatArtifact key={ item.key } widgets={ item.widgets } />;
					case 'activity':
						return (
							<TurnActivityLine
								key={ item.key }
								activity={ item }
								waitingOnUser={ pendingQuestions.size > 0 }
								progressMessage={ progressMessage }
							/>
						);
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.marker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
						);
					case 'error-marker':
						return <TurnErrorMarker key={ item.key } message={ item.message } />;
					default:
						return null;
				}
			} ) }
		</div>
	);
}
