import {
	DESK_CONFIG_VERSION,
	type DeskConfig,
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
		typeof value.shapeType === 'string' &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		typeof value.zIndex === 'string' &&
		( value.rotation === undefined || typeof value.rotation === 'number' )
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
	if ( value.viewport !== undefined && ! isDeskViewport( value.viewport ) ) {
		throw new Error( 'Invalid desk config: expected viewport object.' );
	}
}

export async function getUserDeskConfig(
	_event: IpcMainInvokeEvent
): Promise< DeskConfig | undefined > {
	const userData = await loadUserData();
	return userData.desks?.user;
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
