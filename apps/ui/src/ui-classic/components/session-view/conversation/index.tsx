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
	Icon,
	info,
	link,
	list,
	media,
	navigation,
	offline,
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
import { clsx } from 'clsx';
import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { Markdown } from '@/components/markdown';
import { ThinkingIndicator } from '../thinking-indicator';
import styles from './style.module.css';
import type { LoadedAiSession, StudioChatImageAttachment } from '@/data/core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

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

const HIDDEN_TOOL_ROWS = new Set( [ 'studio_present', 'AskUserQuestion' ] );

interface UserImageAttachment extends StudioChatImageAttachment {
	src?: string;
}

type UserPromptAttachmentMetadata = StudioChatAttachmentSummary | StudioChatImageAttachment;

function isUserImageAttachmentMetadata(
	attachment: UserPromptAttachmentMetadata
): attachment is StudioChatImageAttachment & { previewDataUrl?: string } {
	return ! ( 'kind' in attachment ) || attachment.kind === 'image';
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
	metadata: UserPromptAttachmentMetadata[] | undefined,
	imageBlocks: PiImageContentBlock[]
): UserImageAttachment[] {
	const imageMetadata = metadata?.filter( isUserImageAttachmentMetadata );
	const max = Math.max( imageMetadata?.length ?? 0, imageBlocks.length );
	const attachments: UserImageAttachment[] = [];
	for ( let index = 0; index < max; index += 1 ) {
		const meta = imageMetadata?.[ index ];
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
			src: block ? `data:${ block.mimeType };base64,${ block.data }` : meta?.previewDataUrl,
		} );
	}
	return attachments;
}

function findAskUserAnswerAfter(
	entries: SessionEntry[],
	entryIndex: number,
	options: Array< { label: string } >
): string | undefined {
	const optionLabels = new Set( options.map( ( option ) => option.label ) );
	for ( let index = entryIndex + 1; index < entries.length; index += 1 ) {
		const entry = entries[ index ];
		if (
			isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ||
			isStudioCustomEntryOfType( entry, 'studio.turn_closed' )
		) {
			return undefined;
		}
		if ( ! isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			continue;
		}
		const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
		if ( data?.source === 'ask_user' && optionLabels.has( data.text ) ) {
			return data.text;
		}
		if ( data?.source === 'prompt' ) {
			return undefined;
		}
	}
	return undefined;
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

const TOOL_DETAIL_MAX_LENGTH = 96;
const TOOL_DETAILS_ANIMATION_MS = 140;

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

function getWpCliOptionValue( args: string[], option: string ): string | undefined {
	const inlinePrefix = `${ option }=`;
	for ( let index = 0; index < args.length; index += 1 ) {
		const arg = args[ index ];
		if ( arg.startsWith( inlinePrefix ) ) {
			return arg.slice( inlinePrefix.length );
		}
		if ( arg === option ) {
			return args[ index + 1 ];
		}
	}
	return undefined;
}

function getPostTypeName( postType: string | undefined, plural: boolean ): string {
	switch ( postType ) {
		case 'page':
			return plural ? __( 'pages' ) : __( 'page' );
		case 'attachment':
			return plural ? __( 'media items' ) : __( 'media item' );
		case 'product':
			return plural ? __( 'products' ) : __( 'product' );
		case 'post':
		case undefined:
		case '':
			return plural ? __( 'posts' ) : __( 'post' );
		default:
			return postType.replace( /[-_]+/g, ' ' );
	}
}

function getWpCliPostLabel( args: string[] ): string {
	const action = args[ 1 ];
	const postType = getWpCliOptionValue( args, '--post_type' );
	const postStatus = getWpCliOptionValue( args, '--post_status' );
	const singularPostType = getPostTypeName( postType, false );
	const pluralPostType = getPostTypeName( postType, true );

	switch ( action ) {
		case 'list':
			if ( postStatus === 'publish' ) {
				return sprintf(
					/* translators: %s: plural post type, such as posts or pages. */
					__( 'List published %s' ),
					pluralPostType
				);
			}
			return sprintf(
				/* translators: %s: plural post type, such as posts or pages. */
				__( 'List %s' ),
				pluralPostType
			);
		case 'get':
			return sprintf(
				/* translators: %s: post type, such as post or page. */
				__( 'Read %s' ),
				singularPostType
			);
		case 'create':
			return sprintf(
				/* translators: %s: post type, such as post or page. */
				__( 'Create %s' ),
				singularPostType
			);
		case 'update':
			return sprintf(
				/* translators: %s: post type, such as post or page. */
				__( 'Update %s' ),
				singularPostType
			);
		case 'delete':
			return sprintf(
				/* translators: %s: post type, such as post or page. */
				__( 'Delete %s' ),
				singularPostType
			);
		default:
			return __( 'Manage content' );
	}
}

function getWpCliCommandLabel( command: string ): string {
	const args = splitCommandArgs( command );
	const [ entity, action, target ] = args;

	switch ( entity ) {
		case 'theme':
			switch ( action ) {
				case 'list':
					return __( 'List themes' );
				case 'activate':
					return target ? sprintf( __( 'Activate theme %s' ), target ) : __( 'Activate theme' );
				case 'install':
					return target ? sprintf( __( 'Install theme %s' ), target ) : __( 'Install theme' );
				case 'delete':
					return target ? sprintf( __( 'Delete theme %s' ), target ) : __( 'Delete theme' );
				default:
					return __( 'Manage themes' );
			}
		case 'plugin':
			switch ( action ) {
				case 'list':
					return __( 'List plugins' );
				case 'activate':
					return target ? sprintf( __( 'Activate plugin %s' ), target ) : __( 'Activate plugin' );
				case 'deactivate':
					return target
						? sprintf( __( 'Deactivate plugin %s' ), target )
						: __( 'Deactivate plugin' );
				case 'install':
					return target ? sprintf( __( 'Install plugin %s' ), target ) : __( 'Install plugin' );
				case 'delete':
					return target ? sprintf( __( 'Delete plugin %s' ), target ) : __( 'Delete plugin' );
				case 'update':
					return target ? sprintf( __( 'Update plugin %s' ), target ) : __( 'Update plugin' );
				default:
					return __( 'Manage plugins' );
			}
		case 'post':
			return getWpCliPostLabel( args );
		case 'option':
			if ( action === 'get' ) {
				return target === 'blogname' ? __( 'Read site title' ) : __( 'Read site option' );
			}
			if ( action === 'update' ) {
				return target === 'blogname' ? __( 'Update site title' ) : __( 'Update site option' );
			}
			return __( 'Manage site options' );
		case 'user':
			switch ( action ) {
				case 'list':
					return __( 'List users' );
				case 'create':
					return __( 'Create user' );
				case 'update':
					return __( 'Update user' );
				case 'delete':
					return __( 'Delete user' );
				default:
					return __( 'Manage users' );
			}
		case 'media':
			return action === 'import' ? __( 'Import media' ) : __( 'Manage media' );
		case 'menu':
			return action === 'list' ? __( 'List menus' ) : __( 'Manage menus' );
		case 'term':
			return action === 'list' ? __( 'List terms' ) : __( 'Manage terms' );
		case 'cache':
			return action === 'flush' ? __( 'Flush cache' ) : __( 'Manage cache' );
		case 'rewrite':
			return action === 'flush' ? __( 'Flush permalinks' ) : __( 'Manage permalinks' );
		case 'eval':
		case 'eval-file':
			return __( 'Run WordPress code' );
		default:
			return __( 'Run WordPress command' );
	}
}

function getAskUserDetail( input: Record< string, unknown > | undefined ): string {
	const questions = input?.questions;
	if ( ! Array.isArray( questions ) || questions.length === 0 ) {
		return '';
	}
	const firstQuestion = questions[ 0 ];
	if (
		firstQuestion &&
		typeof firstQuestion === 'object' &&
		'question' in firstQuestion &&
		typeof firstQuestion.question === 'string'
	) {
		return truncateToolDetail( firstQuestion.question );
	}
	return '';
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
		if ( ! command ) {
			return '';
		}
		return `wp ${ command }`;
	}

	if ( name === 'Bash' ) {
		const command = getInputString( input, 'command' );
		return command;
	}

	return stringifyToolInput( input );
}

