import { EventEmitter } from 'events';
import { DOMParser } from '@xmldom/xmldom';
import { TELEX_DEFAULTS } from 'cli/lib/telex-constants';

/**
 * Artefact file
 */
export interface ArtefactFile {
	path: string; // Relative path (e.g., 'src/index.js' or 'build/index.js')
	content: string; // File contents
	description?: string; // Optional description
}

/**
 * Artefact data
 */
export interface Artefact {
	name: string; // Block display name
	slug: string; // Machine-readable slug
	type: string; // Always 'code-package'
	schemaVersion: string; // Schema version (e.g., '2')
	files: ArtefactFile[]; // All files in the block
}

/**
 * Block metadata from block.json
 */
export interface BlockMetadata {
	title?: string;
	name?: string;
	description?: string;
	category?: string;
	supports?: Record< string, unknown >;
}

/**
 * Telex AI generation result
 */
export interface TelexGenerateResult {
	artefact: string; // Full artefact XML
	epid: string; // Encoded project ID
	chatText: string; // AI explanation text
}

/**
 * Options for block generation
 */
export interface TelexGenerateOptions {
	onChunk?: ( text: string ) => void; // Called for each chat text chunk
	onArtefact?: () => void; // Called when artefact marker detected
	onArtefactChunk?: ( xml: string ) => void; // Called for each XML chunk
}

/**
 * Telex API client for AI-powered WordPress block generation.
 *
 * Uses WordPress.com OAuth tokens for authentication (no separate login needed).
 * Compatible with Studio CLI authentication.
 */
export class TelexClient extends EventEmitter {
	private apiUrl: string;
	private wpcomToken: string;

	/**
	 * Create a new Telex API client
	 *
	 * @param apiUrl - Base URL of Telex API (e.g., 'https://telex.automattic.ai/api')
	 * @param wpcomToken - WordPress.com OAuth access token
	 */
	constructor( apiUrl: string, wpcomToken: string ) {
		super();
		this.apiUrl = apiUrl.replace( /\/$/, '' ); // Remove trailing slash
		this.wpcomToken = wpcomToken;
	}

