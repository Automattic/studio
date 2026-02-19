import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { WordPressShortLogo } from 'src/components/wordpress-short-logo';
import { CreateButton } from 'src/modules/sync/components/create-button';

interface NoWpcomSitesContentProps {
	selectedSite?: SiteDetails;
	onButtonClick?: () => void;
	buttonClassName?: string;
}

export function NoWpcomSitesContent( {
	selectedSite,
	onButtonClick,
	buttonClassName,
}: NoWpcomSitesContentProps ) {
	const { __ } = useI18n();

	const features = [
		__( 'Push and pull changes from your live site.' ),
		__( 'Supports staging and production sites.' ),
		__( 'Sync database and files.' ),
	];

	return (
		<>
			<div className="text-a8c-gray-70 a8c-body">
				{ __( 'Unlock the power of WordPress and share your work with the world with' ) }{ ' ' }
				<WordPressShortLogo className="inline-block h-4 align-middle" />
			</div>
			<div>
				{ features.map( ( text ) => (
					<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
						<Icon className="fill-a8c-blue-50 me-2 shrink-0" icon={ check } />
						{ text }
					</div>
				) ) }
			</div>
			<CreateButton
				variant="primary"
				selectedSite={ selectedSite }
				text={ __( 'Choose a plan to publish your site' ) }
				onClick={ onButtonClick }
				className={ buttonClassName }
			/>
		</>
	);
}
