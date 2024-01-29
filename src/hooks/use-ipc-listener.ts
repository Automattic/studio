import { useEffect } from 'react';

export function useIpcListener( channel: string, listener: ( ...args: any[] ) => void ) {
	// The ipcListener global is defined in preload.ts
	const { ipcListener } = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any

	useEffect( () => {
		ipcListener.on( channel, listener );
		return () => {
			ipcListener.off( channel, listener );
		};
	}, [ channel, listener ] );
}
