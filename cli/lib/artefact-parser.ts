import { DOMParser } from '@xmldom/xmldom';

/**
 * Parsed artefact file
 */
export interface ArtefactFile {
	path: string; // Relative path (e.g., 'src/index.js')
	content: string; // File contents
	description?: string; // Optional description
}

/**
 * Parsed artefact data
 */
export interface Artefact {
	name: string; // Block display name (e.g., 'Confetti Button')
	slug: string; // Machine-readable slug (e.g., 'confetti-button')
	type: string; // Always 'code-package'
	schemaVersion: string; // Schema version (e.g., '2')
	files: ArtefactFile[]; // All files in the block
}

/**
 * Parse Telex artefact XML into structured data.
 *
 * Artefacts are XML files that contain all block files and metadata
 * as a single source of truth for WordPress Gutenberg blocks.
 *
 * Example:
 * ```xml
 * <artefact name="My Block" slug="my-block" type="code-package" schemaVersion="2">
 *   <file path="src/index.js">
 *     <description>Block registration</description>
 *     <content><![CDATA[...code...]]></content>
 *   </file>
 * </artefact>
 * ```
 *
 * @param xml - Artefact XML string
 * @returns Parsed artefact data
 * @throws Error if XML is invalid or malformed
 */
export function parseArtefactXml( xml: string ): Artefact {
	try {
		// Trim whitespace first
		xml = xml.trim();

		// Extract only the artefact XML (from <artefact> to </artefact>)
		// to ignore any trailing chat text or extra content
		const artefactStart = xml.indexOf( '<artefact' );
		const artefactEnd = xml.lastIndexOf( '</artefact>' );

		if ( artefactStart === -1 || artefactEnd === -1 ) {
			throw new Error( 'Missing <artefact> tags in XML' );
		}

		const cleanXml = xml.substring( artefactStart, artefactEnd + '</artefact>'.length ).trim();

		const parser = new DOMParser();
		const doc = parser.parseFromString( cleanXml, 'text/xml' );

		// Check for parser errors
		const parseError = doc.getElementsByTagName( 'parsererror' );
		if ( parseError.length > 0 ) {
			throw new Error( `XML parsing error: ${ parseError[ 0 ].textContent }` );
		}

		// Get root artefact element
		const artefactEl = doc.getElementsByTagName( 'artefact' )[ 0 ];
		if ( ! artefactEl ) {
			throw new Error( 'Missing <artefact> root element' );
		}

		// Extract attributes
		const name = artefactEl.getAttribute( 'name' );
		const slug = artefactEl.getAttribute( 'slug' );
		const type = artefactEl.getAttribute( 'type' );
		const schemaVersion = artefactEl.getAttribute( 'schemaVersion' );

		if ( ! name || ! slug ) {
			throw new Error( 'Missing required attributes: name and slug' );
		}

		// Parse all <file> elements
		const fileElements = artefactEl.getElementsByTagName( 'file' );
		const files: ArtefactFile[] = [];

		for ( let i = 0; i < fileElements.length; i++ ) {
			const fileEl = fileElements[ i ];
			const path = fileEl.getAttribute( 'path' );

			if ( ! path ) {
				console.warn( `File element ${ i } missing path attribute, skipping` );
				continue;
			}

			// Get description (optional)
			const descriptionEl = fileEl.getElementsByTagName( 'description' )[ 0 ];
			const description = descriptionEl?.textContent?.trim() || undefined;

			// Get content (required)
			const contentEl = fileEl.getElementsByTagName( 'content' )[ 0 ];
			const content = contentEl?.textContent || '';

			files.push( {
				path,
				content,
				description,
			} );
		}

		return {
			name,
			slug,
			type: type || 'code-package',
			schemaVersion: schemaVersion || '2',
			files,
		};
	} catch ( error ) {
		if ( error instanceof Error ) {
			throw new Error( `Failed to parse artefact XML: ${ error.message }` );
		}
		throw error;
	}
}

/**
 * Get a specific file from an artefact by path
 *
 * @param artefact - Parsed artefact
 * @param filePath - File path to search for
 * @returns File content or null if not found
 */
export function getArtefactFile(
	artefact: Artefact,
	filePath: string
): string | null {
	const file = artefact.files.find( ( f ) => f.path === filePath );
	return file?.content || null;
}

/**
 * Get the main plugin file path for an artefact
 *
 * @param artefact - Parsed artefact
 * @returns Main plugin file path (e.g., 'my-block.php')
 */
export function getMainPluginFile( artefact: Artefact ): string {
	return `${ artefact.slug }.php`;
}

/**
 * Extract block metadata from block.json file
 *
 * @param artefact - Parsed artefact
 * @returns Parsed block.json or null if not found/invalid
 */
export function getBlockMetadata( artefact: Artefact ): Record< string, unknown > | null {
	const blockJsonContent = getArtefactFile( artefact, 'src/block.json' );
	if ( ! blockJsonContent ) {
		return null;
	}

	try {
		return JSON.parse( blockJsonContent );
	} catch {
		return null;
	}
}
