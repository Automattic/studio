import { describe, expect, it } from 'vitest';
import { getToolDetail, getToolDisplayName } from '../tools';

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
		).toBe( 'Activate plugin jetpack' );
		expect(
			getToolDisplayName( 'wp_cli', {
				command: 'option get blogname',
			} )
		).toBe( 'Read site title' );
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
		expect( getToolDisplayName( 'take_screenshot' ) ).toBe( 'Capture screenshot' );
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
