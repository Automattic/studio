import {
	getCheckpointArtifactProps,
	getLocalMediaPath,
	getMediaAltText,
	getSafeMediaUrl,
	isCheckpointArtifactWidget,
	isRenderableMediaWidget,
	isStudioChatArtifactData,
	stripMediaWidgetPayloadLines,
	type CheckpointArtifactProps,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import { isAiBlockedError, isUsageCapError } from '@studio/common/ai/json-events';
import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	buildWorkPhaseSummary,
	formatThinkingDurationLabel,
	getInputString,
	getToolDetail,
	getToolDisplayName,
	getToolResultDiff,
	getToolResultPreview,
	getWritePseudoDiff,
	splitCommandArgs,
	type NormalizedToolResult,
	type ToolGroupSummary,
} from '@studio/common/ai/tools';
import {
	formatAiBlockedNotice,
	formatUsageCapNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import {
	backup,
	blockDefault,
	brush,
	capturePhoto,
	category,
	chartBar,
	check,
	close,
	cloud,
	cloudDownload,
	cloudUpload,
	code,
	create,
	download,
	file,
	globe,
	image,
	info,
	link,
	list,
	media,
	navigation,
	offline,
	page,
	pencil,
	pending,
	people,
	plugins,
	plusCircle,
	post,
	search,
	seen,
	settings,
	share,
	styles as stylesIcon,
	tag,
	tip,
	tool,
	trash,
	trendingUp,
	update,
	upload,
} from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
import { RestoreCheckpointDialog } from '@/components/checkpoint-timeline';
import { CopyButton } from '@/components/copy-button';
import { ImageContextMenu } from '@/components/image-context-menu';
import { ImageLightbox, type LightboxImage } from '@/components/image-lightbox';
import { Markdown } from '@/components/markdown';
import * as Menu from '@/components/menu';
import { toast } from '@/data/app-messages';
import {
	useConnector,
	type LoadedAiSession,
	type PermissionDecision,
	type PermissionRequestData,
} from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { refreshIcon } from '@/lib/icons';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { ActiveToolState } from '@/data/queries/use-agent-run';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface AgentQuestionRenderItem {
	key: string;
	question: string;
	options: Array< { label: string; description: string } >;
	pickedLabel?: string;
}

type WorkPhaseStep =
	| { kind: 'thinking'; key: string; text: string; durationMs?: number }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
	  }
	| {
			kind: 'chat-artifact';
			key: string;
			widgets: StudioChatArtifactWidgetDraft[];
	  };

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
			text: string;
			attachments?: StudioChatAttachmentSummary[];
	  }
	| { kind: 'assistant-text'; key: string; text: string; copyText?: string }
	| {
			kind: 'work-phase';
			key: string;
			steps: WorkPhaseStep[];
			summary: ToolGroupSummary;
	  }
	| {
			kind: 'agent-question-batch';
			key: string;
			questions: AgentQuestionRenderItem[];
	  }
	| {
			kind: 'permission-request';
			key: string;
			request: PermissionRequestData;
			// Disk-backed decision paired by request id; undefined while pending
			// (or forever, if the session died before the user answered).
			decision?: PermissionDecision;
	  }
	| {
			kind: 'chat-artifact';
			key: string;
			widgets: StudioChatArtifactWidgetDraft[];
	  }
	| { kind: 'interrupted-marker'; key: string }
	| { kind: 'error-marker'; key: string; message: string };

/** Intermediate items before work-phase grouping. */
type FlatRenderItem =
	| Extract< RenderItem, { kind: 'user-text' } >
	| Extract< RenderItem, { kind: 'assistant-text' } >
	| WorkPhaseStep
	| Extract< RenderItem, { kind: 'agent-question-batch' } >
	| Extract< RenderItem, { kind: 'permission-request' } >
	| Extract< RenderItem, { kind: 'interrupted-marker' } >
	| Extract< RenderItem, { kind: 'error-marker' } >;

