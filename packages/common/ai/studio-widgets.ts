import { isRecord } from './chat-artifacts';
import type { StudioChatArtifactWidgetDraft } from './chat-artifacts';

interface StudioWidgetSpec {
	type: string;
	description: string;
	propsDescription: string;
	example: StudioChatArtifactWidgetDraft;
	validateWidgetProps: ( props: Record< string, unknown > ) => boolean;
}

interface StudioPresentationRule {
	id: string;
	description: string;
}

const PAGE_TONES = [ 'neutral', 'orange', 'red', 'violet', 'blue', 'sky', 'green' ] as const;
const NOTE_TONES = [
	'yellow',
	'mint',
	'blue',
	'orange',
	'violet',
	'neon-yellow',
	'neon-green',
	'neon-violet',
	'neon-orange',
	'neon-blue',
] as const;
const NOTE_TEXT_SIZE_STEPS = [ 0, 1, 2, 3 ] as const;
const SCRATCHPAD_SCOPES = [ 'page', 'pattern', 'block' ] as const;
const MEDIA_KINDS = [ 'image', 'video' ] as const;
const POST_COLLECTION_STATUSES = [ 'publish', 'draft', 'any' ] as const;
const POST_COLLECTION_ORDER_BY = [ 'date', 'modified', 'title' ] as const;
const POST_COLLECTION_ORDERS = [ 'asc', 'desc' ] as const;
const STACK_VIEW_MODES = [ 'stack', 'tiles', 'circle' ] as const;
const THEME_TEMPLATE_SOURCES = [ 'theme', 'custom', 'plugin' ] as const;
const THEME_PATTERN_SOURCES = [ 'theme', 'reusable', 'template-part' ] as const;
const COLOR_FORMATS = [ 'hex', 'rgb', 'hsl' ] as const;
const MIN_WIDGET_SHAPE_SIZE = 80;

export const STUDIO_PRESENTATION_RULES: StudioPresentationRule[] = [
	{
		id: 'meaningful-milestones',
		description:
			'Present widgets for meaningful user-visible progress, results, and durable context. Do not present routine inspection, low-level file reads, internal edits, or noisy intermediate steps.',
	},
	{
		id: 'post-lists',
		description:
			'When showing latest, recent, top, feed, archive, query, or other post-list results, use one post-collection widget instead of multiple individual post widgets. Use multiple post widgets only for distinct hand-picked posts that need to be compared side by side.',
	},
	{
		id: 'site-code-scratchpad',
		description:
			'During site creation or redesign work, after any successful Write or Edit that creates or changes HTML, CSS, block markup, JSX/TSX markup, inline styles, theme.json design tokens, frontend JS behavior, or theme/plugin code that shapes markup or styling, call studio_present with exactly one note widget as a scratchpad summary. Include the changed file path or basename, the sections/selectors touched, and the design intent or next checkpoint. Keep it compact and do not paste full files. Skip only trivial mechanical edits, generated lockfiles, or config changes unrelated to HTML, CSS, layout, styling, or frontend behavior. Use scratchpad for standalone rendered HTML drafts, and site-preview after a visible site or page milestone.',
	},
	{
		id: 'saved-local-media',
		description:
			'When an image, video, SVG, logo, icon, illustration, or other visual asset is generated, written to, or discovered on disk, present it as a media widget using a file:// URL and local source metadata. For generated SVGs, write a complete .svg file to a local path first, then present that file. Use a temporary file when the user only wants to see the asset; save under the site or project only when they ask for a durable file. Do not present generated SVG code as a drawing widget.',
	},
	{
		id: 'screenshot-auto-artifact',
		description:
			'take_screenshot captures are shown to the user as inline media in the conversation by default. Do not show every internal verification screenshot: while iterating (design polish loops, intermediate checks), pass `display: false` and let only deliberate milestone captures display. Never call studio_present for a screenshot, and do not substitute a site-preview widget for one; site-preview is for live previews, not captured screenshots.',
	},
];

