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
		<div
			data-testid="site-content-header"
			className="flex justify-between items-start w-full gap-5 "
		>
			{ site && (
				<div className="flex flex-col">
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all">
						{ site ? site.name : null }
					</h1>
					<div className="flex mt-1 gap-x-4">
						<Button
							disabled={ ! site.running }
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blueberry !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id, '/wp-admin' ) }
							variant="link"
						>
							{ __( 'WP admin' ) }
							<Icon
								icon={ external }
								className="ltr:ml-0.5 rtl:mr-0.5 rtl:scale-x-[-1]"
								size={ 14 }
							/>
						</Button>
						<Button
							disabled={ ! site.running }
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blueberry !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id ) }
							variant="link"
						>
							{
								// translators: "Open site" refers to the action, like "to open site"
								__( 'Open site' )
							}
							<Icon
								className="ltr:ml-0.5 rtl:mr-0.5 rtl:scale-x-[-1]"
								icon={ external }
								size={ 14 }
							/>
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
