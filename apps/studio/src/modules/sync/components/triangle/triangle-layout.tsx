import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { connectedSitesActions } from 'src/stores/sync/connected-sites';
import { useAppDispatch } from 'src/stores';
import { useAuth } from 'src/hooks/use-auth';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { useSyncActions } from '../../hooks/use-sync-actions';
import { ArchivedConnections } from './archived-connections';
import { EnvironmentColumn } from './environment-column';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { SyncGutter } from './sync-gutter';
import { SyncDialog } from '../sync-dialog';

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

	return (
		<div className="flex flex-col gap-6 p-6">
			<div className="flex flex-row items-stretch gap-4">
				<div className="flex-1">
					<EnvironmentColumn
						kind="local"
						label="Local"
						localSiteId={ selectedSite.id }
						siteName={ selectedSite.name }
						siteUrl={
							selectedSite.running
								? `http://localhost:${ selectedSite.port }`
								: ''
						}
						isRunning={ selectedSite.running }
					/>
				</div>

				{ production ? (
					<>
						<SyncGutter
							from={ { kind: 'local', label: 'Local' } }
							to={ { kind: 'remote', label: 'Production' } }
							lastPushTimestamp={ production.lastPushTimestamp }
							lastPullTimestamp={ production.lastPullTimestamp }
							onPush={ () => syncActions.push( production ) }
							onPull={ () => syncActions.pull( production ) }
						/>
						<div className="flex-1">
							<EnvironmentColumn kind="remote" label="Production" site={ production } />
						</div>
					</>
				) : (
					<div className="flex-1">
						<ConnectProductionCard onClick={ openConnectModal } />
					</div>
				) }

				{ production &&
					( staging ? (
						<>
							{ /*
							  Semantic note: In UI terms, "push" in the staging↔production gutter
							  means Promote (staging → prod). In the wpcom API, that corresponds
							  to the `pull-from-staging` endpoint (wpcom describes the flow from
							  production's perspective). Wired in Task 21.
							*/ }
							<SyncGutter
								from={ { kind: 'remote', label: 'Production' } }
								to={ { kind: 'remote', label: 'Staging' } }
								lastPushTimestamp={ null }
								lastPullTimestamp={ null }
								onPush={ () => {
									/* Task 21: pushToStaging / pullFromStaging */
								} }
								onPull={ () => {
									/* Task 21 */
								} }
							/>
							<div className="flex-1">
								<EnvironmentColumn kind="remote" label="Staging" site={ staging } />
							</div>
						</>
					) : provisioning.state === 'idle' ? (
						<div className="flex-1">
							<CreateStagingCard onClick={ provisioning.start } />
						</div>
					) : (
						<div className="flex-1">
							<ProvisioningColumn
								state={ provisioning.state }
								error={ provisioning.error }
								onRetry={ provisioning.start }
							/>
						</div>
					) ) }
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
