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

export const CONCEPT_POOL_PLACEHOLDER = '{{concept-pool}}';
const CONCEPT_POOL_SIZE = 8;
const MIN_CONCEPT_CANDIDATES = 3;

// Names sampled into the pool on the most recent visual-design load, so
// pick_concept can insist the shortlist came from what the model was shown.
let currentConceptPool: string[] = [];

export function getCurrentConceptPool(): string[] {
	return currentConceptPool;
}

// Skill bodies are static except for the concept pool placeholder, which is
// re-rendered as a fresh random sample on every load.
export function renderSkillBody( skill: Skill ): string {
	if ( ! skill.body.includes( CONCEPT_POOL_PLACEHOLDER ) ) return skill.body;
	const pool = sampleDesignConcepts( CONCEPT_POOL_SIZE );
	currentConceptPool = pool.map( ( concept ) => concept.name );
	return skill.body.replace(
		CONCEPT_POOL_PLACEHOLDER,
		pool.map( ( concept ) => `### ${ concept.name }\n${ concept.body }` ).join( '\n\n' )
	);
}

function findConcept( name: string ): DesignConcept | undefined {
	const wanted = name.trim().toLowerCase();
	return loadDesignConcepts().find( ( concept ) => concept.name.toLowerCase() === wanted );
}

// The model shortlists; the code draws. A concept the user named in the
// brief bypasses the draw. Candidates must be distinct catalog entries from
// the pool the model was shown, and at least three of them, so the draw is
// real rather than a shortlist of one.
export function pickDesignConcept(
	input: { candidates: string[]; namedInBrief?: string },
	random: () => number = Math.random
): { concept: DesignConcept; drawn: boolean } {
	if ( input.namedInBrief ) {
		const concept = findConcept( input.namedInBrief );
		if ( ! concept ) {
			throw new Error(
				`"${ input.namedInBrief }" is not a catalog concept. Catalog: ${ loadDesignConcepts()
					.map( ( c ) => c.name )
					.join( ', ' ) }`
			);
		}
		return { concept, drawn: false };
	}
	const candidates = [ ...new Set( input.candidates.map( ( name ) => name.trim() ) ) ];
	const unknown = candidates.filter( ( name ) => ! findConcept( name ) );
	if ( unknown.length ) {
		throw new Error( `Not catalog concepts: ${ unknown.join( ', ' ) }` );
	}
	const pool = currentConceptPool.map( ( name ) => name.toLowerCase() );
	const outsidePool = pool.length
		? candidates.filter( ( name ) => ! pool.includes( name.toLowerCase() ) )
		: [];
	if ( outsidePool.length ) {
		throw new Error(
			`Not in this build's concept pool: ${ outsidePool.join(
				', '
			) }. Shortlist from the pool shown in the visual-design skill: ${ currentConceptPool.join(
				', '
			) }`
		);
	}
	if ( candidates.length < MIN_CONCEPT_CANDIDATES ) {
		throw new Error(
			`Shortlist at least ${ MIN_CONCEPT_CANDIDATES } distinct concepts that fit the site.`
		);
	}
	const concept = findConcept( candidates[ Math.floor( random() * candidates.length ) ] );
	return { concept: concept as DesignConcept, drawn: true };
}