interface PiAssistantContentBlock {
	type: 'text' | 'toolCall' | 'thinking';
	text?: string;
	thinking?: string;
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

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present', 'AskUserQuestion' ] );

function getEntryTimestampMs( entry: SessionEntry | undefined ): number | null {
	const raw = ( entry as { timestamp?: unknown } | undefined )?.timestamp;
	if ( typeof raw !== 'string' ) {
		return null;
	}
	const parsed = Date.parse( raw );
	return Number.isFinite( parsed ) ? parsed : null;
}

// "Thought for 3s" from the gap between the previous entry and the assistant
// message carrying the thinking block — the closest the transcript gets to
// the model's thinking time (pi doesn't persist per-block durations).
function getThinkingLabel( durationMs?: number ): string {
	return formatThinkingDurationLabel( durationMs );
}
const QUESTION_COLLAPSE_DELAY_MS = 650;
const QUESTION_SCROLL_TOP_MARGIN_PX = 12;
const QUESTION_SCROLL_BOTTOM_CLEARANCE_PX = 96;

function usePrefersReducedMotion(): boolean {
	const [ prefersReducedMotion, setPrefersReducedMotion ] = useState( false );

	useEffect( () => {
		if ( typeof window.matchMedia !== 'function' ) {
			return;
		}
		const mediaQuery = window.matchMedia( '(prefers-reduced-motion: reduce)' );
		const updatePreference = () => setPrefersReducedMotion( mediaQuery.matches );

		updatePreference();
		mediaQuery.addEventListener( 'change', updatePreference );
		return () => mediaQuery.removeEventListener( 'change', updatePreference );
	}, [] );

	return prefersReducedMotion;
}

function resolveBatchedAnswerForQuestion(
	entries: SessionEntry[],
	entryIndex: number,
	options: Array< { label: string } >
): string | undefined {
	const optionLabels = new Set( options.map( ( option ) => option.label ) );
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
	const answer = answers[ batchPosition ];
	return optionLabels.has( answer ) ? answer : undefined;
}

export function entriesToRenderItems(
	entries: SessionEntry[],
	options: { canReadLocalMedia?: boolean } = {}
): RenderItem[] {
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
			text: stripMediaWidgetPayloadLines( text ),
			isError: message.isError === true,
			diff: message.isError === true ? undefined : getToolResultDiff( message.details ),
		} );
	}

	// Permission decisions pair with their request by id.
	const permissionDecisionsById = new Map< string, PermissionDecision >();
	// Gated tool calls, keyed by their toolCallId, so the raw tool-call row can
	// be hidden until the tool actually ran: showing "Delete site …" above a
	// pending confirmation reads as if it already happened.
	const permissionRequestIdsByToolCallId = new Map< string, string >();
	for ( const entry of entries ) {
		if ( isStudioCustomEntryOfType( entry, 'studio.permission_response' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.permission_response' > ).data;
			if ( data ) {
				permissionDecisionsById.set( data.id, data.decision );
			}
		}
		if ( isStudioCustomEntryOfType( entry, 'studio.permission_request' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.permission_request' > ).data;
			if ( data ) {
				permissionRequestIdsByToolCallId.set( data.toolCallId, data.id );
			}
		}
	}
	// The tool-call row only appears once the request was approved (the tool
	// ran). Pending, denied, and expired requests are represented entirely by
	// the permission card / its resolved row.
	const isHiddenGatedToolCall = ( toolCallId: string ): boolean => {
		const requestId = permissionRequestIdsByToolCallId.get( toolCallId );
		if ( ! requestId ) {
			return false;
		}
		const decision = permissionDecisionsById.get( requestId );
		return decision === undefined || decision === 'deny';
	};

	const items: FlatRenderItem[] = [];
	// Media files already rendered in the current turn, keyed by local path or
	// URL. Two artifacts pointing at the same file (e.g. generate_image's own
	// card plus a studio_present of the same path) load identical bytes, so
	// only the first is worth showing.
	let seenTurnMediaKeys = new Set< string >();
	for ( let entryIndex = 0; entryIndex < entries.length; entryIndex += 1 ) {
		const entry = entries[ entryIndex ];
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			seenTurnMediaKeys = new Set();
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) continue;
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
			const startedMs = getEntryTimestampMs( entries[ entryIndex - 1 ] );
			const endedMs = getEntryTimestampMs( entry );
			const thinkingDurationMs =
				startedMs !== null && endedMs !== null && endedMs > startedMs
					? endedMs - startedMs
					: undefined;
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
							copyText: block === lastTextBlock ? fullMessageText : undefined,
						} );
					}
				} else if ( block.type === 'thinking' && typeof block.thinking === 'string' ) {
					const text = block.thinking.trim();
					if ( text ) {
						items.push( {
							kind: 'thinking',
							key: `${ entryIndex }:${ blockIndex }:thinking`,
							text,
							durationMs: thinkingDurationMs,
						} );
					}
				} else if (
					block.type === 'toolCall' &&
					typeof block.id === 'string' &&
					typeof block.name === 'string' &&
					! HIDDEN_TOOL_ROWS.has( block.name ) &&
					! isHiddenGatedToolCall( block.id )
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
					pickedLabel:
						data.selectedLabel ??
						resolveBatchedAnswerForQuestion( entries, entryIndex, data.options ),
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

		if ( isStudioCustomEntryOfType( entry, 'studio.permission_request' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.permission_request' > ).data;
			if ( ! data ) continue;
			items.push( {
				kind: 'permission-request',
				key: `${ entryIndex }:permission`,
				request: data,
				decision: permissionDecisionsById.get( data.id ),
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
			const widgets = data.widgets.filter( ( widget ) => {
				if ( isCheckpointArtifactWidget( widget ) ) {
					return true;
				}
				if (
					! isRenderableMediaWidget( widget ) ||
					// Without local media access (browser builds), only widgets
					// with a renderable remote URL are worth showing.
					( options.canReadLocalMedia === false && ! getSafeMediaUrl( widget ) )
				) {
					return false;
				}
				const mediaKey = getLocalMediaPath( widget ) ?? getSafeMediaUrl( widget );
				if ( mediaKey ) {
					if ( seenTurnMediaKeys.has( mediaKey ) ) {
						return false;
					}
					seenTurnMediaKeys.add( mediaKey );
				}
				return true;
			} );
			if ( widgets.length > 0 ) {
				items.push( {
					kind: 'chat-artifact',
					key: `${ entryIndex }:chat-artifact`,
					widgets,
				} );
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
					message: data.errorMessage ?? '',
				} );
			}
			continue;
		}
	}

	return groupIntoWorkPhases( items );
}

// Media artifacts (screenshots, generated images) are deliberate, user-facing
// milestones — they render as standalone cards in the transcript instead of
// collapsing into the work-phase row like checkpoints and notes do.
function isMediaArtifact( item: FlatRenderItem ): boolean {
	return item.kind === 'chat-artifact' && item.widgets.some( isRenderableMediaWidget );
}

function isWorkPhaseStep( item: FlatRenderItem ): item is WorkPhaseStep {
	return (
		item.kind === 'thinking' ||
		item.kind === 'tool-use' ||
		( item.kind === 'chat-artifact' && ! isMediaArtifact( item ) )
	);
}

function buildWorkPhaseItem(
	steps: WorkPhaseStep[]
): Extract< RenderItem, { kind: 'work-phase' } > {
	const tools = steps.filter(
		( step ): step is Extract< WorkPhaseStep, { kind: 'tool-use' } > => step.kind === 'tool-use'
	);
	const thinkingDurationMs = steps
		.filter(
			( step ): step is Extract< WorkPhaseStep, { kind: 'thinking' } > => step.kind === 'thinking'
		)
		.reduce( ( total, step ) => total + ( step.durationMs ?? 0 ), 0 );
	const artifactCount = steps.filter( ( step ) => step.kind === 'chat-artifact' ).length;
	return {
		kind: 'work-phase',
		key: steps.map( ( step ) => step.key ).join( ':' ),
		steps,
		summary: buildWorkPhaseSummary( tools, thinkingDurationMs || undefined, { artifactCount } ),
	};
}

/**
 * Collapse everything between a user prompt and the assistant's reply into
 * one work-phase row: thinking, tools, and artifacts across agent iterations.
 */
export function groupIntoWorkPhases( items: FlatRenderItem[] ): RenderItem[] {
	const grouped: RenderItem[] = [];
	let pendingSteps: WorkPhaseStep[] = [];

	const flushPhase = () => {
		if ( pendingSteps.length === 0 ) {
			return;
		}
		grouped.push( buildWorkPhaseItem( pendingSteps ) );
		pendingSteps = [];
	};

	for ( const item of items ) {
		if ( isWorkPhaseStep( item ) ) {
			pendingSteps.push( item );
			continue;
		}
		flushPhase();
		grouped.push( item );
	}
	flushPhase();
	return grouped;
}

// Progress from earlier turns must not leak into the current indicator, so
// the scan stops at the nearest turn boundary.
function findLatestProgressMessage( entries: SessionEntry[] ): string | null {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const entry = entries[ i ];
		if (
			isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ||
			isStudioCustomEntryOfType( entry, 'studio.turn_closed' )
		) {
			return null;
		}
		if ( isStudioCustomEntryOfType( entry, 'studio.tool_progress' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.tool_progress' > ).data;
			if ( data ) return data.message;
		}
	}
	return null;
}

