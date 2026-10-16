import { __, sprintf } from '@wordpress/i18n';
import { arrowDown, arrowUp, caution, external, Icon, moreHorizontal } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { EnvironmentSection } from './environment-section';
import styles from './environment-section.module.css';
import { RemoteSiteBadges } from './remote-site-badges';
import { getPullLabel, getPushLabel } from './trigger-secondary';
import { ensureProtocol, stripProtocol } from './utils';
import type { SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

type Props = {
	liveSites: SyncSite[];
	activity: SyncActivity | null;
	notice: string | null;
	actionLabel: string;
	actionDisabled: boolean;
	actionLoading: boolean;
	onAction: () => void;
	canSync: boolean;
	getSyncLabel: ( idle: string, pending: string, isPending: boolean ) => string;
	onPull: ( liveSite: SyncSite ) => void;
	onPush: ( liveSite: SyncSite ) => void;
	onDisconnect: ( liveSite: SyncSite ) => void;
};

export function LiveSitesSection( {
	liveSites,
	activity,
	notice,
	actionLabel,
	actionDisabled,
	actionLoading,
	onAction,
	canSync,
	getSyncLabel,
	onPull,
	onPush,
	onDisconnect,
}: Props ) {
	const connector = useConnector();

	const pendingFor = ( liveSite: SyncSite, direction: 'push' | 'pull' ) =>
		activity?.kind === 'pending' &&
		activity.direction === direction &&
		activity.remoteSiteId === liveSite.id;

	return (
		<EnvironmentSection
			title={ __( 'Live sites' ) }
			count={ liveSites.length }
			actionLabel={ actionLabel }
			actionDisabled={ actionDisabled }
			actionLoading={ actionLoading }
			onAction={ onAction }
			status={ liveSites.length === 0 ? notice : null }
		>
			{ liveSites.map( ( liveSite ) => {
				const isUnavailable = liveSite.syncSupport === 'deleted';
				const name = isUnavailable
					? __( 'Unavailable site' )
					: liveSite.name || stripProtocol( liveSite.url );
				const isPulling = pendingFor( liveSite, 'pull' );
				const isPushing = pendingFor( liveSite, 'push' );
				const lastSynced = [ getPullLabel( liveSite ), getPushLabel( liveSite ) ]
					.filter( Boolean )
					.join( ' · ' );
				return (
					<div
						key={ liveSite.id }
						className={ clsx( styles.row, isUnavailable && styles.row_expired ) }
					>
						<div className={ styles.rowText }>
							<div className={ styles.nameLine }>
								<span className={ styles.name }>{ name }</span>
								{ ! isUnavailable && <RemoteSiteBadges site={ liveSite } /> }
							</div>
							{ isUnavailable ? (
								<div className={ clsx( styles.meta, styles.meta_expired ) }>
									<Icon icon={ caution } size={ 14 } aria-hidden="true" />
									{ __( 'Deleted, or you no longer have access' ) }
								</div>
							) : (
								<>
									<button
										type="button"
										className={ styles.url }
										aria-label={ sprintf(
											/* translators: %s: live site name */
											__( 'Open %s in your browser' ),
											name
										) }
										onClick={ () =>
											void connector.openExternalUrl( ensureProtocol( liveSite.url ) )
										}
									>
										<span>{ stripProtocol( liveSite.url ) }</span>
										<Icon icon={ external } size={ 12 } aria-hidden="true" />
									</button>
									{ lastSynced ? <div className={ styles.meta }>{ lastSynced }</div> : null }
								</>
							) }
						</div>
						<div className={ styles.actions }>
							{ ! isUnavailable && (
								<>
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ arrowDown }
										label={ getSyncLabel(
											__( 'Pull from live' ),
											__( 'Pulling from live…' ),
											isPulling
										) }
										className={ styles.actionButton }
										loading={ isPulling }
										loadingAnnouncement={ __( 'Pulling from live' ) }
										disabled={ ! canSync }
										focusableWhenDisabled
										onClick={ () => onPull( liveSite ) }
									/>
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ arrowUp }
										label={ getSyncLabel(
											__( 'Push to live' ),
											__( 'Pushing to live…' ),
											isPushing
										) }
										className={ styles.actionButton }
										loading={ isPushing }
										loadingAnnouncement={ __( 'Pushing to live' ) }
										disabled={ ! canSync }
										focusableWhenDisabled
										onClick={ () => onPush( liveSite ) }
									/>
								</>
							) }
							<Menu.SubmenuRoot>
								<Menu.SubmenuTrigger
									className={ styles.moreMenuTrigger }
									disabled={ ! canSync }
									aria-label={ sprintf(
										/* translators: %s: live site name */
										__( 'More actions for %s' ),
										name
									) }
								>
									<Icon icon={ moreHorizontal } size={ 16 } aria-hidden="true" />
								</Menu.SubmenuTrigger>
								<Menu.Popup side="right" align="start" className={ styles.moreMenuPopup }>
									<Menu.Item onClick={ () => onDisconnect( liveSite ) }>
										{ __( 'Disconnect' ) }
									</Menu.Item>
								</Menu.Popup>
							</Menu.SubmenuRoot>
						</div>
					</div>
				);
			} ) }
		</EnvironmentSection>
	);
}
