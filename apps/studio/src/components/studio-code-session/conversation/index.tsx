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
import { __ } from '@wordpress/i18n';
import { image, page } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Markdown } from '../markdown';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
			entryId: string;
			text: string;
			attachments?: StudioChatAttachmentSummary[];
	  }
	| { kind: 'assistant-text'; key: string; text: string }
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
			kind: 'chat-artifact';
			key: string;
			widgets: StudioChatArtifactWidgetDraft[];
	  }
	| { kind: 'interrupted-marker'; key: string };

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

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present' ] );

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
			message.content.forEach( ( block, blockIndex ) => {
				if ( block.type === 'text' && typeof block.text === 'string' ) {
					const text = block.text.trim();
					if ( text ) {
						items.push( {
							kind: 'assistant-text',
							key: `${ entryIndex }:${ blockIndex }:text`,
							text,
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

// A conversation counts as "stopped" when the most recent turn ended because
// the user interrupted it. We scan back from the end: the first turn boundary
// we meet decides the answer, and a trailing user prompt (a turn that has since
// been started again) means we're no longer in the stopped state.
export function isConversationStopped( entries: SessionEntry[] ): boolean {
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

function AssistantText( { text }: { text: string } ) {
	return <Markdown>{ text }</Markdown>;
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

export function Conversation( {
	data,
	isRunning,
	startedAt,
	pendingQuestions,
	pendingAnswers,
	answeredQuestions,
	onAnswerQuestion,
	canEditLastUserMessage = false,
	onEditUserMessage,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	answeredQuestions: Record< string, string >;
	onAnswerQuestion: ( question: string, label: string ) => void;
	canEditLastUserMessage?: boolean;
	onEditUserMessage?: ( entryId: string, text: string ) => void;
} ) {
	const entries = data.entries;
	const items = useMemo( () => entriesToRenderItems( entries ), [ entries ] );
	const progressMessage = useMemo(
		() => ( isRunning ? findLatestProgressMessage( entries ) : null ),
		[ entries, isRunning ]
	);
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
						return <AssistantText key={ item.key } text={ item.text } />;
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
				active={ isRunning && pendingQuestions.size === 0 }
				startedAt={ startedAt }
				progressMessage={ progressMessage }
			/>
		</div>
	);
}
