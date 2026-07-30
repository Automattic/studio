import { __, sprintf } from '@wordpress/i18n';

export interface SuggestedPrompt {
	id: string;
	// Short label shown in the list.
	label: string;
	// Fuller prompt dropped into the composer.
	prompt: string;
	// Sampling caps how many prompts of one kind show at once.
	category: 'pages' | 'design' | 'content' | 'structure' | 'features';
}

export const SUGGESTED_PROMPT_COUNT = 7;
const MAX_PER_CATEGORY = 2;

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
	];
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

export function getSuggestedPrompts( siteName: string ): SuggestedPrompt[] {
	return samplePrompts( getPromptPool( siteName ) );
}
