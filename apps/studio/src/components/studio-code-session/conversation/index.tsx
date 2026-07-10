import {
	getLocalMediaPath,
	getMediaAltText,
	getSafeMediaUrl,
	isRenderableMediaWidget,
	isStudioChatArtifactData,
	stripMediaWidgetPayloadLines,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import { readBlobAsDataUrl } from '@studio/common/ai/composer-attachments';
import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	getToolDetail,
	getToolDisplayName,
	getToolResultDiff,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { image, page } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CopyButton } from '../copy-button';
import { Markdown } from '../markdown';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { PermissionDecision, PermissionRequestData } from '@studio/common/ai/tool-permissions';

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
			entryId: string;
			text: string;
			attachments?: StudioChatAttachmentSummary[];
	  }
	| { kind: 'assistant-text'; key: string; text: string; copyText?: string }
	| { kind: 'thinking'; key: string; text: string; durationMs?: number }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
	  }
	| {
			kind: 'agent-question';
			key: string;
			question: string;
			options: Array< { label: string; description: string } >;
			answer?: string;
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
	| { kind: 'interrupted-marker'; key: string };

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

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present' ] );

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
	if ( ! durationMs || durationMs > 60 * 60 * 1000 ) {
		return __( 'Thinking…' );
	}
	const totalSeconds = Math.max( 1, Math.round( durationMs / 1000 ) );
	if ( totalSeconds < 60 ) {
		/* translators: %d: number of seconds the agent spent thinking */
		return sprintf( __( 'Thought for %ds' ), totalSeconds );
	}
	return sprintf(
		/* translators: 1: minutes, 2: seconds the agent spent thinking */
		__( 'Thought for %1$dm %2$ds' ),
		Math.floor( totalSeconds / 60 ),
		totalSeconds % 60
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
			text: stripMediaWidgetPayloadLines( text ),
			isError: message.isError === true,
			diff: message.isError === true ? undefined : getToolResultDiff( message.details ),
		} );
	}

	// Answers picked for `studio.agent_question` entries are persisted as
	// `studio.user_prompt` entries with `source: 'ask_user'` (the CLI writes all
	// questions in a batch first, then all answers, in question order). They are
	// not rendered as prompts, but we reuse them to keep the picked option
	// highlighted in history after the turn moves on — and after a reload, since
	// this is disk-backed (unlike the ephemeral `pendingAnswers` state).
	const askUserAnswers: string[] = [];
	for ( const entry of entries ) {
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( data?.source === 'ask_user' ) {
				askUserAnswers.push( data.text );
			}
		}
	}
	// ponytail: ordinal pairing — i-th question ↔ i-th ask_user answer. A skipped
	// question (empty answer isn't persisted) would shift later pairings, but such
	// batches are interrupted and become non-interactive. Upgrade to label-matching
	// only if that case ever shows wrong highlights.
	let questionOrdinal = 0;

	// Permission decisions pair with their request by id (no ordinal fragility).
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

	// Pre-scan: find entries superseded by edits. For each edit marker, hide
	// everything from the original entry through the marker itself.
	const editMarkers = new Map< string, number >();
	entries.forEach( ( entry, index ) => {
		if ( isStudioCustomEntryOfType( entry, 'studio.message_edited' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.message_edited' > ).data;
			if ( data?.originalEntryId ) {
				editMarkers.set( data.originalEntryId, index );
			}
		}
	} );
	const hiddenIndices = new Set< number >();
	if ( editMarkers.size > 0 ) {
		let hideUntilIndex = -1;
		for ( let i = 0; i < entries.length; i += 1 ) {
			const entryId = ( entries[ i ] as { id?: string } ).id;
			if ( entryId && editMarkers.has( entryId ) ) {
				hideUntilIndex = editMarkers.get( entryId )!;
			}
			if ( i <= hideUntilIndex ) {
				hiddenIndices.add( i );
			}
		}
	}

	const items: RenderItem[] = [];
	entries.forEach( ( entry, entryIndex ) => {
		if ( hiddenIndices.has( entryIndex ) ) {
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) return;
			items.push( {
				kind: 'user-text',
				key: `${ entryIndex }:user`,
				entryId: ( entry as { id: string } ).id,
				text: data.text,
				attachments: data.attachments,
			} );
			return;
		}

		if ( entry.type === 'message' ) {
			const message = ( entry as { message?: unknown } ).message as
				| PiAssistantMessageLike
				| undefined;
			if ( ! message || message.role !== 'assistant' || ! Array.isArray( message.content ) ) {
				return;
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
			const fullMessageText = textBlocks.map( ( block ) => block.text!.trim() ).join( '\n\n' );
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
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.agent_question' > ).data;
			if ( ! data ) return;
			items.push( {
				kind: 'agent-question',
				key: `${ entryIndex }:question`,
				question: data.question,
				options: data.options,
				answer: askUserAnswers[ questionOrdinal ],
			} );
			questionOrdinal += 1;
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.permission_request' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.permission_request' > ).data;
			if ( ! data ) return;
			items.push( {
				kind: 'permission-request',
				key: `${ entryIndex }:permission`,
				request: data,
				decision: permissionDecisionsById.get( data.id ),
			} );
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.chat_artifact' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.chat_artifact' > ).data;
			// Guard against malformed persisted entries so one bad line can't
			// take down the whole transcript.
			if ( ! isStudioChatArtifactData( data ) ) {
				return;
			}
			const widgets = data.widgets.filter( isRenderableMediaWidget );
			if ( widgets.length > 0 ) {
				items.push( {
					kind: 'chat-artifact',
					key: `${ entryIndex }:chat-artifact`,
					widgets,
				} );
			}
			return;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.turn_closed' > ).data;
			if ( data?.status === 'interrupted' ) {
				items.push( {
					kind: 'interrupted-marker',
					key: `${ entryIndex }:interrupted`,
				} );
			}
			return;
		}
	} );

	return items;
}

