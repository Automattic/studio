import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import { ConnectionsSection } from '@/components/site-overview-view/connections-section';
import { CardSectionDivider, OverviewCard } from '@/components/site-overview-view/overview-card';
import { PreviewSitesSection } from '@/components/site-overview-view/preview-sites-section';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import styles from './share-dialog.module.css';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

export function ShareDialog( { site, open, onOpenChange }: Props ) {
	const busy = useIsSiteBusy( site );

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="medium" className={ styles.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Share this site' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					<OverviewCard>
						<ConnectionsSection site={ site } busy={ busy } />
						<CardSectionDivider />
						<PreviewSitesSection site={ site } />
					</OverviewCard>
				</Dialog.Content>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
