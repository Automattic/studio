import { Type } from 'typebox';
import { toBase64 } from '@studio/agent/shared/base64';
import { getFileToolPrompt } from '@studio/agent/shared/file-tool-prompts';
import { defineTool, LOCAL_OVERWRITE, READ_ONLY } from '@studio/agent/shared/tools/define-tool';
import { textResult } from '@studio/agent/shared/tools/utils';
import { generateUnifiedPatch } from '@studio/agent/shared/unified-patch';
import {
	applyEditsToNormalizedContent,
	detectLineEnding,
	generateDiffString,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from './edit-text';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { StudioToolDefinition } from '@studio/agent/shared/tools/define-tool';

// The file tools Node takes from pi, for hosts whose files are not on a disk
// pi's tools can reach. Names, schemas and descriptions are pi's, so the agent
// sees the same tools in both.

const READ_MAX_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024;
const LS_LIMIT = 500;
const GLOB_LIMIT = 1000;
const GREP_LIMIT = 100;
const GREP_LINE_LENGTH = 500;
const IMAGE_TYPES: Record< string, string > = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
};

// A glob as a regular expression over relative paths: `**/` spans folders,
// `*` and `?` stay within one.
function globToRegExp( glob: string ): RegExp {
	let source = '';
	for ( let index = 0; index < glob.length; index++ ) {
		const char = glob[ index ];
		if ( char === '*' && glob[ index + 1 ] === '*' ) {
			source += glob[ index + 2 ] === '/' ? '(?:.*/)?' : '.*';
			index += glob[ index + 2 ] === '/' ? 2 : 1;
		} else if ( char === '*' ) {
			source += '[^/]*';
		} else if ( char === '?' ) {
			source += '[^/]';
		} else {
			source += /[.+^${}()|[\]\\]/.test( char ) ? `\\${ char }` : char;
		}
	}
	return new RegExp( `^${ source }$` );
}

// Truncates output past pi's limit, saying so.
function bounded( lines: string[], limitNote: string ): string {
	let size = 0;
	const kept: string[] = [];
	for ( const line of lines ) {
		size += line.length + 1;
		if ( size > MAX_OUTPUT_BYTES ) {
			return `${ kept.join( '\n' ) }\n\n[${ limitNote }]`;
		}
		kept.push( line );
	}
	return kept.join( '\n' );
}

// Every file under `directory`, by its path relative to it.
async function walk( host: StudioAgentHost, directory: string ): Promise< string[] > {
	const { files, path } = host;
	if ( files.walk ) {
		return files.walk( directory );
	}
	const found: string[] = [];
	const visit = async ( relative: string ) => {
		for ( const entry of await files.list( path.join( directory, relative ) ) ) {
			const child = relative ? `${ relative }/${ entry.name }` : entry.name;
			if ( entry.directory ) {
				await visit( child );
			} else {
				found.push( child );
			}
		}
	};
	await visit( '' );
	return found;
}

