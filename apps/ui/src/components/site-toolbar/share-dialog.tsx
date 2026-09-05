import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import { CardSection, OverviewCard } from '@/components/site-overview-view/overview-card';
import {
	PreviewSitePublishAction,
	PreviewSitesList,
} from '@/components/site-overview-view/preview-sites-section';
import styles from './share-dialog.module.css';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

export function ShareDialog( { site, open, onOpenChange }: Props ) {
	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="medium" className={ styles.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Share this site' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.intro }>
						{ __( 'Temporary copies of this site for sharing work before it goes live.' ) }
					</p>
					<OverviewCard>
						<CardSection>
							<PreviewSitesList site={ site } />
						</CardSection>
					</OverviewCard>
				</Dialog.Content>
				<Dialog.Footer>
					<PreviewSitePublishAction site={ site } presentation="dialog" />
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