// Registry of every image rendered in the conversation, in mount order, so
// the lightbox can page through all of them (uploads and screenshots alike)
// with prev/next. Registration happens on mount; the map lives on the
// Conversation root.
const ConversationGalleryContext = createContext< {
	register: ( id: string, image: LightboxImage ) => () => void;
	open: ( id: string ) => void;
} | null >( null );

/**
 * Every image in the conversation — user uploads and agent screenshots —
 * renders through this one component so they look and behave identically:
 * a bounded thumbnail that opens the full-size image in the shared
 * conversation lightbox (with a standalone fallback outside a gallery).
 */
function ConversationImage( { src, alt }: { src: string; alt: string } ) {
	const gallery = useContext( ConversationGalleryContext );
	const galleryId = useId();
	const [ isLightboxOpen, setIsLightboxOpen ] = useState( false );

	useEffect( () => {
		return gallery?.register( galleryId, { src, alt } );
	}, [ gallery, galleryId, src, alt ] );

	const openImage = () => ( gallery ? gallery.open( galleryId ) : setIsLightboxOpen( true ) );

	return (
		<>
			<ImageContextMenu
				image={ { src, alt } }
				trigger={
					<Button
						variant="unstyled"
						className={ styles.chatImageButton }
						aria-haspopup="dialog"
						title={ alt }
						onClick={ openImage }
					>
						<img className={ styles.chatImageThumb } src={ src } alt={ alt } />
					</Button>
				}
			>
				<Menu.Item onClick={ openImage }>{ __( 'Open image' ) }</Menu.Item>
			</ImageContextMenu>
			{ ! gallery && isLightboxOpen ? (
				<ImageLightbox images={ [ { src, alt } ] } onClose={ () => setIsLightboxOpen( false ) } />
			) : null }
		</>
	);
}

function UserTurn( {
	text,
	attachments,
}: {
	text: string;
	attachments?: StudioChatAttachmentSummary[];
} ) {
	return (
		<div className={ styles.userTurn }>
			<div className={ styles.userText }>{ text }</div>
			{ attachments && attachments.length > 0 ? (
				<ul className={ styles.userAttachments }>
					{ attachments.map( ( attachment, index ) =>
						attachment.kind === 'image' && attachment.previewDataUrl ? (
							<li
								key={ `${ attachment.name }:${ index }` }
								className={ styles.userAttachmentThumbItem }
							>
								<ConversationImage src={ attachment.previewDataUrl } alt={ attachment.name } />
							</li>
						) : (
							<li key={ `${ attachment.name }:${ index }` } className={ styles.userAttachmentChip }>
								<Icon icon={ attachment.kind === 'image' ? image : page } size={ 16 } />
								<span className={ styles.userAttachmentName } title={ attachment.name }>
									{ attachment.name }
								</span>
							</li>
						)
					) }
				</ul>
			) : null }
		</div>
	);
}

function AssistantText( {
	text,
	copyText,
	showActions,
	onToggleSelect,
}: {
	text: string;
	copyText?: string;
	showActions: boolean;
	onToggleSelect: () => void;
} ) {
	const connector = useConnector();

	const handleClick = ( event: ReactMouseEvent< HTMLDivElement > ) => {
		// Links and the buttons inside code blocks or the action row own their
		// clicks; only bare message content toggles the actions.
		if ( ( event.target as HTMLElement | null )?.closest( 'a, button' ) ) {
			return;
		}
		// A click that ends a text drag is a selection, not a tap.
		const selection = window.getSelection();
		if ( selection && ! selection.isCollapsed && selection.toString().trim() ) {
			return;
		}
		onToggleSelect();
	};

	// Double-click anywhere in the reply copies it (the whole message when
	// this is its last text block, otherwise this fragment). Native word
	// selection still happens — the copy is additive, and the app toast is
	// the signal that more than a selection occurred.
	const handleDoubleClick = useCallback( () => {
		void connector.copyText( copyText ?? text );
		toast.success( __( 'Copied' ), { id: 'copy-feedback' } );
	}, [ connector, copyText, text ] );

	return (
		// Clicking the message is a mouse convenience for revealing its actions;
		// keyboard users reach the same buttons by tabbing to them, which opens
		// the row via :focus-within. Deliberately no button role — the message
		// holds links, and nesting them inside a control would be invalid.
		<div
			className={ styles.assistantTurn }
			data-actions-open={ showActions ? 'true' : undefined }
			onClick={ copyText ? handleClick : undefined }
			onDoubleClick={ handleDoubleClick }
		>
			<Markdown>{ text }</Markdown>
			{ copyText ? (
				<div className={ styles.messageActions }>
					<div className={ styles.messageActionsClip }>
						<div className={ styles.messageActionsRow }>
							<CopyButton text={ copyText } label={ __( 'Copy message' ) } />
						</div>
					</div>
				</div>
			) : null }
		</div>
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
		case 'wait_for_annotations':
			display.detail = '';
			break;
	}

	display.detail = truncateToolDetail( display.detail );
	return display;
}

function getWpCliToolIcon( command: string ) {
	const [ entity ] = splitCommandArgs( command );

	switch ( entity ) {
		case 'theme':
			return stylesIcon;
		case 'plugin':
			return plugins;
		case 'post':
			return post;
		case 'option':
			return settings;
		case 'user':
			return people;
		case 'media':
			return media;
		case 'menu':
			return navigation;
		case 'term':
			return tag;
		case 'cache':
			return update;
		case 'rewrite':
			return link;
		case 'eval':
		case 'eval-file':
			return code;
		default:
			return code;
	}
}

function getToolIcon( name: string, input: Record< string, unknown > | undefined ) {
	switch ( name ) {
		case 'site_create':
			return plusCircle;
		case 'site_list':
			return list;
		case 'site_info':
			return info;
		case 'site_start':
			return globe;
		case 'site_stop':
			return offline;
		case 'site_delete':
			return trash;
		case 'site_push':
			return cloudUpload;
		case 'site_pull':
			return cloudDownload;
		case 'site_import':
			return upload;
		case 'site_export':
			return download;
		case 'site_connected_remote_sites':
			return link;
		case 'preview_create':
			return seen;
		case 'preview_list':
			return list;
		case 'preview_update':
			return update;
		case 'preview_delete':
			return trash;
		case 'wp_cli': {
			const command = getInputString( input, 'command' );
			return command ? getWpCliToolIcon( command ) : code;
		}
		case 'open_annotation_browser':
			return pencil;
		case 'wait_for_annotations':
			return pending;
		case 'take_screenshot':
			return capturePhoto;
		case 'inspect_design':
			return search;
		case 'refresh_browser':
			return refreshIcon;
		case 'share_screenshot':
			return share;
		case 'validate_blocks':
			return check;
		case 'scaffold_theme':
			return brush;
		case 'install_taxonomy_scripts':
			return category;
		case 'need_for_speed':
			return chartBar;
		case 'rank_me_up':
			return trendingUp;
		case 'wpcom_request':
			return cloud;
		case 'Read':
			return file;
		case 'Write':
			return create;
		case 'Edit':
			return pencil;
		case 'Bash':
			return code;
		case 'Grep':
		case 'Glob':
			return search;
		case 'Ls':
			return list;
		case 'Skill':
			return blockDefault;
		case 'Task':
			return tool;
		case 'TodoWrite':
			return check;
		default:
			return tool;
	}
}

