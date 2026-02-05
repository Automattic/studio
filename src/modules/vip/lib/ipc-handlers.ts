/**
 * IPC handlers for VIP Local Development Environment integration.
 *
 * These handlers are exported and re-exported from the main ipc-handlers.ts file.
 */

import { shell } from 'electron';
import {
	checkVipCliStatus,
	createVipEnvironment,
	executeVipCommand,
	getVipDevEnvPath,
	getVipEnvironment,
	listVipEnvironments,
	startVipEnvironment,
	stopVipEnvironment,
} from './vip-environment';
import type {
	VipCliStatus,
	VipCommandResult,
	VipCreateOptions,
	VipEnvironment,
	VipStartOptions,
} from '../types';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Check if VIP CLI is available on the system.
 */
export async function isVipCliAvailable( _event: IpcMainInvokeEvent ): Promise< VipCliStatus > {
	return checkVipCliStatus();
}

/**
 * List all VIP Local Development Environments.
 */
export async function getVipEnvironments(
	_event: IpcMainInvokeEvent
): Promise< VipEnvironment[] > {
	return listVipEnvironments();
}

/**
 * Get details for a specific VIP environment.
 */
export async function getVipEnvironmentDetails(
	_event: IpcMainInvokeEvent,
	slug: string
): Promise< VipEnvironment | null > {
	return getVipEnvironment( slug );
}

/**
 * Start a VIP environment.
 */
export async function startVipEnv(
	_event: IpcMainInvokeEvent,
	slug: string,
	options?: VipStartOptions
): Promise< VipCommandResult > {
	return startVipEnvironment( slug, options );
}

/**
 * Stop a VIP environment.
 */
export async function stopVipEnv(
	_event: IpcMainInvokeEvent,
	slug: string
): Promise< VipCommandResult > {
	return stopVipEnvironment( slug );
}

/**
 * Execute a VIP CLI command.
 */
export async function executeVipCliCommand(
	_event: IpcMainInvokeEvent,
	args: string[]
): Promise< VipCommandResult > {
	return executeVipCommand( args );
}

/**
 * Open the VIP environment directory in the file explorer.
 */
export async function openVipEnvironmentFolder(
	_event: IpcMainInvokeEvent,
	slug: string
): Promise< void > {
	const env = await getVipEnvironment( slug );
	if ( env ) {
		await shell.openPath( env.path );
	}
}

/**
 * Open the VIP environment's app code directory in the file explorer.
 */
export async function openVipAppCodeFolder(
	_event: IpcMainInvokeEvent,
	slug: string
): Promise< void > {
	const env = await getVipEnvironment( slug );
	if ( env?.appCodePath ) {
		await shell.openPath( env.appCodePath );
	}
}

/**
 * Open the VIP environment in the browser.
 */
export async function openVipEnvironmentInBrowser(
	_event: IpcMainInvokeEvent,
	slug: string,
	useAutologin = true
): Promise< void > {
	const env = await getVipEnvironment( slug );
	if ( env && env.urls.length > 0 ) {
		let url = env.urls[ 0 ];

		// Add autologin parameter if available and requested
		if ( useAutologin && env.autologinKey ) {
			const adminUrl = url.endsWith( '/' ) ? `${ url }wp-admin/` : `${ url }/wp-admin/`;
			url = `${ adminUrl }?vip-dev-autologin=${ env.autologinKey }`;
		}

		await shell.openExternal( url );
	}
}

/**
 * Get the path to the VIP dev-environment directory.
 */
export function getVipDataPath( _event: IpcMainInvokeEvent ): string {
	return getVipDevEnvPath();
}

/**
 * Create a new VIP environment.
 */
export async function createVipEnv(
	_event: IpcMainInvokeEvent,
	options: VipCreateOptions
): Promise< VipCommandResult > {
	return createVipEnvironment( options );
}
