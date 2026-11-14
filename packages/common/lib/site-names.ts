import { __ } from '@wordpress/i18n';

type IsNameAvailable = ( name: string ) => boolean | Promise< boolean >;

function getSiteNames(): string[] {
	return [
		__( 'Blue Note' ),
		__( 'Kind of Blue' ),
		__( 'Hello Dolly' ),
		__( 'Round Midnight' ),
		__( 'Blue in Green' ),
		__( 'Take Five' ),
		__( 'Giant Steps' ),
		__( 'Mood Indigo' ),
		__( 'Swing Time' ),
		__( 'Blue Train' ),
		__( 'Maiden Voyage' ),
		__( 'Birdland' ),
		__( 'Green Dolphin Street' ),
		__( 'Cotton Tail' ),
	];
}

/**
 * The base name, or its first available numbered variant: "Blue Note 2" if
 * "Blue Note" is taken.
 */
export async function numberedSiteName(
	baseName: string,
	isAvailable: IsNameAvailable
): Promise< string > {
	if ( await isAvailable( baseName ) ) {
		return baseName;
	}
	let number = 2;
	while ( ! ( await isAvailable( `${ baseName } ${ number }` ) ) ) {
		number++;
	}
	return `${ baseName } ${ number }`;
}

/**
 * A random available name from the default names, falling back to numbered
 * variants when all of them are taken.
 */
export async function pickSiteName( isAvailable: IsNameAvailable ): Promise< string > {
	const siteNames = getSiteNames();
	const availableNames = [];
	for ( const name of siteNames ) {
		if ( await isAvailable( name ) ) {
			availableNames.push( name );
		}
	}
	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}
	return numberedSiteName( siteNames[ 0 ], isAvailable );
}
