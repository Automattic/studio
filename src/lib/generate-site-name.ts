import { __ } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';

export { sanitizeFolderName } from 'common/lib/sanitize-folder-name';

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