export function wasLastTurnInterrupted( entries: SessionEntry[] ): boolean {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const entry = entries[ index ];
		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.turn_closed' > ).data;
			return data?.status === 'interrupted';
		}
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			return false;
		}
	}
	return false;
}

function UserTurn( {
	text,
	attachments,
	editable = false,
	onSubmitEdit,
}: {
	text: string;
	attachments?: StudioChatAttachmentSummary[];
	editable?: boolean;
	onSubmitEdit?: ( newText: string ) => void;
} ) {
	const [ isEditing, setIsEditing ] = useState( false );
	const [ editText, setEditText ] = useState( text );
	const textareaRef = useRef< HTMLTextAreaElement >( null );

	const startEditing = useCallback( () => {
		setEditText( text );
		setIsEditing( true );
	}, [ text ] );

	const cancelEditing = useCallback( () => {
		setIsEditing( false );
	}, [] );

	const submitEdit = useCallback( () => {
		const trimmed = editText.trim();
		if ( trimmed && onSubmitEdit ) {
			onSubmitEdit( trimmed );
		}
		setIsEditing( false );
	}, [ editText, onSubmitEdit ] );

	const handleKeyDown = useCallback(
		( event: React.KeyboardEvent< HTMLTextAreaElement > ) => {
			if ( event.key === 'Escape' ) {
				cancelEditing();
			} else if ( event.key === 'Enter' && ! event.shiftKey ) {
				event.preventDefault();
				submitEdit();
			}
		},
		[ cancelEditing, submitEdit ]
	);

	useEffect( () => {
		if ( isEditing && textareaRef.current ) {
			const textarea = textareaRef.current;
			textarea.focus();
			textarea.selectionStart = textarea.value.length;
		}
	}, [ isEditing ] );

	if ( isEditing ) {
		return (
			<div className={ styles.userTurn }>
				<textarea
					ref={ textareaRef }
					className={ styles.userEditTextarea }
					value={ editText }
					onChange={ ( e ) => setEditText( e.target.value ) }
					onKeyDown={ handleKeyDown }
					rows={ 3 }
				/>
				<div className={ styles.userEditActions }>
					<button type="button" className={ styles.userEditCancelButton } onClick={ cancelEditing }>
						{ __( 'Cancel' ) }
					</button>
					<button
						type="button"
						className={ styles.userEditSendButton }
						onClick={ submitEdit }
						disabled={ ! editText.trim() }
					>
						{ __( 'Send' ) }
					</button>
				</div>
			</div>
		);
	}

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
								<img
									className={ styles.userAttachmentThumb }
									src={ attachment.previewDataUrl }
									alt={ attachment.name }
									title={ attachment.name }
								/>
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
			{ editable && onSubmitEdit ? (
				<div className={ styles.userActions }>
					<button
						type="button"
						className={ styles.userEditButton }
						onClick={ startEditing }
						aria-label={ __( 'Edit your last message' ) }
					>
						{ __( 'Edit' ) }
					</button>
				</div>
			) : null }
		</div>
	);
}

