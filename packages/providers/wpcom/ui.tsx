import { ExternalLinkIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { PlanIcon } from './plan-icon';
import { wpcomPlanUrl, type SyncSite } from './sites/site';
import type { ProviderUi, SiteRowsProps } from '../types';

function WpcomSiteRows( { site, disabled, openUrl, Row }: SiteRowsProps< SyncSite > ) {
	const planUrl = wpcomPlanUrl( site );
	if ( ! planUrl ) {
		return null;
	}
	return (
		<Row
			icon={ <PlanIcon /> }
			label={ __( 'Plan' ) }
			trailing={
				<>
					{ site.planName || __( 'Paid plan' ) }
					<ExternalLinkIcon />
				</>
			}
			disabled={ disabled }
			onClick={ () => openUrl( planUrl ) }
		/>
	);
}

export const wpcomUi: ProviderUi< SyncSite > = { SiteRows: WpcomSiteRows };