	/**
	 * Generate a WordPress block from a natural language prompt.
	 *
	 * Uses Claude AI to generate a complete block with all files (PHP, JS, CSS, etc.)
	 * Returns streaming response with real-time chat updates.
	 *
	 * @param prompt - Natural language description of the block to generate
	 * @param options - Optional callbacks for streaming updates
	 * @returns Promise<TelexGenerateResult> - Generated artefact and metadata
	 */
	async generateBlock(
		prompt: string,
		options: TelexGenerateOptions = {}
	): Promise< TelexGenerateResult > {
		const response = await fetch( `${ this.apiUrl }/assistant`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ this.wpcomToken }`,
			},
			body: JSON.stringify( {
				prompt,
				mode: 'chat',
				stream: true,
				// Note: No euid/epid needed - Bearer token provides identity
			} ),
		} );

		if ( ! response.ok ) {
			const errorText = await response.text();
			throw new Error(
				`Telex API error (${ response.status }): ${ errorText.slice( 0, 200 ) }`
			);
		}

		// Parse Server-Sent Events (SSE) stream
		return this.parseStreamResponse( response, options );
	}

	/**
	 * Update an existing block with additional instructions.
	 *
	 * @param epid - Encoded project ID of existing block
	 * @param prompt - Instructions for updating the block
	 * @param options - Optional callbacks for streaming updates
	 * @returns Promise<TelexGenerateResult> - Updated artefact and metadata
	 */
	async updateBlock(
		epid: string,
		prompt: string,
		options: TelexGenerateOptions = {}
	): Promise< TelexGenerateResult > {
		const response = await fetch( `${ this.apiUrl }/assistant`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ this.wpcomToken }`,
			},
			body: JSON.stringify( {
				prompt,
				mode: 'chat',
				stream: true,
				epid, // Provide existing project ID
			} ),
		} );

		if ( ! response.ok ) {
			const errorText = await response.text();
			throw new Error(
				`Telex API error (${ response.status }): ${ errorText.slice( 0, 200 ) }`
			);
		}

		return this.parseStreamResponse( response, options );
	}

	/**
	 * Parse SSE stream response from Telex API
	 */
	private async parseStreamResponse(
		response: Response,
		options: TelexGenerateOptions
	): Promise< TelexGenerateResult > {
		const reader = response.body?.getReader();
		if ( ! reader ) {
			throw new Error( 'Response body is not readable' );
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let chatText = '';
		let artefactXml = '';
		let epid = '';
		let inArtefact = false;
		let error: string | null = null;
		let currentEvent = '';

		try {
			while ( true ) {
				const { done, value } = await reader.read();
				if ( done ) break;

				buffer += decoder.decode( value, { stream: true } );
				const lines = buffer.split( '\n' );
				buffer = lines.pop() || ''; // Keep incomplete line in buffer

				for ( const line of lines ) {
					// Track event type from "event:" lines
					if ( line.startsWith( 'event: ' ) ) {
						currentEvent = line.slice( 7 ).trim();
						continue;
					}

					if ( ! line.startsWith( 'data: ' ) ) continue;

					const data = line.slice( 6 ).trim();
					if ( data === '[DONE]' ) continue;


					try {
						const eventData = JSON.parse( data );

						switch ( currentEvent ) {
							case 'chunk':
								// Chat text streaming
								const chunkContent = eventData.content || '';
								chatText += chunkContent;
								options.onChunk?.( chunkContent );
								break;

							case 'new_artefact':
								// Artefact marker detected
							inArtefact = true;
								options.onArtefact?.();
								break;

							case 'artefact_content':
								// Artefact XML streaming
								const xmlContent = eventData.content || '';
							artefactXml += xmlContent;
								options.onArtefactChunk?.( xmlContent );
								break;

							case 'artefact_ready':
								// Generation complete
							epid = eventData.epid || '';
								break;

							case 'error':
								// Error occurred
								error = eventData.message || 'Unknown error';
								break;

							case 'retry':
								// Retry attempt (informational)
								break;

							case 'end':
								// End of stream
							break;
						}
					} catch ( e ) {
						// Ignore JSON parse errors for malformed events
						console.warn( 'Failed to parse SSE event:', data.slice( 0, 100 ) );
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		// Check for errors
		if ( error ) {
			throw new Error( `Telex generation failed: ${ error }` );
		}

		if ( ! artefactXml ) {
			throw new Error( 'No artefact generated - response incomplete' );
		}

		return {
			artefact: artefactXml,
			epid,
			chatText,
		};
	}

	/**
	 * Fetch an existing block's artefact by project ID.
	 * Fetches BUILT files (compiled JS/CSS) ready for WordPress installation.
	 * Polls for build completion if block is still building.
	 *
	 * @param projectId - Can be either encoded project ID (epid) or public ID
	 * @param maxRetries - Maximum number of polling attempts (default: 60, ~2 minutes)
	 * @param onRetry - Optional callback called on each polling retry
	 * @returns Promise<Artefact> - Parsed artefact data with built files
	 */
	async fetchBlock(
		projectId: string,
		maxRetries: number = TELEX_DEFAULTS.BUILD_MAX_RETRIES,
		onRetry?: ( attempt: number, maxRetries: number ) => void
	): Promise< Artefact > {
		const isEncodedId = projectId.startsWith( TELEX_DEFAULTS.ENCODED_ID_PREFIX );

		// 1. Wait for build to complete
		await this.waitForBuildCompletion( projectId, isEncodedId, maxRetries, onRetry );

		// 2. Fetch built and source files
		const builtFiles = await this.fetchBuiltFiles( projectId, isEncodedId );
		const sourceFiles = await this.fetchSourceFiles( projectId, isEncodedId );

		// 3. Combine all files
		const allFiles = [ ...builtFiles, ...sourceFiles ];

		// 4. Extract metadata and create artefact
		return this.createArtefact( allFiles );
	}

	/**
	 * Wait for build to complete by polling the build endpoint
	 *
	 * @param projectId - Project ID
	 * @param isEncodedId - Whether ID is encoded or public
	 * @param maxRetries - Maximum polling attempts
	 * @param onRetry - Optional callback called on each retry with attempt number
	 */
	private async waitForBuildCompletion(
		projectId: string,
		isEncodedId: boolean,
		maxRetries: number,
		onRetry?: ( attempt: number, maxRetries: number ) => void
	): Promise< void > {
		let retries = 0;

		while ( retries < maxRetries ) {
			const buildUrl = this.getBuildUrl( projectId, isEncodedId );
			const response = await fetch( buildUrl.toString(), {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${ this.wpcomToken }`,
				},
			} );

			// If 204, build is not ready - wait and retry
			if ( response.status === 204 ) {
				retries++;
				if ( retries >= maxRetries ) {
					throw new Error( 'Build timeout: Block is taking too long to build.' );
				}

				// Notify about retry
				onRetry?.( retries, maxRetries );

				await new Promise( ( resolve ) => setTimeout( resolve, TELEX_DEFAULTS.BUILD_POLL_INTERVAL_MS ) );
				continue;
			}

			// Check for errors
			if ( ! response.ok ) {
				const errorText = await response.text();
				throw new Error(
					`Telex API error (${ response.status }): ${ errorText.slice( 0, 200 ) }`
				);
			}

			// Build is ready
			break;
		}
	}

	/**
	 * Fetch built files (compiled JS/CSS) from build endpoint
	 *
	 * @param projectId - Project ID
	 * @param isEncodedId - Whether ID is encoded or public
	 * @returns Array of built files
	 */
	private async fetchBuiltFiles( projectId: string, isEncodedId: boolean ): Promise< ArtefactFile[] > {
		const buildUrl = this.getBuildUrl( projectId, isEncodedId );
		const response = await fetch( buildUrl.toString(), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${ this.wpcomToken }`,
			},
		} );

		if ( ! response.ok ) {
			return [];
		}

		const contentType = response.headers.get( 'Content-Type' );
		if ( ! contentType?.includes( 'application/xml' ) ) {
			return [];
		}

		const xmlText = await response.text();
		return this.parseBuiltFilesXml( xmlText );
	}

	/**
	 * Parse build XML to extract files
	 *
	 * @param xmlText - XML string with build files
	 * @returns Array of built files
	 */
	private parseBuiltFilesXml( xmlText: string ): ArtefactFile[] {
		const parser = new DOMParser();
		const doc = parser.parseFromString( xmlText, 'text/xml' );

		// Check for parse errors
		const parseError = doc.getElementsByTagName( 'parsererror' );
		if ( parseError.length > 0 ) {
			throw new Error( `XML parsing error: ${ parseError[ 0 ].textContent }` );
		}

		const files: ArtefactFile[] = [];
		const fileElements = doc.getElementsByTagName( 'file' );

		for ( let i = 0; i < fileElements.length; i++ ) {
			const fileEl = fileElements[ i ];
			const name = fileEl.getAttribute( 'name' );
			const content = fileEl.textContent || '';

			if ( name ) {
				files.push( {
					path: `build/${ name }`,
					content,
				} );
			}
		}

		return files;
	}

	/**
	 * Fetch source files (PHP, block.json, etc.) from artefact endpoint
	 *
	 * @param projectId - Project ID
	 * @param isEncodedId - Whether ID is encoded or public
	 * @returns Array of source files
	 */
	private async fetchSourceFiles( projectId: string, isEncodedId: boolean ): Promise< ArtefactFile[] > {
		const sourceUrl = this.getSourceUrl( projectId, isEncodedId );
		const response = await fetch( sourceUrl.toString(), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${ this.wpcomToken }`,
			},
		} );

		if ( ! response.ok ) {
			return [];
		}

		const sourceData = await response.json();
		if ( sourceData.files && Array.isArray( sourceData.files ) ) {
			return sourceData.files;
		}

		return [];
	}

	/**
	 * Create artefact object with metadata extracted from files
	 *
	 * @param files - All block files (built + source)
	 * @returns Complete artefact object
	 */
	private createArtefact( files: ArtefactFile[] ): Artefact {
		const blockJsonFile = files.find( ( f ) => f.path === 'src/block.json' );
		const packageJsonFile = files.find( ( f ) => f.path === 'package.json' );

		let name = 'Untitled Block';
		let slug = 'untitled-block';

		// Extract from package.json
		if ( packageJsonFile ) {
			try {
				const pkg = JSON.parse( packageJsonFile.content );
				name = pkg.name || name;
				slug = pkg.name || slug;
			} catch ( e ) {
				console.warn( 'Warning: Could not parse package.json:', e instanceof Error ? e.message : 'Unknown error' );
			}
		}

		// Extract from block.json (takes precedence)
		if ( blockJsonFile ) {
			try {
				const blockMeta = JSON.parse( blockJsonFile.content );
				if ( blockMeta.title ) {
					name = blockMeta.title;
				}
				if ( blockMeta.name ) {
					const parts = blockMeta.name.split( '/' );
					const lastPart = parts[ parts.length - 1 ];
					slug = lastPart.startsWith( 'block-' ) ? lastPart.substring( 6 ) : lastPart;
				}
			} catch ( e ) {
				console.warn( 'Warning: Could not parse block.json:', e instanceof Error ? e.message : 'Unknown error' );
			}
		}

		return {
			name,
			slug,
			type: 'code-package',
			schemaVersion: '2',
			files,
		};
	}

	/**
	 * Get build URL for a project
	 *
	 * @param projectId - Project ID
	 * @param isEncodedId - Whether ID is encoded or public
	 * @returns Build URL
	 */
	private getBuildUrl( projectId: string, isEncodedId: boolean ): URL {
		if ( isEncodedId ) {
			const url = new URL( `${ this.apiUrl }/artefact` );
			url.searchParams.set( 'epid', projectId );
			return url;
		} else {
			return new URL( `${ this.apiUrl }/project/${ projectId }/artefact` );
		}
	}

	/**
	 * Get source URL for a project
	 *
	 * @param projectId - Project ID
	 * @param isEncodedId - Whether ID is encoded or public
	 * @returns Source URL
	 */
	private getSourceUrl( projectId: string, isEncodedId: boolean ): URL {
		if ( isEncodedId ) {
			const url = new URL( `${ this.apiUrl }/artefact` );
			url.searchParams.set( 'epid', projectId );
			url.searchParams.set( 'mode', 'artefact' );
			return url;
		} else {
			const url = new URL( `${ this.apiUrl }/project/${ projectId }/artefact` );
			url.searchParams.set( 'mode', 'artefact' );
			return url;
		}
	}

	/**
	 * Get the full URL for a project in the Telex web UI
	 */
	getProjectUrl( epid: string ): string {
		const webUrl = this.apiUrl.replace( /\/api$/, '' );
		return `${ webUrl }/projects/${ epid }`;
	}
}
