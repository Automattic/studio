import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { clearStudioMainExtensionCache, getStudioExtensionHandler } from './main-registry';
import {
	getStudioExtensionInstallPath,
	installStudioExtensionFromDirectorySource,
	installStudioExtensionFromGitSource,
	listInstalledStudioExtensionPackages,
	normalizeGitSourceUrl,
	removeInstalledStudioExtensionPackage,
} from './package-manager';
import type {
	InstalledStudioExtensionPackage,
	StudioExtensionInstallSource,
	StudioExtensionListItem,
	StudioExtensionManifest,
	StudioExtensionState,
	StudioExtensionStorageState,
} from './types';
import type { IpcMainInvokeEvent } from 'electron';

function getDefaultExtensionState(): StudioExtensionState {
	return {
		installed: false,
		enabled: false,
	};
}

function normalizeExtensionState(
	state: Partial< StudioExtensionState > | undefined,
	extensionPackage: InstalledStudioExtensionPackage | undefined,
	isSupported: boolean
): StudioExtensionState {
	const fallback = getDefaultExtensionState();
	const packageInstalled = Boolean( extensionPackage );
	const installed = packageInstalled;
	return {
		installed,
		enabled: installed && isSupported ? state?.enabled ?? fallback.enabled : false,
		installedPath: extensionPackage?.installedPath ?? state?.installedPath,
		sourceUrl: state?.sourceUrl,
		sourceType: state?.sourceType ?? ( extensionPackage ? 'directory' : undefined ),
		installedAt: state?.installedAt,
		updatedAt: state?.updatedAt,
	};
}

async function readExtensionStorageState(): Promise< StudioExtensionStorageState > {
	const userData = await loadUserData();
	return userData.extensions ?? {};
}

async function saveExtensionState(
	extensionId: string,
	update: Partial< StudioExtensionState >
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const extensions = userData.extensions ?? {};
		extensions[ extensionId ] = {
			...extensions[ extensionId ],
			...update,
		};
		await saveUserData( { ...userData, extensions } );
		await sendIpcEventToRenderer( 'user-preference-changed' );
	} finally {
		await unlockAppdata();
	}
}

function createListItem(
	manifest: StudioExtensionManifest,
	extensionPackage: InstalledStudioExtensionPackage | undefined,
	storedState: Partial< StudioExtensionState > | undefined,
	isSupported: boolean,
	fallbackKind: StudioExtensionListItem[ 'kind' ]
): StudioExtensionListItem {
	const state = normalizeExtensionState( storedState, extensionPackage, isSupported );
	const wasPreviouslyInstalled = storedState?.installed ?? false;
	const kind =
		state.sourceType === 'directory' || state.sourceType === 'git' || state.sourceType === 'manual'
			? 'user'
			: manifest.kind ?? fallbackKind;
	const status = ! state.installed
		? wasPreviouslyInstalled
			? 'missing'
			: 'available'
		: isSupported
		? 'installed'
		: 'unsupported';

	return {
		...manifest,
		kind,
		...state,
		status,
		isSupported,
	};
}

