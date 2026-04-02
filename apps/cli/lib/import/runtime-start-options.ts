import fs from 'fs';
import path from 'path';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { LoggerError } from 'cli/logger';
import type { Blueprint } from '@wp-playground/blueprints';
import type { StartServerOptions } from 'cli/lib/wordpress-server-manager';

const SHELL_ARG_RE = ( flag: string ) =>
	new RegExp( `--${ flag }=(?:'([^']*)'|"([^"]*)"|([^\\s\\\\]+))`, 'g' );

function getShellFlagValues( content: string, flag: string ): string[] {
	return Array.from(
		content.matchAll( SHELL_ARG_RE( flag ) ),
		( match ) => match[ 1 ] ?? match[ 2 ] ?? match[ 3 ] ?? ''
	).filter( Boolean );
}

function parseMountSpec( mountSpec: string ): { hostPath: string; vfsPath: string } {
	const match = mountSpec.match( /^(.*):(\/.*)$/ );
	if ( ! match ) {
		throw new LoggerError( `Invalid runtime mount spec: ${ mountSpec }` );
	}

	return {
		hostPath: match[ 1 ],
		vfsPath: match[ 2 ],
	};
}

function filterExistingMounts(
	mounts: Array< { hostPath: string; vfsPath: string } >
): Array< { hostPath: string; vfsPath: string } > {
	return mounts.filter( ( mount ) => fs.existsSync( mount.hostPath ) );
}

export function normalizeImportedSqliteDatabasePath( sitePath: string ): string {
	const databaseDirectory = path.join( sitePath, 'wp-content', 'database' );
	const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );
	const sqlitePhpPath = path.join( databaseDirectory, '.ht.sqlite.php' );

	if ( ! fs.existsSync( sqlitePath ) && fs.existsSync( sqlitePhpPath ) ) {
		fs.renameSync( sqlitePhpPath, sqlitePath );
	}

	return sqlitePath;
}

export async function ensureImportedSiteSqliteReady( sitePath: string ): Promise< string > {
	const sqlitePath = normalizeImportedSqliteDatabasePath( sitePath );
	await keepSqliteIntegrationUpdated( sitePath );
	return sqlitePath;
}

export function loadRuntimeBlueprint( runtimeBlueprintPath: string ): Blueprint {
	if ( ! fs.existsSync( runtimeBlueprintPath ) ) {
		throw new LoggerError( `Runtime Blueprint not found: ${ runtimeBlueprintPath }` );
	}

	try {
		return JSON.parse( fs.readFileSync( runtimeBlueprintPath, 'utf-8' ) ) as Blueprint;
	} catch ( error ) {
		throw new LoggerError( `Failed to parse runtime Blueprint: ${ runtimeBlueprintPath }`, error );
	}
}

export function loadImportedRuntimeStartOptions(
	runtimeBlueprintPath: string
): StartServerOptions {
	const startOptions: StartServerOptions = {
		blueprint: loadRuntimeBlueprint( runtimeBlueprintPath ),
		blueprintUri: runtimeBlueprintPath,
	};

	const runtimeStartScriptPath = path.join( path.dirname( runtimeBlueprintPath ), 'start.sh' );
	if ( ! fs.existsSync( runtimeStartScriptPath ) ) {
		return startOptions;
	}

	const startScript = fs.readFileSync( runtimeStartScriptPath, 'utf-8' );
	const mountsBeforeInstall = filterExistingMounts(
		getShellFlagValues( startScript, 'mount-before-install' ).map( parseMountSpec )
	);
	const mounts = filterExistingMounts(
		getShellFlagValues( startScript, 'mount' ).map( parseMountSpec )
	);
	const wordpressInstallMode = getShellFlagValues( startScript, 'wordpress-install-mode' ).at(
		0
	) as StartServerOptions[ 'wordpressInstallMode' ];

	if ( mountsBeforeInstall.length > 0 ) {
		startOptions.mountsBeforeInstall = mountsBeforeInstall;
	}

	if ( mounts.length > 0 ) {
		startOptions.mounts = mounts;
	}

	if ( wordpressInstallMode ) {
		startOptions.wordpressInstallMode = wordpressInstallMode;
	}

	startOptions.useExactMountLayout = true;

	return startOptions;
}