function getToolDiffForDisplay(
	name: string,
	input: Record< string, unknown > | undefined,
	result?: NormalizedToolResult
): string | undefined {
	if ( result?.diff ) {
		return result.diff;
	}
	if ( name === 'Write' ) {
		return getWritePseudoDiff( input );
	}
	return undefined;
}

function getToolResultDisplayText(
	name: string,
	input: Record< string, unknown > | undefined,
	result?: NormalizedToolResult
): string {
	const rawResultText = result?.text?.trim() ?? '';
	const resultText =
		name === 'take_screenshot' ? stripMediaWidgetPayloadLines( rawResultText ) : rawResultText;
	if ( ! resultText ) {
		return '';
	}
	const preview = getToolResultPreview( name, input, resultText, result?.isError === true );
	if ( preview?.summaryLines.length ) {
		return preview.summaryLines.join( '\n' );
	}
	return resultText;
}

function DiffBlock( { diff }: { diff: string } ) {
	const lines = diff.replace( /\n$/, '' ).split( '\n' );
	return (
		<pre className={ styles.toolDiff }>
			{ lines.map( ( line, index ) => (
				<span
					key={ index }
					className={ clsx(
						styles.diffLine,
						line.startsWith( '+' ) && styles.diffLineAdded,
						line.startsWith( '-' ) && styles.diffLineRemoved
					) }
				>
					{ line.length > 0 ? line : ' ' }
				</span>
			) ) }
		</pre>
	);
}

function ToolIcon( { name, input }: { name: string; input?: Record< string, unknown > } ) {
	return (
		<Icon
			icon={ getToolIcon( name, input ) }
			size={ 18 }
			className={ styles.toolIcon }
			aria-hidden="true"
		/>
	);
}

function ToolUseRow( {
	name,
	input,
	result,
	compact = false,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
	compact?: boolean;
} ) {
	const display = getClassicToolDisplay( name, input );
	const detailsId = useId();
	const rawResultText = result?.text?.trim() ?? '';
	const resultText =
		name === 'take_screenshot' ? stripMediaWidgetPayloadLines( rawResultText ) : rawResultText;
	const preview = getToolResultPreview( name, input, resultText, result?.isError === true );
	const displayResultText = getToolResultDisplayText( name, input, result );
	const detailText = preview?.detailText ?? resultText;
	const hasOutput = detailText.length > 0;
	const hasInput = display.inputText.length > 0;
	const diff = getToolDiffForDisplay( name, input, result );
	const hasDiff = Boolean( diff );
	const hasExpandableDetails = hasInput || hasOutput || hasDiff;
	const [ expanded, setExpanded ] = useState( false );
	const [ detailsMounted, setDetailsMounted ] = useState( false );
	useEffect( () => {
		if ( expanded || ! detailsMounted ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setDetailsMounted( false ), 220 );
		return () => window.clearTimeout( timeoutId );
	}, [ detailsMounted, expanded ] );
	const rowContent = (
		<>
			<ToolIcon name={ name } input={ input } />
			<span className={ styles.toolLabel }>{ display.label }</span>
			{ display.detail ? <span className={ styles.toolDetail }>{ display.detail }</span> : null }
			{ compact && displayResultText && ! expanded ? (
				<span className={ styles.toolDetail }>{ displayResultText.split( '\n' )[ 0 ] }</span>
			) : null }
		</>
	);

	return (
		<div className={ styles.toolBlock }>
			{ hasExpandableDetails ? (
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<button
								type="button"
								className={ clsx( styles.toolRow, styles.toolRowButton ) }
								aria-label={
									display.detail ? `${ display.label } ${ display.detail }` : display.label
								}
								aria-expanded={ expanded }
								aria-controls={ detailsId }
								data-expanded={ expanded }
								onClick={ () => {
									if ( expanded ) {
										setExpanded( false );
										return;
									}
									setDetailsMounted( true );
									setExpanded( true );
								} }
							/>
						}
					>
						{ rowContent }
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ expanded ? __( 'Hide tool details' ) : __( 'Show tool details' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
			) : (
				<div className={ styles.toolRow }>{ rowContent }</div>
			) }
			{ hasExpandableDetails && detailsMounted ? (
				<div
					id={ detailsId }
					className={ styles.toolDetailsShell }
					data-expanded={ expanded }
					aria-hidden={ ! expanded }
					onTransitionEnd={ ( event ) => {
						if ( event.currentTarget === event.target && ! expanded ) {
							setDetailsMounted( false );
						}
					} }
				>
					<div className={ styles.toolDetailsClip }>
						<div className={ styles.toolOutputWrap }>
							{ hasInput ? <pre className={ styles.toolInput }>{ display.inputText }</pre> : null }
							{ hasOutput ? (
								<pre
									className={ clsx( styles.toolOutput, result?.isError && styles.toolOutputError ) }
								>
									{ detailText }
								</pre>
							) : null }
							{ hasDiff ? <DiffBlock diff={ diff! } /> : null }
						</div>
					</div>
				</div>
			) : null }
		</div>
	);
}

function WorkPhaseStats( { summary }: { summary: ToolGroupSummary } ) {
	if ( summary.additions === 0 && summary.deletions === 0 ) {
		return null;
	}
	return (
		<span className={ styles.workPhaseStats } aria-hidden="true">
			{ summary.additions > 0 ? (
				<span className={ styles.workPhaseStatAdded }>+{ summary.additions }</span>
			) : null }
			{ summary.deletions > 0 ? (
				<span className={ styles.workPhaseStatRemoved }>-{ summary.deletions }</span>
			) : null }
		</span>
	);
}