function getClassicToolDisplay(
	name: string,
	input: Record< string, unknown > | undefined
): ClassicToolDisplay {
	const url = getInputString( input, 'url' );
	const host = getInputString( input, 'host' );
	const command = getInputString( input, 'command' );
	const filePath = getInputString( input, 'filePath' );
	const genericDetail = getToolDetail( name, input );

	const display: ClassicToolDisplay = {
		label: getToolDisplayName( name ),
		detail: genericDetail,
		inputText: getClassicToolInputText( name, input ),
	};

	switch ( name ) {
		case 'site_create':
			display.label = __( 'Create site' );
			display.detail = getInputString( input, 'name' );
			break;
		case 'site_list':
			display.label = __( 'List sites' );
			display.detail = '';
			break;
		case 'site_info':
			display.label = __( 'Inspect site' );
			display.detail = '';
			break;
		case 'site_start':
			display.label = __( 'Start site' );
			display.detail = '';
			break;
		case 'site_stop':
			display.label = __( 'Stop site' );
			display.detail = '';
			break;
		case 'site_delete':
			display.label = __( 'Delete site' );
			display.detail = '';
			break;
		case 'site_push':
			display.label = __( 'Push site' );
			display.detail = '';
			break;
		case 'site_pull':
			display.label = __( 'Pull site' );
			display.detail = '';
			break;
		case 'site_import':
			display.label = __( 'Import site' );
			display.detail = '';
			break;
		case 'site_export':
			display.label = __( 'Export site' );
			display.detail = '';
			break;
		case 'site_connected_remote_sites':
			display.label = __( 'List connected remote sites' );
			display.detail = '';
			break;
		case 'preview_create':
			display.label = __( 'Create preview' );
			display.detail = '';
			break;
		case 'preview_list':
			display.label = __( 'List previews' );
			display.detail = '';
			break;
		case 'preview_update':
			display.label = __( 'Update preview' );
			display.detail = host;
			break;
		case 'preview_delete':
			display.label = __( 'Delete preview' );
			display.detail = host;
			break;
		case 'wp_cli':
			display.label = command ? getWpCliCommandLabel( command ) : __( 'Run WordPress command' );
			display.detail = '';
			break;
		case 'open_annotation_browser':
			display.label = __( 'Open annotation browser' );
			display.detail = '';
			break;
		case 'wait_for_annotations':
			display.label = __( 'Wait for annotations' );
			display.detail = '';
			break;
		case 'AskUserQuestion':
			display.label = __( 'Ask user' );
			display.detail = getAskUserDetail( input );
			break;
		case 'take_screenshot':
			display.label = __( 'Capture screenshot' );
			display.detail = '';
			break;
		case 'share_screenshot':
			display.label = __( 'Share screenshot' );
			display.detail = url;
			break;
		case 'validate_html_blocks':
			display.label = __( 'Check block HTML' );
			display.detail = filePath ? shortPath( filePath ) : __( 'inline content' );
			break;
		case 'validate_and_fix_blocks':
			display.label = __( 'Fix block HTML' );
			display.detail = filePath ? shortPath( filePath ) : __( 'inline content' );
			break;
		case 'scaffold_theme':
			display.label = __( 'Create theme' );
			display.detail = getInputString( input, 'name' );
			break;
		case 'install_taxonomy_scripts':
			display.label = __( 'Install taxonomy tools' );
			display.detail = '';
			break;
		case 'need_for_speed':
			display.label = __( 'Audit performance' );
			display.detail = '';
			break;
		case 'rank_me_up':
			display.label = __( 'Audit SEO' );
			display.detail = '';
			break;
		case 'wpcom_request':
			display.label = __( 'Contact WordPress.com' );
			display.detail = genericDetail;
			break;
		case 'Read':
		case 'Write':
		case 'Edit':
			display.detail = genericDetail ? shortPath( genericDetail ) : '';
			break;
		case 'Bash':
			display.label = __( 'Run terminal command' );
			display.detail = '';
			break;
	}

	display.detail = truncateToolDetail( display.detail );
	return display;
}

