import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import buttonDefense from './wp-ui-button-defense.module.css';
import dialogDefense from './wp-ui-dialog-defense.module.css';
import type { PendingSiteCreation } from './use-site-creation-switch';

/**
 * Shown when the agent creates a new site mid-conversation. The conversation
 * has already been re-homed to the new site; this asks whether to follow it
 * there or stay on the current site with a fresh chat.
 *
 * Pure presentation: the switch/new-chat logic lives in
 * `useSiteCreationSwitch`.
 */
export function SiteCreatedDialog( {
	pending,
	onOpenNewSite,
	onStayHere,
}: {
	pending: PendingSiteCreation | null;
	onOpenNewSite: () => void;
	onStayHere: () => void;
} ) {
	return (
		<Dialog.Root
			open={ pending !== null }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onStayHere();
				}
			} }
		>
			<Dialog.Popup size="small" className={ dialogDefense.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Site created' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>
						{ pending
							? sprintf(
									/* translators: %s: name of the newly created site. */
									__(
										'This conversation has moved to %s. Open it to keep going there, or stay here with a fresh chat.'
									),
									pending.siteName
							  )
							: '' }
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action
						variant="minimal"
						tone="neutral"
						className={ buttonDefense.button }
						onClick={ onStayHere }
					>
						{ __( 'Stay here' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						className={ buttonDefense.button }
						onClick={ onOpenNewSite }
					>
						{ pending
							? sprintf(
									/* translators: %s: name of the newly created site. */
									__( 'Open %s' ),
									pending.siteName
							  )
							: __( 'Open site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
