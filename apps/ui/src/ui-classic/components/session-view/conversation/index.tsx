import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import {
	getToolDetail,
	getToolDisplayName,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import { __, _n, sprintf } from '@wordpress/i18n';
import { chevronRight } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Markdown } from '@/components/markdown';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { LoadedAiSession, StudioChatImageAttachment } from '@/data/core';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

type RenderItem =
	| {
			kind: 'user-turn';
			key: string;
			text: string;
			attachments: UserImageAttachment[];
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
	  }
	| { kind: 'interrupted-marker'; key: string };

type ToolUseRenderItem = Extract< RenderItem, { kind: 'tool-use' } >;

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

interface PiImageContentBlock {
	type: 'image';
	data: string;
	mimeType: string;
}

interface PiUserMessageLike {
	role: 'user';
	content: string | Array< { type: string; text?: string; data?: string; mimeType?: string } >;
}

interface PiToolResultLike {
	role: 'toolResult';
	toolCallId: string;
	content?: Array< { type: string; text?: string } >;
	isError?: boolean;
}

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present' ] );

interface UserImageAttachment extends StudioChatImageAttachment {
	src?: string;
}

function getUserImageBlocksAfter(
	entries: SessionEntry[],
	entryIndex: number
): PiImageContentBlock[] {
	for ( let i = entryIndex + 1; i < entries.length; i += 1 ) {
		const entry = entries[ i ];
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			return [];
		}
		if ( entry.type !== 'message' ) {
			continue;
		}
		const message = ( entry as { message?: unknown } ).message as PiUserMessageLike | undefined;
		if ( ! message || message.role !== 'user' || ! Array.isArray( message.content ) ) {
			return [];
		}
		return message.content
			.filter(
				( block ): block is PiImageContentBlock =>
					block.type === 'image' &&
					typeof block.data === 'string' &&
					typeof block.mimeType === 'string' &&
					block.mimeType.startsWith( 'image/' )
			)
			.map( ( block ) => ( {
				type: 'image',
				data: block.data,
				mimeType: block.mimeType,
			} ) );
	}
	return [];
}

