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
	it( 'includes Studio presentation rules when chat artifacts are enabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '## Visual artifacts' );
		expect( prompt ).toContain( 'show_site_preview' );
		expect( prompt ).toContain( "Studio's live preview" );
		expect( prompt ).toContain( 'visible local site milestones' );
		expect( prompt ).toContain( 'summaries, or screenshots' );
		expect( prompt ).not.toContain( 'desk widgets' );
		expect( prompt ).not.toContain( 'Available artifact types' );
		expect( prompt ).not.toContain( '- post-lists:' );
		expect( prompt ).not.toContain( '- site-code-scratchpad:' );
		expect( prompt ).not.toContain( '- note:' );
		expect( prompt ).not.toContain( '- media:' );
		expect( prompt ).not.toContain( '- scratchpad:' );
		expect( prompt ).not.toContain( '- theme:' );
		expect( prompt ).not.toContain( '- theme-template:' );
		expect( prompt ).not.toContain( '- theme-styles:' );
		expect( prompt ).not.toContain( '- theme-pattern:' );
		expect( prompt ).not.toContain( '- color:' );
		expect( prompt ).not.toContain( '- pdf:' );
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
		expect( prompt ).not.toContain( 'show_site_preview' );
		expect( prompt ).not.toContain( 'studio_present' );
	} );
} );
