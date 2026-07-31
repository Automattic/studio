import { __, sprintf } from '@wordpress/i18n';

export interface SuggestedPrompt {
	id: string;
	// Short label shown in the list.
	label: string;
	// Fuller prompt dropped into the composer.
	prompt: string;
	// Sampling caps how many prompts of one kind show at once.
	category: 'pages' | 'design' | 'content' | 'structure' | 'features';
	// Optional explanation shown in the tooltip when this idea was promoted
	// by something we know about the site or its recent activity.
	reason?: string;
	audience?: 'block-theme' | 'classic-theme' | 'preview' | 'connected' | 'returning';
}

export interface SuggestedPromptContext {
	theme?: {
		slug: string;
		isBlockTheme: boolean;
		supportsMenus?: boolean;
		supportsWidgets?: boolean;
	};
	previousPrompts?: string[];
	preview?: {
		exists: boolean;
		expired: boolean;
	};
	connection?: {
		count: number;
		hasProduction: boolean;
		hasStaging: boolean;
		daysSinceLastSync?: number;
	};
	// Local sites do not yet persist a creation timestamp. This is the age of
	// the earliest known site chat or connected-site record, not a claim about
	// the WordPress install itself.
	knownActivityAgeDays?: number;
}

export const SUGGESTED_PROMPT_COUNT = 7;
const MAX_PER_CATEGORY = 2;
const RECENT_PROMPT_CONTEXT_LENGTH = 180;

