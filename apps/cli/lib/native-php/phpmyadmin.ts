import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

function phpStringLiteral( value: string ): string {
	return `'${ value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
}

export function getNativePhpMyAdminWpEnvPath( config: Pick< ServerConfig, 'siteId' > ): string {
	const safeSiteId = config.siteId.replace( /[^a-zA-Z0-9._-]/g, '-' );
	return path.join( os.tmpdir(), 'studio-phpmyadmin-wp-env', safeSiteId, 'wp-env.php' );
}

export function getPhpMyAdminSessionPath( config: Pick< ServerConfig, 'siteId' > ): string {
	const safeSiteId = config.siteId.replace( /[^a-zA-Z0-9._-]/g, '-' );
	return path.join( os.tmpdir(), 'studio-phpmyadmin-sessions', safeSiteId );
}

export async function writeNativePhpMyAdminWpEnv( config: ServerConfig ): Promise< string > {
	const wpEnvPath = getNativePhpMyAdminWpEnvPath( config );
	const sqliteDriverPath = path.join(
		config.sitePath,
		'wp-content',
		'mu-plugins',
		'sqlite-database-integration',
		'wp-includes',
		'database',
		'load.php'
	);
	const sqliteDatabasePath = path.join( config.sitePath, 'wp-content', 'database', '.ht.sqlite' );
	const wpEnvPhp = `<?php return array (
  'db' => array (
    'type' => 'sqlite',
    'path' => ${ phpStringLiteral( sqliteDatabasePath ) },
    'driver_path' => ${ phpStringLiteral( sqliteDriverPath ) },
  ),
);
`;

	await fs.promises.mkdir( path.dirname( wpEnvPath ), { recursive: true } );
	await fs.promises.mkdir( getPhpMyAdminSessionPath( config ), { recursive: true } );
	await fs.promises.writeFile( wpEnvPath, wpEnvPhp );
	return wpEnvPath;
}