function WorkPhaseRow( { steps, summary }: { steps: WorkPhaseStep[]; summary: ToolGroupSummary } ) {
	const detailsId = useId();
	const [ expanded, setExpanded ] = useState( false );
	const [ detailsMounted, setDetailsMounted ] = useState( false );
	useEffect( () => {
		if ( expanded || ! detailsMounted ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setDetailsMounted( false ), 220 );
		return () => window.clearTimeout( timeoutId );
	}, [ detailsMounted, expanded ] );

	return (
		<div className={ styles.toolBlock }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ clsx( styles.toolRow, styles.toolRowButton, styles.workPhaseButton ) }
							aria-label={ summary.label }
							aria-expanded={ expanded }
							aria-controls={ detailsId }
							data-expanded={ expanded }
							onClick={ () => {
								if ( expanded ) {
									setExpanded( false );
									return;
								}
								setDetailsMounted( true );
								setExpanded( true );
							} }
						/>
					}
				>
					<span className={ styles.toolLabel }>{ summary.label }</span>
					<WorkPhaseStats summary={ summary } />
				</Tooltip.Trigger>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ expanded ? __( 'Hide work details' ) : __( 'Show work details' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
			{ detailsMounted ? (
				<div
					id={ detailsId }
					className={ styles.toolDetailsShell }
					data-expanded={ expanded }
					aria-hidden={ ! expanded }
					onTransitionEnd={ ( event ) => {
						if ( event.currentTarget === event.target && ! expanded ) {
							setDetailsMounted( false );
						}
					} }
				>
					<div className={ styles.toolDetailsClip }>
						<div className={ styles.workPhaseChildren }>
							{ steps.map( ( step ) => {
								switch ( step.kind ) {
									case 'thinking':
										return (
											<ThinkingRow
												key={ step.key }
												text={ step.text }
												durationMs={ step.durationMs }
											/>
										);
									case 'tool-use':
										return (
											<ToolUseRow
												key={ step.key }
												name={ step.name }
												input={ step.input }
												result={ step.result }
												compact
											/>
										);
									case 'chat-artifact':
										return <ChatArtifact key={ step.key } widgets={ step.widgets } />;
									default:
										return null;
								}
							} ) }
						</div>
					</div>
				</div>
			) : null }
		</div>
	);
}

function LiveWorkPhase( {
	steps,
	activeTool,
}: {
	steps: WorkPhaseStep[];
	activeTool: ActiveToolState | null;
} ) {
	const liveSteps = useMemo( () => {
		if ( ! activeTool ) {
			return steps;
		}
		const pending: WorkPhaseStep = {
			kind: 'tool-use',
			key: `live:${ activeTool.name }:${ activeTool.startedAt }`,
			name: activeTool.name,
			input: activeTool.input,
		};
		return [ ...steps, pending ];
	}, [ activeTool, steps ] );

	if ( liveSteps.length === 0 ) {
		return null;
	}

	const phase = buildWorkPhaseItem( liveSteps );
	return <WorkPhaseRow steps={ phase.steps } summary={ phase.summary } />;
}

// The model's extended-thinking block, shown collapsed like a tool call —
// the label row expands to reveal the full reasoning text.
function ThinkingRow( { text, durationMs }: { text: string; durationMs?: number } ) {
	const label = getThinkingLabel( durationMs );
	const detailsId = useId();
	const [ expanded, setExpanded ] = useState( false );
	const [ detailsMounted, setDetailsMounted ] = useState( false );
	useEffect( () => {
		if ( expanded || ! detailsMounted ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setDetailsMounted( false ), 220 );
		return () => window.clearTimeout( timeoutId );
	}, [ detailsMounted, expanded ] );
	return (
		<div className={ styles.toolBlock }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ clsx( styles.toolRow, styles.toolRowButton ) }
							aria-label={ label }
							aria-expanded={ expanded }
							aria-controls={ detailsId }
							data-expanded={ expanded }
							onClick={ () => {
								if ( expanded ) {
									setExpanded( false );
									return;
								}
								setDetailsMounted( true );
								setExpanded( true );
							} }
						/>
					}
				>
					<Icon icon={ tip } size={ 18 } className={ styles.toolIcon } aria-hidden="true" />
					<span className={ styles.toolLabel }>{ label }</span>
				</Tooltip.Trigger>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ expanded ? __( 'Hide thinking' ) : __( 'Show thinking' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
			{ detailsMounted ? (
				<div
					id={ detailsId }
					className={ styles.toolDetailsShell }
					data-expanded={ expanded }
					aria-hidden={ ! expanded }
					onTransitionEnd={ ( event ) => {
						if ( event.currentTarget === event.target && ! expanded ) {
							setDetailsMounted( false );
						}
					} }
				>
					<div className={ styles.toolDetailsClip }>
						<div className={ styles.toolOutputWrap }>
							<pre className={ styles.toolOutput }>{ text }</pre>
						</div>
					</div>
				</div>
			) : null }
		</div>
	);
}

function ChatArtifact( { widgets }: { widgets: StudioChatArtifactWidgetDraft[] } ) {
	// Checkpoints render as tool-style rows; everything else is media in a grid.
	const checkpointArtifacts = widgets
		.map( getCheckpointArtifactProps )
		.filter( ( artifact ): artifact is NonNullable< typeof artifact > => artifact !== null );
	const mediaWidgets = widgets.filter( ( widget ) => ! isCheckpointArtifactWidget( widget ) );
	return (
		<>
			{ checkpointArtifacts.map( ( artifact ) => (
				<CheckpointRow key={ artifact.checkpointId } artifact={ artifact } />
			) ) }
			{ mediaWidgets.length > 0 ? (
				<div className={ styles.mediaArtifactGrid }>
					{ mediaWidgets.map( ( widget, index ) => (
						<MediaArtifactImage key={ `${ widget.type }:${ index }` } widget={ widget } />
					) ) }
				</div>
			) : null }
		</>
	);
}

// A checkpoint capture rendered with the same anatomy as a tool call row —
// icon, muted label, detail — plus a Restore action. Restore opens the same
// confirmation dialog the site's checkpoint timeline uses.
function CheckpointRow( { artifact }: { artifact: CheckpointArtifactProps } ) {
	const [ restoreOpen, setRestoreOpen ] = useState( false );

	let title = artifact.label;
	if ( ! title ) {
		title = artifact.toolName
			? /* translators: %s: the agent tool a checkpoint was captured before (e.g. "wp_cli") */
			  sprintf( __( 'Checkpoint before %s' ), artifact.toolName )
			: __( 'Checkpoint' );
	}

	return (
		<div className={ styles.toolBlock }>
			<div className={ styles.toolRow }>
				<Icon icon={ backup } className={ styles.toolIcon } />
				<span className={ styles.toolLabel }>{ title }</span>
				<span className={ styles.toolDetail }>
					{ formatRelativeTime( new Date( artifact.createdAt ).toISOString() ) }
				</span>
				<Button
					variant="minimal"
					tone="neutral"
					size="compact"
					className={ styles.toolAction }
					onClick={ () => setRestoreOpen( true ) }
				>
					{ __( 'Restore' ) }
				</Button>
			</div>
			<RestoreCheckpointDialog
				siteId={ artifact.siteId }
				checkpointId={ artifact.checkpointId }
				title={ title }
				open={ restoreOpen }
				onOpenChange={ setRestoreOpen }
			/>
		</div>
	);
}