export function createFileTools( host: StudioAgentHost, { visionEnabled = true } = {} ) {
	const { files, path } = host;
	const resolve = ( file: string | undefined ) => path.resolve( host.sitesRoot, file ?? '.' );

	const read = defineTool(
		'Read',
		'Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.',
		{
			path: Type.String( { description: 'Path to the file to read (relative or absolute)' } ),
			offset: Type.Optional(
				Type.Number( { description: 'Line number to start reading from (1-indexed)' } )
			),
			limit: Type.Optional( Type.Number( { description: 'Maximum number of lines to read' } ) ),
		},
		async ( args ) => {
			const file = resolve( args.path );
			const imageType = IMAGE_TYPES[ path.extname( file ).slice( 1 ).toLowerCase() ];
			if ( imageType && visionEnabled ) {
				const bytes = await files.read( file );
				return { content: [ { type: 'image', data: toBase64( bytes ), mimeType: imageType } ] };
			}
			const lines = ( await files.readText( file ) ).split( '\n' );
			const start = Math.max( 0, ( args.offset ?? 1 ) - 1 );
			const end = Math.min( lines.length, start + ( args.limit ?? READ_MAX_LINES ) );
			const body = bounded(
				lines.slice( start, end ),
				`Output truncated at 50KB. Use offset to continue.`
			);
			return textResult(
				end < lines.length
					? `${ body }\n\n[Showing lines ${ start + 1 }-${ end } of ${ lines.length }. Use offset=${
							end + 1
					  } to continue.]`
					: body
			);
		},
		{ annotations: READ_ONLY, ...getFileToolPrompt( 'Read' ) }
	);

	const write = defineTool(
		'Write',
		"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		{
			path: Type.String( { description: 'Path to the file to write (relative or absolute)' } ),
			content: Type.String( { description: 'Content to write to the file' } ),
		},
		async ( args ) => {
			await files.write( resolve( args.path ), args.content );
			return textResult( `Successfully wrote ${ args.content.length } bytes to ${ args.path }` );
		},
		{ annotations: LOCAL_OVERWRITE, ...getFileToolPrompt( 'Write' ) }
	);

	const edit = defineTool(
		'Edit',
		'Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.',
		{
			path: Type.String( { description: 'Path to the file to edit (relative or absolute)' } ),
			edits: Type.Array(
				Type.Object( {
					oldText: Type.String( {
						description:
							'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
					} ),
					newText: Type.String( { description: 'Replacement text for this targeted edit.' } ),
				} ),
				{
					description:
						'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
				}
			),
		},
		async ( args ) => {
			const file = resolve( args.path );
			const { bom, text: content } = stripBom( await files.readText( file ) );
			const ending = detectLineEnding( content );
			const { baseContent, newContent } = applyEditsToNormalizedContent(
				normalizeToLF( content ),
				args.edits,
				args.path
			);
			await files.write( file, bom + restoreLineEndings( newContent, ending ) );
			const { diff, firstChangedLine } = generateDiffString( baseContent, newContent );
			return {
				content: [
					{
						type: 'text',
						text: `Successfully replaced ${ args.edits.length } block(s) in ${ args.path }.`,
					},
				],
				details: {
					diff,
					patch: generateUnifiedPatch( args.path, baseContent, newContent ),
					firstChangedLine,
				},
			};
		},
		{ annotations: LOCAL_OVERWRITE, ...getFileToolPrompt( 'Edit' ) }
	);

	const ls = defineTool(
		'Ls',
		"List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).",
		{
			path: Type.Optional(
				Type.String( { description: 'Directory to list (default: current directory)' } )
			),
			limit: Type.Optional(
				Type.Number( { description: 'Maximum number of entries to return (default: 500)' } )
			),
		},
		async ( args ) => {
			const entries = ( await files.list( resolve( args.path ) ) )
				.map( ( entry ) => ( entry.directory ? `${ entry.name }/` : entry.name ) )
				.sort( ( a, b ) => a.toLowerCase().localeCompare( b.toLowerCase() ) );
			const limit = args.limit ?? LS_LIMIT;
			const shown = bounded( entries.slice( 0, limit ), 'Output truncated at 50KB.' );
			return textResult(
				entries.length > limit
					? `${ shown }\n\n[${ limit } entries limit reached. Use limit=${ limit * 2 } for more.]`
					: shown || '(empty directory)'
			);
		},
		{ annotations: READ_ONLY, ...getFileToolPrompt( 'Ls' ) }
	);

	const glob = defineTool(
		'Glob',
		'Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).',
		{
			pattern: Type.String( {
				description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
			} ),
			path: Type.Optional(
				Type.String( { description: 'Directory to search in (default: current directory)' } )
			),
			limit: Type.Optional(
				Type.Number( { description: 'Maximum number of results (default: 1000)' } )
			),
		},
		async ( args ) => {
			const pattern = globToRegExp(
				args.pattern.includes( '/' ) ? args.pattern : `**/${ args.pattern }`
			);
			const limit = args.limit ?? GLOB_LIMIT;
			const matches = ( await walk( host, resolve( args.path ) ) ).filter( ( file ) =>
				pattern.test( file )
			);
			if ( ! matches.length ) {
				return textResult( 'No files found matching pattern' );
			}
			const shown = bounded( matches.slice( 0, limit ), 'Output truncated at 50KB.' );
			return textResult(
				matches.length > limit
					? `${ shown }\n\n[${ limit } results limit reached. Refine the pattern or use limit=${
							limit * 2
					  } for more.]`
					: shown
			);
		},
		{ annotations: READ_ONLY, ...getFileToolPrompt( 'Glob' ) }
	);

	const grep = defineTool(
		'Grep',
		'Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.',
		{
			pattern: Type.String( { description: 'Search pattern (regex or literal string)' } ),
			path: Type.Optional(
				Type.String( {
					description: 'Directory or file to search (default: current directory)',
				} )
			),
			glob: Type.Optional(
				Type.String( {
					description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
				} )
			),
			ignoreCase: Type.Optional(
				Type.Boolean( { description: 'Case-insensitive search (default: false)' } )
			),
			literal: Type.Optional(
				Type.Boolean( {
					description: 'Treat pattern as literal string instead of regex (default: false)',
				} )
			),
			context: Type.Optional(
				Type.Number( {
					description: 'Number of lines to show before and after each match (default: 0)',
				} )
			),
			limit: Type.Optional(
				Type.Number( { description: 'Maximum number of matches to return (default: 100)' } )
			),
		},
		async ( args ) => {
			const target = resolve( args.path );
			const limit = args.limit ?? GREP_LIMIT;
			const source = args.literal
				? args.pattern.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' )
				: args.pattern;
			const regex = new RegExp( source, args.ignoreCase ? 'i' : '' );
			const filter = args.glob
				? globToRegExp( args.glob.includes( '/' ) ? args.glob : `**/${ args.glob }` )
				: undefined;
			const single = ! ( await files.isDirectory( target ) );
			const candidates = single
				? [ path.basename( target ) ]
				: ( await walk( host, target ) ).filter( ( file ) => ! filter || filter.test( file ) );
			const base = single ? path.dirname( target ) : target;
			const context = args.context ?? 0;
			const out: string[] = [];
			let matches = 0;
			for ( const file of candidates ) {
				let lines: string[];
				try {
					lines = ( await files.readText( path.join( base, file ) ) ).split( '\n' );
				} catch {
					continue;
				}
				for ( let index = 0; index < lines.length && matches < limit; index++ ) {
					if ( ! regex.test( lines[ index ] ) ) {
						continue;
					}
					matches++;
					for (
						let line = Math.max( 0, index - context );
						line <= Math.min( lines.length - 1, index + context );
						line++
					) {
						const separator = line === index ? ':' : '-';
						out.push(
							`${ file }${ separator }${ line + 1 }${ separator } ${ lines[ line ].slice(
								0,
								GREP_LINE_LENGTH
							) }`
						);
					}
				}
				if ( matches >= limit ) {
					break;
				}
			}
			if ( ! out.length ) {
				return textResult( 'No matches found' );
			}
			const shown = bounded( out, 'Output truncated at 50KB.' );
			return textResult(
				matches >= limit
					? `${ shown }\n\n[${ limit } matches limit reached. Use limit=${
							limit * 2
					  } for more, or refine pattern.]`
					: shown
			);
		},
		{ annotations: READ_ONLY, ...getFileToolPrompt( 'Grep' ) }
	);

	return [ read, write, edit, grep, glob, ls ] as StudioToolDefinition[];
}
