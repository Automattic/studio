import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

describe( 'buildSystemPrompt', () => {
	const previousScratchpadWidgetType = 'sd-' + 'artefact';

	it( 'includes Studio presentation rules when chat artifacts are enabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '## Visual artifacts' );
		expect( prompt ).toContain( '- post-lists:' );
		expect( prompt ).toContain( 'one post-collection widget' );
		expect( prompt ).toContain( '- site-code-scratchpad:' );
		expect( prompt ).toContain( 'after any successful Write or Edit' );
		expect( prompt ).toContain( 'creates or changes HTML, CSS, block markup' );
		expect( prompt ).toContain( 'JSX/TSX markup' );
		expect( prompt ).toContain( 'call studio_present with exactly one note widget' );
		expect( prompt ).toContain( 'sections/selectors touched' );
		expect( prompt ).toContain( 'Use scratchpad for standalone rendered HTML drafts' );
		expect( prompt ).toContain( '- scratchpad:' );
		expect( prompt ).not.toContain( previousScratchpadWidgetType );
		expect( prompt ).toContain( '- saved-local-media:' );
		expect( prompt ).toContain( 'For generated SVGs, write a complete .svg file' );
		expect( prompt ).toContain( 'Do not present generated SVG code as a drawing widget' );
		expect( prompt ).not.toContain( '- drawing:' );
		expect( prompt ).toContain( '- screenshot-local-media:' );
		expect( prompt ).toContain( 'present the actual captured PNG' );
		expect( prompt ).toContain( 'Do not substitute a site-preview widget for a screenshot' );
		expect( prompt ).toContain( 'site-preview is for live previews, not captured screenshots' );
		expect( prompt ).toContain( '- theme:' );
		expect( prompt ).toContain( '- theme-template:' );
		expect( prompt ).toContain( '- theme-styles:' );
		expect( prompt ).toContain( '- theme-pattern:' );
		expect( prompt ).toContain( '- color:' );
		expect( prompt ).toContain( '- pdf:' );
	} );

	it( 'steers newsletter signups to jetpack/subscriptions, not jetpack/contact-form', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '## Newsletter signup' );
		expect( prompt ).toContain( 'jetpack/subscriptions' );
		expect( prompt ).toContain( 'wp_cli jetpack module activate subscriptions' );
		// The contact-form section should warn against using it for newsletters.
		expect( prompt ).toMatch( /contact-form[^]*only stores submissions as Feedback/ );
	} );

	it( 'omits Studio presentation rules when chat artifacts are disabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).not.toContain( '## Visual artifacts' );
		expect( prompt ).not.toContain( '- site-code-scratchpad:' );
		expect( prompt ).not.toContain( '- saved-local-media:' );
		expect( prompt ).not.toContain( '- screenshot-local-media:' );
		expect( prompt ).not.toContain( 'studio_present' );
	} );
} );
