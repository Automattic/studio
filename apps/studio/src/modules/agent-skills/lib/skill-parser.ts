import type { SkillMetadata } from '../types';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a SKILL.md file and extract metadata from YAML frontmatter.
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

function parseYamlFrontmatter( yaml: string ): Record< string, unknown > {
	const result: Record< string, unknown > = {};
	const lines = yaml.split( /\r?\n/ );
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;

	for ( const line of lines ) {
		if ( ! line.trim() || line.trim().startsWith( '#' ) ) {
			continue;
		}

		if ( line.match( /^\s+-\s+/ ) && currentKey && currentArray ) {
			const value = line.replace( /^\s+-\s+/, '' ).trim();
			currentArray.push( value.replace( /^["']|["']$/g, '' ) );
			continue;
		}

		const keyValueMatch = line.match( /^(\w+):\s*(.*)$/ );
		if ( keyValueMatch ) {
			if ( currentKey && currentArray ) {
				result[ currentKey ] = currentArray;
				currentArray = null;
			}

			const [ , key, value ] = keyValueMatch;
			currentKey = key;

			if ( value.trim() === '' ) {
				currentArray = [];
			} else {
				result[ key ] = value.trim().replace( /^["']|["']$/g, '' );
				currentArray = null;
			}
		}
	}

	if ( currentKey && currentArray ) {
		result[ currentKey ] = currentArray;
	}

	return result;
}

export function validateSkillMetadata( metadata: unknown ): metadata is SkillMetadata {
	if ( ! metadata || typeof metadata !== 'object' ) {
		return false;
	}

	const obj = metadata as Record< string, unknown >;

	if ( typeof obj.name !== 'string' || obj.name.trim() === '' ) {
		return false;
	}
	if ( typeof obj.description !== 'string' || obj.description.trim() === '' ) {
		return false;
	}
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