export const STUDIO_PRESENTABLE_WIDGET_SPECS: StudioWidgetSpec[] = [
	{
		type: 'site-preview',
		description:
			'A live preview of the current local site at a path or URL. Do not use this for captured screenshots; use a media widget for screenshot PNG files.',
		propsDescription: '{ "path": "/" } where path is a relative path like "/about" or a URL.',
		example: { type: 'site-preview', widgetProps: { path: '/' } },
		validateWidgetProps: ( props ) => typeof props.path === 'string',
	},
	{
		type: 'page',
		description: 'A WordPress page card backed by an existing page ID.',
		propsDescription:
			'{ "pageId": 123, "tone": "neutral" } where tone is neutral, orange, red, violet, blue, sky, or green.',
		example: { type: 'page', widgetProps: { pageId: 123, tone: 'neutral' } },
		validateWidgetProps: ( props ) =>
			isNonNegativeInteger( props.pageId ) && isOneOf( props.tone, PAGE_TONES ),
	},
	{
		type: 'post',
		description:
			'A WordPress post card backed by an existing post ID. Use for a specific individual post, not for generic latest/recent post-list requests.',
		propsDescription: '{ "postId": 123 }.',
		example: { type: 'post', widgetProps: { postId: 123 } },
		validateWidgetProps: ( props ) => isNonNegativeInteger( props.postId ),
	},
	{
		type: 'post-collection',
		description:
			'A dynamic collection of recent or filtered WordPress posts. Prefer this for latest, recent, top, feed, archive, or other post-list requests.',
		propsDescription:
			'{ "query": { "postType": "post", "perPage": 5, "status": "publish", "orderby": "date", "order": "desc" }, "viewMode": "stack" } where viewMode is optional and may be stack, tiles, or circle.',
		example: {
			type: 'post-collection',
			widgetProps: {
				query: {
					postType: 'post',
					perPage: 5,
					status: 'publish',
					orderby: 'date',
					order: 'desc',
				},
				viewMode: 'stack',
			},
		},
		validateWidgetProps: isPostCollectionWidgetProps,
	},
	{
		type: 'note',
		description:
			'A sticky note for scratchpad-style plans, compact implementation summaries, decisions, or next steps.',
		propsDescription:
			'{ "text": "Short note text", "tone": "yellow", "textSize": 1 } where textSize is optional 0-3.',
		example: { type: 'note', widgetProps: { text: 'Draft hero options', tone: 'yellow' } },
		validateWidgetProps: ( props ) =>
			typeof props.text === 'string' &&
			isOneOf( props.tone, NOTE_TONES ) &&
			( props.textSize === undefined || isOneOf( props.textSize, NOTE_TEXT_SIZE_STEPS ) ),
	},
	{
		type: 'bookmark',
		description: 'A link card for an external reference or useful URL.',
		propsDescription: '{ "url": "https://example.com" } with an http or https URL.',
		example: { type: 'bookmark', widgetProps: { url: 'https://wordpress.org' } },
		validateWidgetProps: ( props ) => typeof props.url === 'string' && isHttpUrl( props.url ),
	},
	{
		type: 'embed',
		description: 'An embeddable URL preview for supported services.',
		propsDescription: '{ "url": "https://www.youtube.com/watch?v=..." } with an http or https URL.',
		example: { type: 'embed', widgetProps: { url: 'https://wordpress.tv' } },
		validateWidgetProps: ( props ) => typeof props.url === 'string' && isHttpUrl( props.url ),
	},
	{
		type: 'pdf',
		description:
			'A PDF reference card that becomes an embedded PDF preview when resized large enough.',
		propsDescription:
			'{ "url": "https://example.com/file.pdf", "title": "File title", "mediaId": null, "filesize": 2509824 } where filesize is optional.',
		example: {
			type: 'pdf',
			widgetProps: {
				url: 'https://example.com/brief.pdf',
				title: 'Brief',
				mediaId: null,
			},
		},
		validateWidgetProps: ( props ) =>
			typeof props.url === 'string' &&
			isPdfUrl( props.url ) &&
			typeof props.title === 'string' &&
			( props.mediaId === null || isNonNegativeInteger( props.mediaId ) ) &&
			( props.filesize === undefined || isNonNegativeInteger( props.filesize ) ),
	},
	{
		type: 'media',
		description:
			'An image or video card backed by a URL, including saved local image, video, or SVG files.',
		propsDescription:
			'{ "url": "https://example.com/image.jpg", "mediaKind": "image", "alt": "Alt text", "mediaId": 123 } where mediaId may be null. Local files, including SVGs, should use a file:// URL and source { "type": "local", "path": "/tmp/rb-logo.svg", "name": "rb-logo.svg", "mimeType": "image/svg+xml" }.',
		example: {
			type: 'media',
			widgetProps: {
				url: 'file:///tmp/rb-logo.svg',
				mediaKind: 'image',
				alt: 'RB logo SVG',
				mediaId: null,
				source: {
					type: 'local',
					path: '/tmp/rb-logo.svg',
					name: 'rb-logo.svg',
					mimeType: 'image/svg+xml',
				},
			},
		},
		validateWidgetProps: ( props ) =>
			typeof props.url === 'string' &&
			isMediaUrl( props.url ) &&
			isOneOf( props.mediaKind, MEDIA_KINDS ) &&
			typeof props.alt === 'string' &&
			( props.source === undefined || isMediaWidgetSource( props.source ) ) &&
			( props.mediaId === null || isNonNegativeInteger( props.mediaId ) ),
	},
	{
		type: 'scratchpad',
		description: 'A rendered HTML scratchpad for a page, pattern, or block concept.',
		propsDescription:
			'{ "html": "<main>...</main>", "title": "Landing page draft", "scope": "page", "description": "Optional notes" } where scope is page, pattern, or block.',
		example: {
			type: 'scratchpad',
			widgetProps: {
				html: '<main><h1>Draft</h1></main>',
				title: 'Landing page draft',
				scope: 'page',
			},
		},
		validateWidgetProps: ( props ) =>
			typeof props.html === 'string' &&
			typeof props.title === 'string' &&
			isOneOf( props.scope, SCRATCHPAD_SCOPES ) &&
			( props.description === undefined || typeof props.description === 'string' ),
	},
	{
		type: 'theme',
		description:
			'A theme card for the active site theme. It resolves into a theme material stack with templates, styles, template parts, and patterns.',
		propsDescription:
			'{ "viewMode": "stack" } where viewMode is optional and may be stack, tiles, or circle.',
		example: { type: 'theme', widgetProps: { viewMode: 'stack' } },
		validateWidgetProps: ( props ) =>
			props.viewMode === undefined || isOneOf( props.viewMode, STACK_VIEW_MODES ),
	},
	{
		type: 'theme-template',
		description: 'A theme template material card, such as Index, Single, or Page.',
		propsDescription:
			'{ "templateId": "twentytwentyfive//index", "slug": "index", "title": "Index", "description": "", "source": "theme" } where source is theme, custom, or plugin.',
		example: {
			type: 'theme-template',
			widgetProps: {
				templateId: 'twentytwentyfive//index',
				slug: 'index',
				title: 'Index',
				description: '',
				source: 'theme',
			},
		},
		validateWidgetProps: ( props ) =>
			typeof props.templateId === 'string' &&
			typeof props.slug === 'string' &&
			typeof props.title === 'string' &&
			typeof props.description === 'string' &&
			isOneOf( props.source, THEME_TEMPLATE_SOURCES ),
	},
	{
		type: 'theme-styles',
		description:
			'A theme styles material card showing palette and typography from the active theme.',
		propsDescription:
			'{ "palette": [ { "slug": "primary", "name": "Primary", "color": "#3858e9" } ], "fontFamily": "Inter, sans-serif", "textColor": "#111111", "backgroundColor": "#ffffff" }.',
		example: {
			type: 'theme-styles',
			widgetProps: {
				palette: [
					{ slug: 'background', name: 'Background', color: '#ffffff' },
					{ slug: 'foreground', name: 'Foreground', color: '#111111' },
				],
				fontFamily: 'system-ui, sans-serif',
				textColor: '#111111',
				backgroundColor: '#ffffff',
			},
		},
		validateWidgetProps: ( props ) =>
			Array.isArray( props.palette ) &&
			props.palette.every( isThemePaletteEntry ) &&
			typeof props.fontFamily === 'string' &&
			typeof props.textColor === 'string' &&
			typeof props.backgroundColor === 'string',
	},
	{
		type: 'theme-pattern',
		description:
			'A theme pattern, template part, or reusable block material card backed by block markup.',
		propsDescription:
			'{ "patternId": "twentytwentyfive/hero", "title": "Hero", "content": "<!-- wp:cover /-->", "source": "theme" } where source is theme, reusable, or template-part. Optional blockId is a non-negative integer and area is a string.',
		example: {
			type: 'theme-pattern',
			widgetProps: {
				patternId: 'twentytwentyfive/hero',
				title: 'Hero',
				content: '<!-- wp:cover /-->',
				source: 'theme',
			},
		},
		validateWidgetProps: ( props ) =>
			typeof props.patternId === 'string' &&
			typeof props.title === 'string' &&
			typeof props.content === 'string' &&
			isOneOf( props.source, THEME_PATTERN_SOURCES ) &&
			( props.blockId === undefined || isNonNegativeInteger( props.blockId ) ) &&
			( props.area === undefined || typeof props.area === 'string' ),
	},
	{
		type: 'color',
		description:
			'A standalone color swatch with an optional label and a cycleable hex, rgb, or hsl value display.',
		propsDescription:
			'{ "color": "#3858e9", "title": "Primary", "format": "hex" } where color is a six-digit hex color, title is optional, and format may be hex, rgb, or hsl.',
		example: {
			type: 'color',
			widgetProps: { color: '#3858e9', title: 'Primary', format: 'hex' },
		},
		validateWidgetProps: ( props ) =>
			isHexColor( props.color ) &&
			( props.title === undefined || typeof props.title === 'string' ) &&
			( props.format === undefined || isOneOf( props.format, COLOR_FORMATS ) ),
	},
];

