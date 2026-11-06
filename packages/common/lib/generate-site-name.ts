import path from 'path';
import { __ } from '@wordpress/i18n';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';

function getSiteNames(): string[] {
	return [
		__( 'Blue Note' ),
		__( 'Kind of Blue' ),
		__( 'Hello Dolly' ),
		__( 'Round Midnight' ),
		__( 'Blue in Green' ),
		__( 'Take Five' ),
		__( 'Giant Steps' ),
		__( 'Satin Doll' ),
		__( 'Mood Indigo' ),
		__( 'Swing Time' ),
		__( 'Blue Train' ),
		__( 'Cantaloupe Island' ),
		__( 'Maiden Voyage' ),
		__( 'Birdland' ),
		__( 'Green Dolphin Street' ),
		__( 'Cotton Tail' ),
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
 * Example: "Blue Note 2" if "Blue Note" exists
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
	const siteNames = getSiteNames();
	const availableNames = [];
	for ( const name of siteNames ) {
		if ( await isNameAvailable( name, usedNames, sitesDir ) ) {
			availableNames.push( name );
		}
	}

	if ( availableNames.length > 0 ) {
		return availableNames[ Math.floor( Math.random() * availableNames.length ) ];
	}

	return generateNumberedName( siteNames[ 0 ], usedNames, sitesDir );
}
