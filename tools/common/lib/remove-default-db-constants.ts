const DB_SETTINGS_BLOCK =
	normalizeLineEndings( `// ** Database settings - You can get this info from your web host ** //
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
` );

const REPLACEMENT_COMMENT = normalizeLineEndings( `/**
 * Database connection information is automatically provided.
 * There is no need to set or change the following database configuration
 * values:
 *   DB_HOST
 *   DB_NAME
 *   DB_USER
 *   DB_PASSWORD
 *   DB_CHARSET
 *   DB_COLLATE
 */` );

export function normalizeLineEndings( content: string ): string {
	return content.replace( /\n/g, '\r\n' );
}

export function hasDefaultDbBlock( content: string ): boolean {
	return content.includes( DB_SETTINGS_BLOCK );
}

export function removeDbConstants( content: string ): string {
	return content.replace( DB_SETTINGS_BLOCK, REPLACEMENT_COMMENT + '\n' );
}
