/**
 * GraphQL client for Local by Flywheel's API.
 *
 * Local exposes a GraphQL endpoint for programmatic site management.
 * Connection details are stored in `graphql-connection-info.json` within
 * Local's platform-specific data directory.
 */

/* eslint-disable no-console */

import fs from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalSite {
	id: string;
	name: string;
	domain: string;
	path: string;
	status: string;
	httpPort: number | null;
	url: string;
}

interface GraphQLConnectionInfo {
	port: number;
	authToken: string;
	url: string;
	subscriptionUrl?: string;
}

interface GraphQLResponse< T > {
	data?: T;
	errors?: Array< { message: string } >;
}

// ---------------------------------------------------------------------------
// Platform-specific paths
// ---------------------------------------------------------------------------

/** Returns the platform-specific Local data directory. */
export function getLocalDataDir(): string {
	if ( process.platform === 'darwin' ) {
		return path.join( os.homedir(), 'Library/Application Support/Local' );
	}
	if ( process.platform === 'win32' ) {
		const appdata = process.env.APPDATA || path.join( os.homedir(), 'AppData', 'Roaming' );
		// Local may use either "Local" or "Local by Flywheel" on Windows
		const primary = path.join( appdata, 'Local' );
		const fallback = path.join( appdata, 'Local by Flywheel' );
		if ( fs.existsSync( primary ) ) return primary;
		if ( fs.existsSync( fallback ) ) return fallback;
		return primary; // Default; will fail later with a clear message
	}
	// Linux (limited Local support)
	return path.join( os.homedir(), '.config', 'Local' );
}

/** Returns the default directory where Local creates sites. */
export function getLocalSitesDir(): string {
	return path.join( os.homedir(), 'Local Sites' );
}

// ---------------------------------------------------------------------------
// GraphQL client
// ---------------------------------------------------------------------------

export class LocalGraphQLClient {
	private url: string;
	private token: string;

	private constructor( url: string, token: string ) {
		this.url = url;
		this.token = token;
	}

	/**
	 * Connect to a running Local instance.
	 * Reads graphql-connection-info.json and verifies the API is responsive.
	 * Throws with a clear message if Local isn't running.
	 */
	static async connect(): Promise< LocalGraphQLClient > {
		const dataDir = getLocalDataDir();
		const connectionInfoPath = path.join( dataDir, 'graphql-connection-info.json' );

		if ( ! fs.existsSync( connectionInfoPath ) ) {
			throw new Error(
				`Local connection info not found at ${ connectionInfoPath }.\n` +
					'Please ensure Local is installed and running.'
			);
		}

		let connectionInfo: GraphQLConnectionInfo;
		try {
			connectionInfo = JSON.parse( fs.readFileSync( connectionInfoPath, 'utf-8' ) );
		} catch {
			throw new Error(
				`Failed to parse ${ connectionInfoPath }.\n` +
					'The file may be corrupted. Try restarting Local.'
			);
		}

		const client = new LocalGraphQLClient( connectionInfo.url, connectionInfo.authToken );

		// Verify the API is responsive
		try {
			await client.query< { sites: unknown[] } >( '{ sites { id } }' );
		} catch ( err ) {
			throw new Error(
				`Cannot connect to Local's GraphQL API at ${ connectionInfo.url }.\n` +
					`Is Local running? Error: ${ err }`
			);
		}

		return client;
	}

