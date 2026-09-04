import fs from 'fs';
import path from 'path';

export interface Skill {
	name: string;
	description: string;
	body: string;
}

function parseSkillFile( filePath: string ): Skill | null {
	const contents = fs.readFileSync( filePath, 'utf-8' );
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	if ( ! match ) return null;
	const [ , frontmatter, body ] = match;

	const name = frontmatter.match( /^name:\s*(.+)$/m )?.[ 1 ]?.trim();
	const description = frontmatter.match( /^description:\s*(.+)$/m )?.[ 1 ]?.trim();
	if ( ! name || ! description ) return null;

	return { name, description, body: body.trim() };
}

let cachedSkills: Skill[] | null = null;

// Resolves the skills directory. In source this is `apps/cli/ai/skills`
// (next to this file); after bundling everything collapses into the CLI
// out dir and the `viteStaticCopy` step places skills at `<outDir>/skills`
// (e.g. `dist/cli/skills`), which is again next to this (bundled) file.
// Resolving relative to `import.meta.dirname` therefore works in both
// cases — callers that need a skill asset MUST go through this helper
// rather than hand-rolling their own relative path.
export function getSkillsRoot(): string {
	return path.resolve( import.meta.dirname, 'skills' );
}

// Returns the absolute path to a file/dir inside a specific skill, e.g.
// `getSkillPath( 'taxonomist', 'scripts' )`.
export function getSkillPath( skillName: string, ...segments: string[] ): string {
	return path.join( getSkillsRoot(), skillName, ...segments );
}

// Discovers `apps/cli/ai/skills/<name>/SKILL.md` files at startup; cached
// for the process lifetime since skills never change at runtime.
export function loadSkills(): Skill[] {
	if ( cachedSkills ) return cachedSkills;

	const skillsRoot = getSkillsRoot();

	if ( ! fs.existsSync( skillsRoot ) ) {
		// Loud warning so a broken bundle path doesn't silently disable Skill.
		console.warn(
			`[skills] skills directory not found at ${ skillsRoot } — Skill tool will be unavailable.`
		);
		cachedSkills = [];
		return cachedSkills;
	}

	const skills: Skill[] = [];
	for ( const entry of fs.readdirSync( skillsRoot, { withFileTypes: true } ) ) {
		if ( ! entry.isDirectory() ) continue;
		const skillPath = path.join( skillsRoot, entry.name, 'SKILL.md' );
		if ( ! fs.existsSync( skillPath ) ) continue;
		const skill = parseSkillFile( skillPath );
		if ( skill ) skills.push( skill );
	}
	cachedSkills = skills;
	return skills;
}

export function findSkill( name: string ): Skill | undefined {
	return loadSkills().find( ( skill ) => skill.name === name );
}

export interface DesignConcept {
	category: string;
	name: string;
	body: string;
}

let cachedConcepts: DesignConcept[] | null = null;

// Parses `visual-design/concepts.md`: `## ` headings are categories and
// `### ` headings are concepts, each keeping its own markdown body.
export function loadDesignConcepts(): DesignConcept[] {
	if ( cachedConcepts ) return cachedConcepts;
	const conceptsPath = getSkillPath( 'visual-design', 'concepts.md' );
	if ( ! fs.existsSync( conceptsPath ) ) {
		cachedConcepts = [];
		return cachedConcepts;
	}
	const concepts: DesignConcept[] = [];
	let category = '';
	for ( const section of fs.readFileSync( conceptsPath, 'utf-8' ).split( /^(?=##+ )/m ) ) {
		const heading = section.match( /^(##+) (.+)$/m );
		if ( ! heading ) continue;
		const [ , level, title ] = heading;
		if ( level === '##' ) {
			category = title.trim();
			continue;
		}
		if ( level === '###' && category ) {
			concepts.push( {
				category,
				name: title.trim(),
				body: section.slice( heading[ 0 ].length ).trim(),
			} );
		}
	}
	cachedConcepts = concepts;
	return concepts;
}

function shuffle< T >( items: T[], random: () => number ): T[] {
	const result = [ ...items ];
	for ( let i = result.length - 1; i > 0; i-- ) {
		const j = Math.floor( random() * ( i + 1 ) );
		[ result[ i ], result[ j ] ] = [ result[ j ], result[ i ] ];
	}
	return result;
}

// Picks `count` concepts spread across categories (round-robin over a
// shuffled category order, one random concept per category per round) and
// returns them in random order, so neither the pick nor its position in
// the list is stable between two loads of the skill.
export function sampleDesignConcepts(
	count: number,
	random: () => number = Math.random
): DesignConcept[] {
	const byCategory = new Map< string, DesignConcept[] >();
	for ( const concept of loadDesignConcepts() ) {
		byCategory.set( concept.category, [
			...( byCategory.get( concept.category ) ?? [] ),
			concept,
		] );
	}
	const pools = shuffle( [ ...byCategory.values() ], random ).map( ( pool ) =>
		shuffle( pool, random )
	);
	const picked: DesignConcept[] = [];
	while ( picked.length < count && pools.some( ( pool ) => pool.length > 0 ) ) {
		for ( const pool of pools ) {
			if ( picked.length >= count ) break;
			const concept = pool.pop();
			if ( concept ) picked.push( concept );
		}
	}
	return shuffle( picked, random );
}

export const CONCEPT_SHORTLIST_PLACEHOLDER = '{{concept-shortlist}}';
const CONCEPT_SHORTLIST_SIZE = 10;

function renderConceptShortlist(): string {
	return sampleDesignConcepts( CONCEPT_SHORTLIST_SIZE )
		.map( ( concept ) => `#### ${ concept.name } (${ concept.category })\n${ concept.body }` )
		.join( '\n\n' );
}

// Skill bodies are static except for placeholders that are re-rendered on
// every load — the concept shortlist is a fresh random sample each time.
export function renderSkillBody( skill: Skill ): string {
	if ( ! skill.body.includes( CONCEPT_SHORTLIST_PLACEHOLDER ) ) return skill.body;
	return skill.body.replace( CONCEPT_SHORTLIST_PLACEHOLDER, renderConceptShortlist() );
}
