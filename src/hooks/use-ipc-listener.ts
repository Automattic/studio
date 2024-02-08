import { useEffect } from 'react';

export function useIpcListener( channel: string, listener: ( ...args: any[] ) => void ) {
	useEffect( () => {
		return window.ipcListener.subscribe( channel, listener );
	}, [ channel, listener ] );
}
