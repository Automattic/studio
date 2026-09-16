import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { getSkillPath } from 'cli/ai/skills';

export type DesignCatalogKind = 'directions' | 'layouts';

export interface DesignEntry {
	name: string;
	description: string;
	details: string;
}

// One markdown file per entry: `title` and `description` in the frontmatter
// are shown to the agent when choosing; the body is only returned for drawn
// entries.
export const DESIGN_CATALOGS: Record<
	DesignCatalogKind,
	{ folder: string; placeholder: string; label: string }
> = {
	directions: {
		folder: 'artistic-directions',
		placeholder: '{{direction-index}}',
		label: 'Artistic direction',
	},
	layouts: { folder: 'layouts', placeholder: '{{layout-index}}', label: 'Layout concept' },
};

export const DESIGN_CATALOG_KINDS = Object.keys( DESIGN_CATALOGS ) as DesignCatalogKind[];
export const DESIGN_OPTIONS = 4;
export const MAX_CHOSEN_LAYOUTS = 2;

const cachedCatalogs = new Map< DesignCatalogKind, DesignEntry[] >();

function parseDesignEntry( contents: string ): DesignEntry | null {
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	if ( ! match ) return null;
	const { title, description } = parse( match[ 1 ] ) ?? {};
	const details = match[ 2 ].trim();
	if ( ! title || ! description || ! details ) return null;
	return { name: String( title ), description: String( description ), details };
}

export function loadDesignCatalog( kind: DesignCatalogKind ): DesignEntry[] {
	const cached = cachedCatalogs.get( kind );
	if ( cached ) return cached;
	const folder = getSkillPath( 'visual-design', DESIGN_CATALOGS[ kind ].folder );
	const entries: DesignEntry[] = [];
	if ( fs.existsSync( folder ) ) {
		for ( const file of fs.readdirSync( folder ).sort() ) {
			if ( ! file.endsWith( '.md' ) || file === 'README.md' ) continue;
			const entry = parseDesignEntry( fs.readFileSync( path.join( folder, file ), 'utf-8' ) );
			if ( entry ) entries.push( entry );
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

export function renderDesignCatalogIndex( body: string ): string {
	for ( const kind of DESIGN_CATALOG_KINDS ) {
		const { placeholder } = DESIGN_CATALOGS[ kind ];
		if ( ! body.includes( placeholder ) ) continue;
		const rendered = loadDesignCatalog( kind )
			.map( ( entry ) => `- **${ entry.name }** — ${ entry.description }` )
			.join( '\n' );
		// A function replacer: descriptions may contain `$` sequences that a
		// string replacement would expand.
		body = body.replace( placeholder, () => rendered );
	}
	return body;
}

export function findDesignEntry( kind: DesignCatalogKind, name: string ): DesignEntry | undefined {
	const wanted = name.trim().toLowerCase();
	return loadDesignCatalog( kind ).find( ( entry ) => entry.name.toLowerCase() === wanted );
}

export interface DesignDrawRequest {
	kind: DesignCatalogKind;
	count: number;
	chosen?: string[];
	shown?: string[];
}

function findChosenEntry( kind: DesignCatalogKind, name: string ): DesignEntry {
	const entry = findDesignEntry( kind, name );
	if ( ! entry ) {
		throw new Error(
			`"${ name }" is not a catalog ${ DESIGN_CATALOGS[
				kind
			].label.toLowerCase() }. Pass catalog names verbatim; if the brief asks for something the catalog lacks, skip this draw and design it from the brief. Catalog: ${ loadDesignCatalog(
				kind
			)
				.map( ( e ) => e.name )
				.join( ', ' ) }`
		);
	}
	return entry;
}

export function drawDesignEntries(
	{ kind, count, chosen = [], shown = [] }: DesignDrawRequest,
	random: () => number = Math.random
): DesignEntry[] {
	const picked = [ ...new Set( chosen.map( ( name ) => findChosenEntry( kind, name ) ) ) ];
	const unseen = loadDesignCatalog( kind ).filter( ( entry ) => ! shown.includes( entry.name ) );
	const seen = picked.filter( ( entry ) => ! unseen.includes( entry ) );
	if ( seen.length ) {
		throw new Error(
			`Already shown to the user: ${ seen
				.map( ( entry ) => entry.name )
				.join( ', ' ) }. Choose others.`
		);
	}
	if ( kind === 'directions' ) {
		if ( picked.length < count ) {
			throw new Error(
				`Pass ${ count } in chosen, each with a reason: every artistic direction is yours to pick, none is drawn at random.`
			);
		}
		return picked.slice( 0, count );
	}
	const kept = picked.slice( 0, Math.min( count, MAX_CHOSEN_LAYOUTS ) );
	const drawn = shuffle(
		unseen.filter( ( entry ) => ! kept.includes( entry ) ),
		random
	);
	return shuffle( [ ...kept, ...drawn.slice( 0, count - kept.length ) ], random );
}
