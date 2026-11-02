/**
 * Trunk's design catalogs: artistic directions (a site's look) and layout
 * concepts (its page structure), one markdown file per entry. A new block
 * theme gets looks to choose from and a layout, drawn at random, so one site
 * differs from the next.
 */
export interface DesignEntry {
	name: string;
	description: string;
	details: string;
}

// The files' text, bundled with the code.
const files = {
	directions: import.meta.glob( './directions/*.md', {
		query: '?raw',
		import: 'default',
		eager: true,
	} ),
	layouts: import.meta.glob( './layouts/*.md', { query: '?raw', import: 'default', eager: true } ),
};

function parseEntry( contents: string ): DesignEntry | undefined {
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	// Each frontmatter value is a JSON string.
	const field = ( key: string ) => {
		const value = match?.[ 1 ].match( new RegExp( `^${ key }: (".*")$`, 'm' ) )?.[ 1 ];
		return value ? String( JSON.parse( value ) ) : undefined;
	};
	const [ title, description ] = [ field( 'title' ), field( 'description' ) ];
	// The body says what to build; its Avoid line, a list of what to leave out,
	// stays in the catalog.
	const details = match?.[ 2 ]
		.split( '\n' )
		.filter( ( line ) => ! /^(\*\*)?Avoid(\*\*)?:/.test( line ) )
		.join( '\n' )
		.trim();
	return title && description && details ? { name: title, description, details } : undefined;
}

export function designCatalog( kind: 'directions' | 'layouts' ): DesignEntry[] {
	return Object.entries( files[ kind ] )
		.filter( ( [ file ] ) => ! file.endsWith( '/README.md' ) )
		.sort( ( [ a ], [ b ] ) => a.localeCompare( b ) )
		.map( ( [ , contents ] ) => parseEntry( contents ) )
		.filter( ( entry ): entry is DesignEntry => !! entry );
}

// The looks a new theme gets to choose from.
export const LOOK_OPTIONS = 3;

/** Different looks to choose from and one layout, drawn at random. */
export function drawDesign( random: () => number = Math.random ) {
	const draw = ( kind: 'directions' | 'layouts', count: number ) => {
		const entries = designCatalog( kind );
		return Array.from(
			{ length: Math.min( count, entries.length ) },
			() => entries.splice( Math.floor( random() * entries.length ), 1 )[ 0 ]
		);
	};
	return { looks: draw( 'directions', LOOK_OPTIONS ), layout: draw( 'layouts', 1 )[ 0 ] };
}
