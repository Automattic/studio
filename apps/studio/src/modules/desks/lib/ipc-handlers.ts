import { normalizeDeskSettings } from '@studio/common/lib/desk-settings';
import {
	DESK_CONFIG_VERSION,
	type DeskConnector,
	type DeskConnectorEndpoint,
	type DeskConfig,
	type DeskSettings,
	type DeskStack,
	type DeskViewport,
	type DeskWidgetBase,
} from '@studio/common/types/desk';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { IpcMainInvokeEvent } from 'electron';

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

function isDeskWidget( value: unknown ): value is DeskWidgetBase {
	if ( ! isRecord( value ) || ! isRecord( value.shapeProps ) || ! isRecord( value.widgetProps ) ) {
		return false;
	}
	return (
		typeof value.id === 'string' &&
		typeof value.type === 'string' &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		typeof value.zIndex === 'string' &&
		( value.rotation === undefined || typeof value.rotation === 'number' )
	);
}

function isDeskStack( value: unknown ): value is DeskStack {
	if ( ! isRecord( value ) || ! Array.isArray( value.memberIds ) ) {
		return false;
	}
	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		typeof value.x === 'number' &&
		Number.isFinite( value.x ) &&
		typeof value.y === 'number' &&
		Number.isFinite( value.y ) &&
		typeof value.zIndex === 'string' &&
		value.memberIds.length >= 2 &&
		value.memberIds.every( ( memberId ) => typeof memberId === 'string' )
	);
}

function isDeskViewport( value: unknown ): value is DeskViewport {
	if ( ! isRecord( value ) ) {
		return false;
	}

	const { x, y, z } = value;
	return (
		typeof x === 'number' &&
		Number.isFinite( x ) &&
		typeof y === 'number' &&
		Number.isFinite( y ) &&
		typeof z === 'number' &&
		Number.isFinite( z ) &&
		z > 0
	);
}

function isDeskConnectorEndpoint( value: unknown ): value is DeskConnectorEndpoint {
	if ( ! isRecord( value ) || ! isRecord( value.normalizedAnchor ) ) {
		return false;
	}

	const { x, y } = value.normalizedAnchor;
	return (
		typeof value.widgetId === 'string' &&
		value.widgetId.length > 0 &&
		typeof x === 'number' &&
		Number.isFinite( x ) &&
		x >= 0 &&
		x <= 1 &&
		typeof y === 'number' &&
		Number.isFinite( y ) &&
		y >= 0 &&
		y <= 1
	);
}

function isDeskConnector( value: unknown ): value is DeskConnector {
	if ( ! isRecord( value ) ) {
		return false;
	}

	return (
		typeof value.id === 'string' &&
		value.id.length > 0 &&
		isDeskConnectorEndpoint( value.from ) &&
		isDeskConnectorEndpoint( value.to ) &&
		( value.bend === undefined ||
			( typeof value.bend === 'number' && Number.isFinite( value.bend ) ) )
	);
}

function assertDeskConfig( value: unknown ): asserts value is DeskConfig {
	if ( ! isRecord( value ) ) {
		throw new Error( 'Invalid desk config: expected an object.' );
	}
	if ( value.version !== DESK_CONFIG_VERSION ) {
		throw new Error( `Invalid desk config: expected version ${ DESK_CONFIG_VERSION }.` );
	}
	if ( typeof value.updatedAt !== 'string' ) {
		throw new Error( 'Invalid desk config: expected updatedAt string.' );
	}
	if ( ! Array.isArray( value.widgets ) || ! value.widgets.every( isDeskWidget ) ) {
		throw new Error( 'Invalid desk config: expected widgets array.' );
	}
	if (
		value.stacks !== undefined &&
		( ! Array.isArray( value.stacks ) || ! value.stacks.every( isDeskStack ) )
	) {
		throw new Error( 'Invalid desk config: expected stacks array.' );
	}
	if ( value.viewport !== undefined && ! isDeskViewport( value.viewport ) ) {
		throw new Error( 'Invalid desk config: expected viewport object.' );
	}
	if (
		value.connectors !== undefined &&
		( ! Array.isArray( value.connectors ) || ! value.connectors.every( isDeskConnector ) )
	) {
		throw new Error( 'Invalid desk config: expected connectors array.' );
	}
}

function assertSiteId( siteId: unknown ): asserts siteId is string {
	if ( typeof siteId !== 'string' || ! siteId ) {
		throw new Error( 'Invalid site desk config: expected site id.' );
	}
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
