import fs from 'fs/promises';
import path from 'path';
import { loadUserData } from 'src/storage/user-data';

const DEFAULT_DB_VALUES: Record< string, string > = {
	DB_NAME: 'database_name_here',
	DB_USER: 'username_here',
	DB_PASSWORD: 'password_here',
	DB_HOST: 'localhost',
};

const DB_CONSTANTS_TO_REMOVE = [
	'DB_NAME',
	'DB_USER',
	'DB_PASSWORD',
	'DB_HOST',
	'DB_CHARSET',
	'DB_COLLATE',
];

const REPLACEMENT_COMMENT = `/**
 * Database connection information is automatically provided.
 * There is no need to set or change the following database configuration
 * values:
 *   DB_HOST
 *   DB_NAME
 *   DB_USER
 *   DB_PASSWORD
 *   DB_CHARSET
 *   DB_COLLATE
 */`;

const MIGRATION_MARKER = 'Database connection information is automatically provided';

export function extractDbConstants( content: string ): Record< string, string > {
	const constants: Record< string, string > = {};

	for ( const constantName of DB_CONSTANTS_TO_REMOVE ) {
		const regex = new RegExp(
			`define\\s*\\(\\s*['"]${ constantName }['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)`,
			'i'
		);
		const match = content.match( regex );
		if ( match ) {
			constants[ constantName ] = match[ 1 ];
		}
	}

	return constants;
}

export function hasDefaultDbValues( constants: Record< string, string > ): boolean {
	for ( const [ key, defaultValue ] of Object.entries( DEFAULT_DB_VALUES ) ) {
		if ( constants[ key ] !== defaultValue ) {
			return false;
		}
	}
	return true;
}

export function removeDbConstants( content: string ): string {
	let result = content;
	let firstConstantIndex = -1;

	for ( const constantName of DB_CONSTANTS_TO_REMOVE ) {
		const defineRegex = new RegExp(
			`(?:^[ \\t]*\\/\\*[^/]*\\*\\/[ \\t]*\\n)?` +
				`^[ \\t]*define\\s*\\(\\s*['"]${ constantName }['"]\\s*,\\s*['"][^'"]*['"]\\s*\\)\\s*;[ \\t]*(?:\\/\\/[^\\n]*)?\\n?`,
			'gim'
		);

		const match = defineRegex.exec( result );
		if ( match && ( firstConstantIndex === -1 || match.index < firstConstantIndex ) ) {
			firstConstantIndex = match.index;
		}

		result = result.replace( defineRegex, '' );
	}

	const dbSettingsHeaderRegex =
		/^[ \t]*\/\/[ \t]*\*\*[ \t]*Database settings[^\n]*\n(?:[ \t]*\/\/[^\n]*\n)*/gim;
	result = result.replace( dbSettingsHeaderRegex, '' );

	const dbSettingsBlockCommentRegex = /\/\*\*?\s*\n?\s*\*?\s*Database settings[^*]*\*\//gi;
	result = result.replace( dbSettingsBlockCommentRegex, '' );

	result = result.replace( /\n{4,}/g, '\n\n\n' );

	const phpOpenMatch = result.match( /<\?php\s*\n/ );
	if ( phpOpenMatch ) {
		const insertPosition = ( phpOpenMatch.index ?? 0 ) + phpOpenMatch[ 0 ].length;

		let actualInsertPosition = insertPosition;
		const afterPhpOpen = result.slice( insertPosition );
		const initialCommentMatch = afterPhpOpen.match( /^(\/\*[\s\S]*?\*\/\s*\n?)/ );
		if ( initialCommentMatch ) {
			actualInsertPosition = insertPosition + initialCommentMatch[ 0 ].length;
		}

		result =
			result.slice( 0, actualInsertPosition ) +
			'\n' +
			REPLACEMENT_COMMENT +
			'\n\n' +
			result.slice( actualInsertPosition ).replace( /^\n+/, '' );
	}

	return result;
}

export function isAlreadyMigrated( content: string ): boolean {
	return content.includes( MIGRATION_MARKER );
}

export async function processSiteWpConfig( sitePath: string ): Promise< boolean > {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );

	try {
		await fs.access( wpConfigPath );
	} catch {
		return false;
	}

	try {
		const content = await fs.readFile( wpConfigPath, 'utf-8' );

		if ( isAlreadyMigrated( content ) ) {
			return false;
		}

		const constants = extractDbConstants( content );

		if ( ! hasDefaultDbValues( constants ) ) {
			return false;
		}

		const modifiedContent = removeDbConstants( content );

		await fs.writeFile( wpConfigPath, modifiedContent, 'utf-8' );

		console.log( `Removed default DB constants from: ${ sitePath }` );
		return true;
	} catch ( error ) {
		console.error( `Failed to process wp-config.php for site at ${ sitePath }:`, error );
		return false;
	}
}

export async function removeDefaultDbConstants(): Promise< void > {
	try {
		const userData = await loadUserData();
		const sites = userData.sites || [];

		let modifiedCount = 0;
		for ( const site of sites ) {
			if ( ! site.path ) {
				continue;
			}
			const wasModified = await processSiteWpConfig( site.path );
			if ( wasModified ) {
				modifiedCount++;
			}
		}

		if ( modifiedCount > 0 ) {
			console.log(
				`Migration complete: Removed default DB constants from ${ modifiedCount } site(s).`
			);
		}
	} catch ( error ) {
		console.error( 'Failed to run removeDefaultDbConstants migration:', error );
	}
}
