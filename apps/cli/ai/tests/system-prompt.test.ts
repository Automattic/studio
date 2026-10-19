import { describe, expect, it } from 'vitest';
import { loadSkills } from '../skills';
import { buildSystemPrompt } from '../system-prompt';
import { resolveStudioToolDefinitions } from '../tools';

function extractReferencedSkillNames( prompt: string ): string[] {
	return [
		...new Set( Array.from( prompt.matchAll( /`([a-z0-9-]+)` skill/g ), ( match ) => match[ 1 ] ) ),
	].sort();
}

const toolsFor = ( options: Parameters< typeof resolveStudioToolDefinitions >[ 0 ] ) =>
	resolveStudioToolDefinitions( options ).map( ( tool ) => ( {
		name: tool.name,
		promptSnippet: tool.promptSnippet,
	} ) );

describe( 'buildSystemPrompt', () => {
	it( 'routes plugin-specific feature work to the plugin recommendations skill', () => {
		const prompt = buildSystemPrompt();

		expect( prompt ).toContain( 'plugin-recommendations' );
		expect( prompt ).toContain( 'any feature that core WordPress blocks do not cleanly provide' );
		expect( prompt ).not.toContain( '## Jetpack Forms' );
		expect( prompt ).not.toContain( 'wp_cli jetpack module activate contact-form' );
	} );

	it( 'routes block markup recipes to the block content skill', () => {
		const prompt = buildSystemPrompt();

		expect( prompt ).toContain( 'block-content' );
		expect( prompt ).toContain( 'page/post content, template or template-part content' );
		expect( prompt ).not.toContain( '## Block-theme layout cascade' );
		expect( prompt ).not.toContain( 'core/post-content' );
	} );

	it( 'routes site builds to the build-site skill in every runtime', () => {
		for ( const prompt of [ buildSystemPrompt( {} ), buildSystemPrompt( { external: true } ) ] ) {
			expect( prompt ).toContain( 'load the `build-site` skill first' );
		}
	} );

	it( 'leaves WordPress.com sites to the remote management skill index entry', () => {
		const remote = loadSkills().find( ( skill ) => skill.name === 'edit-manage-remote-site' );

		expect( remote?.description ).toContain( "the user's live remote sites (WordPress.com" );
		expect( buildSystemPrompt() ).not.toContain( 'edit-manage-remote-site' );
		expect( buildSystemPrompt() ).not.toContain( '## Common wp/v2 Endpoints' );
	} );

	it( 'leaves plan questions to the hosting-plans-helper skill index entry', () => {
		const helper = loadSkills().find( ( skill ) => skill.name === 'hosting-plans-helper' );

		expect( helper?.description ).toContain( 'Load before answering ANY plan' );
		expect( buildSystemPrompt() ).not.toContain( 'hosting-plans-helper' );
	} );

	it( 'references only bundled skills', () => {
		const availableSkillNames = new Set( loadSkills().map( ( skill ) => skill.name ) );
		const missingSkillNames = extractReferencedSkillNames( buildSystemPrompt() ).filter(
			( skillName ) => ! availableSkillNames.has( skillName )
		);

		expect( missingSkillNames ).toEqual( [] );
	} );

	it( 'lists the registered tools that have a snippet', () => {
		const prompt = buildSystemPrompt( {
			tools: [
				{ name: 'wp_cli', promptSnippet: 'Run WP-CLI commands on a running site' },
				{ name: 'hidden' },
			],
		} );
		expect( prompt ).toContain(
			'## Available tools\n\n- wp_cli: Run WP-CLI commands on a running site'
		);
		expect( prompt ).not.toContain( '- hidden' );
	} );

	it( "gives external agents their own intro instead of Studio Code's identity and cadence", () => {
		const prompt = buildSystemPrompt( { external: true } );
		expect( prompt ).toContain( 'Edit site files with your own file tools' );
		expect( prompt ).not.toContain( 'WordPress Studio Code' );
		expect( prompt ).not.toContain( '## Working cadence' );
	} );

	it( 'describes the screenshot and inspect tools for models without vision', () => {
		const withVision = buildSystemPrompt( { tools: toolsFor( { visionEnabled: true } ) } );
		expect( withVision ).toContain( 'Pair with take_screenshot' );
		expect( withVision ).not.toContain( 'You cannot view' );

		const textOnly = buildSystemPrompt( { tools: toolsFor( { visionEnabled: false } ) } );
		expect( textOnly ).toContain( 'it still sets the theme screenshot' );
		expect( textOnly ).not.toContain( 'Pair with take_screenshot' );
	} );

	it( 'appends the user global instructions when set', () => {
		const prompt = buildSystemPrompt( { userInstructions: 'Always answer in French.' } );
		expect( prompt ).toContain( "## User's global instructions" );
		expect( prompt ).toContain( 'Always answer in French.' );
		expect( buildSystemPrompt( {} ) ).not.toContain( "## User's global instructions" );
	} );

	it( 'truncates oversized global instructions with a visible notice', () => {
		const prompt = buildSystemPrompt( { userInstructions: 'a'.repeat( 20_000 ) } );

		expect( prompt ).toContain( 'was truncated here' );
		expect( prompt ).not.toContain( 'a'.repeat( 17_000 ) );
	} );
} );
