import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

export default function Header() {
	const { __ } = useI18n();
	const { selectedSite: site, startServer, stopServer, loadingServer } = useSiteDetails();
	return (
		<div
			data-testid="site-content-header"
			className="flex justify-between items-start w-full gap-5 px-8"
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
							<ArrowIcon />
						</Button>
						<Button
							disabled={ ! site.running }
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blueberry !px-0 h-0 leading-4"
							onClick={ () => getIpcApi().openSiteURL( site.id, '', { autoLogin: false } ) }
							variant="link"
						>
							{
								// translators: "Open site" refers to the action, like "to open site"
								__( 'Open site' )
							}
							<ArrowIcon />
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