// The warehouse: every predefined starter prompt. A fresh subset rotates in
// each time the empty state mounts (see samplePrompts below).
function getPromptPool( siteName: string ): SuggestedPrompt[] {
	return [
		// Pages
		{
			id: 'about-page',
			category: 'pages',
			label: __( 'Add an About page' ),
			prompt: sprintf(
				/* translators: %s: site name. */
				__( 'Add an About page to %s with a short introduction.' ),
				siteName
			),
		},
		{
			id: 'contact',
			category: 'pages',
			label: __( 'Add a contact form' ),
			prompt: __( 'Add a contact page with a simple contact form.' ),
		},
		{
			id: 'faq',
			category: 'pages',
			label: __( 'Create an FAQ' ),
			prompt: __( 'Create an FAQ page with a few common questions and answers.' ),
		},
		{
			id: 'services',
			category: 'pages',
			label: __( 'List your services' ),
			prompt: __( 'Add a Services page laying out what’s offered, with a section per service.' ),
		},
		{
			id: 'team',
			category: 'pages',
			label: __( 'Introduce the team' ),
			prompt: __( 'Add a Team page with headshots, names, and short bios.' ),
		},
		{
			id: 'custom-404',
			category: 'pages',
			label: __( 'Design a fun 404' ),
			prompt: __( 'Design a custom 404 page with a friendly message and a way back home.' ),
		},

		// Design
		{
			id: 'design-refresh',
			category: 'design',
			label: __( 'Refresh the design' ),
			prompt: __( 'Update the site’s colors and fonts to feel modern and welcoming.' ),
		},
		{
			id: 'homepage',
			category: 'design',
			label: __( 'Design a homepage' ),
			prompt: sprintf(
				/* translators: %s: site name. */
				__( 'Design a homepage that introduces %s with a hero section and highlights.' ),
				siteName
			),
		},
		{
			id: 'dark-mode',
			category: 'design',
			label: __( 'Try a dark look' ),
			prompt: __( 'Give the site a dark color scheme that still feels readable and warm.' ),
		},
		{
			id: 'typography',
			category: 'design',
			label: __( 'Tune the typography' ),
			prompt: __(
				'Improve the typography — pick a strong heading font and comfortable body text.'
			),
		},
		{
			id: 'footer',
			category: 'design',
			label: __( 'Polish the footer' ),
			prompt: __( 'Design a footer with useful links, contact info, and social icons.' ),
		},
		{
			id: 'buttons',
			category: 'design',
			label: __( 'Restyle the buttons' ),
			prompt: __( 'Restyle the buttons and links so calls to action stand out.' ),
		},
		{
			id: 'global-styles',
			category: 'design',
			audience: 'block-theme',
			label: __( 'Refine the global styles' ),
			prompt: __( 'Refine the block theme’s global colors, typography, and spacing.' ),
		},
		{
			id: 'classic-theme-polish',
			category: 'design',
			audience: 'classic-theme',
			label: __( 'Polish the classic theme' ),
			prompt: __( 'Polish the active classic theme while preserving its menus and widgets.' ),
		},

		// Content
		{
			id: 'blog-post',
			category: 'content',
			label: __( 'Write a first post' ),
			prompt: __( 'Write and publish a first blog post introducing this site.' ),
		},
		{
			id: 'tagline',
			category: 'content',
			label: __( 'Sharpen the tagline' ),
			prompt: sprintf(
				/* translators: %s: site name. */
				__( 'Suggest a better tagline for %s and update the site settings with it.' ),
				siteName
			),
		},
		{
			id: 'sample-posts',
			category: 'content',
			label: __( 'Draft sample posts' ),
			prompt: __( 'Draft three sample blog posts so the site feels lived-in.' ),
		},
		{
			id: 'welcome-copy',
			category: 'content',
			label: __( 'Rewrite the welcome copy' ),
			prompt: __( 'Rewrite the homepage copy to be clearer and more inviting.' ),
		},

		// Structure
		{
			id: 'navigation',
			category: 'structure',
			label: __( 'Set up the navigation' ),
			prompt: __( 'Set up the site navigation with links to the main pages.' ),
		},
		{
			id: 'blog-index',
			category: 'structure',
			label: __( 'Organize the blog' ),
			prompt: __( 'Set up a blog index page and organize posts with a few categories.' ),
		},
		{
			id: 'landing',
			category: 'structure',
			label: __( 'Build a landing page' ),
			prompt: __( 'Build a focused landing page with one clear call to action.' ),
		},

		// Features
		{
			id: 'gallery',
			category: 'features',
			label: __( 'Add a photo gallery' ),
			prompt: __( 'Add a gallery page with a responsive photo grid.' ),
		},
		{
			id: 'newsletter',
			category: 'features',
			label: __( 'Add a newsletter signup' ),
			prompt: __( 'Add a newsletter signup form to the homepage and footer.' ),
		},
		{
			id: 'social-links',
			category: 'features',
			label: __( 'Link your socials' ),
			prompt: __( 'Add social media links to the header or footer.' ),
		},
		{
			id: 'testimonials',
			category: 'features',
			label: __( 'Show testimonials' ),
			prompt: __( 'Add a testimonials section with a few placeholder quotes.' ),
		},
		{
			id: 'search',
			category: 'features',
			label: __( 'Make it searchable' ),
			prompt: __( 'Add site search so visitors can find posts and pages.' ),
		},
		{
			id: 'portfolio',
			category: 'features',
			label: __( 'Start a portfolio' ),
			prompt: __( 'Create a portfolio section to showcase projects with images and blurbs.' ),
		},
		{
			id: 'preview-review',
			category: 'features',
			audience: 'preview',
			label: __( 'Review before sharing' ),
			prompt: __(
				'Review the site for unfinished copy, broken links, and layout issues before sharing its preview.'
			),
		},
		{
			id: 'publish-review',
			category: 'features',
			audience: 'connected',
			label: __( 'Prepare to publish' ),
			prompt: __(
				'Review the local site for unfinished content and potential issues before publishing changes to the connected site.'
			),
		},
		{
			id: 'continue-recent-work',
			category: 'features',
			audience: 'returning',
			label: __( 'Build on recent work' ),
			prompt: __( 'Review the recent work on this site and choose a useful next improvement.' ),
		},
	];
}

