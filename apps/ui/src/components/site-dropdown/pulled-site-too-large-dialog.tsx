import { SYNC_PUSH_SIZE_LIMIT_GB } from '@studio/common/lib/sync/constants';
import { __, sprintf } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import styles from './pulled-site-too-large-dialog.module.css';

type Props = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

/**
 * Shown after a pull that brought down more than the push limit allows.
 *
 * It reports rather than asks: the pull has already finished by the time the
 * size is known, so there is nothing left to cancel. "May" is deliberate — the
 * measurement is of uncompressed files, while the limit applies to a gzipped
 * archive, so it over-reports. See `isSiteOverPushSizeLimit`.
 */
export function PulledSiteTooLargeDialog( { open, onOpenChange }: Props ) {
	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'This site may be too large to push back' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.dialogText }>
						{ sprintf(
							__(
								'The site you pulled is over %d GB, which may prevent you from pushing it back to WordPress.com. Removing unused media, plugins or themes from wp-content will bring it down.'
							),
							SYNC_PUSH_SIZE_LIMIT_GB
						) }
					</p>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="solid" tone="brand">
						{ __( 'Got it' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
