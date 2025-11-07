import { Icon } from '@wordpress/icons';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import Modal from 'src/components/modal';

interface NoWpcomSitesModalProps {
	onRequestClose: () => void;
}

export function NoWpcomSitesModal( { onRequestClose }: NoWpcomSitesModalProps ) {
	const { __ } = useI18n();

	return (
		<Modal
			className="w-[390px]"
			onRequestClose={ onRequestClose }
			title={ __( 'Find a perfect plan with WordPress.com' ) }
		>
			<div className="flex flex-col gap-4">
				<div className="max-w-[40ch] text-a8c-gray-70 a8c-body">
					{ __(
						'Unlock the power of WordPress with the managed WordPress.com hosting platform and share your work with the world.'
					) }
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
					<Button variant="primary" onClick={ onRequestClose } className="w-full">
						{ __( 'Choose a plan to publish your site' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