function buildUserImageAttachments(
	metadata: StudioChatImageAttachment[] | undefined,
	imageBlocks: PiImageContentBlock[]
): UserImageAttachment[] {
	const max = Math.max( metadata?.length ?? 0, imageBlocks.length );
	const attachments: UserImageAttachment[] = [];
	for ( let index = 0; index < max; index += 1 ) {
		const meta = metadata?.[ index ];
		const block = imageBlocks[ index ];
		if ( ! meta && ! block ) {
			continue;
		}
		attachments.push( {
			id: meta?.id ?? `${ index }`,
			name: meta?.name ?? __( 'Attached image' ),
			mimeType: meta?.mimeType ?? ( block?.mimeType as StudioChatImageAttachment[ 'mimeType' ] ),
			size: meta?.size ?? 0,
			width: meta?.width,
			height: meta?.height,
			src: block ? `data:${ block.mimeType };base64,${ block.data }` : undefined,
		} );
	}
	return attachments;
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

	const items: RenderItem[] = [];
	entries.forEach( ( entry, entryIndex ) => {
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
			if ( ! data || data.source !== 'prompt' ) return;
			const imageBlocks = getUserImageBlocksAfter( entries, entryIndex );
			items.push( {
				kind: 'user-turn',
				key: `${ entryIndex }:user`,
				text: data.text,
				attachments: buildUserImageAttachments( data.attachments, imageBlocks ),
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

function UserTurn( { text, attachments }: { text: string; attachments: UserImageAttachment[] } ) {
	return (
		<div className={ styles.userTurn }>
			{ attachments.length > 0 ? (
				<div className={ styles.userAttachments }>
					{ attachments.map( ( attachment ) => (
						<div key={ attachment.id } className={ styles.userAttachment }>
							{ attachment.src ? (
								<img
									className={ styles.userAttachmentImage }
									src={ attachment.src }
									alt={ attachment.name }
									draggable={ false }
								/>
							) : (
								<span className={ styles.userAttachmentFallback }>{ attachment.name }</span>
							) }
						</div>
					) ) }
				</div>
			) : null }
			{ text ? <div className={ styles.userText }>{ text }</div> : null }
		</div>
	);
}

function AssistantText( { text }: { text: string } ) {
	return <Markdown>{ text }</Markdown>;
}

const TOOL_RESULT_PREVIEW_MAX_LINES = 12;

function lowerFirstCharacter( text: string ) {
	if ( text.length === 0 ) {
		return text;
	}
	return text.charAt( 0 ).toLocaleLowerCase() + text.slice( 1 );
}

function getToolActionDescription( name: string, input?: Record< string, unknown > ) {
	const detail = getToolDetail( name, input );
	const withDetail = ( label: string, fallback: string ) =>
		detail ? sprintf( label as '%s', detail ) : fallback;

	switch ( name ) {
		case 'Read':
			return withDetail( __( 'Read %s' ), __( 'Read a file' ) );
		case 'Write':
			return withDetail( __( 'Wrote %s' ), __( 'Wrote a file' ) );
		case 'Edit':
			return withDetail( __( 'Edited %s' ), __( 'Edited a file' ) );
		case 'Bash':
			return withDetail( __( 'Ran %s' ), __( 'Ran a command' ) );
		case 'Grep':
		case 'Glob':
			return withDetail( __( 'Searched for %s' ), __( 'Searched files' ) );
		case 'Ls':
			return withDetail( __( 'Listed %s' ), __( 'Listed files' ) );
		case 'Skill':
			return withDetail( __( 'Loaded %s' ), __( 'Loaded a skill' ) );
		case 'Task':
			return __( 'Ran a task' );
		case 'TodoWrite':
			return __( 'Updated the todo list' );
		case 'wp_cli':
			return withDetail( __( 'Ran %s' ), __( 'Ran WP-CLI' ) );
		case 'wpcom_request':
			return withDetail( __( 'Requested %s' ), __( 'Called WordPress.com' ) );
		case 'validate_html_blocks':
			return withDetail( __( 'Checked HTML blocks in %s' ), __( 'Checked HTML blocks' ) );
		case 'validate_and_fix_blocks':
			return withDetail( __( 'Fixed block validation in %s' ), __( 'Fixed block validation' ) );
		case 'take_screenshot':
		case 'share_screenshot':
			return withDetail( __( 'Captured %s' ), __( 'Captured a screenshot' ) );
		case 'site_create':
			return withDetail( __( 'Created site %s' ), __( 'Created a site' ) );
		case 'site_start':
			return withDetail( __( 'Started site %s' ), __( 'Started a site' ) );
		case 'site_stop':
			return withDetail( __( 'Stopped site %s' ), __( 'Stopped a site' ) );
		case 'site_delete':
			return withDetail( __( 'Deleted site %s' ), __( 'Deleted a site' ) );
		case 'site_push':
			return withDetail( __( 'Pushed site %s' ), __( 'Pushed a site' ) );
		case 'site_pull':
			return withDetail( __( 'Pulled site %s' ), __( 'Pulled a site' ) );
		case 'site_import':
			return withDetail( __( 'Imported site %s' ), __( 'Imported a site' ) );
		case 'site_export':
			return withDetail( __( 'Exported site %s' ), __( 'Exported a site' ) );
		case 'preview_create':
			return withDetail( __( 'Created preview %s' ), __( 'Created a preview' ) );
		case 'preview_update':
			return withDetail( __( 'Updated preview %s' ), __( 'Updated a preview' ) );
		case 'preview_delete':
			return withDetail( __( 'Deleted preview %s' ), __( 'Deleted a preview' ) );
		default: {
			const label = getToolDisplayName( name );
			return detail
				? sprintf( __( 'Used %1$s on %2$s' ), label, detail )
				: sprintf( __( 'Used %s' ), label );
		}
	}
}

function getActivitySummary( activityItems: ToolUseRenderItem[], isRunning: boolean ) {
	if ( activityItems.length === 0 ) {
		return {
			title: isRunning ? __( 'Thinking through it' ) : __( 'Background work' ),
			meta: '',
		};
	}

	const descriptions = activityItems.map( ( item ) =>
		getToolActionDescription( item.name, item.input )
	);

	if ( descriptions.length === 1 ) {
		return {
			title: descriptions[ 0 ],
			meta: isRunning ? __( 'Still working' ) : '',
		};
	}

	if ( descriptions.length === 2 ) {
		return {
			title: sprintf(
				__( '%1$s and %2$s' ),
				descriptions[ 0 ],
				lowerFirstCharacter( descriptions[ 1 ] )
			),
			meta: isRunning ? __( 'Still working' ) : '',
		};
	}

	return {
		title: sprintf(
			_n( '%1$s, %2$s, and %3$d more', '%1$s, %2$s, and %3$d more', descriptions.length - 2 ),
			descriptions[ 0 ],
			lowerFirstCharacter( descriptions[ 1 ] ),
			descriptions.length - 2
		),
		meta: isRunning ? __( 'Still working' ) : '',
	};
}

function AgentActivityAccordion( {
	activityItems,
	isRunning = false,
	children,
}: {
	activityItems: ToolUseRenderItem[];
	isRunning?: boolean;
	children: ReactNode;
} ) {
	const [ expanded, setExpanded ] = useState( false );
	const panelId = useId();
	const summary = getActivitySummary( activityItems, isRunning );

	return (
		<div className={ styles.activityAccordion } data-open={ expanded ? 'true' : 'false' }>
			<button
				type="button"
				className={ styles.activityToggle }
				aria-expanded={ expanded }
				aria-controls={ panelId }
				onClick={ () => setExpanded( ( previous ) => ! previous ) }
				title={ summary.title }
			>
				<span className={ styles.activityTitle }>{ summary.title }</span>
				{ isRunning ? <span className={ styles.activityPulse } aria-hidden="true" /> : null }
				{ summary.meta ? <span className={ styles.activityMeta }>{ summary.meta }</span> : null }
				<Icon icon={ chevronRight } size={ 16 } className={ styles.activityToggleIcon } />
			</button>
			<div
				id={ panelId }
				className={ styles.activityPanel }
				aria-hidden={ expanded ? undefined : true }
			>
				<div className={ styles.activityPanelInner }>{ children }</div>
			</div>
		</div>
	);
}

function ToolUseRow( {
	name,
	input,
	result,
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
} ) {
	const label = getToolDisplayName( name );
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
						className={ clsx(
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
									className={ clsx( styles.questionOption, picked && styles.questionOptionPicked ) }
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
	onAnswerQuestion,
}: {
	data: LoadedAiSession;
	isRunning: boolean;
	startedAt: number | null;
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	onAnswerQuestion: ( question: string, label: string ) => void;
} ) {
	const entries = data.entries;
	const items = useMemo( () => entriesToRenderItems( entries ), [ entries ] );
	const progressMessage = useMemo(
		() => ( isRunning ? findLatestProgressMessage( entries ) : null ),
		[ entries, isRunning ]
	);
	const shouldShowThinking = isRunning && pendingQuestions.size === 0;

	const renderToolActivity = (
		activityItems: ToolUseRenderItem[],
		key: string,
		includeThinkingIndicator = false
	) => (
		<AgentActivityAccordion
			key={ key }
			activityItems={ activityItems }
			isRunning={ includeThinkingIndicator }
		>
			{ activityItems.map( ( item ) => (
				<ToolUseRow
					key={ item.key }
					name={ item.name }
					input={ item.input }
					result={ item.result }
				/>
			) ) }
			{ includeThinkingIndicator ? (
				<ThinkingIndicator active startedAt={ startedAt } progressMessage={ progressMessage } />
			) : null }
		</AgentActivityAccordion>
	);

	const renderedItems: ReactNode[] = [];
	let activityItems: ToolUseRenderItem[] = [];

	const flushActivityItems = () => {
		if ( activityItems.length === 0 ) {
			return;
		}
		renderedItems.push(
			renderToolActivity( activityItems, `activity:${ activityItems[ 0 ].key }` )
		);
		activityItems = [];
	};

	items.forEach( ( item ) => {
		if ( item.kind === 'tool-use' ) {
			activityItems.push( item );
			return;
		}

		flushActivityItems();

		switch ( item.kind ) {
			case 'user-turn':
				renderedItems.push(
					<UserTurn key={ item.key } text={ item.text } attachments={ item.attachments } />
				);
				break;
			case 'assistant-text':
				renderedItems.push( <AssistantText key={ item.key } text={ item.text } /> );
				break;
			case 'agent-question':
				renderedItems.push(
					<AgentQuestion
						key={ item.key }
						question={ item.question }
						options={ item.options }
						isInteractive={ pendingQuestions.has( item.question ) }
						pickedLabel={ pendingAnswers[ item.question ] }
						onAnswer={ ( label ) => onAnswerQuestion( item.question, label ) }
					/>
				);
				break;
			case 'interrupted-marker':
				renderedItems.push(
					<div key={ item.key } className={ styles.interruptedMarker } role="status">
						{ __( 'Interrupted by you' ) }
					</div>
				);
				break;
			default:
				break;
		}
	} );

	if ( activityItems.length > 0 || shouldShowThinking ) {
		renderedItems.push(
			renderToolActivity(
				activityItems,
				`activity:${ activityItems[ 0 ]?.key ?? 'thinking' }`,
				shouldShowThinking
			)
		);
	}

	return <div className={ styles.root }>{ renderedItems }</div>;
}
