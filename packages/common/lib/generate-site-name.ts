import path from 'path';
import { __ } from '@wordpress/i18n';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';

function getDefaultSiteName(): string {
	return __( 'My WordPress Website' );
}

function getSiteNames(): string[] {
	return [
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
}

async function isNameAvailable(
	name: string,
	usedNames: string[],
	sitesDir: string
): Promise< boolean > {
	if ( usedNames.includes( name ) ) {
		return false;
	}
	const sitePath = path.join( sitesDir, sanitizeFolderName( name ) );
	try {
		if ( ! ( await pathExists( sitePath ) ) ) {
			return true;
		}
		return await isEmptyDir( sitePath );
	} catch {
		return true;
	}
}

/**
 * Generates a unique numbered name by iterating until an available name is found.
 * Example: "My WordPress site 2" if "My WordPress site" exists
 */
export async function generateNumberedName(
	baseName: string,
	usedNames: string[],
	sitesDir: string
): Promise< string > {
	if ( await isNameAvailable( baseName, usedNames, sitesDir ) ) {
		return baseName;
	}

	let number = 2;
	let candidateName = `${ baseName } ${ number }`;

	while ( ! ( await isNameAvailable( candidateName, usedNames, sitesDir ) ) ) {
		number++;
		candidateName = `${ baseName } ${ number }`;
	}

	return candidateName;
}

/**
 * Generates a random site name from a list of default names.
 * Falls back to numbered variants when all names are taken.
 */
export async function generateSiteName( usedNames: string[], sitesDir: string ): Promise< string > {
	if ( await isNameAvailable( getDefaultSiteName(), usedNames, sitesDir ) ) {
		return getDefaultSiteName();
	}

	const availableNames = [];
	for ( const name of getSiteNames() ) {
		if ( await isNameAvailable( name, usedNames, sitesDir ) ) {
			availableNames.push( name );
		}
	}

	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}

	return generateNumberedName( getDefaultSiteName(), usedNames, sitesDir );
}