const CATEGORY_KEYWORDS: Record< SuggestedPrompt[ 'category' ], string[] > = {
	pages: [ 'about', 'contact', 'faq', 'service', 'team', 'page' ],
	design: [
		'button',
		'color',
		'design',
		'font',
		'footer',
		'homepage',
		'style',
		'theme',
		'typography',
	],
	content: [ 'blog', 'copy', 'content', 'post', 'tagline', 'write' ],
	structure: [ 'category', 'landing', 'menu', 'navigation', 'organize', 'structure' ],
	features: [ 'gallery', 'newsletter', 'portfolio', 'search', 'social', 'testimonial' ],
};

function includesKeyword( value: string, keywords: string[] ): boolean {
	const normalized = value.toLocaleLowerCase();
	return keywords.some( ( keyword ) => normalized.includes( keyword.toLocaleLowerCase() ) );
}

function truncateRecentPrompt( prompt: string ): string {
	return prompt.length <= RECENT_PROMPT_CONTEXT_LENGTH
		? prompt
		: `${ prompt.slice( 0, RECENT_PROMPT_CONTEXT_LENGTH - 1 ).trimEnd() }…`;
}

function getRecentCategories( previousPrompts: string[] ): Set< SuggestedPrompt[ 'category' ] > {
	const categories = new Set< SuggestedPrompt[ 'category' ] >();
	for ( const category of Object.keys( CATEGORY_KEYWORDS ) as SuggestedPrompt[ 'category' ][] ) {
		if (
			previousPrompts.some( ( prompt ) => includesKeyword( prompt, CATEGORY_KEYWORDS[ category ] ) )
		) {
			categories.add( category );
		}
	}
	return categories;
}

function isEligible( prompt: SuggestedPrompt, context: SuggestedPromptContext ): boolean {
	switch ( prompt.audience ) {
		case 'block-theme':
			return context.theme?.isBlockTheme === true;
		case 'classic-theme':
			return context.theme?.isBlockTheme === false;
		case 'preview':
			return context.preview?.exists === true;
		case 'connected':
			return ( context.connection?.count ?? 0 ) > 0;
		case 'returning':
			return ( context.previousPrompts?.length ?? 0 ) > 0;
		default:
			return true;
	}
}

function scorePrompt(
	prompt: SuggestedPrompt,
	context: SuggestedPromptContext,
	siteName: string,
	random: () => number
): { prompt: SuggestedPrompt; score: number } {
	let score = random();
	let reason: string | undefined;
	const previousPrompts = context.previousPrompts ?? [];
	const recentCategories = getRecentCategories( previousPrompts );

	if ( prompt.audience === 'block-theme' ) {
		score += 6;
		reason = __( 'Suggested for this block theme' );
	} else if ( prompt.audience === 'classic-theme' ) {
		score += 6;
		reason = __( 'Suggested for this classic theme' );
	} else if ( prompt.audience === 'preview' ) {
		score += context.preview?.expired ? 7 : 5;
		reason = context.preview?.expired
			? __( 'This site’s preview may need attention' )
			: __( 'This site already has a preview to review' );
	} else if ( prompt.audience === 'connected' ) {
		score += ( context.connection?.daysSinceLastSync ?? 0 ) >= 14 ? 7 : 5;
		reason = context.connection?.hasProduction
			? __( 'This site is connected to a live site' )
			: __( 'This site is connected to a staging site' );
	} else if ( prompt.audience === 'returning' ) {
		score += 6;
		reason = __( 'Builds on this site’s recent chats' );
		const recentPrompt = previousPrompts[ 0 ];
		if ( recentPrompt ) {
			prompt = {
				...prompt,
				prompt: sprintf(
					/* translators: 1: site name, 2: opening prompt from a previous chat. */
					__(
						'Review %1$s and choose a useful next improvement that builds on this recent request: “%2$s”'
					),
					siteName,
					truncateRecentPrompt( recentPrompt )
				),
			};
		}
	}

	if (
		context.theme?.isBlockTheme &&
		[ 'typography', 'design-refresh', 'homepage' ].includes( prompt.id )
	) {
		score += 2;
		reason ??= __( 'A good fit for this block theme' );
	}

	if (
		context.theme?.isBlockTheme === false &&
		[ 'navigation', 'footer', 'buttons' ].includes( prompt.id )
	) {
		score += 2;
		reason ??= __( 'A good fit for this classic theme' );
	}

	if ( recentCategories.has( prompt.category ) && prompt.audience !== 'returning' ) {
		score -= 1.5;
	}

	if ( previousPrompts.some( ( previous ) => includesKeyword( previous, [ prompt.label ] ) ) ) {
		score -= 5;
	}

	if ( context.knownActivityAgeDays !== undefined && context.knownActivityAgeDays <= 7 ) {
		if (
			[ 'about-page', 'contact', 'homepage', 'navigation', 'tagline', 'welcome-copy' ].includes(
				prompt.id
			)
		) {
			score += 2.5;
			reason ??= __( 'A useful foundation for a newer project' );
		}
	} else if ( ( context.knownActivityAgeDays ?? 0 ) >= 30 ) {
		if (
			[ 'design-refresh', 'custom-404', 'search', 'newsletter', 'testimonials' ].includes(
				prompt.id
			)
		) {
			score += 2.5;
			reason ??= __( 'A useful next step for an established project' );
		}
	}

	return { prompt: { ...prompt, reason }, score };
}

