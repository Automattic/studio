import crypto from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
	InstalledStudioExtensionPackage,
	StudioExtensionMainHandler,
	StudioMainExtension,
} from './types';

type StudioMainExtensionModule = Partial<
	Pick< StudioMainExtension, 'handlers' | 'isNavigationAllowed' >
> & {
	default?: StudioMainExtension | StudioMainExtensionFactory;
	extension?: StudioMainExtension;
	activate?: StudioMainExtensionFactory;
};

type StudioMainExtensionFactory = (
	context: StudioMainExtensionContext
) => StudioMainExtension | Promise< StudioMainExtension >;

interface StudioMainExtensionContext {
	installedPath: string;
	manifest: InstalledStudioExtensionPackage[ 'manifest' ];
}

const loadedMainExtensions = new Map< string, Promise< StudioMainExtension > >();
const resolvedMainExtensions = new Map< string, StudioMainExtension >();
const requireExtensionModule = createRequire( import.meta.url );

export function clearStudioMainExtensionCache( extensionId?: string ): void {
	if ( extensionId ) {
		loadedMainExtensions.delete( extensionId );
		resolvedMainExtensions.delete( extensionId );
		return;
	}
	loadedMainExtensions.clear();
	resolvedMainExtensions.clear();
}

export async function getStudioExtensionHandler(
	extensionPackage: InstalledStudioExtensionPackage,
	handlerName: string
): Promise< StudioExtensionMainHandler | undefined > {
	const extension = await loadStudioMainExtension( extensionPackage );
	return extension.handlers?.[ handlerName ];
}

export function isStudioExtensionNavigationAllowed(
	context: Parameters< NonNullable< StudioMainExtension[ 'isNavigationAllowed' ] > >[ 0 ],
	navigationUrl: string
): boolean {
	for ( const extension of resolvedMainExtensions.values() ) {
		if ( extension.isNavigationAllowed?.( context, navigationUrl ) ) {
			return true;
		}
	}
	return false;
}

async function loadStudioMainExtension(
	extensionPackage: InstalledStudioExtensionPackage
): Promise< StudioMainExtension > {
	const cached = loadedMainExtensions.get( extensionPackage.manifest.id );
	if ( cached ) {
		return cached;
	}

	const loading = loadStudioMainExtensionUncached( extensionPackage );
	void loading
		.then( ( extension ) => {
			resolvedMainExtensions.set( extensionPackage.manifest.id, extension );
		} )
		.catch( () => {
			clearStudioMainExtensionCache( extensionPackage.manifest.id );
		} );
	loadedMainExtensions.set( extensionPackage.manifest.id, loading );
	return loading;
}

async function loadStudioMainExtensionUncached(
	extensionPackage: InstalledStudioExtensionPackage
): Promise< StudioMainExtension > {
	const modulePath = resolveMainModulePath( extensionPackage );
	if ( ! modulePath ) {
		return {
			manifest: extensionPackage.manifest,
		};
	}

	const moduleExports = ( await loadStudioMainExtensionModule(
		modulePath
	) ) as StudioMainExtensionModule;
	const activatedExtension = await activateStudioMainExtension( moduleExports, {
		installedPath: extensionPackage.installedPath,
		manifest: extensionPackage.manifest,
	} );

	return {
		...activatedExtension,
		manifest: {
			...extensionPackage.manifest,
			...activatedExtension.manifest,
			id: extensionPackage.manifest.id,
		},
	};
}

async function loadStudioMainExtensionModule( modulePath: string ): Promise< unknown > {
	if ( path.extname( modulePath ) === '.cjs' ) {
		return requireExtensionModule( modulePath ) as unknown;
	}
	if ( [ '.ts', '.tsx' ].includes( path.extname( modulePath ) ) ) {
		return loadStudioMainExtensionTypeScriptModule( modulePath );
	}
	const moduleUrl = pathToFileURL( modulePath ).toString();
	return import( /* @vite-ignore */ moduleUrl ) as Promise< unknown >;
}

