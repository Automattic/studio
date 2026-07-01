import { describe, expect, it } from 'vitest';
import { loadSkills } from '../skills';
import { buildSystemPrompt } from '../system-prompt';

const remoteSite = {
	name: 'Remote Studio Test',
	url: 'https://example.wordpress.com',
	id: 123,
};

function extractReferencedSkillNames( prompt: string ): string[] {
	return [
		...new Set( Array.from( prompt.matchAll( /`([a-z0-9-]+)` skill/g ), ( match ) => match[ 1 ] ) ),
	].sort();
}

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

	it( 'routes plugin-specific feature work to the plugin recommendations skill', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( 'plugin-recommendations' );
		expect( prompt ).toContain( 'any feature that core WordPress blocks do not cleanly provide' );
		expect( prompt ).not.toContain( '## Jetpack Forms' );
		expect( prompt ).not.toContain( 'wp_cli jetpack module activate contact-form' );
	} );

	it( 'routes block markup recipes to the block content skill', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( 'block-content' );
		expect( prompt ).toContain( 'page/post content, template or template-part content' );
		expect( prompt ).not.toContain( '## Block-theme layout cascade' );
		expect( prompt ).not.toContain( 'core/post-content' );
	} );

	it( 'routes remote WordPress.com endpoint recipes to the remote management skill', () => {
		const prompt = buildSystemPrompt( { remoteSite } );

		expect( prompt ).toContain( 'wpcom-remote-management' );
		expect( prompt ).toContain( 'Before doing ANY work, you MUST first check the site' );
		expect( prompt ).not.toContain( '## API Namespace Guide' );
		expect( prompt ).not.toContain( '## Common wp/v2 Endpoints' );
	} );

	it( 'guards plan/pricing/feature answers behind the hosting-plans-helper skill (local)', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '`hosting-plans-helper` skill' );
		expect( prompt ).toContain( 'Do NOT answer from memory' );
		expect( prompt ).toContain( 'Personal or Premium cannot install plugins' );
	} );

	it( 'guards plan/pricing/feature answers behind the hosting-plans-helper skill (remote)', () => {
		const prompt = buildSystemPrompt( { remoteSite } );

		expect( prompt ).toContain( '`hosting-plans-helper` skill' );
		expect( prompt ).toContain( 'Do NOT answer from memory' );
		expect( prompt ).toContain( 'Personal or Premium cannot install plugins' );
	} );

	it( 'references only bundled skills', () => {
		const prompts = [
			buildSystemPrompt( { chatArtifactsEnabled: true } ),
			buildSystemPrompt( { remoteSite } ),
		];
		const availableSkillNames = new Set( loadSkills().map( ( skill ) => skill.name ) );
		const missingSkillNames = prompts
			.flatMap( extractReferencedSkillNames )
			.filter( ( skillName ) => ! availableSkillNames.has( skillName ) );

		expect( missingSkillNames ).toEqual( [] );
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
