import fs from 'node:fs';
import path from 'node:path';
import { getDatabaseEngine } from 'cli/lib/database';
import {
	getSqliteIntegrationPath,
	needsSqliteIntegration,
} from 'cli/lib/database/sqlite-integration';
import { getFullyResolvedTmpDirPath } from './tmp-dir';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

// phpMyAdmin runs on the SQLite driver; a site on its own MySQL server isn't supported yet.
export function isPhpMyAdminSupported(
	site: Parameters< typeof getDatabaseEngine >[ 0 ] & {
		path: string;
		runtimeBlueprintPath?: string;
	}
) {
	return (
		getDatabaseEngine( site ) === 'sqlite' &&
		// Reprint sites wire SQLite through runtime.php instead of the regular drop-in.
		( Boolean( site.runtimeBlueprintPath ) || needsSqliteIntegration( site.path ) )
	);
}

function phpStringLiteral( value: string ): string {
	return `'${ value.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
}

export function getNativePhpMyAdminWpEnvPath( config: Pick< ServerConfig, 'siteId' > ): string {
	const safeSiteId = config.siteId.replace( /[^a-zA-Z0-9._-]/g, '-' );
	return path.join(
		getFullyResolvedTmpDirPath(),
		'studio-phpmyadmin-wp-env',
		safeSiteId,
		'wp-env.php'
	);
}

export function getPhpMyAdminSessionPath( config: Pick< ServerConfig, 'siteId' > ): string {
	const safeSiteId = config.siteId.replace( /[^a-zA-Z0-9._-]/g, '-' );
	return path.join( getFullyResolvedTmpDirPath(), 'studio-phpmyadmin-sessions', safeSiteId );
}

// The `db` entry of wp-env.php, which DbiMysqli.php reads. It supports SQLite only for now.
function describeDatabase( config: ServerConfig ): string[] {
	const { database } = config;
	if ( database.engine !== 'sqlite' ) {
		return [ `'type' => ${ phpStringLiteral( database.engine ) },` ];
	}
	const driverPath = path.join(
		getSqliteIntegrationPath( config.sitePath ),
		'wp-includes',
		'database',
		'load.php'
	);
	return [
		"'type' => 'sqlite',",
		`'path' => ${ phpStringLiteral( database.path ) },`,
		`'driver_path' => ${ phpStringLiteral( driverPath ) },`,
	];
}

export async function writeNativePhpMyAdminWpEnv( config: ServerConfig ): Promise< string > {
	const wpEnvPath = getNativePhpMyAdminWpEnvPath( config );
	const wpEnvPhp = `<?php return array (
  'db' => array (
    ${ describeDatabase( config ).join( '\n    ' ) }
  ),
);
`;

	await fs.promises.mkdir( path.dirname( wpEnvPath ), { recursive: true } );
	await fs.promises.mkdir( getPhpMyAdminSessionPath( config ), { recursive: true } );
	await fs.promises.writeFile( wpEnvPath, wpEnvPhp );
	return wpEnvPath;
}
