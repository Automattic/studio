import path from 'path';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { __ } from '@wordpress/i18n';

export const DEFAULT_SITE_NAME = __( 'My WordPress Website' );

export const SITE_NAMES = [
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
	if ( await isNameAvailable( DEFAULT_SITE_NAME, usedNames, sitesDir ) ) {
		return DEFAULT_SITE_NAME;
	}

	const availableNames = [];
	for ( const name of SITE_NAMES ) {
		if ( await isNameAvailable( name, usedNames, sitesDir ) ) {
			availableNames.push( name );
		}
	}

	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}

	return generateNumberedName( DEFAULT_SITE_NAME, usedNames, sitesDir );
}
