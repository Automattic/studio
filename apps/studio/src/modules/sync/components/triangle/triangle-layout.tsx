import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch } from 'src/stores';
import {
	useGetConnectedSitesForLocalSiteQuery,
	connectedSitesActions,
} from 'src/stores/sync/connected-sites';
import {
	useGetStagingSyncStateQuery,
	usePullFromStagingMutation,
	usePushToStagingMutation,
} from 'src/stores/sync/staging-site-api';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { useSyncActions } from '../../hooks/use-sync-actions';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import { SyncDialog } from '../sync-dialog';
import { ArchivedConnections } from './archived-connections';
import { EnvironmentColumn } from './environment-column';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { SyncGutter } from './sync-gutter';
import type { SyncOption } from '@studio/common/types/sync';

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
	const [ pushToStaging ] = usePushToStagingMutation();
	const [ pullFromStaging ] = usePullFromStagingMutation();
	const { data: syncState } = useGetStagingSyncStateQuery(
		{ productionSiteId: production?.id ?? 0 },
		{ skip: ! production || ! staging }
	);

	const DEFAULT_STAGING_OPTIONS: SyncOption[] = [
		'sqls',
		'uploads',
		'plugins',
		'themes',
		'contents',
	];

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
						siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
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
								lastPushTimestamp={
									syncState?.direction === 'push' && syncState.finished_at
										? syncState.finished_at
										: null
								}
								lastPullTimestamp={
									syncState?.direction === 'pull' && syncState.finished_at
										? syncState.finished_at
										: null
								}
								onPush={ () => {
									// UI push (staging→prod) = wpcom "pull-from-staging".
									void pullFromStaging( {
										productionSiteId: production!.id,
										stagingSiteId: staging!.id,
										options: DEFAULT_STAGING_OPTIONS,
										allowWooSync: false,
									} );
								} }
								onPull={ () => {
									// UI pull (prod→staging) = wpcom "push-to-staging".
									void pushToStaging( {
										productionSiteId: production!.id,
										stagingSiteId: staging!.id,
										options: DEFAULT_STAGING_OPTIONS,
									} );
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
