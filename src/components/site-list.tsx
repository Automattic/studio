import { Icon, external, wordpress } from '@wordpress/icons';
import { getIpcApi } from '../get-ipc-api';
import { useSiteDetails } from '../hooks/use-site-details';
import LinkButton from './link-button';
import ShareSiteButton from './share-site-button';
import StatusLed from './status-led';

export default function SiteList() {
	const { data, startServer, stopServer } = useSiteDetails();

	if ( ! data?.length ) {
		return <div>No sites found.</div>;
	}

	return (
		<ul role="list" className="divide-y divide-gray-100">
			{ data.map( ( site ) => (
				<li key={ site.id } className="flex justify-between gap-x-6 py-5">
					<div>
						<p className="text-sm font-semibold leading-6 text-gray-900">{ site.name }</p>
						<p className="mt-1 truncate text-xs leading-5 text-gray-500">{ site.path }</p>
					</div>
					<div className="shrink-0 flex flex-col place-content-center text-sm leading-6 text-gray-900">
						<div className="mt-1 flex items-center gap-x-1.5">
							<StatusLed on={ site.running } />
							{ site.running ? (
								<LinkButton onClick={ () => stopServer( site.id ) }>Stop</LinkButton>
							) : (
								<LinkButton onClick={ () => startServer( site.id ) }>Start</LinkButton>
							) }
							|
							<LinkButton
								disabled={ ! site.running }
								onClick={ () => getIpcApi().openSiteURL( site.id ) }
							>
								<Icon icon={ external } /> Open site
							</LinkButton>
							|
							<LinkButton
								disabled={ ! site.running }
								onClick={ () => getIpcApi().openSiteURL( site.id, '/wp-admin' ) }
							>
								<Icon icon={ wordpress } /> Open wp-admin
							</LinkButton>
							| <ShareSiteButton siteId={ site.id } />
						</div>
					</div>
				</li>
			) ) }
		</ul>
	);
}
