import fs from 'fs/promises';
import path from 'path';
import { loadUserData } from 'src/storage/user-data';

const DB_SETTINGS_BLOCK = `// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'database_name_here' );

/** Database username */
define( 'DB_USER', 'username_here' );

/** Database password */
define( 'DB_PASSWORD', 'password_here' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );
`;

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

export function hasDefaultDbBlock( content: string ): boolean {
	return content.includes( DB_SETTINGS_BLOCK );
}

export function removeDbConstants( content: string ): string {
	return content.replace( DB_SETTINGS_BLOCK, REPLACEMENT_COMMENT + '\n' );
}

export async function processSiteWpConfig( sitePath: string ): Promise< boolean > {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );

	try {
		const content = await fs.readFile( wpConfigPath, 'utf-8' );

		if ( ! hasDefaultDbBlock( content ) ) {
			return false;
		}

		const modifiedContent = removeDbConstants( content );

		await fs.writeFile( wpConfigPath, modifiedContent, 'utf-8' );

		console.log( `Removed default DB constants from: ${ sitePath }` );
		return true;
	} catch ( error ) {
		// Silently skip if file doesn't exist; log other errors
		if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
			console.error( `Failed to process wp-config.php for site at ${ sitePath }:`, error );
		}
		return false;
	}
}

export async function removeDefaultDbConstants(): Promise< void > {
	try {
		const userData = await loadUserData();
		const sites = userData.sites || [];

		const results = await Promise.all(
			sites.filter( ( site ) => site.path ).map( ( site ) => processSiteWpConfig( site.path ) )
		);

		const modifiedCount = results.filter( Boolean ).length;

		if ( modifiedCount > 0 ) {
			console.log(
				`Migration complete: Removed default DB constants from ${ modifiedCount } site(s).`
			);
		}
	} catch ( error ) {
		console.error( 'Failed to run removeDefaultDbConstants migration:', error );
	}
}
