import { useEffect } from 'react';

export function useIpcListener( channel: string, listener: ( ...args: any[] ) => void ) {
	// Defined in preload.ts
	const { ipcListener } = window as any;

	useEffect( () => {
		ipcListener.on( channel, listener );
		return () => {
			ipcListener.off( channel, listener );
		};
	}, [ channel, listener ] );
}
