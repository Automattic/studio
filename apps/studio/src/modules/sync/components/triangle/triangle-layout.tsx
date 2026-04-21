import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch } from 'src/stores';
import {
	useGetConnectedSitesForLocalSiteQuery,
	connectedSitesActions,
} from 'src/stores/sync/connected-sites';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { useSyncActions } from '../../hooks/use-sync-actions';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import { SyncDialog } from '../sync-dialog';
import { ArchivedConnections } from './archived-connections';
import { EnvironmentColumn } from './environment-column';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { SyncGutter } from './sync-gutter';

type Props = {
	selectedSite: SiteDetails;
};

export function TriangleLayout( { selectedSite }: Props ) {
	const dispatch = useAppDispatch();
	const { user } = useAuth();
	const { data: sites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const { production, staging, archived } = deriveSlotAssignments( sites );
	const provisioning = useStagingProvisioning( {
		productionSiteId: production?.id ?? 0,
		localSiteId: selectedSite.id,
	} );
	const syncActions = useSyncActions( selectedSite );

	const openConnectModal = () => dispatch( connectedSitesActions.openModal( 'connect' ) );

	const renderLocalSyncHub = ( target: 'production' | 'staging' ) => {
		const site = target === 'production' ? production : staging;
		if ( ! site ) return <div />;
		return (
			<SyncGutter
				from={ { kind: 'local', label: 'Local' } }
				to={ { kind: 'remote', label: target === 'production' ? 'Production' : 'Staging' } }
				lastPushTimestamp={ site.lastPushTimestamp }
				lastPullTimestamp={ site.lastPullTimestamp }
				// Local is above the bottom remotes: Push goes down toward the remote,
				// Pull comes up toward Local.
				pushArrow="↓"
				pullArrow="↑"
				onPush={ () => syncActions.push( site ) }
				onPull={ () => syncActions.pull( site ) }
			/>
		);
	};

	const productionSlot = production ? (
		<EnvironmentColumn
			kind="remote"
			label="Production"
			site={ production }
			orientation="portrait"
		/>
	) : (
		<ConnectProductionCard onClick={ openConnectModal } />
	);

	const stagingSlot = staging ? (
		<EnvironmentColumn kind="remote" label="Staging" site={ staging } orientation="portrait" />
	) : provisioning.state === 'idle' ? (
		<CreateStagingCard onClick={ provisioning.start } />
	) : (
		<ProvisioningColumn
			state={ provisioning.state }
			error={ provisioning.error }
			onRetry={ provisioning.start }
		/>
	);

	return (
		<div className="flex flex-col gap-6 p-6">
			{ /*
			  Triangle layout: Local hero on top; Production (left) and Staging (right)
			  underneath as portrait cards. Sync hubs float between Local and each bottom
			  card, plus one below connecting Prod ↔ Staging directly.
			*/ }
			<EnvironmentColumn
				kind="local"
				label="Local"
				orientation="landscape"
				localSiteId={ selectedSite.id }
				siteName={ selectedSite.name }
				siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
				isRunning={ selectedSite.running }
			/>

			{ ( production || staging ) && (
				<div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
					<div className="flex justify-center">
						{ production ? renderLocalSyncHub( 'production' ) : null }
					</div>
					<div />
					<div className="flex justify-center">
						{ staging ? renderLocalSyncHub( 'staging' ) : null }
					</div>
				</div>
			) }

			<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
				{ productionSlot }
				<div />
				{ stagingSlot }
			</div>

			<ArchivedConnections
				localSiteId={ selectedSite.id }
				archived={ archived }
				isProductionOpen={ ! production }
				isStagingOpen={ ! staging }
			/>

			{ syncActions.pendingSyncTarget && (
				<SyncDialog
					type={ syncActions.pendingSyncTarget.direction }
					localSite={ selectedSite }
					remoteSite={ syncActions.pendingSyncTarget.connectedSite }
					onPush={ syncActions.commitPush }
					onPull={ syncActions.commitPull }
					onRequestClose={ syncActions.closeDialog }
				/>
			) }
		</div>
	);
}
