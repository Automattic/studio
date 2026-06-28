import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getStudioExtensionsDirectory } from '@studio/common/lib/well-known-paths';
import type { InstalledStudioExtensionPackage, StudioExtensionManifest } from './types';
import type { Dirent } from 'node:fs';

export const STUDIO_EXTENSION_MANIFEST_FILE = 'studio-extension.json';
const SUPPORTED_STUDIO_EXTENSION_API_VERSION = 1;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function getStudioExtensionInstallPath( extensionId: string ): string {
	assertValidStudioExtensionId( extensionId );
	return path.join( getStudioExtensionsDirectory(), extensionId );
}

export function assertValidStudioExtensionId( extensionId: string ): void {
	if ( ! EXTENSION_ID_PATTERN.test( extensionId ) ) {
		throw new Error( `Invalid Studio extension id: ${ extensionId }` );
	}
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}

function readRequiredString( manifest: Record< string, unknown >, key: string ): string {
	const value = manifest[ key ];
	if ( typeof value !== 'string' || value.trim() === '' ) {
		throw new Error( `Studio extension manifest must include a ${ key } string.` );
	}
	return value.trim();
}

function readOptionalStringArray(
	manifest: Record< string, unknown >,
	key: string
): string[] | undefined {
	const value = manifest[ key ];
	if ( value === undefined ) {
		return undefined;
	}
	if ( ! Array.isArray( value ) || value.some( ( item ) => typeof item !== 'string' ) ) {
		throw new Error( `Studio extension manifest ${ key } must be an array of strings.` );
	}
	return value.map( ( item ) => item.trim() ).filter( Boolean );
}

export async function readStudioExtensionManifest(
	extensionPath: string
): Promise< StudioExtensionManifest > {
	const manifestPath = path.join( extensionPath, STUDIO_EXTENSION_MANIFEST_FILE );
	const manifestContents = await fs.readFile( manifestPath, 'utf8' );
	const parsed = JSON.parse( manifestContents ) as unknown;

	if ( ! isRecord( parsed ) ) {
		throw new Error( 'Studio extension manifest must be a JSON object.' );
	}

	const id = readRequiredString( parsed, 'id' );
	assertValidStudioExtensionId( id );

	const studioExtensionApiVersion =
		typeof parsed.studioExtensionApiVersion === 'number'
			? parsed.studioExtensionApiVersion
			: SUPPORTED_STUDIO_EXTENSION_API_VERSION;
	if ( studioExtensionApiVersion !== SUPPORTED_STUDIO_EXTENSION_API_VERSION ) {
		throw new Error( `Unsupported Studio extension API version: ${ studioExtensionApiVersion }` );
	}

	return {
		id,
		name: readRequiredString( parsed, 'name' ),
		description: readRequiredString( parsed, 'description' ),
		version: readRequiredString( parsed, 'version' ),
		studioExtensionApiVersion,
		publisher: typeof parsed.publisher === 'string' ? parsed.publisher : undefined,
		repository: typeof parsed.repository === 'string' ? parsed.repository : undefined,
		kind: parsed.kind === 'built-in' || parsed.kind === 'user' ? parsed.kind : undefined,
		main: typeof parsed.main === 'string' && parsed.main.trim() ? parsed.main.trim() : undefined,
		renderer:
			typeof parsed.renderer === 'string' && parsed.renderer.trim()
				? parsed.renderer.trim()
				: undefined,
		allowedNavigationOrigins: readOptionalStringArray( parsed, 'allowedNavigationOrigins' ),
	};
}

export async function writeBundledStudioExtensionPackage(
	manifest: StudioExtensionManifest
): Promise< InstalledStudioExtensionPackage > {
	assertValidStudioExtensionId( manifest.id );
	const installedPath = getStudioExtensionInstallPath( manifest.id );
	await fs.mkdir( installedPath, { recursive: true } );
	await fs.writeFile(
		path.join( installedPath, STUDIO_EXTENSION_MANIFEST_FILE ),
		JSON.stringify(
			{
				studioExtensionApiVersion: SUPPORTED_STUDIO_EXTENSION_API_VERSION,
				...manifest,
				kind: 'built-in',
			},
			null,
			2
		) + '\n',
		'utf8'
	);
	return {
		manifest: { ...manifest, kind: 'built-in' },
		installedPath,
	};
}

export async function listInstalledStudioExtensionPackages(): Promise<
	InstalledStudioExtensionPackage[]
> {
	const extensionsDirectory = getStudioExtensionsDirectory();
	let entries: Dirent[];

	try {
		entries = await fs.readdir( extensionsDirectory, { withFileTypes: true } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return [];
		}
		throw error;
	}

	const packages = await Promise.all(
		entries
			.filter( ( entry ) => entry.isDirectory() && ! entry.name.startsWith( '.' ) )
			.map( async ( entry ) => {
				const installedPath = path.join( extensionsDirectory, entry.name );
				try {
					return {
						manifest: await readStudioExtensionManifest( installedPath ),
						installedPath,
					};
				} catch ( error ) {
					console.warn( `Failed to read Studio extension from ${ installedPath }:`, error );
					return undefined;
				}
			} )
	);

	return packages.filter(
		( extensionPackage ): extensionPackage is InstalledStudioExtensionPackage =>
			Boolean( extensionPackage )
	);
}

