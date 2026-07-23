import { __, _n, sprintf } from '@wordpress/i18n';

export function getInputString(
	input: Record< string, unknown > | undefined,
	key: string
): string {
	const value = input?.[ key ];
	return typeof value === 'string' ? value.trim() : '';
}

export function splitCommandArgs( command: string ): string[] {
	return (
		command
			.match( /(?:[^\s"']+|"[^"]*"|'[^']*')+/g )
			?.map( ( arg ) => arg.replace( /^(['"])(.*)\1$/, '$2' ) )
			.filter( Boolean ) ?? []
	);
}

const WP_CLI_LARGE_PAYLOAD_OPTIONS = [ '--post_content', '--post_excerpt', '--meta_input' ];

function trimWpCliCommandForLabel( command: string ): string {
	const payloadOptionIndex = WP_CLI_LARGE_PAYLOAD_OPTIONS.map( ( option ) =>
		[ `${ option }=`, `${ option } ` ]
			.map( ( optionPattern ) => command.indexOf( optionPattern ) )
			.filter( ( index ) => index >= 0 )
	)
		.flat()
		.sort( ( a, b ) => a - b )[ 0 ];

	return payloadOptionIndex === undefined
		? command
		: command.slice( 0, payloadOptionIndex ).trimEnd();
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

const WP_CLI_TARGET_LABEL_OVERRIDES: Record< string, string > = {
	woocommerce: 'WooCommerce',
};

const WP_CLI_TARGET_WORD_OVERRIDES: Record< string, string > = {
	php: 'PHP',
	seo: 'SEO',
	ssl: 'SSL',
	wp: 'WP',
};

function titleCaseWpCliSlug( value: string ): string {
	return value
		.replace( /[-_]+/g, ' ' )
		.split( ' ' )
		.map( ( word ) => {
			const override = WP_CLI_TARGET_WORD_OVERRIDES[ word.toLowerCase() ];
			return override ?? word.charAt( 0 ).toUpperCase() + word.slice( 1 ).toLowerCase();
		} )
		.join( ' ' );
}

function getWpCliTargetLabel( target: string | undefined ): string | undefined {
	if ( ! target || target.startsWith( '-' ) ) {
		return undefined;
	}

	const normalizedTarget = target.toLowerCase();
	if ( WP_CLI_TARGET_LABEL_OVERRIDES[ normalizedTarget ] ) {
		return WP_CLI_TARGET_LABEL_OVERRIDES[ normalizedTarget ];
	}

	if ( /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test( target ) ) {
		return titleCaseWpCliSlug( target );
	}

	return target;
}

function formatWpCliTargetActionLabel( label: string, target: string | undefined ): string {
	const targetLabel = getWpCliTargetLabel( target );
	if ( ! targetLabel ) {
		return label;
	}

	return sprintf(
		/* translators: 1: WP-CLI action label, 2: plugin or theme name. */
		__( '%1$s: %2$s' ),
		label,
		targetLabel
	);
}

const WP_CLI_OPTIONS_WITH_VALUES = new Set( [
	'--context',
	'--exec',
	'--locale',
	'--path',
	'--prompt',
	'--require',
	'--skip-plugins',
	'--skip-themes',
	'--ssh',
	'--url',
	'--user',
	'--version',
] );

function getWpCliCommandTarget( args: string[] ): string | undefined {
	for ( let index = 2; index < args.length; index += 1 ) {
		const arg = args[ index ];
		if ( ! arg.startsWith( '-' ) ) {
			return arg;
		}

		if ( WP_CLI_OPTIONS_WITH_VALUES.has( arg ) ) {
			index += 1;
		}
	}
	return undefined;
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
	const args = splitCommandArgs( trimWpCliCommandForLabel( command ) );
	const [ entity, action ] = args;
	const target = getWpCliCommandTarget( args );

	switch ( entity ) {
		case 'theme':
			switch ( action ) {
				case 'list':
					return __( 'List themes' );
				case 'activate':
					return formatWpCliTargetActionLabel( __( 'Activate theme' ), target );
				case 'install':
					return formatWpCliTargetActionLabel( __( 'Install theme' ), target );
				case 'delete':
					return formatWpCliTargetActionLabel( __( 'Delete theme' ), target );
				default:
					return __( 'Manage themes' );
			}
		case 'plugin':
			switch ( action ) {
				case 'list':
					return __( 'List plugins' );
				case 'activate':
					if ( args.includes( '--all' ) ) {
						return __( 'Activate all plugins' );
					}
					return formatWpCliTargetActionLabel( __( 'Activate plugin' ), target );
				case 'deactivate':
					if ( args.includes( '--all' ) ) {
						return __( 'Deactivate all plugins' );
					}
					return formatWpCliTargetActionLabel( __( 'Deactivate plugin' ), target );
				case 'install':
					return formatWpCliTargetActionLabel( __( 'Install plugin' ), target );
				case 'delete':
					return formatWpCliTargetActionLabel( __( 'Delete plugin' ), target );
				case 'update':
					if ( args.includes( '--all' ) ) {
						return __( 'Update all plugins' );
					}
					return formatWpCliTargetActionLabel( __( 'Update plugin' ), target );
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

/**
 * Human-facing display name for a tool, localized.
 * Falls back to the raw tool name (e.g. an unknown tool) so the UI/CLI
 * always has something to show.
 */
export function getToolDisplayName( name: string, input?: Record< string, unknown > ): string {
	if ( name === 'wp_cli' ) {
		const command = getInputString( input, 'command' );
		return command ? getWpCliCommandLabel( command ) : __( 'Run WordPress command' );
	}

	const displayNames: Record< string, string > = {
		site_create: __( 'Create site' ),
		site_list: __( 'List sites' ),
		site_info: __( 'Get site info' ),
		site_start: __( 'Start site' ),
		site_stop: __( 'Stop site' ),
		site_delete: __( 'Delete site' ),
		site_push: __( 'Push site' ),
		site_pull: __( 'Pull site' ),
		site_import: __( 'Import site' ),
		site_export: __( 'Export site' ),
		preview_create: __( 'Create preview' ),
		preview_list: __( 'List previews' ),
		preview_update: __( 'Update preview' ),
		preview_delete: __( 'Delete preview' ),
		refresh_browser: __( 'Refresh preview' ),
		site_connected_remote_sites: __( 'List connected remote sites' ),
		scaffold_theme: __( 'Scaffold theme' ),
		inspect_design: __( 'Inspect design' ),
		validate_blocks: __( 'Validate blocks' ),
		take_screenshot: __( 'Take screenshot' ),
		share_screenshot: __( 'Share screenshot' ),
		generate_image: __( 'Generate image' ),
		open_annotation_browser: __( 'Open annotation browser' ),
		wait_for_annotations: __( 'Wait for annotations' ),
		need_for_speed: __( 'Audit performance' ),
		rank_me_up: __( 'Audit SEO' ),
		install_taxonomy_scripts: __( 'Install taxonomy scripts' ),
		data_liberation: __( 'Data Liberation' ),
		wpcom_request: __( 'WordPress.com API' ),
		AskUserQuestion: __( 'Ask user' ),
		Read: __( 'Read' ),
		Write: __( 'Write' ),
		Edit: __( 'Edit' ),
		Bash: __( 'Run' ),
		Glob: __( 'Search' ),
		Grep: __( 'Search' ),
		Ls: __( 'List' ),
		Skill: __( 'Load skill' ),
		Task: __( 'Run task' ),
		TodoWrite: __( 'Update todo list' ),
	};
	return displayNames[ name ] ?? name;
}

const BASH_DETAIL_MAX_LENGTH = 60;
const DATA_LIBERATION_DETAIL_MAX_LENGTH = 80;

// The `data_liberation` tool forwards a single call to the Data Liberation
// engine's MCP server. Surface WHICH engine operation ran (`input.tool`, or
// `setup` when omitted) plus its arguments, so the tool-call line reads e.g.
// `Data Liberation liberate_detect {"url":"https://…"}` instead of a bare name.
// `args` is normally an object but the model sometimes sends stringified JSON,
// so accept both for display.
function getDataLiberationDetail( input: Record< string, unknown > ): string {
	const tool = typeof input.tool === 'string' && input.tool ? input.tool : 'setup';

	let argsObj: Record< string, unknown > | undefined;
	const rawArgs = input.args;
	if ( rawArgs && typeof rawArgs === 'object' && ! Array.isArray( rawArgs ) ) {
		argsObj = rawArgs as Record< string, unknown >;
	} else if ( typeof rawArgs === 'string' && rawArgs.trim() ) {
		try {
			const parsed: unknown = JSON.parse( rawArgs );
			if ( parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ) {
				argsObj = parsed as Record< string, unknown >;
			}
		} catch {
			// Not JSON — fall through and show just the operation name.
		}
	}

	if ( ! argsObj || Object.keys( argsObj ).length === 0 ) {
		return tool;
	}

	const detail = `${ tool } ${ JSON.stringify( argsObj ) }`;
	return detail.length > DATA_LIBERATION_DETAIL_MAX_LENGTH
		? detail.slice( 0, DATA_LIBERATION_DETAIL_MAX_LENGTH - 1 ) + '…'
		: detail;
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
		return firstQuestion.question;
	}
	return '';
}

/**
 * Short detail string extracted from a tool's input, suitable for display
 * next to the tool name (e.g. a filename for Read/Write/Edit, a pattern for
 * Grep/Glob, a truncated command for Bash). Returns `''` when no useful
 * detail can be derived.
 */
export function getToolDetail( name: string, input?: Record< string, unknown > ): string {
	if ( ! input ) {
		return '';
	}
	switch ( name ) {
		case 'site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'site_info':
		case 'site_start':
		case 'site_stop':
		case 'site_delete':
		case 'site_push':
		case 'site_pull':
		case 'site_import':
		case 'site_export':
		case 'preview_create':
		case 'preview_list':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'preview_update':
		case 'preview_delete':
			return typeof input.host === 'string' ? input.host : '';
		case 'AskUserQuestion':
			return getAskUserDetail( input );
		case 'wpcom_request': {
			const method = typeof input.method === 'string' ? input.method : '';
			const path = typeof input.path === 'string' ? input.path : '';
			return [ method, path ].filter( Boolean ).join( ' ' );
		}
		case 'data_liberation':
			return getDataLiberationDetail( input );
		case 'wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'scaffold_theme':
			return typeof input.name === 'string' ? input.name : '';
		case 'inspect_design':
			return typeof input.url === 'string' ? input.url : '';
		case 'validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return __( 'inline content' );
		case 'take_screenshot':
		case 'share_screenshot':
		case 'open_annotation_browser':
			return typeof input.url === 'string' ? input.url : '';
		case 'generate_image': {
			if ( typeof input.prompt !== 'string' ) {
				return '';
			}
			return input.prompt.length > BASH_DETAIL_MAX_LENGTH
				? input.prompt.slice( 0, BASH_DETAIL_MAX_LENGTH - 3 ) + '…'
				: input.prompt;
		}
		case 'Read':
		case 'Write':
		case 'Edit': {
			const filePath = input.file_path ?? input.path;
			if ( typeof filePath === 'string' ) {
				return filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return '';
		}
		case 'Bash':
			if ( typeof input.command !== 'string' ) {
				return '';
			}
			return input.command.length > BASH_DETAIL_MAX_LENGTH
				? input.command.slice( 0, BASH_DETAIL_MAX_LENGTH - 3 ) + '…'
				: input.command;
		case 'Skill':
			if ( typeof input.name === 'string' ) {
				return input.name;
			}
			return typeof input.skill === 'string' ? input.skill : '';
		case 'Grep':
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		case 'Ls':
			return typeof input.path === 'string' ? input.path.split( '/' ).slice( -2 ).join( '/' ) : '';
		default:
			return '';
	}
}

export interface NormalizedToolResult {
	text: string;
	isError: boolean;
	diff?: string;
}

export function getToolResultDiff( details: unknown ): string | undefined {
	if ( ! details || typeof details !== 'object' ) {
		return undefined;
	}
	const diff = ( details as { diff?: unknown } ).diff;
	return typeof diff === 'string' && diff.length > 0 ? diff : undefined;
}

export interface ToolResultPreview {
	summaryLines: string[];
	detailText?: string;
	detailLabel?: string;
	detailMaxLength?: number;
}

function countLines( text: string ): number {
	if ( text.length === 0 ) {
		return 0;
	}
	const normalized = text.endsWith( '\n' ) ? text.slice( 0, -1 ) : text;
	return normalized.split( '\n' ).length;
}

function firstNonEmptyLine( text: string ): string {
	return (
		text
			.split( '\n' )
			.map( ( line ) => line.trim() )
			.find( Boolean ) ?? ''
	);
}

function parseJson( text: string ): unknown {
	try {
		return JSON.parse( text );
	} catch {
		return null;
	}
}

function getSkillPreview( text: string ): ToolResultPreview | null {
	const title = text.match( /^#\s+(.+)$/m )?.[ 1 ]?.trim();
	if ( ! title ) {
		return null;
	}

	const sections = Array.from( text.matchAll( /^##\s+(.+)$/gm ) )
		.map( ( match ) => match[ 1 ].trim() )
		.filter( Boolean );
	const visibleSections = sections.slice( 0, 4 );
	const sectionSuffix = sections.length > visibleSections.length ? ', ...' : '';
	const summaryLines: string[] = [ sprintf( __( 'Loaded %s' ), title ) ];

	if ( visibleSections.length > 0 ) {
		summaryLines.push(
			sprintf( __( 'Sections: %s' ), visibleSections.join( ', ' ) + sectionSuffix )
		);
	}

	return {
		summaryLines,
		detailText: text,
		detailLabel: __( 'Full skill body hidden · ctrl+o to expand' ),
		detailMaxLength: 12000,
	};
}

function getDisplayValue( value: unknown ): string {
	if ( typeof value === 'string' ) {
		return value;
	}
	if ( typeof value === 'number' ) {
		return String( value );
	}
	if ( value && typeof value === 'object' && 'rendered' in value ) {
		const rendered = ( value as { rendered?: unknown } ).rendered;
		return typeof rendered === 'string' ? stripHtmlTags( rendered ) : '';
	}
	return '';
}

function stripHtmlTags( input: string ): string {
	let previous: string;
	let result = input;
	do {
		previous = result;
		result = result.replace( /<[^>]*>/g, '' );
	} while ( result !== previous );
	return result;
}

function getResourceName( value: unknown ): string {
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) {
		return '';
	}
	const record = value as Record< string, unknown >;
	return (
		getDisplayValue( record.title ) ||
		getDisplayValue( record.name ) ||
		getDisplayValue( record.slug ) ||
		getDisplayValue( record.ID ) ||
		getDisplayValue( record.id )
	);
}

function getArraySummary( items: unknown[], noun: string ): string {
	return sprintf(
		/* translators: 1: number of items, 2: item type */
		_n( 'Returned %1$d %2$s', 'Returned %1$d %2$s', items.length ),
		items.length,
		noun
	);
}

function getWpcomResultPreview(
	input: Record< string, unknown > | undefined,
	text: string,
	isError: boolean
): ToolResultPreview {
	if ( isError ) {
		return {
			summaryLines: [ firstNonEmptyLine( text ) || __( 'Request failed' ) ],
			detailText: text,
			detailLabel: __( 'Full API error hidden · ctrl+o to expand' ),
		};
	}

	const parsed = parseJson( text );
	const method = typeof input?.method === 'string' ? input.method : '';
	const path = typeof input?.path === 'string' ? input.path : '';
	const target = [ method, path ].filter( Boolean ).join( ' ' );

	if ( Array.isArray( parsed ) ) {
		const summary = getArraySummary( parsed, __( 'items' ) );
		return {
			summaryLines: [ target ? sprintf( __( '%1$s: %2$s' ), target, summary ) : summary ],
			detailText: text,
			detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
		};
	}

	if ( parsed && typeof parsed === 'object' ) {
		const record = parsed as Record< string, unknown >;
		const arrayEntry = Object.entries( record ).find( ( [ , value ] ) => Array.isArray( value ) );
		const found = typeof record.found === 'number' ? record.found : null;
		const resourceName = getResourceName( record );

		if ( arrayEntry ) {
			const [ key, value ] = arrayEntry as [ string, unknown[] ];
			const count = found ?? value.length;
			const summary = sprintf(
				/* translators: 1: number of resources, 2: resource key */
				_n( 'Returned %1$d %2$s', 'Returned %1$d %2$s', count ),
				count,
				key
			);
			return {
				summaryLines: [ target ? sprintf( __( '%1$s: %2$s' ), target, summary ) : summary ],
				detailText: text,
				detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
			};
		}

		if ( resourceName ) {
			return {
				summaryLines: [
					target
						? sprintf( __( '%1$s: returned %2$s' ), target, resourceName )
						: sprintf( __( 'Returned %s' ), resourceName ),
				],
				detailText: text,
				detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
			};
		}

		const keys = Object.keys( record ).slice( 0, 4 );
		return {
			summaryLines: [
				target ? sprintf( __( '%1$s: returned response' ), target ) : __( 'Returned response' ),
				keys.length > 0 ? sprintf( __( 'Fields: %s' ), keys.join( ', ' ) ) : '',
			].filter( Boolean ),
			detailText: text,
			detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
		};
	}

	return {
		summaryLines: [ firstNonEmptyLine( text ) || __( 'Request completed' ) ],
		detailText: text,
		detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
	};
}

function getFileToolPreview( name: string, text: string, isError: boolean ): ToolResultPreview {
	if ( isError ) {
		return {
			summaryLines: [ firstNonEmptyLine( text ) || __( 'File operation failed' ) ],
			detailText: text,
			detailLabel: __( 'Full file error hidden · ctrl+o to expand' ),
		};
	}

	if ( name === 'Read' ) {
		const lines = countLines( text );
		return {
			summaryLines: [ sprintf( _n( 'Read %d line', 'Read %d lines', lines ), lines ) ],
			detailText: text,
			detailLabel: __( 'File contents hidden · ctrl+o to expand' ),
		};
	}

	return {
		summaryLines: [ name === 'Write' ? __( 'File written' ) : __( 'File edited' ) ],
		detailText: text,
		detailLabel: __( 'Full tool output hidden · ctrl+o to expand' ),
	};
}

function getBashPreview( text: string, isError: boolean ): ToolResultPreview {
	const firstLine = firstNonEmptyLine( text );
	return {
		summaryLines: [
			isError
				? firstLine || __( 'Command failed' )
				: firstLine
				? sprintf( __( 'Command completed: %s' ), firstLine )
				: __( 'Command completed' ),
		],
		detailText: text,
		detailLabel: isError
			? __( 'Full command output hidden · ctrl+o to expand' )
			: __( 'Command output hidden · ctrl+o to expand' ),
	};
}

function getSiteCreatePreview( text: string, isError: boolean ): ToolResultPreview | null {
	if ( isError ) {
		return {
			summaryLines: [ firstNonEmptyLine( text ) || __( 'Site creation failed' ) ],
			detailText: text,
			detailLabel: __( 'Full site error hidden · ctrl+o to expand' ),
		};
	}

	const parsed = parseJson( text );
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		return null;
	}

	const record = parsed as Record< string, unknown >;
	const name = getDisplayValue( record.name );
	const url = getDisplayValue( record.url );
	const summaryLines = [
		name ? sprintf( __( 'Created site %s' ), name ) : __( 'Created site' ),
		url,
	].filter( Boolean );

	return {
		summaryLines,
		detailText: text,
		detailLabel: __( 'Full site details hidden · ctrl+o to expand' ),
	};
}

export function getToolResultPreview(
	name: string | undefined,
	input: Record< string, unknown > | undefined,
	text: string,
	isError = false
): ToolResultPreview | null {
	if ( ! name || ! text ) {
		return null;
	}

	switch ( name ) {
		case 'site_create':
			return getSiteCreatePreview( text, isError );
		case 'Skill':
			return getSkillPreview( text );
		case 'wpcom_request':
			return getWpcomResultPreview( input, text, isError );
		case 'wp_cli':
			return getWpCliResultPreview( input, text, isError );
		case 'Read':
		case 'Write':
		case 'Edit':
			return getFileToolPreview( name, text, isError );
		case 'Bash':
			return getBashPreview( text, isError );
		default:
			return null;
	}
}

function getWpCliResultPreview(
	input: Record< string, unknown > | undefined,
	text: string,
	isError: boolean
): ToolResultPreview {
	const command = getInputString( input, 'command' );
	const firstLine = firstNonEmptyLine( text );
	if ( isError ) {
		return {
			summaryLines: [ firstLine || __( 'WP-CLI command failed' ) ],
			detailText: text,
			detailLabel: __( 'Full command output hidden · click to expand' ),
		};
	}
	const summary = firstLine || __( 'Command completed' );
	return {
		summaryLines: [
			command
				? sprintf( __( '%1$s: %2$s' ), getToolDisplayName( 'wp_cli', input ), summary )
				: summary,
		],
		detailText: text,
		detailLabel: __( 'Full command output hidden · click to expand' ),
	};
}

export function getWritePseudoDiff(
	input: Record< string, unknown > | undefined
): string | undefined {
	const content = input?.content;
	if ( typeof content !== 'string' || content.length === 0 ) {
		return undefined;
	}
	return content
		.split( '\n' )
		.map( ( line ) => `+${ line }` )
		.join( '\n' );
}

export interface DiffLineStats {
	additions: number;
	deletions: number;
}

export function countDiffLineStats( diff: string | undefined ): DiffLineStats {
	if ( ! diff ) {
		return { additions: 0, deletions: 0 };
	}
	let additions = 0;
	let deletions = 0;
	for ( const line of diff.split( '\n' ) ) {
		if ( line.startsWith( '+' ) && ! line.startsWith( '+++' ) ) {
			additions += 1;
		} else if ( line.startsWith( '-' ) && ! line.startsWith( '---' ) ) {
			deletions += 1;
		}
	}
	return { additions, deletions };
}

type ToolCategory =
	| 'file_edit'
	| 'file_read'
	| 'search'
	| 'wp_cli'
	| 'shell'
	| 'checkpoint'
	| 'skill'
	| 'site'
	| 'other';

export function getToolCategory( name: string ): ToolCategory {
	switch ( name ) {
		case 'Edit':
		case 'Write':
			return 'file_edit';
		case 'Read':
			return 'file_read';
		case 'Grep':
		case 'Glob':
		case 'Ls':
			return 'search';
		case 'wp_cli':
			return 'wp_cli';
		case 'Bash':
			return 'shell';
		case 'checkpoint_create':
		case 'checkpoint_restore':
		case 'checkpoint_diff':
		case 'checkpoint_list':
			return 'checkpoint';
		case 'Skill':
			return 'skill';
		case 'site_create':
		case 'site_list':
		case 'site_info':
		case 'site_start':
		case 'site_stop':
		case 'site_delete':
		case 'site_push':
		case 'site_pull':
			return 'site';
		default:
			return 'other';
	}
}

export interface ToolGroupToolInput {
	name: string;
	input?: Record< string, unknown >;
	result?: NormalizedToolResult;
}

export interface ToolGroupSummary {
	label: string;
	additions: number;
	deletions: number;
}

function getToolDiffForStats( tool: ToolGroupToolInput ): string | undefined {
	if ( tool.result?.diff ) {
		return tool.result.diff;
	}
	if ( tool.name === 'Write' ) {
		return getWritePseudoDiff( tool.input );
	}
	return undefined;
}

export function buildToolGroupSummary( tools: ToolGroupToolInput[] ): ToolGroupSummary {
	const counts: Record< ToolCategory, number > = {
		file_edit: 0,
		file_read: 0,
		search: 0,
		wp_cli: 0,
		shell: 0,
		checkpoint: 0,
		skill: 0,
		site: 0,
		other: 0,
	};
	let additions = 0;
	let deletions = 0;

	for ( const tool of tools ) {
		counts[ getToolCategory( tool.name ) ] += 1;
		const diffStats = countDiffLineStats( getToolDiffForStats( tool ) );
		additions += diffStats.additions;
		deletions += diffStats.deletions;
	}

	const fragments: string[] = [];
	if ( counts.skill > 0 ) {
		fragments.push(
			sprintf( _n( 'Loaded %d skill', 'Loaded %d skills', counts.skill ), counts.skill )
		);
	}
	if ( counts.site > 0 ) {
		fragments.push(
			sprintf( _n( 'Used %d site tool', 'Used %d site tools', counts.site ), counts.site )
		);
	}
	if ( counts.file_edit > 0 ) {
		fragments.push(
			sprintf( _n( 'Edited %d file', 'Edited %d files', counts.file_edit ), counts.file_edit )
		);
	}
	if ( counts.file_read > 0 ) {
		fragments.push(
			sprintf( _n( 'Read %d file', 'Read %d files', counts.file_read ), counts.file_read )
		);
	}
	if ( counts.search > 0 ) {
		fragments.push(
			sprintf( _n( 'Explored %d path', 'Explored %d paths', counts.search ), counts.search )
		);
	}
	if ( counts.wp_cli > 0 ) {
		fragments.push(
			sprintf(
				_n( 'Ran %d WP-CLI command', 'Ran %d WP-CLI commands', counts.wp_cli ),
				counts.wp_cli
			)
		);
	}
	if ( counts.shell > 0 ) {
		fragments.push(
			sprintf( _n( 'Ran %d command', 'Ran %d commands', counts.shell ), counts.shell )
		);
	}
	if ( counts.checkpoint > 0 ) {
		fragments.push(
			sprintf(
				_n( 'Checked %d checkpoint', 'Checked %d checkpoints', counts.checkpoint ),
				counts.checkpoint
			)
		);
	}
	if ( counts.other > 0 ) {
		fragments.push( sprintf( _n( 'Used %d tool', 'Used %d tools', counts.other ), counts.other ) );
	}

	return {
		label:
			fragments.join( ' · ' ) ||
			sprintf( _n( 'Used %d tool', 'Used %d tools', tools.length ), tools.length ),
		additions,
		deletions,
	};
}

export function formatThinkingDurationLabel( durationMs?: number ): string {
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

/** Summary for a work phase: tool categories when present, else thinking duration. */
export function buildWorkPhaseSummary(
	tools: ToolGroupToolInput[],
	thinkingDurationMs?: number,
	options?: { artifactCount?: number }
): ToolGroupSummary {
	if ( tools.length > 0 ) {
		return buildToolGroupSummary( tools );
	}
	if ( thinkingDurationMs && thinkingDurationMs > 0 ) {
		return {
			label: formatThinkingDurationLabel( thinkingDurationMs ),
			additions: 0,
			deletions: 0,
		};
	}
	const artifactCount = options?.artifactCount ?? 0;
	if ( artifactCount > 0 ) {
		return {
			label: sprintf(
				_n( 'Captured %d artifact', 'Captured %d artifacts', artifactCount ),
				artifactCount
			),
			additions: 0,
			deletions: 0,
		};
	}
	return {
		label: formatThinkingDurationLabel( thinkingDurationMs ),
		additions: 0,
		deletions: 0,
	};
}
