import { useEffect, useState } from 'react';
import { TabName, useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';

/**
 * Hook that computes the effective tab, handling the case where a site is deleted.
 * When the previously selected site is deleted, automatically resets to 'overview'.
 */
export function useEffectiveTab() {
	const { selectedSite, sites } = useSiteDetails();
	const { selectedTab, setSelectedTab, tabs } = useContentTabs();

	// Track previous site ID in state so we can safely access it during render
	const [ prevSiteId, setPrevSiteId ] = useState( selectedSite?.id );

	// Compute effective tab at render time
	// This ensures TabPanel gets the correct initialTabName on the first render after deletion
	const siteChanged = prevSiteId !== selectedSite?.id;
	const prevSiteWasDeleted = prevSiteId && ! sites.some( ( site ) => site.id === prevSiteId );
	const effectiveTab = siteChanged && prevSiteWasDeleted ? 'overview' : selectedTab;

	// Update prevSiteId and sync selectedTab after render
	useEffect( () => {
		if ( siteChanged ) {
			setPrevSiteId( selectedSite?.id );
		}

		if ( effectiveTab !== selectedTab ) {
			setSelectedTab( effectiveTab as TabName );
		}
	}, [ siteChanged, selectedSite?.id, effectiveTab, selectedTab, setSelectedTab ] );

	return { effectiveTab, selectedTab, setSelectedTab, tabs };
}
