import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Modal from 'src/components/modal';
import { WordPressShortLogo } from 'src/components/wordpress-short-logo';
import { CreateButton } from 'src/modules/sync/components/create-button';

interface NoWpcomSitesModalProps {
	onRequestClose: () => void;
	selectedSite: SiteDetails;
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
				<div className="text-a8c-gray-70 a8c-body">
					{ __( 'Unlock the power of WordPress and share your work with the world with' ) }
					<WordPressShortLogo className="inline-block h-4 align-middle" />
				</div>
				<div>
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Supports staging and production sites.' ),
						__( 'Sync database and files.' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blue-50 me-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				<div className="flex justify-center gap-4">
					<CreateButton
						variant="primary"
						selectedSite={ selectedSite }
						text={ __( 'Choose a plan to publish your site' ) }
						onClick={ onRequestClose }
						className="w-full !text-white !shadow-a8c-blue-50"
					/>
				</div>
			</div>
		</Modal>
	);
}
