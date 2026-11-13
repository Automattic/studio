import type { StudioAgentHost } from './host';

const CORE_ROOT_FILE = /^(index|xmlrpc|wp-(?!config\b)[a-z-]+)\.php$/;

/**
 * Why a write to this file of a WordPress install, by its `/`-separated path
 * in the install, would be lost: it is WordPress core, which a WordPress update
 * replaces. Names where the change belongs.
 */
export function coreFileRefusal( relativePath: string ): string | undefined {
	return relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath )
		? `${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`
		: undefined;
}

/** The WordPress install a file is in, if any: the nearest folder with wp-includes/ and wp-content/. */
async function findWordPressRoot(
	{ files, path }: StudioAgentHost,
	filePath: string
): Promise< string | undefined > {
	for (
		let dir = path.dirname( filePath );
		dir !== path.dirname( dir );
		dir = path.dirname( dir )
	) {
		if (
			( await files.exists( path.join( dir, 'wp-includes' ) ) ) &&
			( await files.exists( path.join( dir, 'wp-content' ) ) )
		) {
			return dir;
		}
	}
	return undefined;
}

/**
 * Refuses a Write or Edit of a Studio site's WordPress core, for runtimes
 * without the Node runtime's site file checks (site-file-guards.ts). WordPress
 * trees that Studio doesn't manage stay writable. `resolvePath` resolves the
 * tool's `path` the way the runtime's file tools do.
 */
export async function assertToolCallAllowed(
	toolName: string,
	params: unknown,
	host: StudioAgentHost,
	resolvePath: ( file: string ) => string
): Promise< void > {
	const filePath = ( params as { path?: unknown } | undefined )?.path;
	if ( ( toolName !== 'Write' && toolName !== 'Edit' ) || typeof filePath !== 'string' ) {
		return;
	}
	const absolutePath = resolvePath( filePath );
	const root = await findWordPressRoot( host, absolutePath );
	const refusal =
		root &&
		coreFileRefusal( host.path.relative( root, absolutePath ).split( host.path.sep ).join( '/' ) );
	if ( refusal && ( await host.sites.findByFolder( root ) ) ) {
		throw new Error( refusal );
	}
}