	/**
	 * Execute a GraphQL query/mutation.
	 */
	private async query< T >( query: string, variables?: Record< string, unknown > ): Promise< T > {
		const response = await fetch( this.url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ this.token }`,
			},
			body: JSON.stringify( { query, variables } ),
		} );

		if ( ! response.ok ) {
			throw new Error( `GraphQL request failed: HTTP ${ response.status }` );
		}

		const json = ( await response.json() ) as GraphQLResponse< T >;

		if ( json.errors?.length ) {
			throw new Error( `GraphQL error: ${ json.errors.map( ( e ) => e.message ).join( ', ' ) }` );
		}

		if ( ! json.data ) {
			throw new Error( 'GraphQL response missing data' );
		}

		return json.data;
	}

	/**
	 * Create a site. Returns when the job completes and the site is running.
	 *
	 * Local's `addSite` mutation returns a Job (async), not a Site directly.
	 * We poll the job until it completes, then query sites to find the new one.
	 */
	async createSite( options: {
		name: string;
		domain: string;
		path: string;
		wpAdminEmail?: string;
		wpAdminPassword?: string;
		wpAdminUsername?: string;
		phpVersion?: string;
	} ): Promise< LocalSite > {
		const {
			name,
			domain,
			path: sitePath,
			wpAdminEmail = 'admin@benchmark.local',
			wpAdminPassword = 'password',
			wpAdminUsername = 'admin',
			phpVersion = '8.2.0',
		} = options;

		// Create the site via addSite mutation
		const createResult = await this.query< { addSite: { id: string } } >(
			`mutation AddSite($input: AddSiteInput!) {
				addSite(input: $input) {
					id
				}
			}`,
			{
				input: {
					name,
					domain,
					path: sitePath,
					wpAdminEmail,
					wpAdminPassword,
					wpAdminUsername,
					phpVersion,
					database: 'mysql',
					environment: 'preferred',
					blueprint: null,
				},
			}
		);

		const jobId = createResult.addSite.id;

		// Poll the job until it completes
		await this.waitForJob( jobId, 300_000 ); // 5 minute timeout

		// Find the new site by name
		const site = await this.findSiteByName( name );
		if ( ! site ) {
			throw new Error( `Site "${ name }" was not found after creation job completed` );
		}

		// Wait for site to be running
		await this.waitForSiteStatus( site.id, 'running', 120_000 );

		// Re-fetch to get the port
		const runningSite = await this.getSite( site.id );
		if ( ! runningSite ) {
			throw new Error( `Site "${ name }" disappeared after starting` );
		}

		return runningSite;
	}

	/**
	 * Poll a job until it reaches 'successful' status.
	 */
	private async waitForJob( jobId: string, timeoutMs: number ): Promise< void > {
		const start = Date.now();
		const pollInterval = 2000;

		while ( Date.now() - start < timeoutMs ) {
			try {
				const result = await this.query< { job: { id: string; status: string; error?: string } } >(
					`query Job($id: ID!) {
						job(id: $id) {
							id
							status
							error
						}
					}`,
					{ id: jobId }
				);

				const job = result.job;
				if ( job.status === 'successful' ) {
					return;
				}
				if ( job.status === 'failed' ) {
					throw new Error( `Job failed: ${ job.error || 'unknown error' }` );
				}
			} catch ( err ) {
				if ( err instanceof Error && err.message.startsWith( 'Job failed' ) ) {
					throw err;
				}
				// GraphQL query itself might fail during setup; keep polling
			}

			await new Promise( ( resolve ) => setTimeout( resolve, pollInterval ) );
		}

		throw new Error( `Job ${ jobId } timed out after ${ timeoutMs / 1000 }s` );
	}

	/**
	 * Wait for a site to reach a specific status.
	 */
	private async waitForSiteStatus(
		siteId: string,
		targetStatus: string,
		timeoutMs: number
	): Promise< void > {
		const start = Date.now();
		const pollInterval = 2000;

		while ( Date.now() - start < timeoutMs ) {
			const site = await this.getSite( siteId );
			if ( site && site.status === targetStatus ) {
				return;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, pollInterval ) );
		}

		throw new Error(
			`Site ${ siteId } did not reach "${ targetStatus }" status within ${ timeoutMs / 1000 }s`
		);
	}

	/**
	 * Find a site by name.
	 */
	private async findSiteByName( name: string ): Promise< LocalSite | null > {
		const result = await this.query< {
			sites: Array< {
				id: string;
				name: string;
				domain: string;
				path: string;
				status: string;
				httpPort: number | null;
			} >;
		} >(
			`{
				sites {
					id
					name
					domain
					path
					status
					httpPort
				}
			}`
		);

		const site = result.sites.find( ( s ) => s.name === name );
		if ( ! site ) return null;

		return {
			...site,
			url: site.httpPort ? `http://localhost:${ site.httpPort }` : '',
		};
	}

	/**
	 * Get a site by ID.
	 */
	async getSite( id: string ): Promise< LocalSite | null > {
		const result = await this.query< {
			site: {
				id: string;
				name: string;
				domain: string;
				path: string;
				status: string;
				httpPort: number | null;
			} | null;
		} >(
			`query Site($id: ID!) {
				site(id: $id) {
					id
					name
					domain
					path
					status
					httpPort
				}
			}`,
			{ id }
		);

		const site = result.site;
		if ( ! site ) return null;

		return {
			...site,
			url: site.httpPort ? `http://localhost:${ site.httpPort }` : '',
		};
	}

	/**
	 * Stop a running site.
	 */
	async stopSite( id: string ): Promise< void > {
		await this.query(
			`mutation StopSite($id: ID!) {
				stopSite(id: $id) {
					id
					status
				}
			}`,
			{ id }
		);
	}

	/**
	 * Delete a site. Uses deleteSitesFromGroups since there's no single deleteSite mutation.
	 */
	async deleteSite( id: string ): Promise< void > {
		await this.query(
			`mutation DeleteSites($ids: [ID!]!) {
				deleteSitesFromGroups(ids: $ids)
			}`,
			{ ids: [ id ] }
		);
	}
}
