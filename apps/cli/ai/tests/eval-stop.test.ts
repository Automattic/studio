import { describe, expect, it } from 'vitest';
import { matchesStopRule, type StopRule } from '../eval-stop';

const rules: StopRule[] = [
	{ tool: 'Write' },
	{ tool: 'wp_cli', input: { command: '^post (create|update)\\b' } },
];

describe( 'matchesStopRule', () => {
	it( 'matches a rule by tool name alone', () => {
		expect( matchesStopRule( { name: 'Write', input: { path: 'a.html' } }, rules ) ).toBe( true );
		expect( matchesStopRule( { name: 'Read', input: { path: 'a.html' } }, rules ) ).toBe( false );
	} );

	it( 'matches a rule with input patterns only when every field matches', () => {
		expect(
			matchesStopRule( { name: 'wp_cli', input: { command: 'post update 8 page.html' } }, rules )
		).toBe( true );
		expect(
			matchesStopRule( { name: 'wp_cli', input: { command: 'post list --post_type=page' } }, rules )
		).toBe( false );
		expect( matchesStopRule( { name: 'wp_cli', input: {} }, rules ) ).toBe( false );
	} );

	it( 'matches non-string fields by their JSON', () => {
		expect(
			matchesStopRule( { name: 'Skill', input: { names: [ 'imagery' ] } }, [
				{ tool: 'Skill', input: { names: '"imagery"' } },
			] )
		).toBe( true );
	} );
} );
