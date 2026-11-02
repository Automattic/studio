import {
	createEditTool,
	createReadTool,
	createWriteTool,
	ok,
	truncateHead,
	truncateLine,
	type AgentHarnessTool,
	type AgentTool,
	type ExecutionEnv,
	type ExecutionToolContext,
} from '@earendil-works/pi-agent-core';
import { Type, type TSchema } from 'typebox';
import { withDesignSystemPreview } from '@studio/agent/shared/chat-artifacts';
import { getFileToolPrompt } from '@studio/agent/shared/file-tool-prompts';
import {
	bindTool,
	defineTool,
	READ_ONLY,
	type AnyStudioAgentTool,
} from '@studio/agent/shared/tools/define-tool';
import { textResult } from '@studio/agent/shared/tools/utils';
import type { StudioAgentHost } from '@studio/agent/shared/host';

// The file tools Node takes from pi-coding-agent, for hosts whose files are not
// on a disk its tools can reach: Read, Write and Edit are pi-agent-core's, over
// the host's files; Grep, Glob and Ls are rebuilt, with pi's names, schemas and
// descriptions, so the agent sees the same tools in both.

const LS_LIMIT = 500;
const GLOB_LIMIT = 1000;
const GREP_LIMIT = 100;

// The part of an execution environment pi-agent-core's file tools use. A host
// call that fails rejects, which fails the tool call with the host's message.
function createFilesEnv( { files, path, sitesRoot }: StudioAgentHost ): ExecutionEnv {
	return {
		absolutePath: async ( file: string ) => ok( path.resolve( sitesRoot, file ) ),
		canonicalPath: async ( file: string ) => ok( file ),
		exists: async ( file: string ) => ok( await files.exists( file ) ),
		fileInfo: async ( file: string ) =>
			ok( { kind: ( await files.isDirectory( file ) ) ? 'directory' : 'file' } ),
		readTextFile: async ( file: string ) => ok( await files.readText( file ) ),
		readBinaryFile: async ( file: string ) => ok( await files.read( file ) ),
		writeFile: async ( file: string, content: string | Uint8Array ) =>
			ok( await files.write( file, content ) ),
	} as unknown as ExecutionEnv;
}

// A pi-agent-core tool under Studio's name, running over `env`.
function withEnv< TParameters extends TSchema, TDetails >(
	tool: AgentHarnessTool< ExecutionToolContext, TParameters, TDetails >,
	name: string,
	env: ExecutionEnv
): AgentTool< TParameters, TDetails > {
	return {
		...tool,
		name,
		label: name,
		...getFileToolPrompt( name ),
		execute: ( toolCallId, params, signal, onUpdate ) =>
			tool.execute( toolCallId, params, signal, onUpdate, { env } ),
	};
}

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
function bounded( lines: string[] ): string {
	const { content, truncated } = truncateHead( lines.join( '\n' ), { maxLines: Infinity } );
	return truncated ? `${ content }\n\n[Output truncated at 50KB.]` : content;
}

export function createFileTools( host: StudioAgentHost ): AnyStudioAgentTool[] {
	const { files, path } = host;
	const resolve = ( file: string | undefined ) => path.resolve( host.sitesRoot, file ?? '.' );
	const env = createFilesEnv( host );

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
			const shown = bounded( entries.slice( 0, limit ) );
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
			const matches = ( await files.walk( resolve( args.path ) ) ).filter( ( file ) =>
				pattern.test( file )
			);
			if ( ! matches.length ) {
				return textResult( 'No files found matching pattern' );
			}
			const shown = bounded( matches.slice( 0, limit ) );
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
				: ( await files.walk( target ) ).filter( ( file ) => ! filter || filter.test( file ) );
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
							`${ file }${ separator }${ line + 1 }${ separator } ${
								truncateLine( lines[ line ] ).text
							}`
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
			const shown = bounded( out );
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

	return [
		withEnv( createReadTool(), 'Read', env ),
		withDesignSystemPreview( withEnv( createWriteTool(), 'Write', env ), host ),
		withDesignSystemPreview( withEnv( createEditTool(), 'Edit', env ), host ),
		bindTool( grep, host ),
		bindTool( glob, host ),
		bindTool( ls, host ),
	] as unknown as AnyStudioAgentTool[];
}
