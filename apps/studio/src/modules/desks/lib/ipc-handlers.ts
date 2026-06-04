import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import fsPromises from 'fs/promises';
import nodePath from 'path';
import { assertDeskConfig } from '@studio/common/lib/desk-config';
import { normalizeDeskSettings } from '@studio/common/lib/desk-settings';
import { type DeskConfig, type DeskSettings, type StudioUiMode } from '@studio/common/types/desk';
import { __ } from '@wordpress/i18n';
import { loadMainWindowRenderer } from 'src/main-window';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function assertSiteId( siteId: unknown ): asserts siteId is string {
	if ( typeof siteId !== 'string' || ! siteId ) {
		throw new Error( 'Invalid site desk config: expected site id.' );
	}
}

function assertStudioUiMode( mode: unknown ): asserts mode is StudioUiMode {
	if ( mode !== 'default' && mode !== 'studio' && mode !== 'desks' && mode !== 'agentic' ) {
		throw new Error( 'Invalid Studio UI mode.' );
	}
}

function normalizeStudioUiMode( mode: StudioUiMode | undefined ): StudioUiMode {
	return mode && mode !== 'default' ? 'studio' : 'default';
}

function getParentWindow( event: IpcMainInvokeEvent, channel: string ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error( `No window found for sender of ${ channel } message: ${ event.frameId }` );
	}
	return parentWindow;
}

function getDeskJsonFilename( suggestedFilename: string ) {
	const fallbackFilename = 'studio-desk.json';
	const basename = nodePath.basename( suggestedFilename || fallbackFilename );
	return basename.toLowerCase().endsWith( '.json' ) ? basename : `${ basename }.json`;
}

export async function getUserDeskConfig(
	_event: IpcMainInvokeEvent
): Promise< DeskConfig | undefined > {
	const userData = await loadUserData();
	return userData.desks?.user;
}

export async function getDeskSettings( _event: IpcMainInvokeEvent ): Promise< DeskSettings > {
	const userData = await loadUserData();
	return normalizeDeskSettings( userData.desks?.settings );
}

export async function getStudioUiMode( _event: IpcMainInvokeEvent ): Promise< StudioUiMode > {
	if ( process.env.NODE_ENV === 'production' && app.isPackaged ) {
		return 'default';
	}
	const userData = await loadUserData();
	return normalizeStudioUiMode( userData.desks?.defaultUiMode );
}

export async function setStudioUiMode(
	event: IpcMainInvokeEvent,
	mode: StudioUiMode
): Promise< void > {
	assertStudioUiMode( mode );
	const normalizedMode = normalizeStudioUiMode( mode );
	await lockAppdata();
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			desks: {
				...userData.desks,
				defaultUiMode: normalizedMode,
			},
		} );
	} finally {
		await unlockAppdata();
	}

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && ! parentWindow.isDestroyed() ) {
		setTimeout( () => {
			void loadMainWindowRenderer( parentWindow, normalizedMode );
		}, 0 );
	}
}

export async function saveDeskSettings(
	_event: IpcMainInvokeEvent,
	settings: DeskSettings
): Promise< void > {
	if ( ! isRecord( settings ) ) {
		throw new Error( 'Invalid desk settings: expected an object.' );
	}

	const normalizedSettings = normalizeDeskSettings( settings );
	await lockAppdata();
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			desks: {
				...userData.desks,
				settings: normalizedSettings,
			},
		} );
	} finally {
		await unlockAppdata();
	}
}

export async function exportDeskConfig(
	event: IpcMainInvokeEvent,
	config: DeskConfig,
	suggestedFilename: string
): Promise< string | null > {
	assertDeskConfig( config );

	const { canceled, filePath } = await dialog.showSaveDialog(
		getParentWindow( event, 'exportDeskConfig' ),
		{
			title: __( 'Export desk' ),
			defaultPath: getDeskJsonFilename( suggestedFilename ),
			filters: [
				{
					name: __( 'JSON files' ),
					extensions: [ 'json' ],
				},
			],
		}
	);
	if ( canceled || ! filePath ) {
		return null;
	}

	const targetPath = filePath.toLowerCase().endsWith( '.json' ) ? filePath : `${ filePath }.json`;
	await fsPromises.writeFile( targetPath, `${ JSON.stringify( config, null, 2 ) }\n`, 'utf8' );
	return targetPath;
}

export async function importDeskConfig( event: IpcMainInvokeEvent ): Promise< DeskConfig | null > {
	const { canceled, filePaths } = await dialog.showOpenDialog(
		getParentWindow( event, 'importDeskConfig' ),
		{
			title: __( 'Import desk' ),
			filters: [
				{
					name: __( 'JSON files' ),
					extensions: [ 'json' ],
				},
			],
			properties: [ 'openFile' ],
		}
	);
	if ( canceled || ! filePaths[ 0 ] ) {
		return null;
	}

	let parsedConfig: unknown;
	try {
		parsedConfig = JSON.parse( await fsPromises.readFile( filePaths[ 0 ], 'utf8' ) );
	} catch {
		throw new Error( 'Could not parse that file. Expected a Studio desk JSON export.' );
	}

	assertDeskConfig( parsedConfig );
	return parsedConfig;
}

export async function saveUserDeskConfig(
	_event: IpcMainInvokeEvent,
	config: DeskConfig
): Promise< void > {
	assertDeskConfig( config );
	await lockAppdata();
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			desks: {
				...userData.desks,
				user: config,
			},
		} );
	} finally {
		await unlockAppdata();
	}
}

export async function getSiteDeskConfig(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< DeskConfig | undefined > {
	assertSiteId( siteId );
	const userData = await loadUserData();
	return userData.desks?.sites?.[ siteId ];
}

export async function saveSiteDeskConfig(
	_event: IpcMainInvokeEvent,
	siteId: string,
	config: DeskConfig
): Promise< void > {
	assertSiteId( siteId );
	assertDeskConfig( config );
	await lockAppdata();
	try {
		const userData = await loadUserData();
		await saveUserData( {
			...userData,
			desks: {
				...userData.desks,
				sites: {
					...userData.desks?.sites,
					[ siteId ]: config,
				},
			},
		} );
	} finally {
		await unlockAppdata();
	}
}
