import path from 'path';
import fs from 'fs-extra';

// Abstract base class for SQLite integration across different contexts
export abstract class SqliteIntegrationProvider {
	abstract getServerFilesPath(): string;
	abstract getSqliteDirname(): string;

	protected getSqlitePluginSourcePath(): string {
		return path.join( this.getServerFilesPath(), this.getSqliteDirname() );
	}

	async isSqliteIntegrationAvailable(): Promise< boolean > {
		const sqliteSourcePath = this.getSqlitePluginSourcePath();
		const dbCopyPath = path.join( sqliteSourcePath, 'db.copy' );
		return ( await fs.pathExists( sqliteSourcePath ) ) && ( await fs.pathExists( dbCopyPath ) );
	}

	async needsSqliteSetup( sitePath: string ): Promise< boolean > {
		const hasWpConfig = await fs.pathExists( path.join( sitePath, 'wp-config.php' ) );
		if ( ! hasWpConfig ) {
			return true;
		}
		const wpContentPath = path.join( sitePath, 'wp-content' );
		const hasSqlite = await Promise.all( [
			fs.pathExists( path.join( wpContentPath, 'db.php' ) ),
			fs.pathExists( path.join( wpContentPath, 'database', '.ht.sqlite' ) ),
			fs.pathExists( path.join( wpContentPath, 'mu-plugins', this.getSqliteDirname() ) ),
		] ).then( ( results ) => results.some( Boolean ) );
		return hasSqlite;
	}

	async getSqliteVersionFromInstallation( sqliteMuPluginPath: string ): Promise< string > {
		try {
			const versionFileContent = await fs.readFile(
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
			throw new Error( 'SQLite integration files not found. Please ensure Studio is installed.' );
		}

		const wpContentPath = path.join( sitePath, 'wp-content' );
		const databasePath = path.join( wpContentPath, 'database' );

		await fs.mkdir( databasePath, { recursive: true } );

		const sqliteSourcePath = this.getSqlitePluginSourcePath();
		const dbCopyContent = await fs.readFile( path.join( sqliteSourcePath, 'db.copy' ), 'utf8' );
		const sqliteDirname = this.getSqliteDirname();
		const updatedContent = dbCopyContent.replace(
			"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			`realpath( __DIR__ . '/mu-plugins/${ sqliteDirname }' )`
		);
		await fs.writeFile( path.join( wpContentPath, 'db.php' ), updatedContent );

		const sqliteDestPath = path.join( wpContentPath, 'mu-plugins', sqliteDirname );
		await fs.copy( sqliteSourcePath, sqliteDestPath );
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
