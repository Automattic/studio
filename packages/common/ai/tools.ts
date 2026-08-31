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
		generate_images: __( 'Generate images' ),
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

// `AskUserQuestion` tells the model the system appends a free-form option, so
// a well-behaved model never writes one itself. Both GUIs append it here.
export function getFreeFormOptionLabel(): string {
	return __( 'Something else' );
}

export function getFreeFormOptionDescription(): string {
	return __( 'Reply in your own words instead of picking an option.' );
}

// Off-contract models do write their own escape hatch. Match the English
// labels they actually use — comparing against the translated label above
// would never match outside an English locale.
const MODEL_FREE_FORM_LABELS = new Set( [ 'other', 'something else', 'none of the above' ] );

export function hasOwnFreeFormOption( options: Array< { label: string } > ): boolean {
	return options.some( ( option ) =>
		MODEL_FREE_FORM_LABELS.has( option.label.trim().toLowerCase() )
	);
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
		case 'generate_images': {
			const count = Array.isArray( input.images ) ? input.images.length : 0;
			return count > 0 ? sprintf( _n( '%d image', '%d images', count ), count ) : '';
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
