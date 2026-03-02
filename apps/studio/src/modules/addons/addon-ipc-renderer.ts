/**
 * Addon IPC Renderer helper — safe to call only from the preload context.
 *
 * Uses a dynamic require() so that this module can be imported at evaluation
 * time without crashing in the renderer bundle (where ipcRenderer is not
 * available). The require() runs only when the returned function is invoked,
 * which happens exclusively in the preload script.
 */
export function addonInvoke( channel: string, ...args: unknown[] ): Promise< unknown > {
	const { ipcRenderer } = require( 'electron' ) as typeof import('electron');
	return ipcRenderer.invoke( channel, ...args );
}
