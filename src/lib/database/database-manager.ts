import Database from 'better-sqlite3';

export default class DatabaseManager {
	private static instance: DatabaseManager;
	private connections: Map<
		string,
		{
			database: Database.Database;
			path: string;
			lastAccessed: number;
		}
	> = new Map();
	private readonly MAX_CONNECTIONS = 5; // Limit number of open connections
	private readonly CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

	private constructor() {}

	static getInstance(): DatabaseManager {
		if ( ! DatabaseManager.instance ) {
			DatabaseManager.instance = new DatabaseManager();
		}
		return DatabaseManager.instance;
	}

	getConnection( databaseId: string, databasePath: string ): Database.Database {
		const existingConnection = this.connections.get( databaseId );

		// If connection exists and path matches, return it
		if ( existingConnection && existingConnection.path === databasePath ) {
			existingConnection.lastAccessed = Date.now();
			return existingConnection.database;
		}

		// If connection exists but path doesn't match, close it
		if ( existingConnection ) {
			existingConnection.database.close();
			this.connections.delete( databaseId );
		}

		// If we've reached max connections, close the oldest one
		if ( this.connections.size >= this.MAX_CONNECTIONS ) {
			this.closeOldestConnection();
		}

		// Create new connection
		const database = new Database( databasePath );
		database.pragma( 'journal_mode = WAL' );

		this.connections.set( databaseId, {
			database,
			path: databasePath,
			lastAccessed: Date.now(),
		} );

		return database;
	}

	private closeOldestConnection(): void {
		let oldestKey: string | null = null;
		let oldestTime = Infinity;

		for ( const [ key, value ] of this.connections.entries() ) {
			if ( value.lastAccessed < oldestTime ) {
				oldestTime = value.lastAccessed;
				oldestKey = key;
			}
		}

		if ( oldestKey ) {
			const connection = this.connections.get( oldestKey );
			if ( connection ) {
				connection.database.close();
			}
			this.connections.delete( oldestKey );
		}
	}

	closeConnection( databaseId: string ): void {
		const connection = this.connections.get( databaseId );
		if ( connection ) {
			connection.database.close();
			this.connections.delete( databaseId );
		}
	}

	closeAllConnections(): void {
		for ( const connection of this.connections.values() ) {
			connection.database.close();
		}
		this.connections.clear();
	}

	hasConnection( databaseId: string ): boolean {
		return this.connections.has( databaseId );
	}

	getConnectionPath( databaseId: string ): string | undefined {
		return this.connections.get( databaseId )?.path;
	}
}