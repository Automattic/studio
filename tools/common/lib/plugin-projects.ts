import fs from 'fs/promises';
import path from 'path';
import type {
	DevelopmentProjectVersionBump,
	DevelopmentProjectVersionState,
	DevelopmentProjectVersionStateStatus,
	PluginProjectInfo,
} from '../types/publishing';
import type { Dirent } from 'fs';

const HEADER_BYTES = 8192;
const MAX_SCAN_DEPTH = 4;
const IGNORED_DIRECTORIES = new Set( [
	'.git',
	'.svn',
	'.wordpress-org',
	'build',
	'dist',
	'node_modules',
	'tests',
	'vendor',
] );

type PluginHeaders = Partial< {
	name: string;
	description: string;
	version: string;
	author: string;
	textDomain: string;
	requiresAtLeast: string;
	testedUpTo: string;
	requiresPhp: string;
} >;

interface PluginCandidate {
	filePath: string;
	headers: PluginHeaders & { name: string };
	score: number;
}

const HEADER_MAP = {
	name: 'Plugin Name',
	description: 'Description',
	version: 'Version',
	author: 'Author',
	textDomain: 'Text Domain',
	requiresAtLeast: 'Requires at least',
	testedUpTo: 'Tested up to',
	requiresPhp: 'Requires PHP',
} as const;

