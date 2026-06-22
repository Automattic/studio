import type { StudioExtensionListItem, StudioRendererExtension } from './types';

export const registeredStudioRendererExtensions: StudioRendererExtension[] = [];

type StudioRendererExtensionFactory = (
	context: StudioRendererExtensionContext
) => StudioRendererExtension | Promise< StudioRendererExtension >;

type StudioRendererExtensionModule = Partial< StudioRendererExtension > & {
	default?: StudioRendererExtension | StudioRendererExtensionFactory;
	extension?: StudioRendererExtension;
	rendererExtension?: StudioRendererExtension;
	activate?: StudioRendererExtensionFactory;
};

interface StudioRendererExtensionContext {
	installedPath: string;
	manifest: StudioExtensionListItem;
}

const loadedRendererExtensions = new Map<
	string,
	Promise< StudioRendererExtension | undefined >
>();

export function clearStudioRendererExtensionCache( extensionId?: string ): void {
	if ( extensionId ) {
		loadedRendererExtensions.delete( extensionId );
		return;
	}
	loadedRendererExtensions.clear();
}

export async function loadStudioRendererExtension(
	extension: StudioExtensionListItem
): Promise< StudioRendererExtension | undefined > {
	if ( ! extension.renderer || ! extension.installedPath ) {
		return undefined;
	}

	const cacheKey = [
		extension.id,
		extension.installedPath,
		extension.renderer,
		extension.updatedAt ?? '',
	].join( ':' );
	const cached = loadedRendererExtensions.get( cacheKey );
	if ( cached ) {
		return cached;
	}

	const loading = loadStudioRendererExtensionUncached( extension );
	void loading.catch( () => {
		loadedRendererExtensions.delete( cacheKey );
	} );
	loadedRendererExtensions.set( cacheKey, loading );
	return loading;
}

async function loadStudioRendererExtensionUncached(
	extension: StudioExtensionListItem
): Promise< StudioRendererExtension | undefined > {
	const moduleUrl = resolveRendererModuleUrl( extension );
	if ( ! moduleUrl ) {
		return undefined;
	}

	const moduleExports = ( await import(
		/* @vite-ignore */ moduleUrl
	) ) as StudioRendererExtensionModule;
	const activatedExtension = await activateStudioRendererExtension( moduleExports, {
		installedPath: extension.installedPath ?? '',
		manifest: extension,
	} );

	return {
		...activatedExtension,
		manifest: {
			...extension,
			...activatedExtension.manifest,
			id: extension.id,
		},
	};
}

async function activateStudioRendererExtension(
	moduleExports: StudioRendererExtensionModule,
	context: StudioRendererExtensionContext
): Promise< StudioRendererExtension > {
	if ( typeof moduleExports.default === 'function' ) {
		return moduleExports.default( context );
	}
	if ( moduleExports.default && isStudioRendererExtension( moduleExports.default ) ) {
		return moduleExports.default;
	}
	if ( moduleExports.extension ) {
		return moduleExports.extension;
	}
	if ( moduleExports.rendererExtension ) {
		return moduleExports.rendererExtension;
	}
	if ( moduleExports.activate ) {
		return moduleExports.activate( context );
	}
	if ( isStudioRendererExtension( moduleExports ) ) {
		return moduleExports;
	}

	const namedRendererExtension = Object.values( moduleExports ).find( isStudioRendererExtension );
	if ( namedRendererExtension ) {
		return namedRendererExtension;
	}

	return {
		manifest: context.manifest,
	};
}

function isStudioRendererExtension( value: unknown ): value is StudioRendererExtension {
	return (
		typeof value === 'object' &&
		value !== null &&
		'manifest' in value &&
		typeof ( value as { manifest?: { id?: unknown } } ).manifest?.id === 'string'
	);
}

function resolveRendererModuleUrl( extension: StudioExtensionListItem ): string | undefined {
	if ( ! extension.renderer || ! extension.installedPath ) {
		return undefined;
	}
	if ( isAbsolutePath( extension.renderer ) ) {
		throw new Error(
			'Studio extension renderer entry must be relative to the extension directory.'
		);
	}

	const installedPath = normalizePath( extension.installedPath );
	const rendererPath = normalizePath( `${ installedPath }/${ extension.renderer }` );
	const relativePath = getRelativePath( installedPath, rendererPath );
	if (
		relativePath.startsWith( '../' ) ||
		relativePath === '..' ||
		isAbsolutePath( relativePath )
	) {
		throw new Error( 'Studio extension renderer entry must stay inside the extension directory.' );
	}

	if ( process.env.NODE_ENV !== 'development' ) {
		console.warn(
			`Skipping Studio extension renderer source for ${ extension.id }. External renderer loading currently requires the development server.`
		);
		return undefined;
	}

	return encodeURI( `/@fs/${ rendererPath }` );
}

function normalizePath( value: string ): string {
	const normalizedSeparators = value.replace( /\\/g, '/' ).replace( /\/+/g, '/' );
	const driveMatch = normalizedSeparators.match( /^([A-Za-z]:)(?:\/|$)/ );
	const drive = driveMatch?.[ 1 ];
	const rest = drive ? normalizedSeparators.slice( drive.length ) : normalizedSeparators;
	const isAbsolute = rest.startsWith( '/' );
	const parts: string[] = [];

	for ( const segment of rest.split( '/' ) ) {
		if ( ! segment || segment === '.' ) {
			continue;
		}
		if ( segment === '..' ) {
			if ( parts.length > 0 && parts[ parts.length - 1 ] !== '..' ) {
				parts.pop();
			} else if ( ! isAbsolute ) {
				parts.push( '..' );
			}
			continue;
		}
		parts.push( segment );
	}

	if ( drive ) {
		return `${ drive }/${ parts.join( '/' ) }`;
	}
	if ( isAbsolute ) {
		return `/${ parts.join( '/' ) }`;
	}
	return parts.join( '/' ) || '.';
}

function isAbsolutePath( value: string ): boolean {
	return value.startsWith( '/' ) || /^[A-Za-z]:[\\/]/.test( value );
}

function getRelativePath( from: string, to: string ): string {
	const fromParts = from.split( '/' ).filter( Boolean );
	const toParts = to.split( '/' ).filter( Boolean );
	let commonParts = 0;

	while (
		commonParts < fromParts.length &&
		commonParts < toParts.length &&
		fromParts[ commonParts ] === toParts[ commonParts ]
	) {
		commonParts++;
	}

	return [
		...Array.from( { length: fromParts.length - commonParts }, () => '..' ),
		...toParts.slice( commonParts ),
	].join( '/' );
}
