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
	name: string;
	body: string;
}

let cachedConcepts: DesignConcept[] | null = null;

// Parses `visual-design/concepts.md`: each `## ` heading is one concept
// keeping its own markdown body.
export function loadDesignConcepts(): DesignConcept[] {
	if ( cachedConcepts ) return cachedConcepts;
	const conceptsPath = getSkillPath( 'visual-design', 'concepts.md' );
	if ( ! fs.existsSync( conceptsPath ) ) {
		cachedConcepts = [];
		return cachedConcepts;
	}
	const concepts: DesignConcept[] = [];
	for ( const section of fs.readFileSync( conceptsPath, 'utf-8' ).split( /^(?=## )/m ) ) {
		const heading = section.match( /^## (.+)$/m );
		if ( ! heading ) continue;
		concepts.push( {
			name: heading[ 1 ].trim(),
			body: section.slice( heading[ 0 ].length ).trim(),
		} );
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

// Picks `count` random concepts in random order, so neither the pick nor
// its position in the list is stable between two loads of the skill.
export function sampleDesignConcepts(
	count: number,
	random: () => number = Math.random
): DesignConcept[] {
	return shuffle( loadDesignConcepts(), random ).slice( 0, count );
}

export const CONCEPT_SHORTLIST_PLACEHOLDER = '{{concept-shortlist}}';
export const CONCEPT_CATALOG_PLACEHOLDER = '{{concept-catalog}}';
const CONCEPT_SHORTLIST_SIZE = 4;

function renderConcepts( concepts: DesignConcept[] ): string {
	return concepts.map( ( concept ) => `### ${ concept.name }\n${ concept.body }` ).join( '\n\n' );
}

// Skill bodies are static except for placeholders that are re-rendered on
// every load — the concept shortlist is a fresh random sample each time,
// and the catalog placeholder lists the entries the shortlist left out so a
// concept named in the brief still comes with its build notes.
export function renderSkillBody( skill: Skill ): string {
	if ( ! skill.body.includes( CONCEPT_SHORTLIST_PLACEHOLDER ) ) return skill.body;
	const shortlist = sampleDesignConcepts( CONCEPT_SHORTLIST_SIZE );
	const rest = loadDesignConcepts().filter( ( concept ) => ! shortlist.includes( concept ) );
	return skill.body
		.replace( CONCEPT_SHORTLIST_PLACEHOLDER, renderConcepts( shortlist ) )
		.replace( CONCEPT_CATALOG_PLACEHOLDER, renderConcepts( rest ) );
}