function AssistantText( { text, copyText }: { text: string; copyText?: string } ) {
	const [ showCopied, setShowCopied ] = useState( false );
	const copiedTimer = useRef< ReturnType< typeof setTimeout > | null >( null );
	useEffect( () => {
		return () => {
			if ( copiedTimer.current ) {
				clearTimeout( copiedTimer.current );
			}
		};
	}, [] );

	// Double-click anywhere in the reply copies it (the whole message when
	// this is its last text block, otherwise this fragment). Native word
	// selection still happens — the copy is additive, and the notice is the
	// only signal that more than a selection occurred.
	const handleDoubleClick = useCallback( () => {
		void getIpcApi().copyText( copyText ?? text );
		setShowCopied( true );
		if ( copiedTimer.current ) {
			clearTimeout( copiedTimer.current );
		}
		copiedTimer.current = setTimeout( () => setShowCopied( false ), 1500 );
	}, [ copyText, text ] );

	return (
		<div className={ styles.assistantTurn } onDoubleClick={ handleDoubleClick }>
			<Markdown>{ text }</Markdown>
			{ copyText ? (
				<CopyButton
					text={ copyText }
					label={ __( 'Copy message' ) }
					className={ styles.messageActions }
				/>
			) : null }
			{ showCopied ? (
				<span className={ styles.copyNotice } role="status">
					{ __( 'Copied' ) }
				</span>
			) : null }
		</div>
	);
}

const TOOL_RESULT_PREVIEW_MAX_LINES = 12;

function ToolUseRow( {
	name,
	input,
	result,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
} ) {
	const label = getToolDisplayName( name, input );
	const detail = getToolDetail( name, input );
	const [ expanded, setExpanded ] = useState( false );
	const resultText = result?.text?.trim() ?? '';
	const diff = result?.diff;
	const hasOutput = resultText.length > 0 || Boolean( diff );
	const isLong =
		resultText.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES ||
		( diff ? diff.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES : false );

	return (
		<div className={ styles.toolBlock }>
			<div className={ styles.toolRow }>
				<span className={ styles.toolLabel }>{ label }</span>
				{ detail ? <span className={ styles.toolDetail }>{ detail }</span> : null }
			</div>
			{ hasOutput ? (
				<div className={ styles.toolOutputWrap }>
					{ resultText.length > 0 ? (
						<pre
							className={ cx(
								styles.toolOutput,
								result?.isError && styles.toolOutputError,
								! expanded && isLong && styles.toolOutputCollapsed
							) }
						>
							{ resultText }
						</pre>
					) : null }
					{ diff ? (
						<pre
							className={ cx(
								styles.toolDiff,
								! expanded && isLong && styles.toolOutputCollapsed
							) }
						>
							{ diff
								.replace( /\n$/, '' )
								.split( '\n' )
								.map( ( line, index ) => (
									<span
										key={ index }
										className={ cx(
											styles.diffLine,
											line.startsWith( '+' ) && styles.diffLineAdded,
											line.startsWith( '-' ) && styles.diffLineRemoved
										) }
									>
										{ line.length > 0 ? line : ' ' }
									</span>
								) ) }
						</pre>
					) : null }
					{ isLong ? (
						<button
							type="button"
							className={ styles.toolOutputToggle }
							onClick={ () => setExpanded( ( prev ) => ! prev ) }
						>
							{ expanded ? __( 'Show less' ) : __( 'Show more' ) }
						</button>
					) : null }
				</div>
			) : null }
		</div>
	);
}

