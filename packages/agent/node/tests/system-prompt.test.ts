import { describe, expect, it } from 'vitest';
import { loadSkills } from '@studio/agent/shared/skills';
import { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
import { resolveStudioTools, type StudioToolsOptions } from '@studio/agent/shared/tools';
import { createFakeHost } from './fake-host';
import type { StudioAgentHost } from '@studio/agent/shared/host';

function extractReferencedSkillNames( prompt: string ): string[] {
	return [
		...new Set( Array.from( prompt.matchAll( /`([a-z0-9-]+)` skill/g ), ( match ) => match[ 1 ] ) ),
	].sort();
}

const toolsFor = ( options: StudioToolsOptions, host: StudioAgentHost = createFakeHost() ) =>
	resolveStudioTools( host, options ).map( ( tool ) => ( {
		name: tool.name,
		promptSnippet: tool.promptSnippet,
	} ) );

describe( 'buildSystemPrompt', () => {
	it( 'mentions a shell only to agents that have one', () => {
		expect( buildSystemPrompt( { tools: [ { name: 'Bash' } ] } ) ).toContain(
			'Never run `wp` commands via Bash'
		);
		expect( buildSystemPrompt( { external: true, tools: [] } ) ).toContain(
			'Never run `wp` commands via Bash'
		);
		expect( buildSystemPrompt( { tools: [ { name: 'wp_cli' } ] } ) ).not.toContain( 'Bash' );
	} );

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

	it( 'carries the remote-site runbook only when a WordPress.com site is active', () => {
		const remote = buildSystemPrompt( {
			activeSite: {
				name: 'Live',
				path: '',
				running: false,
				remote: true,
				url: 'https://example.wordpress.com',
				wpcomSiteId: 123,
			},
		} );
		const local = buildSystemPrompt( {
			activeSite: { name: 'My Site', path: '/sites/my-site', running: true },
		} );
		const runbook = loadSkills().find( ( skill ) => skill.name === 'edit-manage-remote-site' );

		expect( remote ).toContain( runbook?.body );
		expect( remote.indexOf( '## Active site' ) ).toBeLessThan(
			remote.indexOf( '## Common wp/v2 Endpoints' )
		);
		expect( local ).not.toContain( '## Common wp/v2 Endpoints' );
		expect( buildSystemPrompt( {} ) ).not.toContain( '## Common wp/v2 Endpoints' );
	} );

	it( 'lists the remote-site skill with what it covers, for sites the user names', () => {
		const runbook = loadSkills().find( ( skill ) => skill.name === 'edit-manage-remote-site' );

		expect( runbook?.userInvokable ).toBe( true );
		expect( runbook?.description ).toContain( 'live remote sites' );
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

	it( 'lists refresh_browser only when a Studio UI is attached', () => {
		const ui = { showArtifact: () => {}, reloadPreview: () => {} };
		expect( buildSystemPrompt( { tools: toolsFor( {}, { ...createFakeHost(), ui } ) } ) ).toContain(
			'- refresh_browser:'
		);
		expect( buildSystemPrompt( { tools: toolsFor( {} ) } ) ).not.toContain( 'refresh_browser' );
	} );

	it( 'states the active site in its own section, above the user instructions', () => {
		const prompt = buildSystemPrompt( {
			userInstructions: 'Always answer in French.',
			activeSite: { name: 'My Site', path: '/sites/my-site', running: true },
		} );

		expect( prompt ).toContain( '## Active site\n\n"My Site" at /sites/my-site (running)' );
		expect( prompt.indexOf( '## Active site' ) ).toBeLessThan(
			prompt.indexOf( "## User's global instructions" )
		);
		expect( buildSystemPrompt( {} ) ).not.toContain( '## Active site' );
	} );

	it( 'states a WordPress.com active site with its ID and URL', () => {
		const prompt = buildSystemPrompt( {
			activeSite: {
				name: 'Live',
				path: '',
				running: false,
				remote: true,
				url: 'https://example.wordpress.com',
				wpcomSiteId: 123,
			},
		} );

		expect( prompt ).toContain(
			'## Active site\n\n"Live" (ID: 123) at https://example.wordpress.com (WordPress.com)'
		);
	} );

	it( "names the active site's design system when it has a DESIGN.md", () => {
		const prompt = buildSystemPrompt( {
			activeSite: { name: 'Designed', path: '/sites/designed', running: false },
			activeSiteDesignPath: '/sites/designed/DESIGN.md',
		} );
		expect( prompt ).toContain(
			'"Designed" at /sites/designed (stopped), design system: /sites/designed/DESIGN.md'
		);
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
