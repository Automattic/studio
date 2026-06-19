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
import { __ } from '@wordpress/i18n';
import {
	blockDefault,
	brush,
	capturePhoto,
	category,
	chartBar,
	check,
	cloud,
	cloudDownload,
	cloudUpload,
	code,
	create,
	download,
	file,
	globe,
	help,
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
	tool,
	trash,
	trendingUp,
	update,
	upload,
} from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useId, useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { LoadedAiSession } from '@/data/core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
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
			pickedLabel?: string;
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
	isError?: boolean;
}

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present', 'AskUserQuestion' ] );

function findAskUserAnswerAfter(
	entries: SessionEntry[],
	entryIndex: number,
	options: Array< { label: string } >
): string | undefined {
	const optionLabels = new Set( options.map( ( option ) => option.label ) );
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
				pickedLabel:
					data.selectedLabel ?? findAskUserAnswerAfter( entries, entryIndex, data.options ),
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

const TOOL_DETAIL_MAX_LENGTH = 96;

interface ClassicToolDisplay {
	label: string;
	detail: string;
	inputText: string;
}

function getInputString( input: Record< string, unknown > | undefined, key: string ): string {
	const value = input?.[ key ];
	return typeof value === 'string' ? value.trim() : '';
}

function truncateToolDetail( value: string, maxLength = TOOL_DETAIL_MAX_LENGTH ): string {
	if ( value.length <= maxLength ) {
		return value;
	}
	return value.slice( 0, maxLength - 1 ).trimEnd() + '…';
}

function shortPath( value: string ): string {
	return value.split( '/' ).filter( Boolean ).slice( -2 ).join( '/' ) || value;
}

function splitCommandArgs( command: string ): string[] {
	return (
		command
			.match( /(?:[^\s"']+|"[^"]*"|'[^']*')+/g )
			?.map( ( arg ) => arg.replace( /^(['"])(.*)\1$/, '$2' ) )
			.filter( Boolean ) ?? []
	);
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
		case 'Read':
		case 'Write':
		case 'Edit':
			display.detail = genericDetail ? shortPath( genericDetail ) : '';
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
		case 'AskUserQuestion':
			return help;
		case 'take_screenshot':
			return capturePhoto;
		case 'inspect_design':
			return search;
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
}: {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
} ) {
	const display = getClassicToolDisplay( name, input );
	const detailsId = useId();
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const hasInput = display.inputText.length > 0;
	const hasExpandableDetails = hasInput || hasOutput;
	const [ expanded, setExpanded ] = useState( false );
	const rowContent = (
		<>
			<ToolIcon name={ name } input={ input } />
			<span className={ styles.toolLabel }>{ display.label }</span>
			{ display.detail ? <span className={ styles.toolDetail }>{ display.detail }</span> : null }
		</>
	);

	return (
		<div className={ styles.toolBlock }>
			{ hasExpandableDetails ? (
				<button
					type="button"
					className={ clsx( styles.toolRow, styles.toolRowButton ) }
					aria-expanded={ expanded }
					aria-controls={ detailsId }
					onClick={ () => setExpanded( ( previous ) => ! previous ) }
					title={ expanded ? __( 'Hide tool details' ) : __( 'Show tool details' ) }
				>
					{ rowContent }
				</button>
			) : (
				<div className={ styles.toolRow }>{ rowContent }</div>
			) }
			{ hasExpandableDetails && expanded ? (
				<div id={ detailsId } className={ styles.toolOutputWrap }>
					{ hasInput ? <pre className={ styles.toolInput }>{ display.inputText }</pre> : null }
					{ hasOutput ? (
						<pre className={ clsx( styles.toolOutput, result?.isError && styles.toolOutputError ) }>
							{ resultText }
						</pre>
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
	const optionsId = useId();

	return (
		<div className={ styles.question }>
			<p className={ styles.questionText }>{ question }</p>
			{ options.length > 0 ? (
				<ol className={ styles.questionOptions }>
					{ options.map( ( option, index ) => {
						const picked = option.label === pickedLabel;
						const descriptionId = option.description
							? `${ optionsId }-option-${ index }-description`
							: undefined;
						return (
							<li key={ index } className={ styles.questionOptionItem }>
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
										{ picked ? (
											<Icon
												icon={ check }
												size={ 14 }
												className={ styles.questionOptionCheck }
												aria-hidden="true"
											/>
										) : (
											index + 1
										) }
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
								pickedLabel={ pendingAnswers[ item.question ] ?? item.pickedLabel }
								onAnswer={ ( label ) => onAnswerQuestion( item.question, label ) }
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
				active={ isRunning && pendingQuestions.size === 0 }
				startedAt={ startedAt }
				progressMessage={ progressMessage }
			/>
		</div>
	);
}