// The model's extended-thinking block, presented like a tool call: a label
// row with the reasoning as collapsible output.
function ThinkingRow( { text, durationMs }: { text: string; durationMs?: number } ) {
	const [ expanded, setExpanded ] = useState( false );
	const isLong = text.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES;

	return (
		<div className={ styles.toolBlock }>
			<div className={ styles.toolRow }>
				<span className={ styles.toolLabel }>{ getThinkingLabel( durationMs ) }</span>
			</div>
			<div className={ styles.toolOutputWrap }>
				<pre
					className={ cx( styles.toolOutput, ! expanded && isLong && styles.toolOutputCollapsed ) }
				>
					{ text }
				</pre>
				{ isLong ? (
					<button
						type="button"
						className={ styles.toolOutputToggle }
						onClick={ () => setExpanded( ( prev ) => ! prev ) }
					>
						{ expanded ? __( 'Show less' ) : __( 'Show more' ) }
					</button>
				) : null }
			</div>
		</div>
	);
}

// Data URLs for already-read screenshot files, keyed by path. Screenshot
// files are immutable, so one IPC read per path per app lifetime is enough.
// Data URLs (allowed by the renderer CSP, unlike blob:) need no revocation.
const localMediaDataUrls = new Map< string, Promise< string > >();

function readLocalMediaDataUrl( path: string ): Promise< string > {
	let promise = localMediaDataUrls.get( path );
	if ( ! promise ) {
		promise = getIpcApi()
			.readLocalMediaFile( path )
			.then( ( file ) => readBlobAsDataUrl( new Blob( [ file.data ], { type: file.mimeType } ) ) );
		promise.catch( () => localMediaDataUrls.delete( path ) );
		localMediaDataUrls.set( path, promise );
	}
	return promise;
}

function ChatArtifact( { widgets }: { widgets: StudioChatArtifactWidgetDraft[] } ) {
	return (
		<div className={ styles.mediaArtifactGrid }>
			{ widgets.map( ( widget, index ) => (
				<MediaArtifactImage key={ `${ widget.type }:${ index }` } widget={ widget } />
			) ) }
		</div>
	);
}

function MediaArtifactImage( { widget }: { widget: StudioChatArtifactWidgetDraft } ) {
	const localPath = getLocalMediaPath( widget );
	const safeUrl = getSafeMediaUrl( widget );
	const [ localSrc, setLocalSrc ] = useState< string | null >( null );
	const [ failed, setFailed ] = useState( false );

	useEffect( () => {
		if ( ! localPath ) {
			return;
		}
		let active = true;
		setLocalSrc( null );
		setFailed( false );
		readLocalMediaDataUrl( localPath )
			.then( ( dataUrl ) => {
				if ( active ) {
					setLocalSrc( dataUrl );
				}
			} )
			.catch( () => {
				if ( active ) {
					setFailed( true );
				}
			} );
		return () => {
			active = false;
		};
	}, [ localPath ] );

	const src = localPath ? localSrc : safeUrl;

	if ( failed || ( ! localPath && ! safeUrl ) ) {
		return (
			<div className={ styles.mediaArtifactUnavailable } role="status">
				{ __( 'Image unavailable' ) }
			</div>
		);
	}

	if ( ! src ) {
		return <div className={ styles.mediaArtifactLoading } aria-hidden="true" />;
	}

	return (
		<figure className={ styles.mediaArtifactItem }>
			<img
				className={ styles.mediaArtifactImage }
				src={ src }
				alt={ getMediaAltText( widget, __( 'Image' ) ) }
			/>
		</figure>
	);
}

