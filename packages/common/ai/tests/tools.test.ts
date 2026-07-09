import { describe, expect, it } from 'vitest';
import {
	buildToolGroupSummary,
	countDiffLineStats,
	getToolDetail,
	getToolDisplayName,
	getWritePseudoDiff,
} from '../tools';

describe( 'tool display helpers', () => {
	it( 'summarizes common WP-CLI commands from their input', () => {
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'post list --post_type=post --post_status=publish',
			} )
		).toBe( 'List published posts' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin activate jetpack',
			} )
		).toBe( 'Activate plugin: Jetpack' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'option get blogname',
			} )
		).toBe( 'Read site title' );
	} );

	it( 'formats WP-CLI plugin and theme targets as display names', () => {
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin install woocommerce',
			} )
		).toBe( 'Install plugin: WooCommerce' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin activate classic-editor',
			} )
		).toBe( 'Activate plugin: Classic Editor' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin install --activate woocommerce',
			} )
		).toBe( 'Install plugin: WooCommerce' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin install --version 9.0 woocommerce',
			} )
		).toBe( 'Install plugin: WooCommerce' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'theme activate my-custom-theme',
			} )
		).toBe( 'Activate theme: My Custom Theme' );
	} );

	it( 'does not treat WP-CLI flags as plugin names', () => {
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin update --all',
			} )
		).toBe( 'Update all plugins' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin activate --all',
			} )
		).toBe( 'Activate all plugins' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'plugin deactivate --all',
			} )
		).toBe( 'Deactivate all plugins' );
	} );

	it( 'ignores large WP-CLI payload values when deriving labels', () => {
		expect(
			getToolDisplayName( 'wp_cli', {
				command: `post create --post_type=page --post_content=${ 'Block content '.repeat(
					1000
				) } --post_type=post`,
			} )
		).toBe( 'Create page' );
	} );

	it( 'keeps the full WP-CLI command available as detail', () => {
		expect( getToolDetail( 'wp_cli', { command: 'plugin activate jetpack' } ) ).toBe(
			'wp plugin activate jetpack'
		);
	} );

	it( 'keeps terminal command detail available for compact surfaces', () => {
		expect( getToolDisplayName( 'Bash' ) ).toBe( 'Run' );
		expect( getToolDetail( 'Bash', { command: 'npm test' } ) ).toBe( 'npm test' );
	} );

	it( 'truncates long terminal commands', () => {
		const detail = getToolDetail( 'Bash', {
			command: "cat > /tmp/now-playing-draft.txt << 'ENDOFPOST' with much more text after it",
		} );

		expect( detail.length ).toBeLessThanOrEqual( 60 );
		expect( detail.endsWith( '…' ) ).toBe( true );
	} );

	it( 'adds human names for Studio-specific visual tools', () => {
		expect( getToolDisplayName( 'take_screenshot' ) ).toBe( 'Take screenshot' );
		expect( getToolDisplayName( 'inspect_design' ) ).toBe( 'Inspect design' );
		expect( getToolDisplayName( 'open_annotation_browser' ) ).toBe( 'Open annotation browser' );
	} );

	it( 'summarizes Ask User questions without exposing the raw tool name', () => {
		expect(
			getToolDetail( 'AskUserQuestion', {
				questions: [
					{
						question: 'What kind of visual direction should this site use?',
						options: [],
					},
				],
			} )
		).toBe( 'What kind of visual direction should this site use?' );
	} );
} );

describe( 'tool group summaries', () => {
	it( 'builds category counts for mixed tool groups', () => {
		const summary = buildToolGroupSummary( [
			{ name: 'Read' },
			{ name: 'Read' },
			{ name: 'Edit' },
			{ name: 'wp_cli' },
		] );
		expect( summary.label ).toBe( 'Edited 1 file · Read 2 files · Ran 1 WP-CLI command' );
	} );

	it( 'counts unified diff line stats', () => {
		const stats = countDiffLineStats(
			[ '--- a/file.txt', '+++ b/file.txt', '-old line', '+new line', '+another line' ].join( '\n' )
		);
		expect( stats ).toEqual( { additions: 2, deletions: 1 } );
	} );

	it( 'builds pseudo diffs for write tool input', () => {
		expect( getWritePseudoDiff( { content: 'line one\nline two' } ) ).toBe(
			'+line one\n+line two'
		);
	} );
} );