export async function installStudioExtensionFromGitSource(
	sourceUrl: string
): Promise< InstalledStudioExtensionPackage > {
	const normalizedSourceUrl = normalizeGitSourceUrl( sourceUrl );
	const extensionsDirectory = getStudioExtensionsDirectory();
	const installTempDirectory = path.join( extensionsDirectory, '.installing' );
	const tempPath = path.join( installTempDirectory, `${ Date.now() }-${ crypto.randomUUID() }` );

	await fs.mkdir( installTempDirectory, { recursive: true } );

	try {
		await runGit( [ 'clone', '--depth', '1', normalizedSourceUrl, tempPath ] );
		const manifest = await readStudioExtensionManifest( tempPath );
		const installedPath = getStudioExtensionInstallPath( manifest.id );

		await fs.rm( installedPath, { recursive: true, force: true } );
		await fs.mkdir( path.dirname( installedPath ), { recursive: true } );
		await fs.rename( tempPath, installedPath );

		return {
			manifest: { ...manifest, kind: 'user' },
			installedPath,
		};
	} catch ( error ) {
		await fs.rm( tempPath, { recursive: true, force: true } ).catch( () => undefined );
		throw error;
	}
}

export async function installStudioExtensionFromDirectorySource(
	sourcePath: string
): Promise< InstalledStudioExtensionPackage > {
	const resolvedSourcePath = resolveLocalExtensionPath( sourcePath );
	const sourceStat = await fs.stat( resolvedSourcePath );
	if ( ! sourceStat.isDirectory() ) {
		throw new Error( 'Studio extension path must be a directory.' );
	}

	const manifest = await readStudioExtensionManifest( resolvedSourcePath );
	const installedPath = getStudioExtensionInstallPath( manifest.id );
	const [ realSourcePath, realInstalledPath ] = await Promise.all( [
		resolveExistingPath( resolvedSourcePath ),
		resolveExistingPath( installedPath ),
	] );

	if ( realInstalledPath && realSourcePath === realInstalledPath ) {
		return {
			manifest: { ...manifest, kind: 'user' },
			installedPath,
		};
	}

	await fs.rm( installedPath, { recursive: true, force: true } );
	await fs.mkdir( path.dirname( installedPath ), { recursive: true } );
	await fs.cp( resolvedSourcePath, installedPath, {
		recursive: true,
		filter: ( source ) => path.basename( source ) !== '.git',
	} );

	return {
		manifest: { ...manifest, kind: 'user' },
		installedPath,
	};
}

export async function removeInstalledStudioExtensionPackage(
	extensionId: string,
	installedPath?: string
): Promise< void > {
	assertValidStudioExtensionId( extensionId );
	const resolvedInstalledPath = path.resolve(
		installedPath ?? getStudioExtensionInstallPath( extensionId )
	);
	const extensionsDirectory = path.resolve( getStudioExtensionsDirectory() );
	const relativePath = path.relative( extensionsDirectory, resolvedInstalledPath );

	if ( relativePath.startsWith( '..' ) || path.isAbsolute( relativePath ) ) {
		throw new Error( `Refusing to remove extension outside Studio extensions directory.` );
	}

	await fs.rm( resolvedInstalledPath, { recursive: true, force: true } );
}

export function normalizeGitSourceUrl( sourceUrl: string ): string {
	const trimmed = sourceUrl.trim();
	if ( trimmed === '' ) {
		throw new Error( 'Enter a Git or GitHub URL.' );
	}

	if ( /^github\.com\//i.test( trimmed ) ) {
		return `https://${ trimmed }`;
	}

	if ( /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\.git)?$/i.test( trimmed ) ) {
		return `https://github.com/${ trimmed }`;
	}

	if ( /^(https?|ssh|git|file):\/\//i.test( trimmed ) || /^git@[^:]+:.+$/i.test( trimmed ) ) {
		return trimmed;
	}

	throw new Error( 'Enter a Git or GitHub URL.' );
}

export function resolveLocalExtensionPath( sourcePath: string ): string {
	const trimmed = sourcePath.trim();
	if ( trimmed === '' ) {
		throw new Error( 'Enter a Studio extension directory path.' );
	}
	if ( trimmed === '~' ) {
		return os.homedir();
	}
	if ( trimmed.startsWith( `~${ path.sep }` ) || trimmed.startsWith( '~/' ) ) {
		return path.resolve( os.homedir(), trimmed.slice( 2 ) );
	}
	return path.resolve( trimmed );
}

async function runGit( args: string[] ): Promise< void > {
	await new Promise< void >( ( resolve, reject ) => {
		const child = spawn( 'git', args, {
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			windowsHide: true,
		} );
		let stdout = '';
		let stderr = '';

		child.stdout?.setEncoding( 'utf8' );
		child.stderr?.setEncoding( 'utf8' );
		child.stdout?.on( 'data', ( chunk ) => {
			stdout += chunk;
		} );
		child.stderr?.on( 'data', ( chunk ) => {
			stderr += chunk;
		} );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve();
				return;
			}
			reject( new Error( stderr.trim() || stdout.trim() || `git exited with code ${ code }` ) );
		} );
	} );
}

async function resolveExistingPath( targetPath: string ): Promise< string | undefined > {
	try {
		return await fs.realpath( targetPath );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return undefined;
		}
		throw error;
	}
}

function isErrnoException( error: unknown ): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}
