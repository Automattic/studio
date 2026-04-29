import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Absolute path to the Studio plugin skills directory. Each subdirectory holds
 * a single `SKILL.md` whose YAML frontmatter declares the skill's name,
 * description, allowed tools, and (optionally) an `argument-hint`.
 */
const SKILLS_DIR = path.resolve( import.meta.dirname, '..', 'plugin', 'skills' );

/**
 * Parsed representation of a SKILL.md frontmatter block.
 */
interface SkillFrontmatter {
	/** Skill identifier; matches the slash-command name. */
	name?: string;
	/** Short description shown in autocomplete and the skill listing. */
	description?: string;
	/** Optional argument hint (e.g. `<source-url>`) shown after the slash command. */
	'argument-hint'?: string;
	/** Whether the user can invoke this skill via slash command. SDK reads `user-invocable` (with C). */
	'user-invocable'?: boolean;
	/** Comma-separated list of tools the skill is allowed to call. */
	'allowed-tools'?: string;
}

/**
 * Parse the YAML frontmatter block at the top of a SKILL.md file. The parser
 * handles only the simple key/value forms used by Studio skills (`key: value`,
 * with optional double-quoted values and boolean coercion). It deliberately
 * avoids pulling in `js-yaml` to keep the CLI workspace dependency footprint
 * minimal — the frontmatter shape across all existing skills is uniform.
 *
 * @param source - Full SKILL.md file contents, including the leading `---`.
 * @returns The parsed frontmatter object.
 * @example
 * parseFrontmatter('---\nname: foo\nuser-invocable: true\n---\n# Body');
 * // => { name: 'foo', 'user-invocable': true }
 */
function parseFrontmatter( source: string ): SkillFrontmatter {
	const match = source.match( /^---\r?\n([\s\S]*?)\r?\n---\r?\n/ );
	if ( ! match ) {
		throw new Error( 'SKILL.md is missing a YAML frontmatter block' );
	}
	const block = match[ 1 ];
	const result: SkillFrontmatter = {};
	for ( const rawLine of block.split( /\r?\n/ ) ) {
		const line = rawLine.trimEnd();
		if ( ! line || line.startsWith( '#' ) ) {
			continue;
		}
		const colonIndex = line.indexOf( ':' );
		if ( colonIndex === -1 ) {
			continue;
		}
		const key = line.slice( 0, colonIndex ).trim();
		let value = line.slice( colonIndex + 1 ).trim();
		if (
			( value.startsWith( '"' ) && value.endsWith( '"' ) ) ||
			( value.startsWith( "'" ) && value.endsWith( "'" ) )
		) {
			value = value.slice( 1, -1 );
		}
		if ( value === 'true' || value === 'false' ) {
			( result as Record< string, unknown > )[ key ] = value === 'true';
		} else {
			( result as Record< string, unknown > )[ key ] = value;
		}
	}
	return result;
}

describe( 'migrate skill', () => {
	const skillPath = path.join( SKILLS_DIR, 'migrate', 'SKILL.md' );
	const source = fs.readFileSync( skillPath, 'utf8' );
	const frontmatter = parseFrontmatter( source );

	it( 'declares name "migrate"', () => {
		expect( frontmatter.name ).toBe( 'migrate' );
	} );

	it( 'uses user-invocable with C (not the user-invokable typo)', () => {
		expect( frontmatter[ 'user-invocable' ] ).toBe( true );
		expect( ( frontmatter as Record< string, unknown > )[ 'user-invokable' ] ).toBeUndefined();
	} );

	it( 'declares an argument-hint string for inline source URLs', () => {
		expect( typeof frontmatter[ 'argument-hint' ] ).toBe( 'string' );
		expect( frontmatter[ 'argument-hint' ] ).toMatch( /</ );
	} );

	it( 'declares a non-empty description', () => {
		expect( typeof frontmatter.description ).toBe( 'string' );
		expect( ( frontmatter.description ?? '' ).length ).toBeGreaterThan( 0 );
	} );

	it( 'allows precisely the orchestration tools the workflow needs', () => {
		const allowed = ( frontmatter[ 'allowed-tools' ] ?? '' )
			.split( ',' )
			.map( ( entry ) => entry.trim() )
			.filter( Boolean );
		const expected = [
			'mcp__data-liberation__liberate_inspect',
			'mcp__data-liberation__liberate_extract',
			'mcp__data-liberation__liberate_verify',
			'mcp__data-liberation__liberate_setup',
			'mcp__data-liberation__liberate_import',
			'mcp__studio__site_create',
			'mcp__studio__site_list',
			'mcp__studio__site_info',
			'mcp__studio__wp_cli',
			'AskUserQuestion',
		];
		for ( const tool of expected ) {
			expect( allowed ).toContain( tool );
		}
	} );

	it( 'does not allow DLA preview tools (Studio creates the site itself)', () => {
		const allowed = ( frontmatter[ 'allowed-tools' ] ?? '' )
			.split( ',' )
			.map( ( entry ) => entry.trim() );
		expect( allowed ).not.toContain( 'mcp__data-liberation__liberate_preview' );
		expect( allowed ).not.toContain( 'mcp__data-liberation__liberate_preview_stop' );
	} );
} );
