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
				  Row order (top → bottom): Production → Staging → Local.
				  Local at the bottom keeps "pull" reading as a downward motion. Staging
				  sits in the middle so sync work flows Production ↕ Staging ↕ Local.
				*/ }

				{ production ? (
					<EnvironmentColumn kind="remote" label="Production" site={ production } />
				) : (
					<ConnectProductionCard onClick={ openConnectModal } />
				) }

				{ production && staging && (
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
						// Production is above Staging in the new layout: Push to Staging
						// moves down; Pull from Staging moves up.
						pushArrow="↓"
						pullArrow="↑"
						onPush={ () => {
							void pushToStaging( {
								productionSiteId: production.id,
								stagingSiteId: staging.id,
								options: DEFAULT_STAGING_OPTIONS,
							} );
						} }
						onPull={ () => {
							void pullFromStaging( {
								productionSiteId: production.id,
								stagingSiteId: staging.id,
								options: DEFAULT_STAGING_OPTIONS,
								allowWooSync: false,
							} );
						} }
					/>
				) }

				{ production && ! staging && provisioning.state === 'idle' && (
					<CreateStagingCard onClick={ provisioning.start } />
				) }
				{ production && ! staging && provisioning.state !== 'idle' && (
					<ProvisioningColumn
						state={ provisioning.state }
						error={ provisioning.error }
						onRetry={ provisioning.start }
					/>
				) }

				{ staging && <EnvironmentColumn kind="remote" label="Staging" site={ staging } /> }

				{ /*
				  Local↔remote gutter. When staging exists, Local syncs with Staging; when
				  there's no staging, Local syncs directly with Production. The staging-first
				  flow encourages users to stage changes before promoting them to production.
				*/ }
				{ production &&
					( staging ? (
						<SyncGutter
							from={ { kind: 'local', label: 'Local' } }
							to={ { kind: 'remote', label: 'Staging' } }
							lastPushTimestamp={ staging.lastPushTimestamp }
							lastPullTimestamp={ staging.lastPullTimestamp }
							// Staging is above Local: push up, pull down.
							pushArrow="↑"
							pullArrow="↓"
							onPush={ () => syncActions.push( staging ) }
							onPull={ () => syncActions.pull( staging ) }
						/>
					) : (
						<SyncGutter
							from={ { kind: 'local', label: 'Local' } }
							to={ { kind: 'remote', label: 'Production' } }
							lastPushTimestamp={ production.lastPushTimestamp }
							lastPullTimestamp={ production.lastPullTimestamp }
							pushArrow="↑"
							pullArrow="↓"
							onPush={ () => syncActions.push( production ) }
							onPull={ () => syncActions.pull( production ) }
						/>
					) ) }

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
