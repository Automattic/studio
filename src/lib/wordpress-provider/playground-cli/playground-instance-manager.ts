import { WordPressServerInstance, WordPressServerProcess } from '../types';

interface ManagedInstance {
	serverInstance: WordPressServerInstance;
	serverProcess: WordPressServerProcess;
	createdAt: number;
	lastAccessedAt: number;
	siteId: string;
	isSetupComplete: boolean;
}

export class PlaygroundInstanceManager {
	private static instance: PlaygroundInstanceManager;
	private instances = new Map< string, ManagedInstance >();
	private readonly DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds
	private cleanupInterval: NodeJS.Timeout | null = null;

	private constructor() {
		// Start cleanup interval
		this.startCleanupInterval();
	}

	static getInstance(): PlaygroundInstanceManager {
		if ( ! PlaygroundInstanceManager.instance ) {
			PlaygroundInstanceManager.instance = new PlaygroundInstanceManager();
		}
		return PlaygroundInstanceManager.instance;
	}

	/**
	 * Register a new running instance
	 */
	register(
		siteId: string,
		serverInstance: WordPressServerInstance,
		serverProcess: WordPressServerProcess,
		isSetupComplete = false
	): void {
		const now = Date.now();
		this.instances.set( siteId, {
			serverInstance,
			serverProcess,
			createdAt: now,
			lastAccessedAt: now,
			siteId,
			isSetupComplete,
		} );
		console.log( `Registered Playground instance for site ${ siteId }` );
	}

	/**
	 * Get an existing instance if available and not expired
	 */
	get( siteId: string ): { serverInstance: WordPressServerInstance; serverProcess: WordPressServerProcess } | null {
		const instance = this.instances.get( siteId );
		if ( ! instance ) {
			return null;
		}

		const now = Date.now();
		const age = now - instance.createdAt;

		// Check if instance has expired
		if ( age > this.DEFAULT_TTL ) {
			console.log( `Instance for site ${ siteId } has expired (age: ${ age }ms)` );
			this.remove( siteId );
			return null;
		}

		// Update last accessed time
		instance.lastAccessedAt = now;
		console.log( `Reusing existing Playground instance for site ${ siteId }` );
		
		return {
			serverInstance: instance.serverInstance,
			serverProcess: instance.serverProcess,
		};
	}

	/**
	 * Mark an instance as setup complete
	 */
	markSetupComplete( siteId: string ): void {
		const instance = this.instances.get( siteId );
		if ( instance ) {
			instance.isSetupComplete = true;
			console.log( `Marked site ${ siteId } setup as complete` );
		}
	}

	/**
	 * Check if an instance exists and is ready
	 */
	has( siteId: string ): boolean {
		const instance = this.instances.get( siteId );
		if ( ! instance ) {
			return false;
		}

		const age = Date.now() - instance.createdAt;
		return age <= this.DEFAULT_TTL;
	}

	/**
	 * Remove an instance from tracking without stopping it
	 * Used when transferring management to SiteServer
	 */
	untrack( siteId: string ): void {
		if ( this.instances.has( siteId ) ) {
			console.log( `Untracking Playground instance for site ${ siteId } (process remains running)` );
			this.instances.delete( siteId );
		}
	}

	/**
	 * Remove an instance and clean up its process
	 */
	async remove( siteId: string ): Promise< void > {
		const instance = this.instances.get( siteId );
		if ( instance ) {
			try {
				console.log( `Stopping Playground instance for site ${ siteId }` );
				await instance.serverProcess.stop();
			} catch ( error ) {
				console.error( `Error stopping instance for site ${ siteId }:`, error );
			}
			this.instances.delete( siteId );
		}
	}

	/**
	 * Clean up expired instances
	 */
	private async cleanupExpired(): Promise< void > {
		const now = Date.now();
		const expiredSites: string[] = [];

		for ( const [ siteId, instance ] of this.instances ) {
			const age = now - instance.createdAt;
			const idleTime = now - instance.lastAccessedAt;
			
			// Remove if expired or idle for too long
			if ( age > this.DEFAULT_TTL || idleTime > this.DEFAULT_TTL ) {
				expiredSites.push( siteId );
			}
		}

		for ( const siteId of expiredSites ) {
			await this.remove( siteId );
		}

		if ( expiredSites.length > 0 ) {
			console.log( `Cleaned up ${ expiredSites.length } expired Playground instances` );
		}
	}

	/**
	 * Start periodic cleanup of expired instances
	 */
	private startCleanupInterval(): void {
		// Run cleanup every 5 minutes
		this.cleanupInterval = setInterval( () => {
			this.cleanupExpired().catch( ( error ) => {
				console.error( 'Error during instance cleanup:', error );
			} );
		}, 5 * 60 * 1000 );
	}

	/**
	 * Stop the cleanup interval (for shutdown)
	 */
	stopCleanupInterval(): void {
		if ( this.cleanupInterval ) {
			clearInterval( this.cleanupInterval );
			this.cleanupInterval = null;
		}
	}

	/**
	 * Clean up all instances (for app shutdown)
	 */
	async cleanupAll(): Promise< void > {
		console.log( 'Cleaning up all Playground instances' );
		const cleanupPromises: Promise< void >[] = [];
		
		for ( const siteId of this.instances.keys() ) {
			cleanupPromises.push( this.remove( siteId ) );
		}
		
		await Promise.all( cleanupPromises );
		this.stopCleanupInterval();
	}

	/**
	 * Get statistics about managed instances
	 */
	getStats(): { total: number; setupComplete: number; expired: number } {
		const now = Date.now();
		let expired = 0;
		let setupComplete = 0;

		for ( const instance of this.instances.values() ) {
			if ( instance.isSetupComplete ) {
				setupComplete++;
			}
			if ( now - instance.createdAt > this.DEFAULT_TTL ) {
				expired++;
			}
		}

		return {
			total: this.instances.size,
			setupComplete,
			expired,
		};
	}
}