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

type RuntimeConstantValue = string | number | boolean;
type BlueprintWithConstants = Blueprint & {
	constants?: Record< string, RuntimeConstantValue >;
};

function decodePhpScalarValue( rawValue: string ): RuntimeConstantValue | null {
	if ( rawValue === 'true' ) {
		return true;
	}

	if ( rawValue === 'false' ) {
		return false;
	}

	if ( /^-?\d+(?:\.\d+)?$/.test( rawValue ) ) {
		return Number( rawValue );
	}

	if ( rawValue.startsWith( "'" ) && rawValue.endsWith( "'" ) ) {
		return rawValue.slice( 1, -1 ).replace( /\\'/g, "'" ).replace( /\\\\/g, '\\' );
	}

	return null;
}

function parseRuntimePhpConstants( runtimePhp: string ): Record< string, RuntimeConstantValue > {
	const constants: Record< string, RuntimeConstantValue > = {};
	const defineRegex = /define\('([^']+)',\s*('(?:[^'\\]|\\.)*'|true|false|-?\d+(?:\.\d+)?)\s*\);/g;

	for ( const match of runtimePhp.matchAll( defineRegex ) ) {
		const value = decodePhpScalarValue( match[ 2 ] );
		if ( value === null ) {
			continue;
		}

		constants[ match[ 1 ] ] = value;
	}

	return constants;
}

function getMountedWordPressPathConstants(
	mountsBeforeInstall: Array< { hostPath: string; vfsPath: string } >,
	mounts: Array< { hostPath: string; vfsPath: string } >
): Record< string, string > {
	const allMounts = [ ...mountsBeforeInstall, ...mounts ];
	const wpContentMount = allMounts.find( ( mount ) => mount.vfsPath === '/wordpress/wp-content' );

	if ( ! wpContentMount ) {
		return {};
	}

	return {
		WP_CONTENT_DIR: '/wordpress/wp-content',
		WP_PLUGIN_DIR: '/wordpress/wp-content/plugins',
		WPMU_PLUGIN_DIR: '/wordpress/wp-content/mu-plugins',
	};
}

function mergeBlueprintConstants(
	blueprint: Blueprint,
	constants: Record< string, RuntimeConstantValue >
): Blueprint {
	if ( Object.keys( constants ).length === 0 ) {
		return blueprint;
	}

	const blueprintWithConstants = blueprint as BlueprintWithConstants;

	return {
		...blueprintWithConstants,
		constants: {
			...( blueprintWithConstants.constants ?? {} ),
			...constants,
		},
	};
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
	const runtimeDirectory = path.dirname( runtimeBlueprintPath );
	const runtimeStartScriptPath = path.join( runtimeDirectory, 'start.sh' );
	const runtimePhpPath = path.join( runtimeDirectory, 'runtime.php' );

	let blueprint = loadRuntimeBlueprint( runtimeBlueprintPath );
	const startOptions: StartServerOptions = {
		blueprint,
		blueprintUri: runtimeBlueprintPath,
	};

	if ( ! fs.existsSync( runtimeStartScriptPath ) ) {
		if ( fs.existsSync( runtimePhpPath ) ) {
			blueprint = mergeBlueprintConstants(
				blueprint,
				parseRuntimePhpConstants( fs.readFileSync( runtimePhpPath, 'utf-8' ) )
			);
			startOptions.blueprint = blueprint;
		}

		startOptions.skipSqliteSetup = true;
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

	const runtimeConstants = {
		...getMountedWordPressPathConstants( mountsBeforeInstall, mounts ),
		...( fs.existsSync( runtimePhpPath )
			? parseRuntimePhpConstants( fs.readFileSync( runtimePhpPath, 'utf-8' ) )
			: {} ),
	};
	if ( Object.keys( runtimeConstants ).length > 0 ) {
		blueprint = mergeBlueprintConstants( blueprint, runtimeConstants );
		startOptions.blueprint = blueprint;
	}

	startOptions.skipSqliteSetup = true;
	startOptions.useExactMountLayout = true;

	return startOptions;
}
