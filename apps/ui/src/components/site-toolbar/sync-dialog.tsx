import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { formatSyncTimestamp } from './derive-toolbar-state';
import styles from './sync-dialog.module.css';
import { getConnectionLabel, stripProtocol } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';

export type SyncDirection = 'push' | 'pull';

type Props = {
	site: SiteDetails;
	connections: SyncSite[];
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onRun: ( direction: SyncDirection, target: SyncSite ) => void;
};

function lastSyncSummary( connection: SyncSite, direction: SyncDirection ): string {
	const at = formatSyncTimestamp(
		direction === 'push' ? connection.lastPushTimestamp : connection.lastPullTimestamp
	);
	if ( ! at ) {
		return direction === 'push' ? __( 'Never pushed' ) : __( 'Never pulled' );
	}
	return direction === 'push'
		? // translators: %s: compact relative time, e.g. "6d".
		  sprintf( __( 'Pushed %s ago' ), at )
		: // translators: %s: compact relative time, e.g. "6d".
		  sprintf( __( 'Pulled %s ago' ), at );
}

/**
 * One place to answer everything a sync needs: which way it goes, which
 * connected site it touches, and what it carries. Modelled on the legacy sync
 * dialog, which asked the same questions — this pairs it back to the two
 * choices that matter at this level rather than a full file tree.
 */
export function SyncDialog( { site, connections, open, onOpenChange, onRun }: Props ) {
	const [ direction, setDirection ] = useState< SyncDirection >( 'push' );
	const [ targetId, setTargetId ] = useState< number | null >( null );
	const [ includeFiles, setIncludeFiles ] = useState( true );
	const [ includeDatabase, setIncludeDatabase ] = useState( true );

	const target = connections.find( ( candidate ) => candidate.id === targetId ) ?? connections[ 0 ];
	const canRun = Boolean( target ) && ( includeFiles || includeDatabase );

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="medium">
				<Dialog.Header>
					<Dialog.Title>
						{ sprintf(
							// translators: %s: the Studio site's name.
							__( 'Sync %s' ),
							site.name
						) }
					</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<fieldset className={ styles.field }>
						<legend className={ styles.legend }>{ __( 'Direction' ) }</legend>
						<div className={ styles.directions }>
							{ ( [ 'push', 'pull' ] as const ).map( ( option ) => (
								<button
									key={ option }
									type="button"
									className={ clsx(
										styles.direction,
										direction === option && styles.directionSelected
									) }
									aria-pressed={ direction === option }
									onClick={ () => setDirection( option ) }
								>
									<span className={ styles.directionTitle }>
										{ option === 'push' ? __( 'Push' ) : __( 'Pull' ) }
									</span>
									<span className={ styles.directionRoute }>
										{ option === 'push'
											? __( 'Studio → WordPress.com' )
											: __( 'WordPress.com → Studio' ) }
									</span>
									<span className={ styles.directionWarning }>
										{ option === 'push'
											? __( 'Replaces the live site with this one.' )
											: __( 'Replaces this site with the live one.' ) }
									</span>
								</button>
							) ) }
						</div>
					</fieldset>

					{ connections.length > 1 ? (
						<fieldset className={ styles.field }>
							<legend className={ styles.legend }>
								{ direction === 'push' ? __( 'Push to' ) : __( 'Pull from' ) }
							</legend>
							<div className={ styles.targets }>
								{ connections.map( ( connection ) => (
									<label
										key={ connection.id }
										className={ clsx(
											styles.target,
											connection.id === target?.id && styles.targetSelected
										) }
									>
										<input
											type="radio"
											name="sync-target"
											checked={ connection.id === target?.id }
											onChange={ () => setTargetId( connection.id ) }
										/>
										<span className={ styles.targetText }>
											<span className={ styles.targetTitle }>
												{ getConnectionLabel( connection ) }
											</span>
											<span className={ styles.targetMeta }>
												{ stripProtocol( connection.url ) } ·{ ' ' }
												{ lastSyncSummary( connection, direction ) }
											</span>
										</span>
									</label>
								) ) }
							</div>
						</fieldset>
					) : null }

					<fieldset className={ styles.field }>
						<legend className={ styles.legend }>{ __( 'What to sync' ) }</legend>
						<label className={ styles.check }>
							<input
								type="checkbox"
								checked={ includeFiles }
								onChange={ ( event ) => setIncludeFiles( event.target.checked ) }
							/>
							<span className={ styles.checkText }>
								<span>{ __( 'Files and folders' ) }</span>
								<span className={ styles.checkMeta }>
									{ __( 'Themes, plugins, and uploads in wp-content' ) }
								</span>
							</span>
						</label>
						<label className={ styles.check }>
							<input
								type="checkbox"
								checked={ includeDatabase }
								onChange={ ( event ) => setIncludeDatabase( event.target.checked ) }
							/>
							<span className={ styles.checkText }>
								<span>{ __( 'Database' ) }</span>
								<span className={ styles.checkMeta }>
									{ __( 'Posts, pages, settings, and users' ) }
								</span>
							</span>
						</label>
						{ /* The agentic connector runs the CLI's full export/import, so a
						     partial selection has nowhere to go yet. Say so rather than
						     letting the checkboxes imply otherwise. */ }
						{ ! includeFiles || ! includeDatabase ? (
							<p className={ styles.notice }>
								{ __(
									'Studio still syncs everything for now — choosing parts of a site is not wired up yet.'
								) }
							</p>
						) : null }
					</fieldset>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						disabled={ ! canRun }
						onClick={ () => {
							if ( target ) {
								onRun( direction, target );
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
