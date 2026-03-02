/**
 * <MainContent /> — Main content area router.
 *
 * Checks addon mainContentRenderer hooks first. If one returns a ReactNode,
 * it is rendered instead of the core <SiteContentTabs />.
 * This mirrors exactly what PR #2535 added for VIP environments, generalized for any addon.
 */
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAddonMainContentRenderer } from 'src/modules/addons/addon-main-content';

export function MainContent() {
	const { selectedSite } = useSiteDetails();
	const context = { selectedSiteId: selectedSite?.id ?? null };
	const addonContent = useAddonMainContentRenderer( context );

	if ( addonContent != null ) {
		return <>{ addonContent }</>;
	}

	return <SiteContentTabs />;
}
