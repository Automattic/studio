import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { getIpcApi } from 'src/lib/get-ipc-api';

export default function Header() {
	const { __ } = useI18n();
	const { selectedSite: site, startServer, stopServer, loadingServer } = useSiteDetails();
	const isLoading = site?.id ? loadingServer[ site.id ] : false;

	const handleWpAdminClick = async () => {
		if ( ! site || isLoading ) return;

		recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_WP_ADMIN );
		if ( ! site.running ) {
			await startServer( site );
		}
		getIpcApi().openSiteURL( site.id, '/wp-admin/' );
	};

	const handleOpenSiteClick = async () => {
		if ( ! site || isLoading ) return;

		recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER );
		if ( ! site.running ) {
			await startServer( site );
		}
		getIpcApi().openSiteURL( site.id, '', { autoLogin: false } );
	};

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
							className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
							onClick={ handleWpAdminClick }
							variant="link"
							disabled={ isLoading }
						>
							{ __( 'WP admin' ) }
							<ArrowIcon />
						</Button>
						<Button
							className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
							onClick={ handleOpenSiteClick }
							variant="link"
							disabled={ isLoading }
						>
							{
								// translators: "Open local site" refers to the action of opening the local site in a browser
								__( 'Open local site' )
							}
							<ArrowIcon />
						</Button>
					</div>
				</div>
			) }
			<SiteManagementActions
				onStart={ startServer }
				loading={ isLoading }
				onStop={ stopServer }
				selectedSite={ site }
			/>
		</div>
	);
}
