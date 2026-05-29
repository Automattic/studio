import fs from 'fs';
import path from 'path';

// Abstract base class for SQLite integration across different contexts
export abstract class SqliteIntegrationProvider {
	abstract getSqliteDirname(): string;
	protected abstract getSqlitePluginSourcePath(): string;

	async isSqliteIntegrationAvailable(): Promise< boolean > {
		const sqliteSourcePath = this.getSqlitePluginSourcePath();
		const dbCopyPath = path.join( sqliteSourcePath, 'db.copy' );
		return fs.existsSync( sqliteSourcePath ) && fs.existsSync( dbCopyPath );
	}

	// Returns true if site has db.php or no wp-config.php
	async needsSqliteSetup( sitePath: string ): Promise< boolean > {
		const hasDbPhp = fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) );
		const hasWpConfig = fs.existsSync( path.join( sitePath, 'wp-config.php' ) );
		return hasDbPhp || ! hasWpConfig;
	}

	async shouldKeepExistingDbDropin( sitePath: string ): Promise< boolean > {
		const dbPhpPath = path.join( sitePath, 'wp-content', 'db.php' );
		if ( ! fs.existsSync( dbPhpPath ) ) {
			return false;
		}

		try {
			const content = await fs.promises.readFile( dbPhpPath, 'utf8' );
			return content.includes( '@studio-keep' );
		} catch {
			return false;
		}
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

	async keepSqliteIntegrationUpdated( sitePath: string ): Promise< boolean > {
		if ( await this.needsSqliteSetup( sitePath ) ) {
			await this.installSqliteIntegration( sitePath );
			return true;
		}
		return false;
	}

	async isSqliteInstalled( sitePath: string ): Promise< boolean > {
		return (
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', this.getSqliteDirname() ) ) &&
			fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) )
		);
	}
}
