import { __ } from '@wordpress/i18n';
import { generateNumberedName } from 'common/lib/generate-numbered-name';
import { getIpcApi } from 'src/lib/get-ipc-api';

export { sanitizeFolderName } from 'common/lib/sanitize-folder-name';

async function isNameAvailable( name: string, usedSites: SiteDetails[] ): Promise< boolean > {
	const isNameUnique = ! usedSites.some( ( site ) => site.name === name );
	if ( ! isNameUnique ) {
		return false;
	}
	const { isEmpty } = await getIpcApi().generateProposedSitePath( name );
	return isEmpty;
}

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

	if ( await isNameAvailable( defaultName, usedSites ) ) {
		return defaultName;
	}

	const availableNames = [];
	for ( const name of siteNames ) {
		if ( await isNameAvailable( name, usedSites ) ) {
			availableNames.push( name );
		}
	}

	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}

	return generateNumberedName( defaultName, ( name ) => isNameAvailable( name, usedSites ) );
}
