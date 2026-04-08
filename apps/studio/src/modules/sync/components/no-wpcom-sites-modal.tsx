import { useI18n } from '@wordpress/react-i18n';
import Modal from 'src/components/modal';
import { NoWpcomSitesContent } from 'src/modules/sync/components/no-wpcom-sites-content';

interface NoWpcomSitesModalProps {
	onRequestClose: () => void;
	selectedSite?: SiteDetails;
}

export function NoWpcomSitesModal( { onRequestClose, selectedSite }: NoWpcomSitesModalProps ) {
	const { __ } = useI18n();

	return (
		<Modal
			className="w-[390px]"
			onRequestClose={ onRequestClose }
			title={ __( 'Find a perfect plan' ) }
		>
			<div className="flex flex-col gap-4">
				<NoWpcomSitesContent
					selectedSite={ selectedSite }
					onButtonClick={ onRequestClose }
					buttonClassName="w-full !text-white !shadow-frame-theme"
				/>
			</div>
		</Modal>
	);
}
