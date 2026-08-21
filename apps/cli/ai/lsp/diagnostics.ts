import { readFile } from 'fs/promises';
import path from 'path';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { formatDiagnosticLine } from './format';
import { getLspServerForSiteRoot, getSiteRootForFile, isWpLspAvailable } from './pool';

// wp-lsp pushes diagnostics right after a document sync; the initial index of
// a site blocks requests, so the first collection after a spawn waits longer.
const DIAGNOSTICS_WAIT_MS = 3_000;
const COLD_DIAGNOSTICS_WAIT_MS = 10_000;

export function isPhpFile( filePath: string ): boolean {
	return /\.(php|phtml)$/i.test( filePath );
}

/**
 * Report wp-lsp's problems for a just-edited PHP file, or null when there is
 * nothing to say (non-PHP file, file outside a site, wp-lsp unavailable, no
 * diagnostics, or any failure — diagnostics must never break the edit).
 */
export async function collectPhpFileDiagnostics( absolutePath: string ): Promise< string | null > {
	if ( ! isPhpFile( absolutePath ) || ! isWpLspAvailable() ) {
		return null;
	}
	const siteRoot = getSiteRootForFile( absolutePath );
	if ( ! siteRoot ) {
		return null;
	}
	try {
		const server = await getLspServerForSiteRoot( siteRoot );
		if ( ! server ) {
			return null;
		}
		const wasWarm = server.warmedUp;
		const content = await readFile( absolutePath, 'utf8' );
		const uri = server.client.syncDocument( absolutePath, content );
		const diagnostics = await server.client.waitForDiagnostics(
			uri,
			wasWarm ? DIAGNOSTICS_WAIT_MS : COLD_DIAGNOSTICS_WAIT_MS
		);
		server.warmedUp = true;
		if ( ! diagnostics.length ) {
			return null;
		}
		const lines = diagnostics.map( formatDiagnosticLine ).join( '\n' );
		return `wp-lsp found problems in this file:\n${ lines }`;
	} catch {
		return null;
	}
}

/**
 * Diagnostics hook for the agent's file-editing tools: given an Edit/Write
 * tool call's name and arguments, report wp-lsp problems for the edited file.
 * Returns null for other tools, non-PHP files, or files outside a site.
 */
export async function collectEditToolDiagnostics(
	toolName: string,
	params: unknown
): Promise< string | null > {
	if ( toolName !== 'Edit' && toolName !== 'Write' ) {
		return null;
	}
	const args = params as { path?: unknown; file_path?: unknown } | undefined;
	const rawPath =
		typeof args?.path === 'string'
			? args.path
			: typeof args?.file_path === 'string'
			? args.file_path
			: null;
	if ( ! rawPath ) {
		return null;
	}
	const absolutePath = path.isAbsolute( rawPath )
		? rawPath
		: path.join( STUDIO_SITES_ROOT, rawPath );
	return collectPhpFileDiagnostics( absolutePath );
}
