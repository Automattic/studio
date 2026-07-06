import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	getToolDetail,
	getToolDisplayName,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { image, page } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { cx } from 'src/lib/cx';
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
			text: string;
			attachments?: StudioChatAttachmentSummary[];
	  }
	| { kind: 'assistant-text'; key: string; text: string }
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
			text,
			isError: message.isError === true,
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
	for ( const entry of entries ) {
		if ( isStudioCustomEntryOfType( entry, 'studio.permission_response' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.permission_response' > ).data;
			if ( data ) {
				permissionDecisionsById.set( data.id, data.decision );
			}
		}
	}

	const items: RenderItem[] = [];
	entries.forEach( ( entry, entryIndex ) => {
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) return;
			items.push( {
				kind: 'user-text',
				key: `${ entryIndex }:user`,
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
	const hasOutput = resultText.length > 0;
	const isLong = resultText.split( '\n' ).length > TOOL_RESULT_PREVIEW_MAX_LINES;

	return (
		<div className={ styles.toolBlock }>
			<div className={ styles.toolRow }>
				<span className={ styles.toolLabel }>{ label }</span>
				{ detail ? <span className={ styles.toolDetail }>{ detail }</span> : null }
			</div>
			{ hasOutput ? (
				<div className={ styles.toolOutputWrap }>
					<pre
						className={ cx(
							styles.toolOutput,
							result?.isError && styles.toolOutputError,
							! expanded && isLong && styles.toolOutputCollapsed
						) }
					>
						{ resultText }
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
		<div className={ styles.permission } role="alertdialog">
			<p className={ styles.permissionTitle }>{ request.title }</p>
			{ request.consequences.map( ( line, index ) => (
				<p key={ index } className={ styles.permissionConsequence }>
					{ line }
				</p>
			) ) }
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
						className={ styles.permissionAction }
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
} ) {
	const entries = data.entries;
	const items = useMemo( () => entriesToRenderItems( entries ), [ entries ] );

	return (
		<div className={ styles.root }>
			{ items.map( ( item ) => {
				switch ( item.kind ) {
					case 'user-text':
						return (
							<UserTurn key={ item.key } text={ item.text } attachments={ item.attachments } />
						);
					case 'assistant-text':
						return <AssistantText key={ item.key } text={ item.text } />;
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