function AgentQuestion( {
	question,
	options,
	isInteractive,
	pickedLabel,
	onAnswer,
}: {
	question: string;
	options: Array< { label: string; description: string } >;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	onAnswer: ( label: string ) => void;
} ) {
	return (
		<div className={ styles.question }>
			<p className={ styles.questionText }>{ question }</p>
			{ options.length > 0 ? (
				<ul className={ styles.questionOptions }>
					{ options.map( ( option, index ) => {
						const picked = option.label === pickedLabel;
						return (
							<li key={ index }>
								<button
									type="button"
									className={ cx( styles.questionOption, picked && styles.questionOptionPicked ) }
									disabled={ ! isInteractive }
									onClick={ () => onAnswer( option.label ) }
									title={ option.description }
								>
									{ option.label }
								</button>
							</li>
						);
					} ) }
				</ul>
			) : null }
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
	// Live pending request from the active run; everything else renders as a
	// resolved (or expired) record.
	isInteractive: boolean;
	decision: PermissionDecision | undefined;
	onDecide: ( decision: PermissionDecision ) => void;
} ) {
	const titleId = useId();
	const descriptionId = useId();
	const containerRef = useRef< HTMLDivElement >( null );

	// Move keyboard focus to the card (not a button) when it appears: a screen
	// reader announces the whole question via the group's name/description, Tab
	// reaches the actions, and Enter can't trigger the destructive action until
	// the user deliberately moves to it. Not a dialog — the user can still
	// scroll and read the conversation to inform the decision.
	useEffect( () => {
		if ( isInteractive ) {
			containerRef.current?.focus();
		}
	}, [ isInteractive ] );

	// Resolved (or expired) requests collapse to a tool-call-style row — the
	// full card is only for the decision that's actually being made.
	if ( ! isInteractive ) {
		let label: string = __( 'Permission request expired' );
		if ( decision === 'deny' ) {
			label = request.deniedLabel ?? __( 'Permission denied' );
		} else if ( decision !== undefined ) {
			label = request.allowedLabel ?? __( 'Permission granted' );
		}
		return (
			<div className={ styles.toolBlock }>
				<div className={ styles.toolRow }>
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
				<button
					type="button"
					className={ cx( styles.permissionAction, styles.permissionActionConfirm ) }
					onClick={ () => onDecide( 'allow_once' ) }
				>
					{ __( 'Yes, go ahead' ) }
				</button>
				{ request.allowAlways ? (
					<button
						type="button"
						className={ cx( styles.permissionAction, styles.permissionActionAlways ) }
						onClick={ () => onDecide( 'always_allow' ) }
						title={ sprintf(
							/* translators: %s: what will be allowed without asking again (e.g. "pushing sites to WordPress.com") */
							__( 'Stop asking before %s. You can change this in Settings.' ),
							request.actionLabel
						) }
					>
						{ __( 'Always allow' ) }
					</button>
				) : null }
				<button
					type="button"
					className={ cx( styles.permissionAction, styles.permissionActionDeny ) }
					onClick={ () => onDecide( 'deny' ) }
				>
					{ __( 'No, stop' ) }
				</button>
			</div>
		</div>
	);
}

export function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	answeredQuestions,
	pendingPermissions,
	answeredPermissions,
	onAnswerQuestion,
	onAnswerPermission,
	canEditLastUserMessage = false,
	onEditUserMessage,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	answeredQuestions: Record< string, string >;
	// Ids of gated tool calls awaiting a decision on the active run.
	pendingPermissions: Set< string >;
	// Decisions sent this session, keyed by request id (bridges the disk lag).
	answeredPermissions: Record< string, PermissionDecision >;
	onAnswerQuestion: ( question: string, label: string ) => void;
	onAnswerPermission: ( requestId: string, decision: PermissionDecision ) => void;
	canEditLastUserMessage?: boolean;
	onEditUserMessage?: ( entryId: string, text: string ) => void;
} ) {
	const entries = data.entries;
	const items = useMemo( () => entriesToRenderItems( entries ), [ entries ] );
	// Only the most recent user prompt is offered for editing, and only once
	// the run behind it has been stopped.
	const lastUserTextKey = useMemo( () => {
		for ( let index = items.length - 1; index >= 0; index -= 1 ) {
			if ( items[ index ].kind === 'user-text' ) {
				return items[ index ].key;
			}
		}
		return null;
	}, [ items ] );

	// Optimistic hide: the persisted `studio.message_edited` marker only takes
	// effect once the cache refreshes from disk. This local set hides the old
	// turn immediately so the user sees the replacement right away.
	const [ optimisticHiddenKeys, setOptimisticHiddenKeys ] = useState< Set< string > >(
		() => new Set()
	);
	const handleEditSubmit = useCallback(
		( entryId: string, newText: string ) => {
			const keysToHide = new Set< string >();
			let lastUserIdx = -1;
			for ( let i = items.length - 1; i >= 0; i -= 1 ) {
				if ( items[ i ].kind === 'user-text' ) {
					lastUserIdx = i;
					break;
				}
			}
			if ( lastUserIdx >= 0 ) {
				for ( let i = lastUserIdx; i < items.length; i += 1 ) {
					keysToHide.add( items[ i ].key );
				}
				setOptimisticHiddenKeys( keysToHide );
			}
			onEditUserMessage?.( entryId, newText );
		},
		[ items, onEditUserMessage ]
	);

	return (
		<div className={ styles.root }>
			{ items.map( ( item ) => {
				if ( optimisticHiddenKeys.has( item.key ) ) {
					return null;
				}
				switch ( item.kind ) {
					case 'user-text': {
						const editable = canEditLastUserMessage && item.key === lastUserTextKey;
						return (
							<UserTurn
								key={ item.key }
								text={ item.text }
								attachments={ item.attachments }
								editable={ editable }
								onSubmitEdit={
									editable ? ( newText ) => handleEditSubmit( item.entryId, newText ) : undefined
								}
							/>
						);
					}
					case 'assistant-text':
						return <AssistantText key={ item.key } text={ item.text } copyText={ item.copyText } />;
					case 'thinking':
						return (
							<ThinkingRow key={ item.key } text={ item.text } durationMs={ item.durationMs } />
						);
					case 'tool-use':
						return (
							<ToolUseRow
								key={ item.key }
								name={ item.name }
								input={ item.input }
								result={ item.result }
							/>
						);
					case 'agent-question':
						return (
							<AgentQuestion
								key={ item.key }
								question={ item.question }
								options={ item.options }
								isInteractive={ pendingQuestions.has( item.question ) }
								pickedLabel={
									pendingAnswers[ item.question ] ??
									answeredQuestions[ item.question ] ??
									item.answer
								}
								onAnswer={ ( label ) => onAnswerQuestion( item.question, label ) }
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
					case 'chat-artifact':
						return <ChatArtifact key={ item.key } widgets={ item.widgets } />;
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.interruptedMarker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
						);
					default:
						return null;
				}
			} ) }
			<ThinkingIndicator
				active={ isRunning && pendingQuestions.size === 0 && pendingPermissions.size === 0 }
				startedAt={ startedAt }
			/>
		</div>
	);
}
