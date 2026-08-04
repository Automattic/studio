import { __, sprintf } from '@wordpress/i18n';
import { arrowDown, arrowUp, chevronDown, Icon } from '@wordpress/icons';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import styles from './sync-dialog.module.css';
import { createInitialTree, hasSelection, toPullOptions, toPushOptions } from './sync-selection';
import { convertRawToTreeNodes, SyncTree, updateNodeById } from './sync-tree';
import { formatSyncTimestamp, getConnectionLabel, stripProtocol } from './utils';
import type { TreeNode } from './sync-tree';
import type { SyncSite } from '@/data/core';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

export type SyncDirection = 'push' | 'pull';

type Props = {
	siteId: string;
	connections: SyncSite[];
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	// Which direction the dialog opens on. Defaults to push; onboarding opens it
	// on pull to nudge a freshly connected site's first pull.
	initialDirection?: SyncDirection;
	onRun: (
		direction: SyncDirection,
		target: SyncSite,
		options: PushSyncOptions | PullSyncOptions | undefined
	) => void;
};

// Just the age — "4h", "6d". The direction already says what happened then.
function lastSyncAge( connection: SyncSite, direction: SyncDirection ): string | null {
	return formatSyncTimestamp(
		direction === 'push' ? connection.lastPushTimestamp : connection.lastPullTimestamp
	);
}

/** The second line under a connection's URL: what kind it is, and how stale. */
function describeConnection( connection: SyncSite, direction: SyncDirection ): string {
	const age = lastSyncAge( connection, direction );
	return [
		getConnectionLabel( connection ),
		age
			? sprintf(
					// translators: %s: compact relative time, e.g. "6d".
					direction === 'push' ? __( 'pushed %s ago' ) : __( 'pulled %s ago' ),
					age
			  )
			: null,
	]
		.filter( Boolean )
		.join( ' · ' );
}

/**
 * One place to answer everything a sync needs: which way it goes, which
 * connected site it touches, and what it carries.
 *
 * Connections are identified by URL rather than by their Production/Staging
 * label: that label is derived from whether the site's id appears in some other
 * site's `wpcom_staging_blog_ids`, which isn't always known at the time a
 * connection is stored, so two connections can both read "Production". The URL
 * is always right.
 */
