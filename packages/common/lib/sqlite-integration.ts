import fs from 'fs';
import path from 'path';

// Identifies a db.php that Studio generated from db.copy (see the auto-generated
// header in that template). Stock drop-ins are refreshed on every run; custom,
// SQLite-compatible drop-ins are preserved.
const STOCK_DB_DROPIN_MARKER = 'This file is auto-generated and copied from the sqlite plugin.';

// Abstract base class for SQLite integration across different contexts
export abstract class SqliteIntegrationProvider {
	abstract getSqliteDirname(): string;
	protected abstract getSqlitePluginSourcePath(): string;

	async isSqliteIntegrationAvailable(): Promise< boolean > {
		const sqliteSourcePath = this.getSqlitePluginSourcePath();
		const dbCopyPath = path.join( sqliteSourcePath, 'db.copy' );
		return fs.existsSync( sqliteSourcePath ) && fs.existsSync( dbCopyPath );
	}

	/**
	 * Whether Studio should (re)install the SQLite integration for this site.
	 *
	 * A user can run Studio against their own database server (e.g. MySQL) by removing
	 * the SQLite drop-in, database, and mu-plugin, then pointing wp-config.php at it
	 * (https://developer.wordpress.com/docs/developer-tools/studio/frequently-asked-questions/#use-studio-with-mysql-server).
	 * We must not reinstall SQLite over that. But a SQLite site whose db.php drop-in went
	 * missing still has its database/mu-plugin, and needs the drop-in restored.
	 *
	 * So: set up SQLite for a fresh site (no wp-config.php), or whenever any SQLite artifact
	 * is still present; skip only when wp-config.php exists and every SQLite artifact is gone.
	 */
	async needsSqliteSetup( sitePath: string ): Promise< boolean > {
		const wpContentPath = path.join( sitePath, 'wp-content' );
		if ( ! fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ) {
			return true;
		}
		return (
			fs.existsSync( path.join( wpContentPath, 'db.php' ) ) ||
			fs.existsSync( path.join( wpContentPath, 'database', '.ht.sqlite' ) ) ||
			fs.existsSync( path.join( wpContentPath, 'mu-plugins', this.getSqliteDirname() ) )
		);
	}

	/**
	 * Whether to overwrite the existing wp-content/db.php with Studio's stock SQLite
	 * drop-in instead of preserving it.
	 *
	 * A Studio site can only boot through a drop-in the local SQLite runtime understands,
	 * so a db.php is preserved only when it is a custom SQLite-compatible drop-in, identified
	 * by defining SQLITE_DB_DROPIN_VERSION (how the SQLite plugin recognizes it). Replace it
	 * in every other case:
	 *  - missing/unreadable → replace (recreate it so the site can connect)
	 *  - Studio's own stock drop-in → replace (refresh its path and version)
	 *  - a plugin-owned db.php restored from a WordPress.com backup, etc. → replace
	 *  - a custom drop-in defining SQLITE_DB_DROPIN_VERSION → keep (e.g. markdown-database-integration)
	 */
	async shouldReplaceDbDropin( sitePath: string ): Promise< boolean > {
		const dbPhpPath = path.join( sitePath, 'wp-content', 'db.php' );

		let content: string;
		try {
			content = await fs.promises.readFile( dbPhpPath, 'utf8' );
		} catch {
			return true;
		}

		if ( content.includes( STOCK_DB_DROPIN_MARKER ) ) {
			return true;
		}
		return ! content.includes( 'SQLITE_DB_DROPIN_VERSION' );
	}

	async getSqliteVersionFromInstallation( sqliteMuPluginPath: string ): Promise< string > {
		try {
			const versionFileContent = await fs.promises.readFile(
				path.join( sqliteMuPluginPath, 'load.php' ),
				'utf8'
			);
			const matches = versionFileContent.match( /\s\*\sVersion:\s*([0-9a-zA-Z.-]+)/ );
			return matches?.[ 1 ] || '';
		} catch ( err ) {
			return '';
		}
	}

	async installSqliteIntegration( sitePath: string ): Promise< void > {
		if ( ! ( await this.isSqliteIntegrationAvailable() ) ) {
			throw new Error( 'SQLite integration files not found.' );
		}

		const wpContentPath = path.join( sitePath, 'wp-content' );
		const databasePath = path.join( wpContentPath, 'database' );
		const sqliteSourcePath = this.getSqlitePluginSourcePath();
		const sqliteDirname = this.getSqliteDirname();

		await fs.promises.mkdir( databasePath, { recursive: true } );

		if ( await this.shouldReplaceDbDropin( sitePath ) ) {
			const dbCopyContent = await fs.promises.readFile(
				path.join( sqliteSourcePath, 'db.copy' ),
				'utf8'
			);
			const updatedContent = dbCopyContent.replace(
				"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				`realpath( __DIR__ . '/mu-plugins/${ sqliteDirname }' )`
			);
			await fs.promises.writeFile( path.join( wpContentPath, 'db.php' ), updatedContent );
		}

		const sqliteDestPath = path.join( wpContentPath, 'mu-plugins', sqliteDirname );
		await fs.promises.rm( sqliteDestPath, { recursive: true, force: true } );
		await fs.promises.cp( sqliteSourcePath, sqliteDestPath, {
			recursive: true,
			verbatimSymlinks: true,
		} );
	}

	async keepSqliteIntegrationUpdated( sitePath: string ): Promise< void > {
		if ( await this.needsSqliteSetup( sitePath ) ) {
			await this.installSqliteIntegration( sitePath );
		}
	}

	async isSqliteInstalled( sitePath: string ): Promise< boolean > {
		return (
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', this.getSqliteDirname() ) ) &&
			fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) )
		);
	}
}
