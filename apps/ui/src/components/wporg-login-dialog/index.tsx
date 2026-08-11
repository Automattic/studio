import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { setWporgConnected } from '@/lib/wporg-connection';
import styles from './style.module.css';

interface WporgLoginDialogProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
}

/**
 * Stands in for the real WordPress.org login. WordPress.org has no OAuth and
 * its login form is guarded by reCAPTCHA and mandatory 2FA, which blocks an
 * automated session capture — so we're honest about it: this dialog explains
 * the simulation, and confirming pretends the account is connected.
 */
export function WporgLoginDialog( { open, onOpenChange }: WporgLoginDialogProps ) {
	const handleConfirm = () => {
		setWporgConnected( true );
		onOpenChange( false );
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Simulated WordPress.org login' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.text }>
						{ __(
							'Signing in to WordPress.org for real isn’t wired up yet. Its login is guarded by reCAPTCHA and requires two-factor authentication, which we can’t automate a session capture around.'
						) }
					</p>
					<p className={ styles.text }>
						{ __(
							'For now, continuing will pretend you’re connected so you can explore the rest of the plugin flow.'
						) }
					</p>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button variant="solid" tone="brand" onClick={ handleConfirm }>
						{ __( 'Continue' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