function MediaArtifactImage( { widget }: { widget: StudioChatArtifactWidgetDraft } ) {
	const connector = useConnector();
	const localPath = connector.capabilities.readLocalMedia ? getLocalMediaPath( widget ) : null;
	const safeUrl = getSafeMediaUrl( widget );
	const localFileQuery = useLocalMediaDataUrl( localPath );

	const src = localPath ? localFileQuery.data ?? null : safeUrl;

	if ( localFileQuery.isError || ( ! localPath && ! safeUrl ) ) {
		return (
			<div className={ styles.mediaArtifactUnavailable } role="status">
				{ __( 'Image unavailable' ) }
			</div>
		);
	}

	if ( ! src ) {
		return <div className={ styles.mediaArtifactLoading } aria-hidden="true" />;
	}

	return <ConversationImage src={ src } alt={ getMediaAltText( widget, __( 'Image' ) ) } />;
}

function AgentQuestion( {
	question,
	options,
	isInteractive,
	pickedLabel,
	isCollapsing = false,
	onAnswer,
}: {
	question: string;
	options: Array< { label: string; description: string } >;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	isCollapsing?: boolean;
	onAnswer: ( label: string ) => void;
} ) {
	const optionsId = useId();
	const isFolding = isCollapsing && Boolean( pickedLabel );

	return (
		<div className={ styles.question } data-state={ isFolding ? 'folding' : undefined }>
			<p className={ styles.questionText }>{ question }</p>
			{ options.length > 0 ? (
				<ol className={ styles.questionOptions }>
					{ options.map( ( option, index ) => {
						const picked = option.label === pickedLabel;
						const descriptionId =
							option.description && ! isFolding
								? `${ optionsId }-option-${ index }-description`
								: undefined;
						return (
							<li
								key={ index }
								className={ styles.questionOptionItem }
								data-picked={ picked ? 'true' : undefined }
							>
								<button
									type="button"
									className={ clsx( styles.questionOption, picked && styles.questionOptionPicked ) }
									disabled={ ! isInteractive }
									onClick={ () => onAnswer( option.label ) }
									aria-label={ option.label }
									aria-describedby={ descriptionId }
									aria-pressed={ picked }
								>
									<span className={ styles.questionOptionNumber } aria-hidden="true">
										{ picked ? <QuestionOptionCheckIcon /> : index + 1 }
									</span>
									<span className={ styles.questionOptionCopy }>
										<span className={ styles.questionOptionLabel }>{ option.label }</span>
										{ option.description ? (
											<span id={ descriptionId } className={ styles.questionOptionDescription }>
												{ option.description }
											</span>
										) : null }
									</span>
								</button>
							</li>
						);
					} ) }
				</ol>
			) : null }
		</div>
	);
}

function QuestionOptionCheckIcon() {
	return <Icon icon={ check } size={ 14 } style={ { fill: 'currentColor' } } aria-hidden="true" />;
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
	const topOverflow = elementRect.top - ( containerRect.top + QUESTION_SCROLL_TOP_MARGIN_PX );
	const bottomOverflow =
		elementRect.bottom - ( containerRect.bottom - QUESTION_SCROLL_BOTTOM_CLEARANCE_PX );
	const scrollDelta = topOverflow < 0 ? topOverflow : Math.max( bottomOverflow, 0 );

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
	pickedLabel,
	canEdit,
	onClick,
}: {
	index: number;
	total: number;
	question: string;
	pickedLabel: string;
	canEdit: boolean;
	onClick: () => void;
} ) {
	const label = sprintf(
		__( 'Edit question %1$d of %2$d: %3$s. Selected answer: %4$s' ),
		index + 1,
		total,
		question,
		pickedLabel
	);
	const content = (
		<span className={ styles.questionSummaryBody }>
			<span className={ styles.questionSummaryText }>{ question }</span>
			<span
				className={ clsx(
					styles.questionOption,
					styles.questionOptionPicked,
					styles.questionSummaryOption
				) }
				aria-hidden={ canEdit ? 'true' : undefined }
			>
				<span className={ styles.questionOptionNumber }>
					<QuestionOptionCheckIcon />
				</span>
				<span className={ styles.questionOptionCopy }>
					<span className={ styles.questionOptionLabel }>{ pickedLabel }</span>
				</span>
			</span>
		</span>
	);

	if ( ! canEdit ) {
		return (
			<div className={ styles.questionSummary } data-interactive="false">
				{ content }
			</div>
		);
	}

	return (
		<button
			type="button"
			className={ styles.questionSummary }
			data-interactive="true"
			onClick={ onClick }
			aria-label={ label }
		>
			{ content }
		</button>
	);
}

function AgentQuestionBatch( {
	questions,
	pendingQuestions,
	pendingAnswers,
	onAnswer,
}: {
	questions: AgentQuestionRenderItem[];
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	onAnswer: ( question: string, label: string ) => void;
} ) {
	const [ expandedIndex, setExpandedIndex ] = useState< number | null >( null );
	const [ settlingIndex, setSettlingIndex ] = useState< number | null >( null );
	const prefersReducedMotion = usePrefersReducedMotion();
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
		return (
			<AgentQuestion
				question={ question.question }
				options={ question.options }
				isInteractive={ pendingQuestions.has( question.question ) }
				pickedLabel={ getQuestionPickedLabel( question, pendingAnswers ) }
				onAnswer={ ( label ) => onAnswer( question.question, label ) }
			/>
		);
	}

	const handleAnswer = ( question: AgentQuestionRenderItem, index: number, label: string ) => {
		shouldFocusActiveQuestionRef.current = true;
		setExpandedIndex( null );
		setSettlingIndex( index );
		onAnswer( question.question, label );
	};

	return (
		<div className={ styles.questionBatch }>
			{ questions.slice( 0, visibleQuestionCount ).map( ( question, index ) => {
				const pickedLabel = getQuestionPickedLabel( question, pendingAnswers );
				const isActive = index === activeIndex;
				if ( ! isActive && pickedLabel ) {
					const canEdit = pendingQuestions.has( question.question );
					return (
						<QuestionSummary
							key={ question.key }
							index={ index }
							total={ total }
							question={ question.question }
							pickedLabel={ pickedLabel }
							canEdit={ canEdit }
							onClick={ () => setExpandedIndex( index ) }
						/>
					);
				}
				return (
					<div
						key={ question.key }
						ref={ isActive ? activeQuestionRef : undefined }
						className={ styles.questionBatchStep }
						data-state={ settlingIndex === index ? 'answered' : 'asking' }
						data-has-prior={ index > 0 ? 'true' : undefined }
						tabIndex={ isActive ? -1 : undefined }
						aria-label={
							isActive ? sprintf( __( 'Current question: %s' ), question.question ) : undefined
						}
					>
						{ total > 1 ? (
							<span className={ styles.questionBatchProgress }>
								{ sprintf( __( 'Asking question %1$d of %2$d' ), index + 1, total ) }
							</span>
						) : null }
						<AgentQuestion
							question={ question.question }
							options={ question.options }
							isInteractive={ pendingQuestions.has( question.question ) && settlingIndex !== index }
							pickedLabel={ pickedLabel }
							isCollapsing={ settlingIndex === index }
							onAnswer={ ( label ) => handleAnswer( question, index, label ) }
						/>
					</div>
				);
			} ) }
		</div>
	);
}

