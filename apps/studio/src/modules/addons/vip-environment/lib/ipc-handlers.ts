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

export async function isVipCliAvailableHandler( _event: unknown ): Promise< VipCliStatus > {
	return checkVipCliStatus();
}

export async function getVipEnvironmentsHandler( _event: unknown ): Promise< VipEnvironment[] > {
	return listVipEnvironments();
}

export async function getVipEnvironmentDetailsHandler(
	_event: unknown,
	slug: unknown
): Promise< VipEnvironment | null > {
	return getVipEnvironment( slug as string );
}

export async function startVipEnvHandler(
	_event: unknown,
	slug: unknown,
	options?: unknown
): Promise< VipCommandResult > {
	return startVipEnvironment( slug as string, options as VipStartOptions | undefined );
}

export async function stopVipEnvHandler(
	_event: unknown,
	slug: unknown
): Promise< VipCommandResult > {
	return stopVipEnvironment( slug as string );
}

export async function executeVipCliCommandHandler(
	_event: unknown,
	args: unknown
): Promise< VipCommandResult > {
	return executeVipCommand( args as string[] );
}

export async function openVipEnvFolderHandler( _event: unknown, slug: unknown ): Promise< void > {
	const env = await getVipEnvironment( slug as string );
	if ( env ) {
		await shell.openPath( env.path );
	}
}

export async function openVipAppCodeFolderHandler(
	_event: unknown,
	slug: unknown
): Promise< void > {
	const env = await getVipEnvironment( slug as string );
	if ( env?.appCodePath ) {
		await shell.openPath( env.appCodePath );
	}
}

export async function openVipEnvInBrowserHandler(
	_event: unknown,
	slug: unknown,
	useAutologin?: unknown
): Promise< void > {
	const env = await getVipEnvironment( slug as string );
	if ( env && env.urls.length > 0 ) {
		let url = env.urls[ 0 ];
		if ( useAutologin !== false && env.autologinKey ) {
			const adminUrl = url.endsWith( '/' ) ? `${ url }wp-admin/` : `${ url }/wp-admin/`;
			url = `${ adminUrl }?vip-dev-autologin=${ env.autologinKey }`;
		}
		await shell.openExternal( url );
	}
}

export async function getVipDataPathHandler( _event: unknown ): Promise< string > {
	return getVipDevEnvPath();
}

export async function createVipEnvHandler(
	_event: unknown,
	options: unknown
): Promise< VipCommandResult > {
	return createVipEnvironment( options as VipCreateOptions );
}
