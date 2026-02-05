import { useSiteDetails } from 'src/hooks/use-site-details';
import { VipContentTabs } from 'src/modules/vip/components/vip-content-tabs';
import { useVipContext } from 'src/modules/vip/context/vip-context';
import { SiteContentTabs } from './site-content-tabs';

/**
 * Main content area that displays either regular site content or VIP environment content
 * based on which is currently selected.
 *
 * VIP environment is checked first because the regular site selection has fallback behavior
 * that always returns a site when sites exist. When a user actively clicks a VIP environment,
 * that selection should take priority.
 */
export function MainContent() {
	const { selectedSite } = useSiteDetails();
	const { selectedEnvironment } = useVipContext();

	// If a VIP environment is selected, show VIP content (check first due to regular site fallback behavior)
	if ( selectedEnvironment ) {
		return <VipContentTabs />;
	}

	// If a regular site is selected, show regular site content
	if ( selectedSite ) {
		return <SiteContentTabs />;
	}

	// Default to regular site content tabs (which handles the "no site selected" state)
	return <SiteContentTabs />;
}
