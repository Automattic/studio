import {
	getLocalMediaPath,
	getMediaAltText,
	getSafeMediaUrl,
	isRenderableMediaWidget,
	isStudioChatArtifactData,
	stripMediaWidgetPayloadLines,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import { isAiBlockedError, isUsageCapError } from '@studio/common/ai/json-events';
import {
	isStudioCustomEntryOfType,
	type StudioChatAttachmentSummary,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	getInputString,
	getToolDetail,
	getToolDisplayName,
	getToolResultDiff,
	splitCommandArgs,
	type NormalizedToolResult,
} from '@studio/common/ai/tools';
import {
	formatAiBlockedNotice,
	formatUsageCapNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
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
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Markdown } from '@/components/markdown';
import { useConnector, type LoadedAiSession } from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { useSites } from '@/data/queries/use-sites';
import { refreshIcon } from '@/lib/icons';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { MouseEvent as ReactMouseEvent } from 'react';

interface AgentQuestionRenderItem {
	key: string;
	question: string;
	options: Array< { label: string; description: string } >;
	pickedLabel?: string;
}

type RenderItem =
	| {
			kind: 'user-text';
			key: string;
			text: string;
			attachments?: StudioChatAttachmentSummary[];
	  }
	| { kind: 'assistant-text'; key: string; text: string; copyText?: string }
	| {
			kind: 'tool-use';
			key: string;
			name: string;
			input?: Record< string, unknown >;
			result?: NormalizedToolResult;
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
	| { kind: 'interrupted-marker'; key: string }
	| { kind: 'error-marker'; key: string; message: string };

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

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present', 'AskUserQuestion' ] );
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

	const items: RenderItem[] = [];
	for ( let entryIndex = 0; entryIndex < entries.length; entryIndex += 1 ) {
		const entry = entries[ entryIndex ];
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
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

		if ( isStudioCustomEntryOfType( entry, 'studio.chat_artifact' ) ) {
			const data = ( entry as StudioCustomEntry< 'studio.chat_artifact' > ).data;
			// Guard against malformed persisted entries so one bad line can't
			// take down the whole transcript.
			if ( ! isStudioChatArtifactData( data ) ) {
				continue;
			}
			const widgets = data.widgets.filter(
				( widget ) =>
					isRenderableMediaWidget( widget ) &&
					// Without local media access (browser builds), only widgets
					// with a renderable remote URL are worth showing.
					( options.canReadLocalMedia !== false || Boolean( getSafeMediaUrl( widget ) ) )
			);
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

	return (
		// Clicking the message is a mouse convenience for revealing its actions;
		// keyboard users reach the same buttons by tabbing to them, which opens
		// the row via :focus-within. Deliberately no button role — the message
		// holds links, and nesting them inside a control would be invalid.
		<div
			className={ styles.assistantTurn }
			data-actions-open={ showActions ? 'true' : undefined }
			onClick={ copyText ? handleClick : undefined }
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
	const hasDiff = Boolean( result?.diff );
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
		</>
	);

	return (
		<div className={ styles.toolBlock }>
			{ hasExpandableDetails ? (
				<button
					type="button"
					className={ clsx( styles.toolRow, styles.toolRowButton ) }
					aria-label={ display.detail ? `${ display.label } ${ display.detail }` : display.label }
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
					title={ expanded ? __( 'Hide tool details' ) : __( 'Show tool details' ) }
				>
					{ rowContent }
				</button>
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
									{ resultText }
								</pre>
							) : null }
							{ hasDiff ? <DiffBlock diff={ result!.diff! } /> : null }
						</div>
					</div>
				</div>
			) : null }
		</div>
	);
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

// In-flow marker for a turn that ended in an error. The monthly usage cap
// gets dedicated copy — with the reset date once the quota query resolves —
// instead of the raw provider message.
function TurnErrorMarker( {
	message,
	terminalSiteId,
}: {
	message: string;
	terminalSiteId?: string;
} ) {
	const isUsageCap = isUsageCapError( message );
	const { data: quota } = useStudioAssistantQuota( { enabled: isUsageCap } );
	const navigate = useNavigate();
	let text: string;
	if ( isAiBlockedError( message ) ) {
		text = formatAiBlockedNotice();
	} else if ( isUsageCap ) {
		text = formatUsageCapNotice( quota?.costResetDate );
	} else {
		text = message || __( 'Something went wrong and this turn was stopped. Please try again.' );
	}
	// When the WPcom assistant is capped, disabled, or wants a login, offer the
	// Claude Code terminal — it runs on the user's own Claude subscription.
	// The login-required match keys on the English CLI error; localized CLIs
	// fall back to the plain error text without the shortcut.
	const isLoginRequired = /login required|use \/login/i.test( message );
	const offerTerminal =
		terminalSiteId && ( isUsageCap || isAiBlockedError( message ) || isLoginRequired );
	return (
		<div className={ styles.errorMarker } role="alert">
			{ text }
			{ offerTerminal ? (
				<div className={ styles.errorMarkerAction }>
					<Button
						type="button"
						variant="outline"
						size="small"
						onClick={ () =>
							void navigate( {
								to: '/sites/$siteId/terminal',
								params: { siteId: terminalSiteId },
							} )
						}
					>
						{ __( 'Continue in the Claude Code terminal' ) }
					</Button>
				</div>
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
	const canReadLocalMedia = useConnector().capabilities.readLocalMedia;
	const { data: sites } = useSites();
	const ownerSite = findAiSessionOwnerSite( sites, data.summary );
	const items = useMemo(
		() => entriesToRenderItems( entries, { canReadLocalMedia } ),
		[ entries, canReadLocalMedia ]
	);
	const progressMessage = useMemo(
		() => ( isRunning ? findLatestProgressMessage( entries ) : null ),
		[ entries, isRunning ]
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
		<div className={ styles.root }>
			{ items.map( ( item ) => {
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
					case 'tool-use':
						return (
							<ToolUseRow
								key={ item.key }
								name={ item.name }
								input={ item.input }
								result={ item.result }
							/>
						);
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
					case 'chat-artifact':
						return <ChatArtifact key={ item.key } widgets={ item.widgets } />;
					case 'interrupted-marker':
						return (
							<div key={ item.key } className={ styles.interruptedMarker } role="status">
								{ __( 'Interrupted by you' ) }
							</div>
						);
					case 'error-marker':
						return (
							<TurnErrorMarker
								key={ item.key }
								message={ item.message }
								terminalSiteId={ ownerSite?.id }
							/>
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
