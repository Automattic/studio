import { __, sprintf } from '@wordpress/i18n';
import { external, Icon, plus } from '@wordpress/icons';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './connections-dialog.module.css';
import { formatSyncTimestamp } from './derive-toolbar-state';
import { PublishPickerView } from './publish-picker-view';
import { ensureProtocol, getConnectionLabel, stripProtocol } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';

type Props = {
	site: SiteDetails;
	connections: SyncSite[];
	// The connection the toolbar currently pushes and pulls with.
	activeId: number | undefined;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onSelect: ( remoteSiteId: number ) => void;
	onDisconnect: ( connection: SyncSite ) => void;
};

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
 * Everywhere this local site is connected, in one place: which connection the
 * toolbar acts on, where each one lives, and the way in and out of the set.
 */
export function ConnectionsDialog( {
	site,
	connections,
	activeId,
	open,
	onOpenChange,
	onSelect,
	onDisconnect,
}: Props ) {
	const connector = useConnector();
	const [ picking, setPicking ] = useState( false );

	const close = ( next: boolean ) => {
		onOpenChange( next );
		if ( ! next ) {
			setPicking( false );
		}
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ close }>
			<Dialog.Popup size="medium">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Connections' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					{ picking ? (
						<PublishPickerView site={ site } onClose={ () => setPicking( false ) } />
					) : (
						<>
							<p className={ styles.intro }>
								{ __(
									'This Studio site can be connected to more than one WordPress.com site. Push and pull act on the one you choose here.'
								) }
							</p>
							{ connections.length === 0 ? (
								<p className={ styles.empty }>{ __( 'Not connected to WordPress.com yet.' ) }</p>
							) : (
								<ul className={ styles.list }>
									{ connections.map( ( connection ) => {
										const isActive = connection.id === activeId;
										return (
											<li
												key={ connection.id }
												className={ clsx( styles.row, isActive && styles.rowActive ) }
											>
												<div className={ styles.rowText }>
													<span className={ styles.rowTitle }>
														{ getConnectionLabel( connection ) }
														{ isActive ? (
															<span className={ styles.badge }>{ __( 'Active' ) }</span>
														) : null }
													</span>
													<span className={ styles.rowUrl }>
														{ stripProtocol( connection.url ) }
													</span>
													<span className={ styles.rowMeta }>
														{ lastSyncSummary( connection ) }
													</span>
												</div>
												<div className={ styles.rowActions }>
													{ isActive ? null : (
														<Button
															variant="outline"
															tone="neutral"
															size="compact"
															onClick={ () => onSelect( connection.id ) }
														>
															{ __( 'Use this one' ) }
														</Button>
													) }
													<Button
														variant="minimal"
														tone="neutral"
														size="compact"
														onClick={ () =>
															void connector.openExternalUrl( ensureProtocol( connection.url ) )
														}
													>
														{ __( 'Open' ) }
														<Icon icon={ external } size={ 16 } aria-hidden="true" />
													</Button>
													<Button
														variant="minimal"
														tone="neutral"
														size="compact"
														className={ styles.disconnect }
														onClick={ () => onDisconnect( connection ) }
													>
														{ __( 'Disconnect' ) }
													</Button>
												</div>
											</li>
										);
									} ) }
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
						</>
					) }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Done' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
