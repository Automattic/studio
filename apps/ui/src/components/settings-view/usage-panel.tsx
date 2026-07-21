import { __, _n, sprintf } from '@wordpress/i18n';
import { moreHorizontal } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

function PreviewSitesSummary( { userId }: { userId: number } ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const { data: snapshots, isLoading } = useSnapshots( userId );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useSnapshotUsage( userId );
	const deleteAllSnapshots = useDeleteAllSnapshots( userId );
	const siteCount = snapshotUsage?.siteCount ?? snapshots?.length ?? 0;
	const siteLimit = snapshotUsage?.siteLimit ?? DEFAULT_PREVIEW_SITE_LIMIT;
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const isLoadingPreviewUsage = isLoading || isLoadingSnapshotUsage || deleteAllSnapshots.isPending;
	const isDisabled =
		siteCount === 0 || snapshotCreationBlocked || isLoadingPreviewUsage || isOffline;
	const progress = Math.min( siteCount / Math.max( siteLimit, 1 ), 1 ) * 100;
	const deletePreviewSitesLabel = isOffline
		? __( 'Deleting preview sites requires an internet connection.' )
		: deleteAllSnapshots.isPending
		? __( 'Deleting preview sites...' )
		: __( 'Delete all preview sites' );

	const handleDelete = async () => {
		if ( isDisabled ) {
			return;
		}
		const confirmed = await connector.confirmDeleteAllPreviewSites();
		if ( confirmed ) {
			deleteAllSnapshots.mutate();
		}
	};

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ __( 'Preview sites' ) }</h2>
				{ ! snapshotCreationBlocked ? (
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ moreHorizontal }
									label={ __( 'Preview site actions' ) }
									className={ styles.previewActionsButton }
									disabled={ isDisabled }
								/>
							}
						/>
						<Menu.Popup side="bottom" align="end">
							<Menu.Item disabled={ isDisabled } onClick={ () => void handleDelete() }>
								{ deletePreviewSitesLabel }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : null }
			</div>
			{ snapshotCreationBlocked ? (
				<div className={ styles.previewUsageText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</div>
			) : (
				<>
					<div className={ styles.previewUsageText }>
						{ isLoadingPreviewUsage
							? __( 'Loading...' )
							: sprintf(
									/* translators: 1: number of active preview sites, 2: maximum allowed */
									_n(
										'%1$d of %2$d active preview site',
										'%1$d of %2$d active preview sites',
										siteCount
									),
									siteCount,
									siteLimit
							  ) }
					</div>
					<div className={ styles.progressTrack } aria-hidden="true">
						<div className={ styles.progressValue } style={ { inlineSize: `${ progress }%` } } />
					</div>
				</>
			) }
			{ deleteAllSnapshots.error ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while deleting preview sites. Please try again.' ) }
				</div>
			) : null }
		</section>
	);
}

export function UsagePanel() {
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin();

	return (
		<div className={ styles.usagePanel }>
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Usage' ) }</h2>
					<p>{ __( 'Track your preview site usage and Studio Code AI credits.' ) }</p>
				</div>
				<section className={ styles.usageSection }>
					<div className={ styles.usageSectionHeader }>
						<h2>{ __( 'AI credits' ) }</h2>
					</div>
					<p>
						{ __(
							'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
						) }
					</p>
					<div className={ clsx( styles.progressTrack, styles.aiCreditsTrack ) } aria-hidden="true">
						<div className={ styles.aiCreditsMeterValue } />
					</div>
				</section>
				{ user ? (
					<PreviewSitesSummary userId={ user.id } />
				) : (
					<section className={ styles.usageSection }>
						<div className={ styles.usageSectionHeader }>
							<h2>{ __( 'Preview sites' ) }</h2>
						</div>
						<p>
							{ isLoading
								? __( 'Loading...' )
								: __( 'Log in to view preview site usage for your account.' ) }
						</p>
						{ ! isLoading ? (
							<Button
								type="button"
								variant="outline"
								tone="neutral"
								size="small"
								className={ styles.usageSectionAction }
								loading={ login.isPending }
								loadingAnnouncement={ __( 'Logging in' ) }
								onClick={ () => login.mutate() }
							>
								{ __( 'Log in' ) }
							</Button>
						) : null }
					</section>
				) }
			</section>
		</div>
	);
}
