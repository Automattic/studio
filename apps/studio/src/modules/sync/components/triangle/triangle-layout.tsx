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
			<div className="flex flex-col gap-2">
				{ /*
				  Row order: Staging (top) → Production → Local (bottom).
				  Rationale: "pull" reads as a downward motion (from remote down to Local),
				  so putting Local at the bottom aligns the arrows with the mental model.
				*/ }

				{ production &&
					( staging ? (
						<>
							<EnvironmentColumn kind="remote" label="Staging" site={ staging } />
							<SyncGutter
								from={ { kind: 'remote', label: 'Staging' } }
								to={ { kind: 'remote', label: 'Production' } }
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
								// Promote (staging→prod) moves down visually; refresh staging
								// from prod moves up. wpcom API mapping is inverted: UI "push"
								// (promote) = wpcom pull-from-staging; UI "pull" (refresh staging)
								// = wpcom push-to-staging.
								pushArrow="↓"
								pullArrow="↑"
								onPush={ () => {
									void pullFromStaging( {
										productionSiteId: production!.id,
										stagingSiteId: staging!.id,
										options: DEFAULT_STAGING_OPTIONS,
										allowWooSync: false,
									} );
								} }
								onPull={ () => {
									void pushToStaging( {
										productionSiteId: production!.id,
										stagingSiteId: staging!.id,
										options: DEFAULT_STAGING_OPTIONS,
									} );
								} }
							/>
						</>
					) : provisioning.state === 'idle' ? (
						<CreateStagingCard onClick={ provisioning.start } />
					) : (
						<ProvisioningColumn
							state={ provisioning.state }
							error={ provisioning.error }
							onRetry={ provisioning.start }
						/>
					) ) }

				{ production ? (
					<>
						<EnvironmentColumn kind="remote" label="Production" site={ production } />
						<SyncGutter
							from={ { kind: 'local', label: 'Local' } }
							to={ { kind: 'remote', label: 'Production' } }
							lastPushTimestamp={ production.lastPushTimestamp }
							lastPullTimestamp={ production.lastPullTimestamp }
							// Production is above Local: push goes up to prod, pull comes down.
							pushArrow="↑"
							pullArrow="↓"
							onPush={ () => syncActions.push( production ) }
							onPull={ () => syncActions.pull( production ) }
						/>
					</>
				) : (
					<ConnectProductionCard onClick={ openConnectModal } />
				) }

				<EnvironmentColumn
					kind="local"
					label="Local"
					localSiteId={ selectedSite.id }
					siteName={ selectedSite.name }
					siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
					isRunning={ selectedSite.running }
				/>
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