async function getExtensionListItems(): Promise< StudioExtensionListItem[] > {
	const [ states, installedPackages ] = await Promise.all( [
		readExtensionStorageState(),
		listInstalledStudioExtensionPackages(),
	] );
	const packagesById = new Map(
		installedPackages.map( ( extensionPackage ) => [
			extensionPackage.manifest.id,
			extensionPackage,
		] )
	);
	const installedItems = Array.from( packagesById.values() ).map( ( extensionPackage ) =>
		createListItem(
			extensionPackage.manifest,
			extensionPackage,
			states[ extensionPackage.manifest.id ],
			true,
			'user'
		)
	);
	const missingItems = Object.entries( states )
		.filter( ( [ extensionId, state ] ) => state?.installed && ! packagesById.has( extensionId ) )
		.map( ( [ extensionId, state ] ) =>
			createListItem(
				{
					id: extensionId,
					name: extensionId,
					description: 'Extension package is missing from disk.',
					version: 'unknown',
				},
				undefined,
				state,
				false,
				'user'
			)
		);

	return [ ...installedItems, ...missingItems ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
}

async function getExtensionListItem( extensionId: string ): Promise< StudioExtensionListItem > {
	const extension = ( await getExtensionListItems() ).find( ( item ) => item.id === extensionId );
	if ( ! extension ) {
		throw new Error( `Unknown Studio extension: ${ extensionId }` );
	}
	return extension;
}

async function getInstalledExtensionPackage(
	extensionId: string
): Promise< InstalledStudioExtensionPackage > {
	const extensionPackage = ( await listInstalledStudioExtensionPackages() ).find(
		( installedPackage ) => installedPackage.manifest.id === extensionId
	);
	if ( ! extensionPackage ) {
		throw new Error( `Unknown Studio extension: ${ extensionId }` );
	}
	return extensionPackage;
}

async function persistInstalledExtension(
	manifest: StudioExtensionManifest,
	installedPath: string,
	sourceType: StudioExtensionInstallSource,
	options: { sourceUrl?: string; enabled: boolean }
): Promise< StudioExtensionListItem > {
	const now = new Date().toISOString();
	await saveExtensionState( manifest.id, {
		installed: true,
		enabled: options.enabled,
		installedPath,
		sourceType,
		sourceUrl: options.sourceUrl,
		installedAt: now,
		updatedAt: now,
	} );
	return getExtensionListItem( manifest.id );
}

export async function listStudioExtensions(
	_event: IpcMainInvokeEvent
): Promise< StudioExtensionListItem[] > {
	return getExtensionListItems();
}

export async function installStudioExtension(
	_event: IpcMainInvokeEvent,
	extensionId: string
): Promise< StudioExtensionListItem > {
	const extensionPackage = await getInstalledExtensionPackage( extensionId );
	return persistInstalledExtension(
		extensionPackage.manifest,
		extensionPackage.installedPath,
		extensionPackage.manifest.kind === 'built-in' ? 'bundled' : 'manual',
		{ enabled: true }
	);
}

export async function installStudioExtensionFromUrl(
	_event: IpcMainInvokeEvent,
	sourceUrl: string
): Promise< StudioExtensionListItem > {
	const normalizedSourceUrl = normalizeGitSourceUrl( sourceUrl );
	const extensionPackage = await installStudioExtensionFromGitSource( normalizedSourceUrl );
	return persistInstalledExtension(
		extensionPackage.manifest,
		extensionPackage.installedPath,
		'git',
		{
			enabled: true,
			sourceUrl: normalizedSourceUrl,
		}
	);
}

export async function installStudioExtensionFromPath(
	_event: IpcMainInvokeEvent,
	sourcePath: string
): Promise< StudioExtensionListItem > {
	const extensionPackage = await installStudioExtensionFromDirectorySource( sourcePath );
	return persistInstalledExtension(
		extensionPackage.manifest,
		extensionPackage.installedPath,
		'directory',
		{ enabled: true }
	);
}

export async function uninstallStudioExtension(
	_event: IpcMainInvokeEvent,
	extensionId: string
): Promise< StudioExtensionListItem > {
	const extension = await getExtensionListItem( extensionId );
	await removeInstalledStudioExtensionPackage(
		extensionId,
		extension.installedPath ?? getStudioExtensionInstallPath( extensionId )
	);
	await saveExtensionState( extensionId, {
		installed: false,
		enabled: false,
		installedPath: undefined,
		updatedAt: new Date().toISOString(),
	} );
	clearStudioMainExtensionCache( extensionId );

	return {
		...extension,
		installed: false,
		enabled: false,
		installedPath: undefined,
		status: 'missing',
	};
}

export async function setStudioExtensionEnabled(
	_event: IpcMainInvokeEvent,
	extensionId: string,
	enabled: boolean
): Promise< StudioExtensionListItem > {
	const extension = await getExtensionListItem( extensionId );
	if ( ! extension.installed ) {
		throw new Error( `Studio extension is not installed: ${ extensionId }` );
	}
	if ( enabled && ! extension.isSupported ) {
		throw new Error( `Studio extension is not supported: ${ extensionId }` );
	}

	await saveExtensionState( extensionId, {
		installed: true,
		enabled,
		installedPath: extension.installedPath,
		sourceType:
			extension.sourceType === 'git'
				? 'git'
				: extension.kind === 'built-in'
				? 'bundled'
				: 'directory',
		updatedAt: new Date().toISOString(),
	} );
	if ( ! enabled ) {
		clearStudioMainExtensionCache( extensionId );
	}
	return getExtensionListItem( extensionId );
}

export async function invokeStudioExtensionHandler(
	event: IpcMainInvokeEvent,
	extensionId: string,
	handlerName: string,
	...args: unknown[]
): Promise< unknown > {
	const extension = await getExtensionListItem( extensionId );
	if ( ! extension.installed || ! extension.enabled || ! extension.isSupported ) {
		throw new Error( `Studio extension is not enabled: ${ extensionId }` );
	}

	const extensionPackage = await getInstalledExtensionPackage( extensionId );
	const handler = await getStudioExtensionHandler( extensionPackage, handlerName );
	if ( ! handler ) {
		throw new Error( `Unknown Studio extension handler: ${ extensionId }/${ handlerName }` );
	}

	return handler( event, ...args );
}
