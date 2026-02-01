/**
 * Parser for SKILL.md files using the AgentSkills format.
 *
 * SKILL.md files contain YAML frontmatter followed by markdown content.
 * The frontmatter contains metadata about the skill (name, description, etc.)
 * and the body contains the actual instructions for AI agents.
 */

import type { SkillMetadata } from '../types';

/**
 * Regular expression to match YAML frontmatter in markdown files.
 * Matches content between --- delimiters at the start of the file.
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a SKILL.md file and extract metadata from YAML frontmatter.
 *
 * @param content - The raw content of the SKILL.md file
 * @returns Object containing parsed metadata and the markdown body
 * @throws Error if frontmatter is invalid or missing required fields
 */
export function parseSkillFile( content: string ): { metadata: SkillMetadata; body: string } {
	const match = content.match( FRONTMATTER_REGEX );

	if ( ! match ) {
		throw new Error( 'Invalid SKILL.md format: missing YAML frontmatter' );
	}

	const [ , yamlContent, body ] = match;
	const metadata = parseYamlFrontmatter( yamlContent );

	if ( ! validateSkillMetadata( metadata ) ) {
		throw new Error( 'Invalid skill metadata: missing required fields (name, description)' );
	}

	return {
		metadata,
		body: body.trim(),
	};
}

/**
 * Parse YAML frontmatter into a JavaScript object.
 * This is a simple parser that handles the common cases for skill metadata.
 *
 * @param yaml - The YAML string to parse
 * @returns Parsed object
 */
function parseYamlFrontmatter( yaml: string ): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	const lines = yaml.split( /\r?\n/ );
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for ( const line of lines ) {
		// Skip empty lines and comments
		if ( ! line.trim() || line.trim().startsWith( '#' ) ) {
			continue;
		}

		// Check for array item (starts with -)
		if ( line.match( /^\s+-\s+/ ) && currentKey && currentArray ) {
			const value = line.replace( /^\s+-\s+/, '' ).trim();
			// Remove quotes if present
			currentArray.push( value.replace( /^["']|["']$/g, '' ) );
			continue;
		}

		// Check for key-value pair
		const keyValueMatch = line.match( /^(\w+):\s*(.*)$/ );
		if ( keyValueMatch ) {
			// Save any pending array
			if ( currentKey && currentArray ) {
				result[ currentKey ] = currentArray;
				currentArray = null;
			}

			const [ , key, value ] = keyValueMatch;
			currentKey = key;

			if ( value.trim() === '' ) {
				// Could be start of an array or empty value
				currentArray = [];
			} else {
				// Simple value - remove quotes if present
				result[ key ] = value.trim().replace( /^["']|["']$/g, '' );
				currentArray = null;
			}
		}
	}

	// Save any pending array
	if ( currentKey && currentArray ) {
		result[ currentKey ] = currentArray;
	}

	return result;
}

/**
 * Validate that skill metadata contains all required fields.
 *
 * @param metadata - The metadata object to validate
 * @returns True if the metadata is valid
 */
export function validateSkillMetadata( metadata: unknown ): metadata is SkillMetadata {
	if ( ! metadata || typeof metadata !== 'object' ) {
		return false;
	}

	const obj = metadata as Record< string, unknown >;

	// Required fields
	if ( typeof obj.name !== 'string' || obj.name.trim() === '' ) {
		return false;
	}
	if ( typeof obj.description !== 'string' || obj.description.trim() === '' ) {
		return false;
	}

	// Optional fields type checking
	if ( obj.license !== undefined && typeof obj.license !== 'string' ) {
		return false;
	}
	if ( obj.compatibility !== undefined && typeof obj.compatibility !== 'string' ) {
		return false;
	}
	if ( obj.allowedTools !== undefined && ! Array.isArray( obj.allowedTools ) ) {
		return false;
	}
	if (
		obj.metadata !== undefined &&
		( typeof obj.metadata !== 'object' || obj.metadata === null )
	) {
		return false;
	}

	return true;
}

/**
 * Extract just the name from a SKILL.md file without fully parsing it.
 * Useful for quick lookups.
 *
 * @param content - The raw content of the SKILL.md file
 * @returns The skill name or null if not found
 */
export function extractSkillName( content: string ): string | null {
	const match = content.match( /^---[\s\S]*?name:\s*["']?([^"'\r\n]+)["']?/m );
	return match ? match[ 1 ].trim() : null;
}
