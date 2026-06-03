import { describe, expect, it } from 'vitest';
import { findSkill, loadSkills } from '../skills';
import { buildSystemPrompt } from '../system-prompt';

describe( 'creative-direction skill', () => {
	describe( 'discoverability', () => {
		it( 'is listed among available skills', () => {
			const names = loadSkills().map( ( s ) => s.name );
			expect( names ).toContain( 'creative-direction' );
		} );

		it( 'has a description', () => {
			const skill = findSkill( 'creative-direction' );
			expect( skill?.description ).toBeTruthy();
			expect( skill?.description.length ).toBeGreaterThan( 20 );
		} );

		it( 'is not user-invokable (internal skill)', () => {
			// Creative direction is loaded by the agent automatically, not typed by users.
			// Verify the frontmatter doesn't mark it as user-invokable.
			const skill = findSkill( 'creative-direction' );
			// The skill body is everything after the frontmatter — user-invokable: true
			// would appear in the raw file but is stripped from body by parseSkillFile.
			// We test intent via the description not advertising it as a slash command.
			expect( skill?.description ).not.toMatch( /slash command|type \//i );
		} );
	} );

	describe( 'skill body content', () => {
		it( 'has a Step 0 that selects the expansion mode', () => {
			const skill = findSkill( 'creative-direction' );
			// Step 0 should distinguish auto-expand, guided (one question), and skip paths
			expect( skill?.body ).toMatch( /step 0/i );
			expect( skill?.body ).toMatch( /auto.?expand|auto.?expan/i );
			expect( skill?.body ).toMatch( /one question/i );
			expect( skill?.body ).toMatch( /skip this skill/i );
		} );

		it( 'limits guided mode to a single clarifying question', () => {
			const skill = findSkill( 'creative-direction' );
			// Must not fan out into a multi-question wizard
			expect( skill?.body ).toMatch( /one question rule|single.*question|ask.*one/i );
		} );

		it( 'covers site-type detection', () => {
			const skill = findSkill( 'creative-direction' );
			expect( skill?.body ).toContain( 'Bar' );
			expect( skill?.body ).toContain( 'Restaurant' );
			expect( skill?.body ).toContain( 'SaaS' );
			expect( skill?.body ).toContain( 'Portfolio' );
		} );

		it( 'includes per-type content plans with pages and forms', () => {
			const skill = findSkill( 'creative-direction' );
			// Bar type should specify concrete pages and a reservations form
			expect( skill?.body ).toContain( 'Menu' );
			expect( skill?.body ).toContain( 'Events' );
			expect( skill?.body ).toContain( 'Gallery' );
			expect( skill?.body ).toContain( 'reservations' );
		} );

		it( 'instructs the agent to brief the user before building', () => {
			const skill = findSkill( 'creative-direction' );
			expect( skill?.body ).toMatch( /brief the user|tell the user/i );
			expect( skill?.body ).toMatch( /do not ask for approval|proceed.*without asking/i );
		} );

		it( 'includes a skip condition for detailed prompts', () => {
			const skill = findSkill( 'creative-direction' );
			expect( skill?.body ).toMatch( /when to skip/i );
			expect( skill?.body ).toMatch( /detailed content|keep it minimal/i );
		} );

		it( 'instructs the agent to use the site name as a design prompt', () => {
			const skill = findSkill( 'creative-direction' );
			expect( skill?.body ).toMatch( /name.*creative|name.*brief|use.*name/i );
		} );
	} );

	describe( 'system prompt integration', () => {
		it( 'is referenced in the local site workflow', () => {
			const prompt = buildSystemPrompt();
			expect( prompt ).toContain( 'creative-direction' );
		} );

		it( 'is invoked during the design planning step', () => {
			const prompt = buildSystemPrompt();
			// Verify the creative-direction skill reference appears in the workflow
			// context (Plan the design step), not just anywhere in the prompt.
			const planStep = prompt.match( /\*\*Plan the design\*\*[^\n]*/ )?.[ 0 ] ?? '';
			expect( planStep ).toContain( 'creative-direction' );
		} );

		it( 'is NOT referenced in the remote site workflow', () => {
			// Remote sites use the REST API workflow — creative direction is local only.
			const prompt = buildSystemPrompt( {
				remoteSite: { name: 'Test Site', url: 'https://test.wordpress.com', id: 123 },
			} );
			expect( prompt ).not.toContain( 'creative-direction' );
		} );

		it( 'instructs the agent to proceed without asking for approval', () => {
			const prompt = buildSystemPrompt();
			const planStep = prompt.match( /\*\*Plan the design\*\*[^\n]*/ )?.[ 0 ] ?? '';
			expect( planStep ).toContain( 'without asking for approval' );
		} );
	} );
} );