export function getStudioPresentableWidgetTypes(): string[] {
	return STUDIO_PRESENTABLE_WIDGET_SPECS.map( ( spec ) => spec.type );
}

export function getStudioPresentationRulesPrompt(): string {
	return STUDIO_PRESENTATION_RULES.map( ( rule ) => `- ${ rule.id }: ${ rule.description }` ).join(
		'\n'
	);
}

export function getStudioWidgetPromptManifest(): string {
	return STUDIO_PRESENTABLE_WIDGET_SPECS.map(
		( spec ) =>
			`- ${ spec.type }: ${ spec.description } Props: ${
				spec.propsDescription
			} Example: ${ JSON.stringify( spec.example ) }`
	).join( '\n' );
}

export function getStudioWidgetDraftValidationError( value: unknown ): string | null {
	if ( ! isRecord( value ) ) {
		return 'Widget must be an object.';
	}

	if ( typeof value.type !== 'string' ) {
		return 'Widget type must be a string.';
	}

	if ( ! isRecord( value.widgetProps ) ) {
		return `Widget "${ value.type }" must include widgetProps as an object.`;
	}

	if ( value.shapeProps !== undefined && ! isShapeProps( value.shapeProps ) ) {
		return `Widget "${ value.type }" shapeProps may only include numeric w and h between ${ MIN_WIDGET_SHAPE_SIZE } and 3000.`;
	}

	const spec = STUDIO_PRESENTABLE_WIDGET_SPECS.find(
		( candidate ) => candidate.type === value.type
	);
	if ( ! spec ) {
		return `Unsupported widget type "${
			value.type
		}". Supported types: ${ getStudioPresentableWidgetTypes().join( ', ' ) }.`;
	}

	if ( ! spec.validateWidgetProps( value.widgetProps ) ) {
		return `Invalid widgetProps for "${ spec.type }". Expected: ${ spec.propsDescription }`;
	}

	return null;
}

