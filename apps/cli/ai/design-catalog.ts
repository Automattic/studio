import fs from 'fs';
import path from 'path';
import { getSkillPath } from 'cli/ai/skills';

export type DesignCatalogKind = 'concept' | 'direction';

export interface DesignEntry {
	name: string;
	description: string;
	details: string;
}

// One markdown file per entry: `title` and `description` in the frontmatter
// are shown to the agent when choosing; the body is only returned for drawn
// entries.
const DESIGN_CATALOGS: Record<
	DesignCatalogKind,
	{ folder: string; placeholder: string; label: string }
> = {
	concept: { folder: 'layouts', placeholder: '{{layout-index}}', label: 'layout concept' },
	direction: {
		folder: 'artistic-directions',
		placeholder: '{{direction-index}}',
		label: 'artistic direction',
	},
};

export const DESIGN_CATALOG_KINDS = Object.keys( DESIGN_CATALOGS ) as DesignCatalogKind[];
export const MAX_CHOSEN_DESIGN_PAIRS = 2;

const cachedCatalogs = new Map< DesignCatalogKind, DesignEntry[] >();

// Values are JSON strings so they can hold colons and quotes.
function readFrontmatterValue( frontmatter: string, key: string ): string | undefined {
	const raw = frontmatter.match( new RegExp( `^${ key }:\\s*(.+)$`, 'm' ) )?.[ 1 ]?.trim();
	if ( ! raw ) return undefined;
	if ( raw.startsWith( '"' ) ) {
		try {
			return String( JSON.parse( raw ) );
		} catch {
			return undefined;
		}
	}
	return raw;
}

export function parseDesignEntry( contents: string ): DesignEntry | null {
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	if ( ! match ) return null;
	const [ , frontmatter, body ] = match;
	const name = readFrontmatterValue( frontmatter, 'title' );
	const description = readFrontmatterValue( frontmatter, 'description' );
	const details = body.trim();
	if ( ! name || ! description || ! details ) return null;
	return { name, description, details };
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

export interface DesignPairRequest {
	chosen?: Array< { layout: string; direction: string } >;
	avoid?: { layouts?: string[]; directions?: string[] };
	layoutNamedInBrief?: string;
	directionNamedInBrief?: string;
	count: number;
	onlyChosen?: boolean;
}

export interface DesignPair {
	layout: DesignEntry;
	direction: DesignEntry;
}

export interface DesignDraw {
	pairs: DesignPair[];
	fixed: Partial< Record< DesignCatalogKind, DesignEntry > >;
	ignored: string[];
}

function resolveNamedInBrief( kind: DesignCatalogKind, name: string ): DesignEntry {
	const entry = findDesignEntry( kind, name );
	if ( ! entry ) {
		const { label } = DESIGN_CATALOGS[ kind ];
		throw new Error(
			`"${ name }" is not a catalog ${ label }. If the brief asks for it, skip this draw: leave this side out of the call and design it from the brief. Catalog: ${ loadDesignCatalog(
				kind
			)
				.map( ( e ) => e.name )
				.join( ', ' ) }`
		);
	}
	return entry;
}

export function drawDesignPairs(
	request: DesignPairRequest,
	random: () => number = Math.random
): DesignDraw {
	const fixed: DesignDraw[ 'fixed' ] = {};
	if ( request.layoutNamedInBrief ) {
		fixed.concept = resolveNamedInBrief( 'concept', request.layoutNamedInBrief );
	}
	if ( request.directionNamedInBrief ) {
		fixed.direction = resolveNamedInBrief( 'direction', request.directionNamedInBrief );
	}
	const count = Math.max( 1, Math.floor( request.count ) );
	const ignored: string[] = [];
	const used: Record< DesignCatalogKind, Set< string > > = {
		concept: new Set(),
		direction: new Set(),
	};
	const pairs: DesignPair[] = [];

	for ( const choice of ( request.chosen ?? [] ).slice( 0, MAX_CHOSEN_DESIGN_PAIRS ) ) {
		if ( pairs.length >= count ) break;
		const layout = fixed.concept ?? findDesignEntry( 'concept', choice.layout );
		const direction = fixed.direction ?? findDesignEntry( 'direction', choice.direction );
		if ( ! layout ) ignored.push( choice.layout );
		if ( ! direction ) ignored.push( choice.direction );
		if ( ! layout || ! direction ) continue;
		if ( ! fixed.concept && used.concept.has( layout.name ) ) continue;
		if ( ! fixed.direction && used.direction.has( direction.name ) ) continue;
		used.concept.add( layout.name );
		used.direction.add( direction.name );
		pairs.push( { layout, direction } );
	}

	const avoided = ( kind: DesignCatalogKind ) =>
		new Set(
			( kind === 'concept' ? request.avoid?.layouts : request.avoid?.directions )?.map( ( n ) =>
				n.trim().toLowerCase()
			) ?? []
		);
	const drawSide = ( kind: DesignCatalogKind ): DesignEntry => {
		const fixedEntry = fixed[ kind ];
		if ( fixedEntry ) return fixedEntry;
		const skip = avoided( kind );
		let candidates = loadDesignCatalog( kind ).filter(
			( entry ) => ! used[ kind ].has( entry.name ) && ! skip.has( entry.name.toLowerCase() )
		);
		if ( ! candidates.length ) {
			candidates = loadDesignCatalog( kind ).filter(
				( entry ) => ! used[ kind ].has( entry.name )
			);
		}
		if ( ! candidates.length ) {
			throw new Error( `Not enough ${ DESIGN_CATALOGS[ kind ].label }s to draw from.` );
		}
		const entry = candidates[ Math.floor( random() * candidates.length ) ];
		used[ kind ].add( entry.name );
		return entry;
	};
	if ( request.onlyChosen ) {
		if ( ! pairs.length ) {
			throw new Error(
				`None of the chosen pairs are catalog entries${
					ignored.length ? ` (${ ignored.join( ', ' ) })` : ''
				}. Pass catalog names verbatim.`
			);
		}
		return { pairs, fixed, ignored };
	}
	while ( pairs.length < count ) {
		pairs.push( { layout: drawSide( 'concept' ), direction: drawSide( 'direction' ) } );
	}

	return { pairs: count > 1 ? shuffle( pairs, random ) : pairs, fixed, ignored };
}
