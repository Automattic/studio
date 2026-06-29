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
	 * Whether to keep the existing wp-content/db.php instead of overwriting it with
	 * Studio's stock SQLite drop-in.
	 *
	 * A Studio site can only boot through a drop-in the local SQLite runtime understands,
	 * so we only keep a file we recognize as such:
	 *  - missing/unreadable → don't keep (recreate it so the site can connect)
	 *  - marked `@studio-keep` → keep (explicit opt-out)
	 *  - Studio's own stock drop-in → don't keep (refresh its path and version)
	 *  - a custom drop-in defining SQLITE_DB_DROPIN_VERSION → keep (e.g. markdown-database-integration)
	 *  - anything else, e.g. a plugin-owned db.php restored from a WordPress.com backup → don't keep (replace)
	 */
	async shouldKeepExistingDbDropin( sitePath: string ): Promise< boolean > {
		const dbPhpPath = path.join( sitePath, 'wp-content', 'db.php' );

		let content: string;
		try {
			content = await fs.promises.readFile( dbPhpPath, 'utf8' );
		} catch {
			return false;
		}

		if ( content.includes( '@studio-keep' ) ) {
			return true;
		}
		if ( content.includes( STOCK_DB_DROPIN_MARKER ) ) {
			return false;
		}
		return content.includes( 'SQLITE_DB_DROPIN_VERSION' );
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

		if ( ! ( await this.shouldKeepExistingDbDropin( sitePath ) ) ) {
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
		// SQLite setup is idempotent and every Studio site needs it, so always run it.
		// This restores a missing db.php drop-in (otherwise the site reports "Error
		// establishing a database connection") and keeps the bundled mu-plugin current,
		// while installSqliteIntegration() preserves custom SQLite-compatible drop-ins.
		await this.installSqliteIntegration( sitePath );
	}

	async isSqliteInstalled( sitePath: string ): Promise< boolean > {
		return (
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', this.getSqliteDirname() ) ) &&
			fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) )
		);
	}
}