/**
 * Pure sampler: shuffle the pool (Fisher–Yates on a copy), then take the
 * first N while capping how many of one category get through — a rotating,
 * varied handful instead of the same seven forever. `random` is injectable
 * for tests.
 */
export function samplePrompts(
	pool: SuggestedPrompt[],
	count: number = SUGGESTED_PROMPT_COUNT,
	random: () => number = Math.random
): SuggestedPrompt[] {
	const shuffled = [ ...pool ];
	for ( let i = shuffled.length - 1; i > 0; i-- ) {
		const j = Math.floor( random() * ( i + 1 ) );
		[ shuffled[ i ], shuffled[ j ] ] = [ shuffled[ j ], shuffled[ i ] ];
	}

	const picked: SuggestedPrompt[] = [];
	const perCategory = new Map< SuggestedPrompt[ 'category' ], number >();
	for ( const prompt of shuffled ) {
		const used = perCategory.get( prompt.category ) ?? 0;
		if ( used >= MAX_PER_CATEGORY ) {
			continue;
		}
		perCategory.set( prompt.category, used + 1 );
		picked.push( prompt );
		if ( picked.length >= count ) {
			break;
		}
	}
	return picked;
}

export function rankPrompts(
	pool: SuggestedPrompt[],
	siteName: string,
	context: SuggestedPromptContext,
	count: number = SUGGESTED_PROMPT_COUNT,
	random: () => number = Math.random
): SuggestedPrompt[] {
	const ranked = pool
		.filter( ( prompt ) => isEligible( prompt, context ) )
		.map( ( prompt ) => scorePrompt( prompt, context, siteName, random ) )
		.sort( ( a, b ) => b.score - a.score );
	const picked: SuggestedPrompt[] = [];
	const perCategory = new Map< SuggestedPrompt[ 'category' ], number >();

	for ( const { prompt } of ranked ) {
		const used = perCategory.get( prompt.category ) ?? 0;
		if ( used >= MAX_PER_CATEGORY ) {
			continue;
		}
		perCategory.set( prompt.category, used + 1 );
		picked.push( prompt );
		if ( picked.length >= count ) {
			break;
		}
	}

	return picked;
}

export function getSuggestedPrompts(
	siteName: string,
	context?: SuggestedPromptContext
): SuggestedPrompt[] {
	const pool = getPromptPool( siteName );
	return context ? rankPrompts( pool, siteName, context ) : samplePrompts( pool );
}