function normalizeHeaderLine( line: string ): string {
	return line.replace( /^[\s/*#@]+/, '' ).trim();
}

function getHeaderValue( content: string, label: string ): string | undefined {
	const escapedLabel = label.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	const matcher = new RegExp( `^\\s*(?:\\*\\s*)?${ escapedLabel }\\s*:\\s*(.+)$`, 'im' );
	const match = content.match( matcher );
	return match ? normalizeHeaderLine( match[ 1 ] ) : undefined;
}

export function parsePluginHeaders( content: string ): PluginHeaders {
	return Object.fromEntries(
		Object.entries( HEADER_MAP )
			.map( ( [ key, label ] ) => [ key, getHeaderValue( content, label ) ] )
			.filter( ( entry ): entry is [ keyof PluginHeaders, string ] => Boolean( entry[ 1 ] ) )
	) as PluginHeaders;
}

function toSlug( value: string ): string {
	return value
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

function inferSlugFromPath( rootDir: string ): string {
	const basename = path.basename( rootDir );
	if ( [ 'src', 'source', 'trunk' ].includes( basename ) ) {
		return toSlug( path.basename( path.dirname( rootDir ) ) );
	}
	return toSlug( basename );
}

export function inferPluginSlug( rootDir: string, headers: { textDomain?: string } ) {
	return headers.textDomain ? toSlug( headers.textDomain ) : inferSlugFromPath( rootDir );
}

async function readHeaderSnippet( filePath: string ): Promise< string > {
	const handle = await fs.open( filePath, 'r' );
	try {
		const buffer = Buffer.alloc( HEADER_BYTES );
		const { bytesRead } = await handle.read( buffer, 0, HEADER_BYTES, 0 );
		return buffer.toString( 'utf8', 0, bytesRead );
	} finally {
		await handle.close();
	}
}

async function findReadmePath( rootDir: string ): Promise< string | undefined > {
	for ( const filename of [ 'readme.txt', 'README.txt', 'readme.md', 'README.md' ] ) {
		const readmePath = path.join( rootDir, filename );
		try {
			const stats = await fs.stat( readmePath );
			if ( stats.isFile() ) {
				return readmePath;
			}
		} catch {
			// Keep checking the conventional readme filenames.
		}
	}
	return undefined;
}

function getSvnTrunkRootDir( rootDir: string, mainFile: string ): string {
	const trunkDir = path.join( rootDir, 'trunk' );
	const relativeMainFile = path.relative( trunkDir, mainFile );
	const mainFileIsInTrunk =
		relativeMainFile &&
		! relativeMainFile.startsWith( '..' ) &&
		! path.isAbsolute( relativeMainFile );

	if ( ! mainFileIsInTrunk ) {
		return rootDir;
	}

	return trunkDir;
}

export async function parseReadmeMetadata(
	readmePath?: string
): Promise< Partial< PluginProjectInfo > > {
	if ( ! readmePath ) {
		return {};
	}

	try {
		const content = await fs.readFile( readmePath, 'utf8' );
		const metadata: Partial< PluginProjectInfo > = {};
		const title = content.match( /^===\s*(.+?)\s*===/m )?.[ 1 ]?.trim();
		const stableTag = content.match( /^Stable tag:\s*(.+)$/im )?.[ 1 ]?.trim();
		const requiresAtLeast = content.match( /^Requires at least:\s*(.+)$/im )?.[ 1 ]?.trim();
		const testedUpTo = content.match( /^Tested up to:\s*(.+)$/im )?.[ 1 ]?.trim();
		const requiresPhp = content.match( /^Requires PHP:\s*(.+)$/im )?.[ 1 ]?.trim();

		if ( title ) {
			metadata.name = title;
		}
		if ( stableTag ) {
			metadata.stableTag = stableTag;
		}
		if ( requiresAtLeast ) {
			metadata.requiresAtLeast = requiresAtLeast;
		}
		if ( testedUpTo ) {
			metadata.testedUpTo = testedUpTo;
		}
		if ( requiresPhp ) {
			metadata.requiresPhp = requiresPhp;
		}
		return metadata;
	} catch {
		return {};
	}
}

function scoreCandidate( rootDir: string, filePath: string, headers: PluginHeaders ): number {
	const rootBasename = path.basename( rootDir );
	const fileBasename = path.basename( filePath, '.php' );
	const isRootFile = path.dirname( filePath ) === rootDir;
	let score = isRootFile ? 50 : 0;

	if ( fileBasename === rootBasename ) {
		score += 30;
	}
	if ( headers.textDomain && toSlug( headers.textDomain ) === inferSlugFromPath( rootDir ) ) {
		score += 20;
	}
	if ( headers.version ) {
		score += 5;
	}
	return score;
}

async function collectCandidates(
	rootDir: string,
	currentDir: string,
	depth: number,
	candidates: PluginCandidate[]
): Promise< void > {
	if ( depth > MAX_SCAN_DEPTH ) {
		return;
	}

	let entries: Dirent[];
	try {
		entries = await fs.readdir( currentDir, { withFileTypes: true } );
	} catch {
		return;
	}

	await Promise.all(
		entries.map( async ( entry ) => {
			if ( entry.isDirectory() ) {
				if ( ! IGNORED_DIRECTORIES.has( entry.name ) ) {
					await collectCandidates(
						rootDir,
						path.join( currentDir, entry.name ),
						depth + 1,
						candidates
					);
				}
				return;
			}

			if ( ! entry.isFile() || path.extname( entry.name ).toLowerCase() !== '.php' ) {
				return;
			}

			const filePath = path.join( currentDir, entry.name );
			let headers: PluginHeaders;
			try {
				headers = parsePluginHeaders( await readHeaderSnippet( filePath ) );
			} catch {
				return;
			}
			if ( ! headers.name ) {
				return;
			}

			candidates.push( {
				filePath,
				headers: headers as PluginHeaders & { name: string },
				score: scoreCandidate( rootDir, filePath, headers ),
			} );
		} )
	);
}

export async function discoverPluginProject( inputPath: string ): Promise< PluginProjectInfo > {
	const resolvedPath = path.resolve( inputPath );
	const stats = await fs.stat( resolvedPath );
	const rootDir = stats.isDirectory() ? resolvedPath : path.dirname( resolvedPath );
	const candidates: PluginCandidate[] = [];

	if ( stats.isFile() && path.extname( resolvedPath ).toLowerCase() === '.php' ) {
		const headers = parsePluginHeaders( await readHeaderSnippet( resolvedPath ) );
		if ( headers.name ) {
			candidates.push( {
				filePath: resolvedPath,
				headers: headers as PluginHeaders & { name: string },
				score: scoreCandidate( rootDir, resolvedPath, headers ) + 100,
			} );
		}
	} else {
		await collectCandidates( rootDir, rootDir, 0, candidates );
	}

	if ( candidates.length === 0 ) {
		throw new Error( 'No WordPress plugin header was found in this folder.' );
	}

	const selectedCandidate = candidates.sort( ( a, b ) => b.score - a.score )[ 0 ];
	const pluginRootDir = getSvnTrunkRootDir( rootDir, selectedCandidate.filePath );
	const readmePath = await findReadmePath( pluginRootDir );
	const readmeMetadata = await parseReadmeMetadata( readmePath );
	const slug = inferPluginSlug( pluginRootDir, selectedCandidate.headers );

	return {
		rootDir: pluginRootDir,
		mainFile: selectedCandidate.filePath,
		readmePath,
		name: selectedCandidate.headers.name || readmeMetadata.name || slug,
		slug,
		version: selectedCandidate.headers.version,
		stableTag: readmeMetadata.stableTag,
		description: selectedCandidate.headers.description,
		author: selectedCandidate.headers.author,
		textDomain: selectedCandidate.headers.textDomain,
		requiresAtLeast: selectedCandidate.headers.requiresAtLeast || readmeMetadata.requiresAtLeast,
		testedUpTo: selectedCandidate.headers.testedUpTo || readmeMetadata.testedUpTo,
		requiresPhp: selectedCandidate.headers.requiresPhp || readmeMetadata.requiresPhp,
	};
}

export function bumpPluginVersion(
	currentVersion: string,
	bump: DevelopmentProjectVersionBump
): string {
	const match = currentVersion.trim().match( /^(\d+)\.(\d+)\.(\d+)(.*)$/ );
	if ( ! match ) {
		throw new Error( `Unsupported version "${ currentVersion }". Expected semver like 1.2.3.` );
	}

	const major = Number( match[ 1 ] );
	const minor = Number( match[ 2 ] );
	const patch = Number( match[ 3 ] );

	if ( bump === 'major' ) {
		return `${ major + 1 }.0.0`;
	}

	if ( bump === 'minor' ) {
		return `${ major }.${ minor + 1 }.0`;
	}

	return `${ major }.${ minor }.${ patch + 1 }`;
}

export async function updatePluginHeaderVersion(
	mainFile: string,
	nextVersion: string
): Promise< void > {
	const contents = await fs.readFile( mainFile, 'utf8' );
	const updated = contents.replace(
		/^([ \t/*#@]*Version\s*:\s*)(.+?)\s*$/im,
		`$1${ nextVersion }`
	);

	if ( updated === contents ) {
		throw new Error( `Could not update Version header in ${ mainFile }.` );
	}

	await fs.writeFile( mainFile, updated );
}

export async function updateReadmeStableTag(
	readmePath: string,
	nextVersion: string
): Promise< void > {
	const contents = await fs.readFile( readmePath, 'utf8' );
	const updated = contents.replace( /^(Stable tag\s*:\s*)(.+?)\s*$/im, `$1${ nextVersion }` );

	if ( updated === contents ) {
		throw new Error( `Could not update Stable tag in ${ readmePath }.` );
	}

	await fs.writeFile( readmePath, updated );
}

export async function updatePluginProjectVersion(
	project: PluginProjectInfo,
	nextVersion: string
): Promise< void > {
	await updatePluginHeaderVersion( project.mainFile, nextVersion );

	if ( project.readmePath ) {
		await updateReadmeStableTag( project.readmePath, nextVersion );
	}
}

export async function bumpPluginProjectVersion(
	project: PluginProjectInfo,
	bump: DevelopmentProjectVersionBump
): Promise< string > {
	if ( ! project.version ) {
		throw new Error( 'Could not find a Version header in the main plugin file.' );
	}

	const nextVersion = bumpPluginVersion( project.version, bump );
	await updatePluginProjectVersion( project, nextVersion );
	return nextVersion;
}

export function compareVersions( left: string, right: string ): number {
	const leftParts = normalizeVersion( left );
	const rightParts = normalizeVersion( right );
	for ( let index = 0; index < Math.max( leftParts.length, rightParts.length ); index += 1 ) {
		const diff = ( leftParts[ index ] ?? 0 ) - ( rightParts[ index ] ?? 0 );
		if ( diff !== 0 ) {
			return diff > 0 ? 1 : -1;
		}
	}
	return 0;
}

export function calculateDevelopmentProjectVersionState( input: {
	slug: string;
	name: string;
	path: string;
	localVersion?: string;
	readmeStableTag?: string;
	remoteVersion?: string;
	svnTags?: string[];
	svnTagsSource: DevelopmentProjectVersionState[ 'svnTagsSource' ];
} ): DevelopmentProjectVersionState {
	const statuses: DevelopmentProjectVersionStateStatus[] = [];
	const messages: string[] = [];
	const latestSvnTag = latestVersion( input.svnTags ?? [] );

	if ( ! input.localVersion ) {
		statuses.push( 'missing_version' );
		messages.push( 'The plugin header does not declare a Version value.' );
	}

	if (
		input.localVersion &&
		input.readmeStableTag &&
		input.localVersion !== input.readmeStableTag
	) {
		statuses.push( 'header_readme_mismatch' );
		messages.push(
			`The plugin header version (${ input.localVersion }) and readme Stable tag (${ input.readmeStableTag }) differ.`
		);
	}

	if (
		input.localVersion &&
		input.remoteVersion &&
		compareVersions( input.remoteVersion, input.localVersion ) > 0
	) {
		statuses.push( 'remote_newer' );
		messages.push(
			`WordPress.org has ${ input.remoteVersion }, which is newer than the local ${ input.localVersion }.`
		);
	}

	if ( input.localVersion && input.svnTags?.includes( input.localVersion ) ) {
		statuses.push( 'duplicate_tag_blocked' );
		messages.push(
			`SVN already has a ${ input.localVersion } tag. Bump the version before releasing.`
		);
	}

	if ( input.svnTagsSource === 'unknown' ) {
		statuses.push( 'unknown_svn_state' );
		messages.push( 'Could not read SVN tags, so duplicate release detection is incomplete.' );
	}

	if ( statuses.length === 0 ) {
		statuses.push( 'ready' );
		messages.push( 'Version state looks ready for a guarded publish or release.' );
	}

	return {
		...input,
		latestSvnTag,
		statuses,
		releaseBlocked: statuses.some( ( status ) =>
			[ 'missing_version', 'header_readme_mismatch', 'duplicate_tag_blocked' ].includes( status )
		),
		messages,
		nextVersions: input.localVersion
			? {
					patch: safeNextVersion( input.localVersion, 'patch' ),
					minor: safeNextVersion( input.localVersion, 'minor' ),
					major: safeNextVersion( input.localVersion, 'major' ),
			  }
			: undefined,
	};
}

function safeNextVersion(
	version: string,
	bump: DevelopmentProjectVersionBump
): string | undefined {
	try {
		return bumpPluginVersion( version, bump );
	} catch {
		return undefined;
	}
}

function latestVersion( values: string[] ): string | undefined {
	return values.length > 0 ? [ ...values ].sort( compareVersions ).at( -1 ) : undefined;
}

function normalizeVersion( value: string ): number[] {
	return value
		.trim()
		.split( /[.-]/ )
		.map( ( part ) => Number.parseInt( part, 10 ) )
		.map( ( part ) => ( Number.isFinite( part ) ? part : 0 ) );
}
