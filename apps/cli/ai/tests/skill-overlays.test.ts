import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSkill, loadSkills } from '../skills';

describe( 'skill overlays', () => {
	it( 'keeps the shared verify-layout body free of Studio tool names', () => {
		// The source SKILL.md (capability-level) must not name a Studio tool, so it
		// stays liftable into a shared cross-harness skill library.
		const body = fs.readFileSync(
			path.resolve( import.meta.dirname, '..', 'skills', 'verify-layout', 'SKILL.md' ),
			'utf-8'
		);
		expect( body ).not.toContain( 'take_screenshot' );
		expect( body ).not.toContain( 'measure_elements' );
	} );

	it( 'appends the Studio overlay to the loaded skill body', () => {
		const skill = findSkill( 'verify-layout' );
		expect( skill ).toBeDefined();
		// The loaded (composed) body carries the Studio tool mapping under the
		// "In Studio" heading, so the agent still knows which tools to use.
		expect( skill?.body ).toContain( '## In Studio' );
		expect( skill?.body ).toContain( 'take_screenshot' );
		expect( skill?.body ).toContain( 'measure_elements' );
	} );

	it( 'leaves skills without an overlay unchanged', () => {
		// A skill with no overlay file must not gain an "In Studio" section.
		const blockContent = findSkill( 'block-content' );
		expect( blockContent ).toBeDefined();
		expect( blockContent?.body ).not.toContain( '## In Studio' );
	} );

	it( 'exposes verify-layout in the skill index', () => {
		expect( loadSkills().map( ( s ) => s.name ) ).toContain( 'verify-layout' );
	} );
} );
