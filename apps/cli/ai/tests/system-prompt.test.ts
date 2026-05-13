import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

describe( 'buildSystemPrompt', () => {
	it( 'includes Studio presentation rules when chat artifacts are enabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '## Visual artifacts' );
		expect( prompt ).toContain( '- post-lists:' );
		expect( prompt ).toContain( 'one post-collection widget' );
		expect( prompt ).toContain( '- site-code-scratchpad:' );
		expect( prompt ).toContain( 'note widget as a scratchpad-style summary' );
		expect( prompt ).toContain( 'Use sd-artefact for standalone rendered HTML drafts' );
		expect( prompt ).toContain( '- saved-local-media:' );
		expect( prompt ).toContain( 'For generated SVGs, write a complete .svg file' );
		expect( prompt ).toContain( 'Do not present generated SVG code as a drawing widget' );
		expect( prompt ).not.toContain( '- drawing:' );
		expect( prompt ).toContain( '- screenshot-local-media:' );
		expect( prompt ).toContain( 'present the actual captured PNG' );
		expect( prompt ).toContain( 'Do not substitute a site-preview widget for a screenshot' );
		expect( prompt ).toContain( 'site-preview is for live previews, not captured screenshots' );
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
