import { describe, expect, it } from 'vitest';
import { findSkill } from '../skills';

function getSkillBody( name: string ): string {
	const skill = findSkill( name );
	if ( ! skill ) {
		throw new Error( `Skill not found: ${ name }` );
	}
	return skill.body;
}

// Pins the stale-content guards added for STU-2048: the agent must hydrate
// its working copy from the live site before editing existing content, or a
// full-content apply silently overwrites manual WordPress-editor edits.
describe( 'skill content guards', () => {
	it( 'block-content requires hydrating from live content before editing an existing page', () => {
		const body = getSkillBody( 'block-content' );

		expect( body ).toContain( '## Editing Existing Content' );
		expect( body ).toContain( 'get_post_field("post_content", <id>, "raw")' );
		expect( body ).toContain(
			'Never start an edit from a `tmp/page-*.html` file left over from an earlier task or session'
		);
		expect( body ).toContain( "never rebuild a page's content from conversation memory" );
	} );

	it( 'block-content applies content with slashed data so backslashes survive the round trip', () => {
		const body = getSkillBody( 'block-content' );

		expect( body ).toContain( 'wp_update_post(wp_slash(' );
	} );

	it( 'wpcom-remote-management requires fetching current content before updates', () => {
		const body = getSkillBody( 'wpcom-remote-management' );

		expect( body ).toContain( 'fetch its current raw content first' );
		expect( body ).toContain( 'context=edit' );
		expect( body ).toContain( 'Staged payload files are single-use' );
		expect( body ).toContain(
			'never reuse a `tmp/ai-payloads/` file written for an earlier request or session'
		);
	} );
} );
