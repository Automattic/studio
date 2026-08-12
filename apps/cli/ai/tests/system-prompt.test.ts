import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
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

function extractEnvironmentHeadings( prompt: string ): string[] {
	return Array.from( prompt.matchAll( /^## Your environment: .+$/gm ), ( match ) => match[ 0 ] );
}

describe( 'buildSystemPrompt', () => {
	const previousScratchpadWidgetType = 'sd-' + 'artefact';
	const studioUiOptions = { chatArtifactsEnabled: true, surface: 'desktop' } as const;

	it( 'identifies Studio Code as available in the desktop app and CLI', () => {
		expect( buildSystemPrompt() ).toContain(
			"available in WordPress Studio's desktop app and CLI"
		);
	} );

	it( 'includes Studio presentation rules when chat artifacts are enabled', () => {
		const prompt = buildSystemPrompt( studioUiOptions );

		expect( prompt ).toContain( '### Visual artifacts' );
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
		expect( prompt ).toContain( '- screenshot-auto-artifact:' );
		expect( prompt ).toContain( 'Never call studio_present for a screenshot' );
		expect( prompt ).toContain( 'site-preview is for live previews, not captured screenshots' );
		expect( prompt ).toContain( '- theme:' );
		expect( prompt ).toContain( '- theme-template:' );
		expect( prompt ).toContain( '- theme-styles:' );
		expect( prompt ).toContain( '- theme-pattern:' );
		expect( prompt ).toContain( '- color:' );
		expect( prompt ).toContain( '- pdf:' );
	} );

	it.each( [
		[ 'desktop', 'the WordPress Studio desktop app' ],
		[ 'cliui', "Studio's browser interface, launched with `studio ui`" ],
	] as const )( 'describes the %s interface and its navigation', ( surface, description ) => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: true, surface } );

		expect( prompt ).toContain( '## Your environment: Studio interface' );
		expect( prompt ).toContain( description );
		expect( prompt ).toContain( '**Add site** (+)' );
		expect( prompt ).toContain( '**Site overview** button' );
		expect( prompt ).toContain( '**Overview**, **Settings**, and **Debugging** tabs' );
		expect( prompt ).toContain( '**Show preview** / **Hide preview**' );
		expect( prompt ).toContain( '**AI**, **Usage**, **Keyboard**, **Skills**, and **MCP**' );
	} );

	it( 'includes interface navigation for remote-site conversations', () => {
		const prompt = buildSystemPrompt( {
			remoteSite,
			chatArtifactsEnabled: true,
			surface: 'desktop',
		} );

		expect( prompt ).toContain( '## Your environment: Studio interface' );
		expect( prompt ).toContain( 'the WordPress Studio desktop app' );
		expect( prompt ).toContain( '### Visual artifacts' );
	} );

	it( 'omits visual interface navigation in the standalone terminal', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).toContain( '## Your environment: terminal' );
		expect( prompt ).not.toContain( '## Your environment: Studio interface' );
		expect( prompt ).not.toContain( '**Add site** (+)' );
		expect( prompt ).not.toContain( '- refresh_browser:' );
		expect( prompt ).not.toContain( 'call refresh_browser so the attached Studio preview' );
	} );

	it( 'routes plugin-specific feature work to the plugin recommendations skill', () => {
		const prompt = buildSystemPrompt( studioUiOptions );

		expect( prompt ).toContain( 'plugin-recommendations' );
		expect( prompt ).toContain( 'any feature that core WordPress blocks do not cleanly provide' );
		expect( prompt ).not.toContain( '## Jetpack Forms' );
		expect( prompt ).not.toContain( 'wp_cli jetpack module activate contact-form' );
	} );

	it( 'routes block markup recipes to the block content skill', () => {
		const prompt = buildSystemPrompt( studioUiOptions );

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
		const prompt = buildSystemPrompt( studioUiOptions );

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
		const prompts = [ buildSystemPrompt( studioUiOptions ), buildSystemPrompt( { remoteSite } ) ];
		const availableSkillNames = new Set( loadSkills().map( ( skill ) => skill.name ) );
		const missingSkillNames = prompts
			.flatMap( extractReferencedSkillNames )
			.filter( ( skillName ) => ! availableSkillNames.has( skillName ) );

		expect( missingSkillNames ).toEqual( [] );
	} );

	it( 'gives Playground sites the inline post_content guidance', () => {
		const prompt = buildSystemPrompt( { runtime: SITE_RUNTIME_PLAYGROUND } );

		expect( prompt ).toContain( 'rewrite large content to a virtual temp file' );
		expect( prompt ).toContain( 'cannot read your machine' );
		expect( prompt ).not.toContain( 'write the validated markup to a scratch file' );
	} );

	it( 'lets native PHP sites use a scratch file for post_content', () => {
		const prompt = buildSystemPrompt( { runtime: SITE_RUNTIME_NATIVE_PHP } );

		expect( prompt ).toContain( 'write the validated markup to a scratch file' );
		expect( prompt ).toContain( 'wp post create <file>' );
		expect( prompt ).not.toContain( 'virtual temp file' );
		expect( prompt ).not.toContain( 'cannot read your machine' );
	} );

	it( 'defaults to native PHP post_content guidance when no runtime is given', () => {
		const prompt = buildSystemPrompt( {} );

		expect( prompt ).toContain( 'write the validated markup to a scratch file' );
		expect( prompt ).not.toContain( 'virtual temp file' );
	} );

	it( 'keeps the shared no-shell post_content rule for both runtimes', () => {
		const runtimes: SiteRuntime[] = [ SITE_RUNTIME_PLAYGROUND, SITE_RUNTIME_NATIVE_PHP ];
		for ( const runtime of runtimes ) {
			const prompt = buildSystemPrompt( { runtime } );
			expect( prompt ).toContain( 'takes literal arguments, not shell commands' );
		}
	} );

	it( 'omits Studio presentation rules when chat artifacts are disabled', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).not.toContain( '### Visual artifacts' );
		expect( prompt ).not.toContain( '- site-code-scratchpad:' );
		expect( prompt ).not.toContain( '- saved-local-media:' );
		expect( prompt ).not.toContain( '- screenshot-auto-artifact:' );
		expect( prompt ).not.toContain( '- studio_present:' );
	} );

	it( 'gives terminal-specific screenshot and preview guidance', () => {
		const prompt = buildSystemPrompt( { chatArtifactsEnabled: false } );

		expect( prompt ).toContain( '## Your environment: terminal' );
		expect( prompt ).toContain( 'terminal transcript may show only the saved file link' );
		expect( prompt ).toContain( 'Do not speak as though the user is already looking at the image' );
		expect( prompt ).toContain( 'do not call `refresh_browser` or `studio_present`' );
	} );

	it( 'uses Studio UI guidance instead of terminal guidance when a visual surface is attached', () => {
		const prompt = buildSystemPrompt( studioUiOptions );

		expect( prompt ).toContain( '## Your environment: Studio interface' );
		expect( prompt ).not.toContain( '## Your environment: terminal' );
		expect( prompt ).toContain( '- refresh_browser:' );
		expect( prompt ).toContain( 'call refresh_browser so the attached Studio preview' );
		expect( prompt ).toContain( 'choose **Database** in the attached preview toolbar' );
		expect( prompt ).not.toContain( 'For direct SQL access, the user can run' );
	} );

	it( 'appends the user global instructions for local and remote sessions', () => {
		const variants = [ studioUiOptions, { remoteSite } ];
		for ( const variant of variants ) {
			const prompt = buildSystemPrompt( {
				...variant,
				userInstructions: 'Always answer in French.',
			} );
			expect( prompt ).toContain( "## User's global instructions" );
			expect( prompt ).toContain( 'Always answer in French.' );
		}
	} );

	it( 'omits the global instructions section when none are set', () => {
		const prompts = [ buildSystemPrompt( {} ), buildSystemPrompt( { remoteSite } ) ];
		for ( const prompt of prompts ) {
			expect( prompt ).not.toContain( "## User's global instructions" );
		}
	} );

	it( 'truncates oversized global instructions with a visible notice', () => {
		const prompt = buildSystemPrompt( { userInstructions: 'a'.repeat( 20_000 ) } );

		expect( prompt ).toContain( 'was truncated here' );
		expect( prompt ).not.toContain( 'a'.repeat( 17_000 ) );
	} );

	it( 'uses Telegram guidance instead of terminal or Studio UI guidance for remote sessions', () => {
		// The Telegram user cannot open local file paths; delivery is covered
		// by the remote-session share_screenshot guidance instead.
		const prompt = buildSystemPrompt( {
			chatArtifactsEnabled: true,
			remoteSession: true,
			surface: 'desktop',
		} );

		expect( prompt ).toContain( '## Your environment: Telegram remote session' );
		expect( prompt ).not.toContain( '## Your environment: terminal' );
		expect( prompt ).not.toContain( '## Your environment: Studio interface' );
		expect( prompt ).not.toContain( '- refresh_browser:' );
		expect( prompt ).not.toContain( '- studio_present:' );
		expect( prompt ).not.toContain( '### Visual artifacts' );
		expect( prompt ).not.toContain( 'For direct SQL access, the user can run' );
	} );

	it( 'includes exactly one environment section in every execution mode', () => {
		const prompts = [
			buildSystemPrompt(),
			buildSystemPrompt( studioUiOptions ),
			buildSystemPrompt( { chatArtifactsEnabled: true, surface: 'cliui' } ),
			buildSystemPrompt( { remoteSession: true } ),
			buildSystemPrompt( { remoteSite } ),
			buildSystemPrompt( { remoteSite, ...studioUiOptions } ),
		];

		for ( const prompt of prompts ) {
			expect( extractEnvironmentHeadings( prompt ) ).toHaveLength( 1 );
		}
	} );
} );
