import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { Button, Popover } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { useConnector, type Snapshot } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import styles from './style.module.css';

export function PreviewExpiry( { snapshot }: { snapshot: Snapshot } ) {
	const locale = useUserLocale();
	const connector = useConnector();
	return (
		<p className={ styles.previewExpiry }>
			<Popover.Root>
				<Popover.Trigger
					openOnHover
					render={
						<Button className={ styles.previewExpiryLink } variant="inline-link" size="inline" />
					}
				>
					{ __( 'Expires' ) }
				</Popover.Trigger>
				<Popover.Popup
					variant="tooltip"
					className={ styles.previewExpiryPopover }
					side="top"
					align="center"
					sideOffset={ 2 }
					aria-label={ __( 'Preview expiration' ) }
				>
					<div>
						{ __(
							'Preview sites are temporary. Updating your preview resets the expiration date.'
						) }{ ' ' }
						<Button
							variant="inline-accent"
							size="inline"
							onClick={ () =>
								void connector.openExternalUrl(
									'https://wordpress.studio/docs/preview-sites/#preview-expiration'
								)
							}
						>
							{ __( 'Learn more' ) }
						</Button>
					</div>
				</Popover.Popup>
			</Popover.Root>{ ' ' }
			{ new Date( getSnapshotExpiry( snapshot ) ).toLocaleDateString( locale, {
				month: 'short',
				day: 'numeric',
			} ) }
		</p>
	);
}
