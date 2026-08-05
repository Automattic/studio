import { __, sprintf } from '@wordpress/i18n';
import { external, Icon, moreVertical, plus } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import * as Menu from '@/components/menu';
import { formatSyncTimestamp } from '@/components/site-toolbar/derive-toolbar-state';
import { DisconnectSiteDialog } from '@/components/site-toolbar/disconnect-site-dialog';
import { PublishSiteDialog } from '@/components/site-toolbar/publish-site-dialog';
import {
	ensureProtocol,
	getConnectionLabel,
	sortConnections,
	stripProtocol,
} from '@/components/site-toolbar/utils';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import styles from './connections-tab.module.css';
import type { SiteDetails, SyncSite } from '@/data/core';

function lastSyncSummary( connection: SyncSite ): string {
	const pushedAt = formatSyncTimestamp( connection.lastPushTimestamp );
	const pulledAt = formatSyncTimestamp( connection.lastPullTimestamp );
	if ( pushedAt ) {
		// translators: %s: compact relative time, e.g. "6d".
		return sprintf( __( 'Pushed %s ago' ), pushedAt );
	}
	if ( pulledAt ) {
		// translators: %s: compact relative time, e.g. "6d".
		return sprintf( __( 'Pulled %s ago' ), pulledAt );
	}
	return __( 'Never synced' );
}

/**
 * Everywhere this local site is connected: where each one lives, when it was
 * last synced, and the ways in and out of the set. Push and pull name their own
 * target from the header, so nothing here is "selected" — this is the ledger,
 * not a mode switch.
 */
export function ConnectionsTab( {
	site,
	compact = false,
}: {
	site: SiteDetails;
	compact?: boolean;
} ) {
	const connector = useConnector();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const connections = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );
	const [ picking, setPicking ] = useState( false );
	const [ disconnecting, setDisconnecting ] = useState< SyncSite | null >( null );

	return (
		<div className={ clsx( styles.root, compact && styles.compact ) }>
			{ ! compact ? (
				<p className={ styles.intro }>
					{ __(
						'Add one or more remote sites, then choose where to push changes or where to pull them from.'
					) }
				</p>
			) : null }
			{ connections.length === 0 ? (
				<p className={ styles.empty }>{ __( 'Not connected to WordPress.com yet.' ) }</p>
			) : (
				<ul className={ styles.list }>
					{ connections.map( ( connection ) => (
						<li key={ connection.id } className={ styles.row }>
							<div className={ styles.rowTop }>
								<span className={ styles.rowUrl }>{ stripProtocol( connection.url ) }</span>
								<span className={ styles.rowDate }>{ lastSyncSummary( connection ) }</span>
							</div>
							<div className={ styles.rowBottom }>
								<span className={ styles.environmentPill }>
									{ getConnectionLabel( connection ) }
								</span>
								<div className={ styles.rowActions }>
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ external }
										label={ __( 'Open site' ) }
										onClick={ () =>
											void connector.openExternalUrl( ensureProtocol( connection.url ) )
										}
									/>
									<CopyButton
										text={ ensureProtocol( connection.url ) }
										label={ __( 'Copy URL' ) }
									/>
									<Menu.Root>
										<Menu.Trigger
											render={
												<Button
													variant="minimal"
													tone="neutral"
													size="small"
													className={ styles.overflowButton }
													aria-label={ __( 'More options' ) }
												/>
											}
										>
											<Icon icon={ moreVertical } size={ 16 } aria-hidden="true" />
										</Menu.Trigger>
										<Menu.Popup side="bottom" align="end">
											<Menu.Item
												className={ styles.disconnectMenuItem }
												onClick={ () => setDisconnecting( connection ) }
											>
												{ __( 'Disconnect' ) }
											</Menu.Item>
										</Menu.Popup>
									</Menu.Root>
								</div>
							</div>
						</li>
					) ) }
				</ul>
			) }
			<Button
				variant="minimal"
				tone="neutral"
				size="compact"
				className={ styles.addButton }
				onClick={ () => setPicking( true ) }
			>
				<Icon icon={ plus } size={ 16 } aria-hidden="true" />
				{ __( 'Connect another site' ) }
			</Button>

			{ picking ? <PublishSiteDialog site={ site } open onOpenChange={ setPicking } /> : null }

			{ disconnecting ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ disconnecting }
					open
					onOpenChange={ ( next ) => {
						if ( ! next ) {
							setDisconnecting( null );
						}
					} }
				/>
			) : null }
		</div>
	);
}