async function loadStudioMainExtensionTypeScriptModule( modulePath: string ): Promise< unknown > {
	if ( process.env.NODE_ENV !== 'development' ) {
		throw new Error(
			'Studio extension TypeScript main entries are only supported in development.'
		);
	}

	const { build } = await import( 'esbuild' );
	const result = await build( {
		entryPoints: [ modulePath ],
		bundle: true,
		write: false,
		platform: 'node',
		format: 'cjs',
		target: 'node20',
		sourcemap: 'inline',
		nodePaths: [
			path.resolve( process.cwd(), 'node_modules' ),
			path.resolve( process.cwd(), '../../node_modules' ),
		],
		external: [ 'electron' ],
		plugins: [ studioMainExtensionAliasPlugin() ],
	} );
	const output = result.outputFiles[ 0 ]?.text;
	if ( ! output ) {
		throw new Error( 'Studio extension TypeScript main entry did not produce output.' );
	}

	const cacheKey = crypto
		.createHash( 'sha256' )
		.update( modulePath )
		.update( output )
		.digest( 'hex' );
	const cacheDirectory = path.join( os.tmpdir(), 'studio-extension-main' );
	const cachePath = path.join( cacheDirectory, `${ cacheKey }.cjs` );
	await fs.mkdir( cacheDirectory, { recursive: true } );
	await fs.writeFile( cachePath, output, 'utf8' );

	return requireExtensionModule( cachePath ) as unknown;
}

async function activateStudioMainExtension(
	moduleExports: StudioMainExtensionModule,
	context: StudioMainExtensionContext
): Promise< StudioMainExtension > {
	if ( typeof moduleExports.default === 'function' ) {
		return moduleExports.default( context );
	}
	if ( moduleExports.default && 'manifest' in moduleExports.default ) {
		return moduleExports.default;
	}
	if ( moduleExports.extension ) {
		return moduleExports.extension;
	}
	if ( moduleExports.activate ) {
		return moduleExports.activate( context );
	}
	return {
		manifest: context.manifest,
		handlers: moduleExports.handlers,
		isNavigationAllowed: moduleExports.isNavigationAllowed,
	};
}

function resolveMainModulePath(
	extensionPackage: InstalledStudioExtensionPackage
): string | undefined {
	if ( ! extensionPackage.manifest.main ) {
		return undefined;
	}
	if ( path.isAbsolute( extensionPackage.manifest.main ) ) {
		throw new Error( 'Studio extension main entry must be relative to the extension directory.' );
	}

	const resolvedPath = path.resolve(
		extensionPackage.installedPath,
		extensionPackage.manifest.main
	);
	const relativePath = path.relative( extensionPackage.installedPath, resolvedPath );
	if ( relativePath.startsWith( '..' ) || path.isAbsolute( relativePath ) ) {
		throw new Error( 'Studio extension main entry must stay inside the extension directory.' );
	}
	if ( ! [ '.cjs', '.js', '.mjs', '.ts', '.tsx' ].includes( path.extname( resolvedPath ) ) ) {
		throw new Error( 'Studio extension main entry must be a JavaScript or TypeScript module.' );
	}

	return resolvedPath;
}

function studioMainExtensionAliasPlugin() {
	const aliases = new Map( [
		[ 'src', path.resolve( process.cwd(), 'src' ) ],
		[ '@studio/common', path.resolve( process.cwd(), '../../tools/common' ) ],
		[ 'cli', path.resolve( process.cwd(), '../cli' ) ],
		[ 'vendor', path.resolve( process.cwd(), '../../vendor' ) ],
	] );

	return {
		name: 'studio-main-extension-aliases',
		setup( build: import('esbuild').PluginBuild ) {
			build.onResolve( { filter: /^(src|@studio\/common|cli|vendor)(\/.*)?$/ }, ( args ) => {
				const [ alias, ...rest ] = args.path.split( '/' );
				const aliasKey = alias === '@studio' ? `${ alias }/${ rest.shift() }` : alias;
				const aliasPath = aliases.get( aliasKey );
				if ( ! aliasPath ) {
					return undefined;
				}
				return {
					path: resolveAliasedStudioModulePath( path.join( aliasPath, ...rest ) ),
				};
			} );
		},
	};
}

function resolveAliasedStudioModulePath( modulePath: string ): string {
	const candidates = [
		modulePath,
		...[ '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json' ].map(
			( extension ) => `${ modulePath }${ extension }`
		),
		...[ 'index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs', 'index.json' ].map(
			( filename ) => path.join( modulePath, filename )
		),
	];
	return candidates.find( isExistingFile ) ?? modulePath;
}

function isExistingFile( filePath: string ): boolean {
	try {
		return existsSync( filePath ) && statSync( filePath ).isFile();
	} catch {
		return false;
	}
}
