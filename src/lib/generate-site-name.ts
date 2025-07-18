import { __ } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';

export async function generateSiteName( usedSites: SiteDetails[] ): Promise< string > {
	const siteNames = [
		__( 'My Bold Website' ),
		__( 'My Bright Website' ),
		__( 'My Blissful Website' ),
		__( 'My Calm Website' ),
		__( 'My Cool Website' ),
		__( 'My Dreamy Website' ),
		__( 'My Elite Website' ),
		__( 'My Fresh Website' ),
		__( 'My Glowing Website' ),
		__( 'My Happy Website' ),
		__( 'My Joyful Website' ),
		__( 'My Noble Website' ),
		__( 'My Pure Website' ),
		__( 'My Peak Website' ),
		__( 'My Prime Website' ),
		__( 'My Serene Website' ),
		__( 'My Shiny Website' ),
		__( 'My Sparkly Website' ),
		__( 'My Swift Website' ),
		__( 'My True Website' ),
	];

	const defaultName = __( 'My WordPress Website' );

	const isPathUnique = async ( name: string ): Promise< boolean > => {
		const { isEmpty } = await getIpcApi().generateProposedSitePath( name );
		return isEmpty;
	};

	const isNameUnique = ( name: string ): boolean => {
		return ! usedSites.some( ( site ) => site.name === name );
	};

	if ( isNameUnique( defaultName ) && ( await isPathUnique( defaultName ) ) ) {
		return defaultName;
	}

	const availableNames = [];
	for ( const name of siteNames ) {
		if ( isNameUnique( name ) && ( await isPathUnique( name ) ) ) {
			availableNames.push( name );
		}
	}

	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}

	let siteNumber = 2;
	let candidateName = `${ defaultName } ${ siteNumber }`;

	while ( ! isNameUnique( candidateName ) || ! ( await isPathUnique( candidateName ) ) ) {
		siteNumber++;
		candidateName = `${ defaultName } ${ siteNumber }`;
	}

	return candidateName;
}

export const sanitizeFolderName = ( filename: string ) => {
	const LATIN = 'a-z';
	const CYRILLIC = 'а-яё';
	const ARABIC = '\\u0600-\\u06FF';
	const HEBREW = '\\u0590-\\u05FF';
	const CHINESE = '\\u4e00-\\u9fa5';
	const JAPANESE_HIRAGANA = '\\u3040-\\u309F';
	const JAPANESE_KATAKANA = '\\u30A0-\\u30FF';
	const KOREAN_HANGUL = '\\uAC00-\\uD7AF';
	const KOREAN_JAMO = '\\u1100-\\u11FF'; // Hangul syllables are decomposed to Jamo letters
	const NUMBERS = '0-9';
	const WHITELISTED_SYMBOLS = '_\\- '; // Allow underscore, hyphen, and space

	const ALLOWED_CHARS = new RegExp(
		`[^${ LATIN }${ NUMBERS }${ CYRILLIC }${ ARABIC }${ HEBREW }${ CHINESE }${ JAPANESE_HIRAGANA }${ JAPANESE_KATAKANA }${ KOREAN_HANGUL }${ KOREAN_JAMO }${ WHITELISTED_SYMBOLS }]`,
		'gi'
	);

	return String( filename )
		.replace( /ł/g, 'l' ) // Polish ł to l
		.replace( /Ł/g, 'L' ) // Polish Ł to L
		.normalize( 'NFKD' )
		.replace( /[\u0300-\u036f]/g, '' ) // Remove diacritics
		.toLowerCase()
		.replace( ALLOWED_CHARS, '' )
		.trim()
		.replace( /\s+/g, '-' ) // Replace spaces with hyphens
		.replace( /-+/g, '-' ); // Replace multiple hyphens with a single one
};
