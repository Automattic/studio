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
		promptGuidelines: tool.promptGuidelines,
	} ) );

describe( 'buildSystemPrompt', () => {
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

	it( 'routes WordPress.com sites to the remote management skill', () => {
		const prompt = buildSystemPrompt( {} );

		expect( prompt ).toContain( 'load the `wpcom-remote-management` skill first' );
		expect( prompt ).not.toContain( '## Common wp/v2 Endpoints' );
	} );

	it( 'guards plan/pricing/feature answers behind the hosting-plans-helper skill', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).toContain( '`hosting-plans-helper` skill' );
		expect( prompt ).toContain( 'Do NOT answer from memory' );
		expect( prompt ).toContain( 'Personal or Premium cannot install plugins' );
	} );

	it( 'references only bundled skills', () => {
		const availableSkillNames = new Set( loadSkills().map( ( skill ) => skill.name ) );
		const missingSkillNames = extractReferencedSkillNames(
			buildSystemPrompt( { chatArtifactsEnabled: true } )
		).filter( ( skillName ) => ! availableSkillNames.has( skillName ) );

		expect( missingSkillNames ).toEqual( [] );
	} );

	it( 'lets sites use a scratch file for post_content', () => {
		const prompt = buildSystemPrompt( {} );

		expect( prompt ).toContain( 'write the validated markup to a scratch file' );
		expect( prompt ).toContain( 'wp post create <file>' );
		expect( prompt ).not.toContain( 'virtual temp file' );
		expect( prompt ).not.toContain( 'cannot read your machine' );
	} );

	it( 'keeps the no-shell post_content rule', () => {
		const prompt = buildSystemPrompt( {} );
		expect( prompt ).toContain( 'takes literal arguments, not shell commands' );
	} );

	it( 'lists the registered tools and their guidelines', () => {
		const prompt = buildSystemPrompt( {
			tools: [
				{ name: 'wp_cli', promptSnippet: 'Run WP-CLI commands on a running site' },
				{ name: 'Edit', promptGuidelines: [ 'Use one Edit call with multiple entries' ] },
				{ name: 'hidden' },
			],
		} );
		expect( prompt ).toContain(
			'## Available tools\n\n- wp_cli: Run WP-CLI commands on a running site'
		);
		expect( prompt ).toContain( '## Tool guidelines\n\n- Use one Edit call with multiple entries' );
		expect( prompt ).not.toContain( '- hidden' );
		expect( buildSystemPrompt( {} ) ).not.toContain( '## Tool guidelines' );
	} );

	it( "gives external agents their own intro instead of Studio Code's identity and cadence", () => {
		const prompt = buildSystemPrompt( { external: true } );
		expect( prompt ).toContain( 'Edit site files with your own file tools' );
		expect( prompt ).not.toContain( 'WordPress Studio Code' );
		expect( prompt ).not.toContain( '## Working cadence' );
	} );

	it( 'mentions refresh_browser only when chat artifacts are enabled', () => {
		const attachedPrompt = buildSystemPrompt( { chatArtifactsEnabled: true } );
		expect( attachedPrompt ).toContain( 'refresh_browser' );

		const terminalPrompt = buildSystemPrompt( { chatArtifactsEnabled: false } );
		expect( terminalPrompt ).not.toContain( 'refresh_browser' );
	} );

	it( 'warns that terminal users may not see screenshots when chat artifacts are disabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).toContain( '## Screenshots' );
		expect( prompt ).toContain( 'Do not respond as though the user is looking at the capture' );
	} );

	it( 'describes the screenshot and inspect tools for models without vision', () => {
		const polishStep = 'You MUST load the `visual-polish` skill and follow its instructions';
		const withVision = buildSystemPrompt( { tools: toolsFor( { visionEnabled: true } ) } );
		expect( withVision ).toContain( polishStep );
		expect( withVision ).toContain( 'Pair with take_screenshot' );
		expect( withVision ).not.toContain( 'You cannot view' );

		const textOnly = buildSystemPrompt( { tools: toolsFor( { visionEnabled: false } ) } );
		expect( textOnly ).toContain( polishStep );
		expect( textOnly ).toContain( 'which you need for the theme screenshot' );
		expect( textOnly ).toContain( 'copying your final desktop take_screenshot capture' );
		expect( textOnly ).not.toContain( 'Pair with take_screenshot' );
	} );

	it( 'omits the terminal screenshot caveat when chat artifacts are enabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true } );

		expect( prompt ).not.toContain( 'Do not respond as though the user is looking at the capture' );
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

	it( 'includes the terminal screenshot caveat for terminal sessions', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).toContain( '## Screenshots' );
		expect( prompt ).toContain( 'Do not respond as though the user is looking at the capture' );
	} );
} );
