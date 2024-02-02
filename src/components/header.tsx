import { sprintf } from '@wordpress/i18n';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { SiteManagementActions } from './site-management-actions';

const SITE_URL = 'localhost';

export default function Header() {
	const { __ } = useI18n();
	const { selectedSite: site, startServer, stopServer, loading } = useSiteDetails();
	return (
		<div className="flex justify-between items-center w-full">
			{ site && (
				<div className="flex flex-col">
					<h1 className="text-xl font-normal">{ site ? __( site.name ) : null }</h1>
					<div className="flex mt-1 gap-x-4">
						<Button
							disabled={ ! site.running }
							className="text-[13px] text-a8c-gray-70 hover:text-a8c-gray-90 !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id ) }
						>
							{ sprintf( __( '%s:%s' ), SITE_URL, site.port ) }
							<Icon className="ml-1" icon={ external } size={ 14 } />
						</Button>
						<Button
							disabled={ ! site.running }
							className="text-[13px] text-a8c-gray-70 hover:text-a8c-gray-90 !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id, '/wp-admin' ) }
						>
							{ __( 'WP Admin' ) }
							<Icon icon={ external } className="ml-1" size={ 14 } />
						</Button>
					</div>
				</div>
			) }
			<SiteManagementActions
				onStart={ startServer }
				loading={ loading }
				onStop={ stopServer }
				selectedSite={ site }
			/>
		</div>
	);
}
