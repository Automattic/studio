import { NotificationDot } from '@studio/ds';
import { ChevronRightIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { DestinationRow } from './destination-row';
import { isNewDestination } from './new-destination';
import { ProviderLogo } from './provider-logo';
import styles from './style.module.css';
import type { PublishTarget } from './use-publish-targets';

export function DestinationChooser( {
	targets,
	hasChanges,
	focusKey,
	disabled,
	onSelect,
	feedback,
	actionRows,
}: {
	targets: PublishTarget[];
	hasChanges: ( target: PublishTarget ) => boolean;
	focusKey?: string;
	disabled: boolean;
	onSelect: ( target: PublishTarget ) => void;
	feedback?: ReactNode;
	actionRows: ReactNode;
} ) {
	const rows = useRef( new Map< string, HTMLElement >() );
	useEffect( () => {
		if ( disabled || focusKey === 'add-destination' || focusKey === 'connect-existing' ) return;
		const row = focusKey ? rows.current.get( focusKey ) : undefined;
		( row ?? rows.current.values().next().value )?.focus();
	}, [ focusKey, disabled ] );
	const sites = targets.filter( ( target ) => target.remote );
	const previews = targets.filter( ( target ) => target.snapshot );
	const renderTarget = ( target: PublishTarget ) => {
		const { remote, snapshot, provider } = target;
		const hostname = snapshot ? getSnapshotHostname( snapshot ) : new URL( remote!.url ).hostname;
		const live =
			remote &&
			! isNewDestination( remote ) &&
			( !! remote.lastPushTimestamp || remote.launchStatus === 'launched' );
		const changed = hasChanges( target );
		const siteDescription = live
			? sprintf(
					/* translators: %s is the site's hostname. */
					__( '%s · Live site' ),
					hostname
			  )
			: hostname;
		return (
			<DestinationRow
				key={ target.key }
				ref={ ( element ) => {
					if ( element ) rows.current.set( target.key, element );
					else rows.current.delete( target.key );
				} }
				icon={ <ProviderLogo provider={ provider } site={ remote } branded compact /> }
				label={ target.label }
				labelAdornment={
					changed ? <NotificationDot position="inline" tone="current" /> : undefined
				}
				description={ hostname !== target.label ? hostname : undefined }
				data-site
				aria-label={ target.label }
				aria-description={
					changed
						? sprintf(
								/* translators: %s describes the destination. */
								__( '%s · Local changes' ),
								siteDescription
						  )
						: siteDescription
				}
				disabled={ disabled }
				onClick={ () => onSelect( target ) }
				trailing={
					<>
						{ live && <span className={ styles.chooserLive }>{ __( 'Live' ) }</span> }
						<ChevronRightIcon data-navigation-chevron />
					</>
				}
			/>
		);
	};
	return (
		<>
			<div className={ styles.publishRows } data-slot="share-destinations">
				{ sites.map( renderTarget ) }
				{ sites.length > 0 && previews.length > 0 && <hr className={ styles.chooserDivider } /> }
				{ previews.map( renderTarget ) }
				{ actionRows }
			</div>
			{ feedback }
		</>
	);
}
