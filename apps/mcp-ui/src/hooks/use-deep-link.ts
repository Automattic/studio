import { useEffect } from 'react';
import { parseDeepLink } from '@/lib/sites';
import { useHostState } from './use-host-state';
import { useOpenSite } from './use-open-site';

// OpenAI hosts open a site's page with a deep link: /sites/local/<id> or /sites/wpcom/<id>.
export function useDeepLink() {
	const { context } = useHostState();
	const openSite = useOpenSite();
	const url = context[ 'openai/deepLink' ]?.url;
	useEffect( () => {
		const route = url ? parseDeepLink( url ) : null;
		if ( route ) {
			openSite( route.kind, route.id );
		}
	}, [ url, openSite ] );
}