function isPostCollectionWidgetProps( props: Record< string, unknown > ): boolean {
	if ( ! isRecord( props.query ) ) {
		return false;
	}

	return (
		props.query.postType === 'post' &&
		isIntegerInRange( props.query.perPage, 1, 20 ) &&
		isOneOf( props.query.status, POST_COLLECTION_STATUSES ) &&
		isOneOf( props.query.orderby, POST_COLLECTION_ORDER_BY ) &&
		isOneOf( props.query.order, POST_COLLECTION_ORDERS ) &&
		( props.viewMode === undefined || isOneOf( props.viewMode, STACK_VIEW_MODES ) )
	);
}

function isNonNegativeInteger( value: unknown ): value is number {
	return isIntegerInRange( value, 0, Number.MAX_SAFE_INTEGER );
}

function isIntegerInRange( value: unknown, min: number, max: number ): value is number {
	return typeof value === 'number' && Number.isInteger( value ) && value >= min && value <= max;
}

function isOneOf< T extends readonly unknown[] >(
	value: unknown,
	values: T
): value is T[ number ] {
	return values.includes( value );
}

function isHttpUrl( value: string ): boolean {
	try {
		const url = new URL( value );
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function isMediaUrl( value: string ): boolean {
	try {
		const url = new URL( value );
		return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
	} catch {
		return false;
	}
}

function isPdfUrl( value: string ): boolean {
	return isMediaUrl( value ) && /\.pdf(\?|$)/i.test( value );
}

function isMediaWidgetSource( value: unknown ): boolean {
	if ( ! isRecord( value ) ) {
		return false;
	}

	if ( value.type === 'site' ) {
		return true;
	}

	return (
		value.type === 'local' &&
		typeof value.path === 'string' &&
		typeof value.name === 'string' &&
		typeof value.mimeType === 'string'
	);
}

function isThemePaletteEntry( value: unknown ): boolean {
	if ( ! isRecord( value ) ) {
		return false;
	}

	return (
		typeof value.slug === 'string' &&
		( value.name === undefined || typeof value.name === 'string' ) &&
		typeof value.color === 'string'
	);
}

function isHexColor( value: unknown ): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test( value );
}

function isShapeProps( value: unknown ): boolean {
	if ( ! isRecord( value ) ) {
		return false;
	}

	const keys = Object.keys( value );
	if ( keys.some( ( key ) => key !== 'w' && key !== 'h' ) ) {
		return false;
	}

	return keys.every(
		( key ) =>
			typeof value[ key ] === 'number' &&
			Number.isFinite( value[ key ] ) &&
			value[ key ] >= MIN_WIDGET_SHAPE_SIZE &&
			value[ key ] <= 3000
	);
}