function getWpCliToolIcon( command: string ): ReactElement {
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

function getToolIcon(
	name: string,
	input: Record< string, unknown > | undefined
): ReactElement | null {
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
		case 'share_screenshot':
			return name === 'take_screenshot' ? capturePhoto : share;
		case 'validate_html_blocks':
			return check;
		case 'validate_and_fix_blocks':
			return tool;
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
			return null;
	}
}

function ToolIcon( { icon }: { icon: ReactElement | null } ) {
	return (
		<Icon icon={ icon ?? tool } size={ 18 } className={ styles.toolIcon } aria-hidden="true" />
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
	const icon = getToolIcon( name, input );
	const [ detailsState, setDetailsState ] = useState< 'closed' | 'opening' | 'open' | 'closing' >(
		'closed'
	);
	const detailsId = useId();
	const resultText = result?.text?.trim() ?? '';
	const hasOutput = resultText.length > 0;
	const hasInput = display.inputText.length > 0;
	const hasExpandableDetails = hasOutput || hasInput;
	const isDetailsRendered = detailsState !== 'closed';
	const isDetailsExpanded = detailsState === 'opening' || detailsState === 'open';

	useEffect( () => {
		if ( detailsState !== 'opening' ) {
			return;
		}
		const frame = requestAnimationFrame( () => setDetailsState( 'open' ) );
		return () => cancelAnimationFrame( frame );
	}, [ detailsState ] );

	useEffect( () => {
		if ( detailsState !== 'closing' ) {
			return;
		}
		const timeout = window.setTimeout(
			() => setDetailsState( 'closed' ),
			TOOL_DETAILS_ANIMATION_MS
		);
		return () => window.clearTimeout( timeout );
	}, [ detailsState ] );

	const rowContent = (
		<>
			<ToolIcon icon={ icon } />
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
					aria-expanded={ isDetailsExpanded }
					aria-controls={ detailsId }
					onClick={ () =>
						setDetailsState( ( state ) =>
							state === 'open' || state === 'opening' ? 'closing' : 'opening'
						)
					}
					title={ isDetailsExpanded ? __( 'Hide tool details' ) : __( 'Show tool details' ) }
				>
					{ rowContent }
				</button>
			) : (
				<div className={ styles.toolRow }>{ rowContent }</div>
			) }
			{ hasExpandableDetails && isDetailsRendered ? (
				<div
					id={ detailsId }
					className={ styles.toolOutputWrap }
					data-state={ detailsState === 'open' ? 'open' : 'closed' }
					aria-hidden={ ! isDetailsExpanded }
					onTransitionEnd={ ( event ) => {
						if ( event.target !== event.currentTarget || detailsState !== 'closing' ) {
							return;
						}
						setDetailsState( 'closed' );
					} }
				>
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
				<ul className={ styles.questionOptions }>
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

	return (
		<div className={ styles.root }>
			{ items.map( ( item ) => {
				switch ( item.kind ) {
					case 'user-turn':
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
