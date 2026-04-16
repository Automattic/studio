import { IpcRendererEvent } from 'electron';
import { useEffect } from 'react';
import { IpcEvents } from 'src/ipc-utils';

export function useIpcListener< T extends keyof IpcEvents >(
	channel: T,
	listener: ( event: IpcRendererEvent, ...args: IpcEvents[ T ] ) => void,
	deps: React.DependencyList = []
) {
	useEffect( () => {
		return window.ipcListener.subscribe( channel, listener );
	}, [ channel, listener, ...deps ] );
}