export function SyncDialog( {
	siteId,
	connections,
	open,
	onOpenChange,
	initialDirection = 'push',
	onRun,
}: Props ) {
	const connector = useConnector();
	const [ direction, setDirection ] = useState< SyncDirection >( initialDirection );
	const [ targetId, setTargetId ] = useState< number | null >( null );
	const [ tree, setTree ] = useState< TreeNode[] >( createInitialTree );

	const target = connections.find( ( candidate ) => candidate.id === targetId ) ?? connections[ 0 ];

	// Push browses the local site; pull browses the remote backup. Switching
	// direction means the tree describes a different filesystem, so start over.
	useEffect( () => {
		setTree( createInitialTree() );
	}, [ direction, targetId ] );

	const expandNode = useCallback(
		async ( node: TreeNode ) => {
			const path = node.path ?? 'wp-content';
			try {
				if ( direction === 'push' ) {
					const entries = await connector.listLocalFileTree( siteId, path, 1 );
					setTree( ( prev ) =>
						updateNodeById( prev, node.id, {
							children: convertRawToTreeNodes( entries ),
							checked: node.checked,
						} )
					);
					return;
				}
				if ( ! target ) {
					return;
				}
				const rewindId = await connector.getLatestRewindId( target.id );
				if ( ! rewindId ) {
					return;
				}
				const contents = await connector.listRemoteFileTree( target.id, rewindId, path );
				const entries = Object.entries( contents ).map( ( [ name, raw ] ) => {
					const item = raw as { type?: string; has_children?: boolean; id?: string };
					const isDirectory = item.type === 'dir' || item.has_children === true;
					return {
						name,
						isDirectory,
						path: `${ path.replace( /\/$/, '' ) }/${ name }`,
					};
				} );
				setTree( ( prev ) =>
					updateNodeById( prev, node.id, {
						children: convertRawToTreeNodes( entries ),
						checked: node.checked,
					} )
				);
			} catch ( error ) {
				console.error( 'Failed to list sync tree:', error );
				setTree( ( prev ) => updateNodeById( prev, node.id, { children: [] } ) );
			}
		},
		[ connector, direction, siteId, target ]
	);

	const canRun = Boolean( target ) && hasSelection( tree );

	// The label is a hint, not an identifier — see the note above. It sits with
	// the age so the URL above it stands alone.
	const destinationMeta = target ? describeConnection( target, direction ) : '';

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="medium" className={ styles.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Sync this site' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					{ /* Which site first, then which way — the destination is the
					     thing most easily got wrong. */ }
					<div className={ styles.destination }>
						{ connections.length > 1 ? (
							<Menu.Root modal={ false }>
								<Menu.Trigger
									render={
										<button type="button" className={ styles.destinationTrigger }>
											<span className={ styles.destinationTriggerText }>
												<span className={ styles.destinationUrl }>
													{ target ? stripProtocol( target.url ) : __( 'Choose a site' ) }
												</span>
												<span className={ styles.destinationMeta }>{ destinationMeta }</span>
											</span>
											<Icon
												icon={ chevronDown }
												size={ 16 }
												className={ styles.destinationChevron }
												aria-hidden="true"
											/>
										</button>
									}
								/>
								<Menu.Popup side="bottom" align="start" aboveOverlays className={ styles.menu }>
									{ connections.map( ( connection ) => (
										<Menu.Item key={ connection.id } onClick={ () => setTargetId( connection.id ) }>
											<span className={ styles.menuItem }>
												<span className={ styles.destinationUrl }>
													{ stripProtocol( connection.url ) }
												</span>
												<span className={ styles.destinationMeta }>
													{ describeConnection( connection, direction ) }
												</span>
											</span>
										</Menu.Item>
									) ) }
								</Menu.Popup>
							</Menu.Root>
						) : target ? (
							<div className={ styles.destinationStatic }>
								<span className={ styles.destinationUrl }>{ stripProtocol( target.url ) }</span>
								<span className={ styles.destinationMeta }>{ destinationMeta }</span>
							</div>
						) : null }
					</div>

					<div
						className={ styles.directionPicker }
						role="group"
						aria-label={ __( 'Direction' ) }
						data-active-index={ direction === 'push' ? 0 : 1 }
					>
						{ ( [ 'push', 'pull' ] as const ).map( ( option ) => (
							<button
								key={ option }
								type="button"
								className={ clsx(
									styles.directionButton,
									direction === option && styles.directionButtonActive
								) }
								aria-pressed={ direction === option }
								onClick={ () => setDirection( option ) }
							>
								<Icon
									className={ styles.directionIcon }
									icon={ option === 'push' ? arrowUp : arrowDown }
									size={ 16 }
									aria-hidden="true"
								/>
								{ option === 'push' ? __( 'Push' ) : __( 'Pull' ) }
							</button>
						) ) }
					</div>

					<p className={ styles.consequence }>
						{ direction === 'push'
							? __( 'Replaces the live site with this one.' )
							: __( 'Replaces this site with the live one.' ) }
					</p>

					<div className={ styles.whatToSync }>
						<span className={ styles.legend }>{ __( 'What to sync' ) }</span>
						<SyncTree tree={ tree } setTree={ setTree } onExpand={ expandNode } />
					</div>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						size="small"
						className={ styles.run }
						disabled={ ! canRun }
						onClick={ () => {
							if ( target && canRun ) {
								onRun(
									direction,
									target,
									direction === 'push' ? toPushOptions( tree ) : toPullOptions( tree )
								);
								onOpenChange( false );
							}
						} }
					>
						{ direction === 'push' ? __( 'Push' ) : __( 'Pull' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
