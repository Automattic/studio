import path from 'path';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import fs from 'fs-extra';
import semver from 'semver';
import { updateLatestWPCliVersion } from 'src/lib/download-utils';
import {
	getAgentSkillsPath,
	getLanguagePacksPath,
	getPhpMyAdminPath,
	getWordPressVersionPath,
	getSqlitePath,
	getWpCliPath,
} from 'src/lib/server-files-paths';
import {
	getSqliteCommandPath,
	updateLatestSQLiteCommandVersion,
} from 'src/lib/sqlite-command-versions';
import { getSqliteVersionFromInstallation } from 'src/lib/sqlite-versions';
import {
	getWordPressVersionFromInstallation,
	updateLatestWordPressVersion,
} from 'src/lib/wp-versions';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { getWpFilesPath } from 'src/storage/paths';

// SQLite integration folder name
const SQLITE_FILENAME = 'sqlite-database-integration';

// Tries to copy the app's bundled WordPress version to server files if needed
async function copyBundledLatestWPVersion() {
	const bundledWPVersionPath = path.join( getWpFilesPath(), 'latest', 'wordpress' );
	const bundledWPVersion = semver.coerce(
		await getWordPressVersionFromInstallation( bundledWPVersionPath )
	);
	if ( ! bundledWPVersion ) {
		return;
	}
	const latestWPVersionPath = getWordPressVersionPath( 'latest' );
	const latestWPVersion = await getWordPressVersionFromInstallation( latestWPVersionPath );
	const latestWPSemVersion = semver.coerce( latestWPVersion );
	const isBundledVersionNewer =
		latestWPVersion && latestWPSemVersion && semver.gt( bundledWPVersion, latestWPSemVersion );
	if ( ! latestWPVersion || isBundledVersionNewer ) {
		if ( isBundledVersionNewer ) {
			// We keep a copy of the latest installed version instead of removing it.
			await fs.move( latestWPVersionPath, getWordPressVersionPath( latestWPVersion ), {
				overwrite: true,
			} );
		}
		console.log( `Copying bundled WP version ${ bundledWPVersion } as 'latest' version…` );
		await recursiveCopyDirectory( bundledWPVersionPath, latestWPVersionPath );
	}
}

async function copyBundledSqlite() {
	const bundledSqlitePath = path.join( getWpFilesPath(), SQLITE_FILENAME );
	const bundledSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( bundledSqlitePath ),
		{
			includePrerelease: true,
		}
	);
	if ( ! bundledSqliteVersion ) {
		return;
	}
	const installedSqlitePath = getSqlitePath();
	const isSqliteInstalled = await fs.pathExists( installedSqlitePath );
	const installedSqliteVersion = semver.coerce(
		await getSqliteVersionFromInstallation( installedSqlitePath ),
		{
			includePrerelease: true,
		}
	);
	const isBundledVersionNewer =
		installedSqliteVersion && semver.gt( bundledSqliteVersion, installedSqliteVersion );
	if ( ! isSqliteInstalled || isBundledVersionNewer ) {
		console.log( `Copying bundled SQLite version ${ bundledSqliteVersion }…` );
		await recursiveCopyDirectory( bundledSqlitePath, getSqlitePath() );
	}
}

async function copyBundledWPCLI() {
	const bundledWPCLIInstalled = await fs.pathExists( getWpCliPath() );
	if ( bundledWPCLIInstalled ) {
		return;
	}
	const bundledWPCLIPath = path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
	await fs.copyFile( bundledWPCLIPath, getWpCliPath() );
}

async function copyBundledSQLiteCommand() {
	const bundledSqliteCommandPath = path.join( getWpFilesPath(), 'sqlite-command' );
	if ( ! ( await fs.pathExists( bundledSqliteCommandPath ) ) ) {
		return;
	}
	// Always copy to ensure files are complete and up-to-date
	await recursiveCopyDirectory( bundledSqliteCommandPath, getSqliteCommandPath() );
}

async function copyBundledTranslations() {
	const bundledTranslationsPath = path.join(
		getWpFilesPath(),
		'latest',
		'available-site-translations.json'
	);
	if ( ! ( await fs.pathExists( bundledTranslationsPath ) ) ) {
		return;
	}
	const installedTranslationsPath = path.join(
		getWordPressVersionPath( 'latest' ),
		'available-site-translations.json'
	);
	// Always copy the bundled translations file to ensure CLI has access to it
	await fs.copyFile( bundledTranslationsPath, installedTranslationsPath );
}

async function copyBundledAgentSkills() {
	const bundledAgentSkillsPath = path.join( getWpFilesPath(), 'agent-skills' );
	if ( ! ( await fs.pathExists( bundledAgentSkillsPath ) ) ) {
		return;
	}
	await recursiveCopyDirectory( bundledAgentSkillsPath, getAgentSkillsPath() );
}

async function copyBundledPhpMyAdmin() {
	const bundledPath = path.join( getWpFilesPath(), 'phpmyadmin' );
	if ( ! ( await fs.pathExists( bundledPath ) ) ) {
		return;
	}
	// Always copy to ensure files are complete and up-to-date
	await recursiveCopyDirectory( bundledPath, getPhpMyAdminPath() );
}

async function copyBundledLanguagePacks() {
	const bundledLanguagePacksPath = path.join( getWpFilesPath(), 'latest', 'languages' );
	if ( ! ( await fs.pathExists( bundledLanguagePacksPath ) ) ) {
		return;
	}
	const installedLanguagePacksPath = getLanguagePacksPath();
	await fs.ensureDir( installedLanguagePacksPath );
	await recursiveCopyDirectory( bundledLanguagePacksPath, installedLanguagePacksPath );
}

export async function setupWPServerFiles() {
	const steps: Array< [ string, () => Promise< void > ] > = [
		[ 'WordPress version', copyBundledLatestWPVersion ],
		[ 'SQLite integration', copyBundledSqlite ],
		[ 'WP-CLI', copyBundledWPCLI ],
		[ 'SQLite command', copyBundledSQLiteCommand ],
		[ 'translations', copyBundledTranslations ],
		[ 'language packs', copyBundledLanguagePacks ],
		[ 'agent skills', copyBundledAgentSkills ],
		[ 'phpMyAdmin', copyBundledPhpMyAdmin ],
	];

	for ( const [ name, step ] of steps ) {
		try {
			await step();
		} catch ( error ) {
			console.error( `Failed to set up bundled ${ name }:`, error );
		}
	}
}

/**
 * Get WP-CLI version from installation by running wp-cli --version
 */
async function getWPCliVersionFromInstallation(): Promise< string > {
	return new Promise( ( resolve ) => {
		const [ emitter ] = executeCliCommand( [ 'wp', '--studio-no-path', '--version' ], {
			output: 'capture',
		} );

		emitter.on( 'success', ( { result } ) => {
			const stdout = result?.stdout || '';
			if ( stdout.startsWith( 'WP-CLI ' ) ) {
				const version = stdout.split( ' ' )[ 1 ];
				resolve( version ? `v${ version }` : '' );
			} else {
				resolve( '' );
			}
		} );

		emitter.on( 'failure', () => resolve( '' ) );
		emitter.on( 'error', () => resolve( '' ) );
	} );
}

export async function updateWPServerFiles() {
	await updateLatestWordPressVersion();
	await updateLatestWPCliVersion( getWPCliVersionFromInstallation );
	await updateLatestSQLiteCommandVersion();
}