function PermissionRequest( {
	request,
	isInteractive,
	decision,
	onDecide,
}: {
	request: PermissionRequestData;
	isInteractive: boolean;
	decision: PermissionDecision | undefined;
	onDecide: ( decision: PermissionDecision ) => void;
} ) {
	const titleId = useId();
	const descriptionId = useId();
	const containerRef = useRef< HTMLDivElement >( null );
	const prefersReducedMotion = usePrefersReducedMotion();

	// Move keyboard focus to the card (not a button) when it appears: a screen
	// reader announces the whole question via the group's name/description, Tab
	// reaches the actions, and Enter can't trigger the destructive action until
	// the user deliberately moves to it. Not a dialog — the user can still
	// scroll and read the conversation to inform the decision.
	useEffect( () => {
		if ( ! isInteractive ) {
			return;
		}
		const element = containerRef.current;
		if ( ! element ) {
			return;
		}
		scrollElementIntoViewIfNeeded( element, prefersReducedMotion );
		element.focus( { preventScroll: true } );
	}, [ isInteractive, prefersReducedMotion ] );

	// Resolved (or expired) requests collapse to a tool-call-style row — the
	// full card is only for the decision that's actually being made.
	if ( ! isInteractive ) {
		let icon = info;
		let label: string = __( 'Permission request expired' );
		if ( decision === 'deny' ) {
			icon = close;
			label = request.deniedLabel ?? __( 'Permission denied' );
		} else if ( decision !== undefined ) {
			icon = check;
			label = request.allowedLabel ?? __( 'Permission granted' );
		}
		return (
			<div className={ styles.toolBlock }>
				<div className={ styles.toolRow }>
					<Icon icon={ icon } size={ 18 } className={ styles.toolIcon } aria-hidden="true" />
					<span className={ styles.toolLabel }>{ label }</span>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={ containerRef }
			className={ styles.permission }
			role="group"
			tabIndex={ -1 }
			aria-labelledby={ titleId }
			aria-describedby={ descriptionId }
			onKeyDown={ ( event ) => {
				// Escape is the keyboard's "dismiss", and dismissal means deny.
				if ( event.key === 'Escape' ) {
					event.stopPropagation();
					onDecide( 'deny' );
				}
			} }
		>
			<p id={ titleId } className={ styles.permissionTitle }>
				{ request.title }
			</p>
			<div id={ descriptionId } className={ styles.permissionConsequences }>
				{ request.consequences.map( ( line, index ) => (
					<p key={ index } className={ styles.permissionConsequence }>
						{ line }
					</p>
				) ) }
			</div>
			<div className={ styles.permissionActions }>
				{ /* Same error-token remap the wpds AlertDialog uses for its
				     irreversible confirm button — a solid Button rendered with
				     the theme's error colors instead of brand. */ }
				<Button
					variant="solid"
					size="compact"
					className={ styles.permissionConfirmButton }
					onClick={ () => onDecide( 'allow_once' ) }
				>
					{ __( 'Yes, go ahead' ) }
				</Button>
				{ request.allowAlways ? (
					<Button
						variant="outline"
						tone="neutral"
						size="compact"
						className={ styles.permissionAlwaysButton }
						onClick={ () => onDecide( 'always_allow' ) }
						title={ sprintf(
							/* translators: %s: what will be allowed without asking again (e.g. "pushing sites to WordPress.com") */
							__( 'Stop asking before %s. You can change this in Settings.' ),
							request.actionLabel
						) }
					>
						{ __( 'Always allow' ) }
					</Button>
				) : null }
				<Button
					variant="minimal"
					tone="neutral"
					size="compact"
					onClick={ () => onDecide( 'deny' ) }
				>
					{ __( 'No, stop' ) }
				</Button>
			</div>
		</div>
	);
}

// In-flow marker for a turn that ended in an error. The monthly usage cap
// gets dedicated copy — with the reset date once the quota query resolves —
// instead of the raw provider message.
function TurnErrorMarker( { message }: { message: string } ) {
	const isUsageCap = isUsageCapError( message );
	const { data: quota } = useStudioAssistantQuota( { enabled: isUsageCap } );
	let text: string;
	if ( isAiBlockedError( message ) ) {
		text = formatAiBlockedNotice();
	} else if ( isUsageCap ) {
		text = formatUsageCapNotice( quota?.costResetDate );
	} else {
		text = message || __( 'Something went wrong and this turn was stopped. Please try again.' );
	}
	return (
		<div className={ styles.errorMarker } role="alert">
			{ text }
		</div>
	);
}

export function Conversation( {
	data,
	isRunning,
	startedAt,
	activeTool,
	pendingQuestions,
	pendingAnswers,
	pendingPermissions,
	answeredPermissions,
	onAnswerQuestion,
	onAnswerPermission,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	activeTool: ActiveToolState | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	// Ids of gated tool calls awaiting a decision on the active run.
	pendingPermissions: Set< string >;
	// Decisions sent this session, keyed by request id (bridges the disk lag).
	answeredPermissions: Record< string, PermissionDecision >;
	onAnswerQuestion: ( question: string, label: string ) => void;
	onAnswerPermission: ( requestId: string, decision: PermissionDecision ) => void;
} ) {
	const entries = data.entries;
	const canReadLocalMedia = useConnector().capabilities.readLocalMedia;
	const items = useMemo(
		() => entriesToRenderItems( entries, { canReadLocalMedia } ),
		[ entries, canReadLocalMedia ]
	);
	const progressMessage = useMemo( () => findLatestProgressMessage( entries ), [ entries ] );

	// While a turn is in flight, the last work-phase (after the latest user
	// prompt, before any reply text) is shown as a live updating summary.
	// Completed phases earlier in the transcript stay as normal rows.
	const { committedItems, livePhaseSteps } = useMemo( () => {
		if ( ! isRunning ) {
			return { committedItems: items, livePhaseSteps: null as WorkPhaseStep[] | null };
		}
		let lastUserIndex = -1;
		for ( let i = items.length - 1; i >= 0; i -= 1 ) {
			if ( items[ i ].kind === 'user-text' ) {
				lastUserIndex = i;
				break;
			}
		}
		const turnItems = lastUserIndex >= 0 ? items.slice( lastUserIndex + 1 ) : items;
		const hasReply = turnItems.some( ( item ) => item.kind === 'assistant-text' );
		if ( hasReply ) {
			return { committedItems: items, livePhaseSteps: null as WorkPhaseStep[] | null };
		}
		let lastPhaseIndex = -1;
		for ( let i = items.length - 1; i >= 0; i -= 1 ) {
			if ( items[ i ].kind === 'work-phase' ) {
				lastPhaseIndex = i;
				break;
			}
		}
		if ( lastPhaseIndex < 0 || lastPhaseIndex < lastUserIndex ) {
			return { committedItems: items, livePhaseSteps: [] as WorkPhaseStep[] };
		}
		// A standalone item (e.g. a media artifact) after the phase commits it:
		// slicing at the phase would drop the trailing item from the transcript.
		if ( lastPhaseIndex !== items.length - 1 ) {
			return { committedItems: items, livePhaseSteps: [] as WorkPhaseStep[] };
		}
		const phase = items[ lastPhaseIndex ];
		if ( phase.kind !== 'work-phase' ) {
			return { committedItems: items, livePhaseSteps: null as WorkPhaseStep[] | null };
		}
		return {
			committedItems: items.slice( 0, lastPhaseIndex ),
			livePhaseSteps: phase.steps,
		};
	}, [ isRunning, items ] );

	const showLiveWork =
		isRunning &&
		livePhaseSteps !== null &&
		pendingQuestions.size === 0 &&
		pendingPermissions.size === 0;

	// Gallery registry: insertion order matches render (≈ chronological)
	// order, so the lightbox pages through images as they appear in the
	// transcript. A ref (not state) — registration must not re-render the
	// whole conversation. `open` snapshots the registry into state, so the
	// render below never reads the ref.
	const galleryImagesRef = useRef( new Map< string, LightboxImage >() );
	const [ activeGallery, setActiveGallery ] = useState< {
		images: LightboxImage[];
		index: number;
	} | null >( null );
	const gallery = useMemo(
		() => ( {
			register: ( id: string, image: LightboxImage ) => {
				galleryImagesRef.current.set( id, image );
				return () => {
					galleryImagesRef.current.delete( id );
				};
			},
			open: ( id: string ) => {
				const ids = [ ...galleryImagesRef.current.keys() ];
				setActiveGallery( {
					images: [ ...galleryImagesRef.current.values() ],
					index: Math.max( 0, ids.indexOf( id ) ),
				} );
			},
		} ),
		[]
	);

	// One selected message at a time, so picking a new one closes the last.
	const [ selectedKey, setSelectedKey ] = useState< string | null >( null );
	const sessionId = data.summary.id;
	useEffect( () => {
		setSelectedKey( null );
	}, [ sessionId ] );

	// The newest reply keeps its actions open, so copying the answer you just
	// got never depends on discovering that messages can be clicked. Held back
	// until the turn settles — mid-run the last text block keeps moving as new
	// blocks stream in, and the row would hop down the transcript with it.
	const latestActionableKey = useMemo( () => {
		if ( isRunning ) {
			return null;
		}
		for ( let index = items.length - 1; index >= 0; index -= 1 ) {
			const item = items[ index ];
			if ( item.kind === 'assistant-text' && item.copyText ) {
				return item.key;
			}
		}
		return null;
	}, [ isRunning, items ] );

	return (
		<ConversationGalleryContext.Provider value={ gallery }>
			{ activeGallery ? (
				<ImageLightbox
					images={ activeGallery.images }
					initialIndex={ activeGallery.index }
					onClose={ () => setActiveGallery( null ) }
				/>
			) : null }
			<div className={ styles.root }>
				{ committedItems.map( ( item ) => {
					switch ( item.kind ) {
						case 'user-text':
							return (
								<UserTurn key={ item.key } text={ item.text } attachments={ item.attachments } />
							);
						case 'assistant-text':
							return (
								<AssistantText
									key={ item.key }
									text={ item.text }
									copyText={ item.copyText }
									showActions={ selectedKey === item.key || item.key === latestActionableKey }
									onToggleSelect={ () =>
										setSelectedKey( ( current ) => ( current === item.key ? null : item.key ) )
									}
								/>
							);
						case 'work-phase':
							return (
								<WorkPhaseRow key={ item.key } steps={ item.steps } summary={ item.summary } />
							);
						case 'chat-artifact':
							return <ChatArtifact key={ item.key } widgets={ item.widgets } />;
						case 'agent-question-batch':
							return (
								<AgentQuestionBatch
									key={ item.key }
									questions={ item.questions }
									pendingQuestions={ pendingQuestions }
									pendingAnswers={ pendingAnswers }
									onAnswer={ onAnswerQuestion }
								/>
							);
						case 'permission-request':
							return (
								<PermissionRequest
									key={ item.key }
									request={ item.request }
									isInteractive={ pendingPermissions.has( item.request.id ) }
									decision={ answeredPermissions[ item.request.id ] ?? item.decision }
									onDecide={ ( decision ) => onAnswerPermission( item.request.id, decision ) }
								/>
							);
						case 'interrupted-marker':
							return (
								<div key={ item.key } className={ styles.interruptedMarker } role="status">
									{ __( 'Interrupted by you' ) }
								</div>
							);
						case 'error-marker':
							return <TurnErrorMarker key={ item.key } message={ item.message } />;
						default:
							return null;
					}
				} ) }
				{ showLiveWork ? (
					<>
						<LiveWorkPhase steps={ livePhaseSteps } activeTool={ activeTool } />
						<ThinkingIndicator active startedAt={ startedAt } progressMessage={ progressMessage } />
					</>
				) : (
					<ThinkingIndicator
						active={ isRunning && pendingQuestions.size === 0 && pendingPermissions.size === 0 }
						startedAt={ startedAt }
						progressMessage={ progressMessage }
					/>
				) }
			</div>
		</ConversationGalleryContext.Provider>
	);
}
