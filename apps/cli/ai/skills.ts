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

export type DesignCatalogKind = 'concept' | 'direction';

export interface DesignEntry {
	name: string;
	body: string;
}

// Two catalogs feed the visual-design skill: layout concepts (the shape of
// the page) and artistic directions (palette, type, surfaces, motion). Each
// is a markdown file where every `## ` heading is one entry keeping its own
// body, and each has a placeholder in SKILL.md that is re-rendered as a
// fresh random pool on every load.
const DESIGN_CATALOGS: Record<
	DesignCatalogKind,
	{ file: string; placeholder: string; poolSize: number; label: string }
> = {
	concept: {
		file: 'concepts.md',
		placeholder: '{{concept-pool}}',
		poolSize: 8,
		label: 'layout concept',
	},
	direction: {
		file: 'directions.md',
		placeholder: '{{direction-pool}}',
		poolSize: 6,
		label: 'artistic direction',
	},
};

export const DESIGN_CATALOG_KINDS = Object.keys( DESIGN_CATALOGS ) as DesignCatalogKind[];
const MIN_DESIGN_CANDIDATES = 3;

const cachedCatalogs = new Map< DesignCatalogKind, DesignEntry[] >();

export function loadDesignCatalog( kind: DesignCatalogKind ): DesignEntry[] {
	const cached = cachedCatalogs.get( kind );
	if ( cached ) return cached;
	const catalogPath = getSkillPath( 'visual-design', DESIGN_CATALOGS[ kind ].file );
	const entries: DesignEntry[] = [];
	if ( fs.existsSync( catalogPath ) ) {
		for ( const section of fs.readFileSync( catalogPath, 'utf-8' ).split( /^(?=## )/m ) ) {
			const heading = section.match( /^## (.+)$/m );
			if ( ! heading ) continue;
			entries.push( {
				name: heading[ 1 ].trim(),
				body: section.slice( heading[ 0 ].length ).trim(),
			} );
		}
	}
	cachedCatalogs.set( kind, entries );
	return entries;
}

function shuffle< T >( items: T[], random: () => number ): T[] {
	const result = [ ...items ];
	for ( let i = result.length - 1; i > 0; i-- ) {
		const j = Math.floor( random() * ( i + 1 ) );
		[ result[ i ], result[ j ] ] = [ result[ j ], result[ i ] ];
	}
	return result;
}

// Picks `count` random entries in random order, so neither the pick nor
// its position in the list is stable between two loads of the skill.
export function sampleDesignCatalog(
	kind: DesignCatalogKind,
	count: number,
	random: () => number = Math.random
): DesignEntry[] {
	return shuffle( loadDesignCatalog( kind ), random ).slice( 0, count );
}

// Names sampled into each pool on the most recent visual-design load, so
// pick_design can insist the shortlists came from what the model was shown.
const currentPools = new Map< DesignCatalogKind, string[] >();

export function getCurrentDesignPool( kind: DesignCatalogKind ): string[] {
	return currentPools.get( kind ) ?? [];
}

// Skill bodies are static except for the pool placeholders, which are
// re-rendered as fresh random samples on every load.
export function renderSkillBody( skill: Skill ): string {
	let body = skill.body;
	for ( const kind of DESIGN_CATALOG_KINDS ) {
		const { placeholder, poolSize } = DESIGN_CATALOGS[ kind ];
		if ( ! body.includes( placeholder ) ) continue;
		const pool = sampleDesignCatalog( kind, poolSize );
		currentPools.set(
			kind,
			pool.map( ( entry ) => entry.name )
		);
		const names = loadDesignCatalog( kind ).map( ( entry ) => entry.name );
		const rendered =
			pool.map( ( entry ) => `### ${ entry.name }\n${ entry.body }` ).join( '\n\n' ) +
			`\n\nFull catalog (names only, for an entry the brief names by name): ${ names.join(
				', '
			) }.`;
		// A function replacer: entry bodies may contain `$` sequences that a
		// string replacement would expand.
		body = body.replace( placeholder, () => rendered );
	}
	return body;
}

function findDesignEntry( kind: DesignCatalogKind, name: string ): DesignEntry | undefined {
	const wanted = name.trim().toLowerCase();
	return loadDesignCatalog( kind ).find( ( entry ) => entry.name.toLowerCase() === wanted );
}

// The model shortlists; the code draws. An entry the user named in the
// brief bypasses the draw. Candidates must be distinct catalog entries from
// the pool the model was shown, and at least three of them, so the draw is
// real rather than a shortlist of one.
export function pickDesignEntry(
	kind: DesignCatalogKind,
	input: { candidates: string[]; namedInBrief?: string },
	random: () => number = Math.random
): { entry: DesignEntry; drawn: boolean } {
	const { label } = DESIGN_CATALOGS[ kind ];
	if ( input.namedInBrief ) {
		const entry = findDesignEntry( kind, input.namedInBrief );
		if ( ! entry ) {
			throw new Error(
				`"${
					input.namedInBrief
				}" is not a catalog ${ label }. If the brief asks for it, skip this draw: leave this side out of the call and design it from the brief. Catalog: ${ loadDesignCatalog(
					kind
				)
					.map( ( e ) => e.name )
					.join( ', ' ) }`
			);
		}
		return { entry, drawn: false };
	}
	const candidates = [ ...new Set( input.candidates.map( ( name ) => name.trim() ) ) ];
	const unknown = candidates.filter( ( name ) => ! findDesignEntry( kind, name ) );
	if ( unknown.length ) {
		throw new Error( `Not catalog ${ label }s: ${ unknown.join( ', ' ) }` );
	}
	const pool = getCurrentDesignPool( kind );
	const lowerPool = pool.map( ( name ) => name.toLowerCase() );
	const outsidePool = pool.length
		? candidates.filter( ( name ) => ! lowerPool.includes( name.toLowerCase() ) )
		: [];
	if ( outsidePool.length ) {
		throw new Error(
			`Not in this build's ${ label } pool: ${ outsidePool.join(
				', '
			) }. Shortlist from the pool shown in the visual-design skill: ${ pool.join( ', ' ) }`
		);
	}
	if ( candidates.length < MIN_DESIGN_CANDIDATES ) {
		throw new Error(
			`Shortlist at least ${ MIN_DESIGN_CANDIDATES } distinct ${ label }s that fit the site.`
		);
	}
	const entry = findDesignEntry( kind, candidates[ Math.floor( random() * candidates.length ) ] );
	return { entry: entry as DesignEntry, drawn: true };
}
