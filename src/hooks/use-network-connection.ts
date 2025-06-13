import { useEffect } from 'react';
import { useSiteDetails } from './use-site-details';
import { useOffline } from './use-offline';

export function useNetworkConnection() {
    const { data: sites, stopServer, startServer } = useSiteDetails();
    const isOffline = useOffline();

    const restartRunningSites = async () => {
        const runningSites = sites.filter(site => site.running);
        await Promise.all(runningSites.map(site => stopServer(site.id)));
        await Promise.all(runningSites.map(site => startServer(site.id)));
    };

    useEffect(() => {
        window.addEventListener('online', restartRunningSites);
        window.addEventListener('offline', restartRunningSites);
        return () => {
            window.removeEventListener('online', restartRunningSites);
            window.removeEventListener('offline', restartRunningSites);
        };
    }, [sites, stopServer, startServer, isOffline]);
} 