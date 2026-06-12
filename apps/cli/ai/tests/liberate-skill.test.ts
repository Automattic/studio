import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { findSkill, loadSkills } from 'cli/ai/skills';

/**
 * The `/liberate` wrapper skill is parsed by `loadSkills()` at runtime. The
 * loader only reads `name` and `description` from frontmatter (everything
 * else is body), so these tests assert both the frontmatter contract and a
 * loose set of body references that lock in the bare-tool-name convention.
 *
 * Bare names matter: DLA's MCP tools surface through the bridge as plain
 * `customTools` (e.g. `liberate_inspect`), not as MCP-prefixed remote
 * tools (`mcp__data-liberation__liberate_inspect`). The skill body must
 * reference the bare names for the model to call them correctly.
 */
describe( '/liberate skill', () => {
	const skillPath = path.resolve( import.meta.dirname, '..', 'skills', 'liberate', 'SKILL.md' );

	it( 'exists at apps/cli/ai/skills/liberate/SKILL.md', () => {
		expect( fs.existsSync( skillPath ) ).toBe( true );
	} );

	it( 'is discovered by loadSkills()', () => {
		const skills = loadSkills();
		const names = skills.map( ( s ) => s.name );
		expect( names ).toContain( 'liberate' );
	} );

	it( 'parses frontmatter with name=liberate and a non-empty description', () => {
		const skill = findSkill( 'liberate' );
		expect( skill ).toBeDefined();
		expect( skill!.name ).toBe( 'liberate' );
		expect( skill!.description ).toBeTruthy();
		expect( skill!.description.length ).toBeGreaterThan( 0 );
	} );

	it( 'body references the bare DLA tool names (no MCP prefix)', () => {
		const skill = findSkill( 'liberate' );
		const body = skill!.body;

		// Bare DLA tools the skill orchestrates.
		expect( body ).toContain( 'liberate_inspect' );
		expect( body ).toContain( 'liberate_extract' );
		expect( body ).toContain( 'liberate_verify' );
		expect( body ).toContain( 'liberate_setup' );
		expect( body ).toContain( 'liberate_import' );

		// Studio's local tools the skill hands work off to.
		expect( body ).toContain( 'site_create' );
		expect( body ).toContain( 'wp_cli' );
	} );

	it( 'does not use the MCP-prefixed tool names', () => {
		const skill = findSkill( 'liberate' );
		const body = skill!.body;
		expect( body ).not.toContain( 'mcp__data-liberation__' );
		expect( body ).not.toContain( 'mcp__studio__' );
	} );

	it( 'enforces the delegate:true contract for liberate_import', () => {
		const skill = findSkill( 'liberate' );
		const body = skill!.body;
		// The body must instruct the model to pass delegate:true; a loose
		// grep is enough — exact phrasing is allowed to drift.
		expect( body ).toMatch( /delegate:\s*true/i );
	} );

	it( 'points users to `studio liberate` for headless mode', () => {
		const skill = findSkill( 'liberate' );
		const body = skill!.body;
		expect( body.toLowerCase() ).toContain( 'studio liberate' );
	} );
} );
