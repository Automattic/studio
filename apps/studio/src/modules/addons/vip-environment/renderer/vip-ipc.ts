/**
 * Typed IPC helpers for the VIP addon renderer components.
 *
 * Since VIP IPC handlers are registered via the addon system (not the main ipc-handlers.ts),
 * they are not part of the IpcApi type. This module provides typed wrappers.
 */
import type {
	VipCliStatus,
	VipCommandResult,
	VipCreateOptions,
	VipEnvironment,
	VipStartOptions,
} from '../types';

type VipIpcApi = {
	vipIsCliAvailable: () => Promise< VipCliStatus >;
	vipGetEnvironments: () => Promise< VipEnvironment[] >;
	vipGetEnvironmentDetails: ( slug: string ) => Promise< VipEnvironment | null >;
	vipStartEnvironment: ( slug: string, options?: VipStartOptions ) => Promise< VipCommandResult >;
	vipStopEnvironment: ( slug: string ) => Promise< VipCommandResult >;
	vipExecuteVipCliCommand: ( args: string[] ) => Promise< VipCommandResult >;
	vipOpenEnvironmentFolder: ( slug: string ) => Promise< void >;
	vipOpenAppCodeFolder: ( slug: string ) => Promise< void >;
	vipOpenEnvironmentInBrowser: ( slug: string, useAutologin?: boolean ) => Promise< void >;
	vipGetVipDataPath: () => Promise< string >;
	vipCreateEnvironment: ( options: VipCreateOptions ) => Promise< VipCommandResult >;
};

export function getVipIpcApi(): VipIpcApi {
	return window.ipcApi as unknown as VipIpcApi;
}
