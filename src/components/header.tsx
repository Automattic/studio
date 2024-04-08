import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { SiteManagementActions } from './site-management-actions';

export default function Header() {
	const { __ } = useI18n();
	const { selectedSite: site, startServer, stopServer, loadingServer } = useSiteDetails();
	return (
		<div data-testid="site-content-header" className="flex justify-between items-center w-full">
			{ site && (
				<div className="flex flex-col">
					<h1 className="text-xl font-normal">{ site ? __( site.name ) : null }</h1>
					<div className="flex mt-1 gap-x-4">
						<Button
							disabled={ ! site.running }
							className="cursor-pointer [&.is-link]:text-a8c-gray-50 [&.is-link]:hover:text-a8c-gray-90 !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id, '/wp-admin' ) }
							variant="link"
						>
							{ __( 'WP Admin' ) }
							<Icon icon={ external } className="ml-1" size={ 14 } />
						</Button>
						<Button
							disabled={ ! site.running }
							className="cursor-pointer [&.is-link]:text-a8c-gray-50 [&.is-link]:hover:text-a8c-gray-90 !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id ) }
							variant="link"
						>
							{ __( 'Open site' ) }
							<Icon className="ml-1" icon={ external } size={ 14 } />
						</Button>
					</div>
				</div>
			) }
			<SiteManagementActions
				onStart={ startServer }
				loading={ site?.id ? loadingServer[ site.id ] : false }
				onStop={ stopServer }
				selectedSite={ site }
			/>
		</div>
	);
}
