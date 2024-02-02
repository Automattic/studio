import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useArchiveSite } from '../hooks/use-archive-site';
import { useAuth } from '../hooks/use-auth';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface ContentTabSnapshotsProps {
	selectedSite: SiteDetails;
}

function SnapshotsList( { snapshots }: { snapshots: Snapshot[] } ) {
	return (
		<div className="mt-10">
			{ snapshots.map( ( { url } ) => (
				<div key={ url } className="h-12 text-black text-xs font-normal">
					<button onClick={ () => getIpcApi().openURL( `https://${ url }` ) }>{ url }</button>
				</div>
			) ) }
		</div>
	);
}

export function ContentTabSnapshots( { selectedSite }: ContentTabSnapshotsProps ) {
	const { __ } = useI18n();
	const { snapshots } = useSiteDetails();
	const { archiveSite, isLoading } = useArchiveSite();
	const { isAuthenticated } = useAuth();
	return (
		<div>
			<div className="w-full justify-between items-center inline-flex">
				<div className="flex-col justify-start items-start gap-1 inline-flex">
					<div className="text-center text-black text-sm font-semibold">
						{ __( 'Snapshot links' ) }
					</div>
					<div className="min-w-80 text-zinc-700 text-xs font-normal pr-2">
						{ __(
							'Share up to five snapshots of your site with a temporary link. Links expire after 7 days.'
						) }
					</div>
				</div>
				<Button
					variant="primary"
					disabled={ isLoading || ! isAuthenticated }
					onClick={ () => archiveSite( selectedSite.id ) }
				>
					{ isLoading ? __( 'Creating snapshot…' ) : __( 'Create snapshot' ) }
				</Button>
			</div>

			<SnapshotsList
				snapshots={ snapshots.filter( ( snapshot ) => snapshot.localSiteId === selectedSite.id ) }
			/>
		</div>
	);
}
