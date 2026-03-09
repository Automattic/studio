import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { readAppdata } from 'cli/lib/appdata';

function ok( data: unknown ) {
	return { content: [ { type: 'text' as const, text: JSON.stringify( data, null, 2 ) } ] };
}

function err( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true as const,
	};
}

function resolveInsideRoot( root: string, userPath: string ): string {
	const resolvedRoot = path.resolve( root );
	const resolved = path.resolve( root, userPath );
	if ( resolved !== resolvedRoot && ! resolved.startsWith( resolvedRoot + path.sep ) ) {
		throw new Error( __( 'Path traversal not allowed' ) );
	}
	return resolved;
}

async function getSiteRoot( sitePath: string ): Promise< string > {
	const appdata = await readAppdata();
	const site = appdata.sites.find( ( s ) => s.path === sitePath );
	if ( ! site ) {
		throw new Error( __( 'Site not found at the specified path' ) );
	}
	return site.path;
}

export function registerFsTools( server: McpServer ) {
	server.tool(
		'fs_list_dir',
		__( 'List files and directories inside a WordPress site' ),
		{
			sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ),
			dirPath: z
				.string()
				.optional()
				.describe( __( 'Relative path within the site (default: site root)' ) ),
		},
		async ( { sitePath, dirPath } ) => {
			try {
				const root = await getSiteRoot( sitePath );
				const target = resolveInsideRoot( root, dirPath ?? '.' );
				const entries = fs.readdirSync( target, { withFileTypes: true } );
				const result = entries.map( ( e ) => ( {
					name: e.name,
					type: e.isDirectory() ? 'directory' : 'file',
					size: e.isFile() ? fs.statSync( path.join( target, e.name ) ).size : undefined,
				} ) );
				return ok( result );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'fs_read_file',
		__( 'Read a file inside a WordPress site' ),
		{
			sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ),
			filePath: z.string().describe( __( 'Relative path to the file within the site' ) ),
		},
		async ( { sitePath, filePath } ) => {
			try {
				const root = await getSiteRoot( sitePath );
				const target = resolveInsideRoot( root, filePath );
				const content = fs.readFileSync( target, 'utf-8' );
				return ok( { content } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'fs_write_file',
		__( 'Write content to a file inside a WordPress site' ),
		{
			sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ),
			filePath: z.string().describe( __( 'Relative path to the file within the site' ) ),
			content: z.string().describe( __( 'Content to write to the file' ) ),
		},
		async ( { sitePath, filePath, content } ) => {
			try {
				const root = await getSiteRoot( sitePath );
				const target = resolveInsideRoot( root, filePath );
				fs.mkdirSync( path.dirname( target ), { recursive: true } );
				fs.writeFileSync( target, content, 'utf-8' );
				return ok( { success: true, path: target } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'fs_delete',
		__( 'Delete a file or directory inside a WordPress site' ),
		{
			sitePath: z.string().describe( __( 'Absolute path to the site directory' ) ),
			targetPath: z.string().describe( __( 'Relative path to the file or directory to delete' ) ),
		},
		async ( { sitePath, targetPath } ) => {
			try {
				const root = await getSiteRoot( sitePath );
				const target = resolveInsideRoot( root, targetPath );
				if ( target === path.resolve( root ) ) {
					return err( __( 'Cannot delete the site root directory' ) );
				}
				fs.rmSync( target, { recursive: true, force: true } );
				return ok( { success: true } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);
}
