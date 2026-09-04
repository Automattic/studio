import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import styles from './database-intro.module.css';

interface DatabaseIntroProps {
	onDismiss: () => void;
}

export function DatabaseIntro( { onDismiss }: DatabaseIntroProps ) {
	const connector = useConnector();
	const phpMyAdminUrl = 'https://www.phpmyadmin.net/';

	return (
		<div className={ styles.positioner }>
			<Notice.Root intent="warning" className={ styles.notice }>
				<Notice.Title>{ __( 'About the Database' ) }</Notice.Title>
				<Notice.Description>
					{ __(
						"The Database tab uses phpMyAdmin, an open-source tool for browsing and editing the data behind your WordPress site. Changes take effect immediately, so take care when editing tables or running SQL. You can also ask Studio Code to inspect the database, make a change, or explain what you're seeing."
					) }
				</Notice.Description>
				<Notice.Actions>
					<Notice.ActionButton variant="outline" onClick={ onDismiss }>
						{ __( 'Got it' ) }
					</Notice.ActionButton>
					<Notice.ActionLink
						href={ phpMyAdminUrl }
						onClick={ ( event ) => {
							event.preventDefault();
							void connector.openExternalUrl( phpMyAdminUrl );
						} }
					>
						{ __( 'About phpMyAdmin' ) }
					</Notice.ActionLink>
				</Notice.Actions>
				<Notice.CloseIcon label={ __( 'Dismiss database introduction' ) } onClick={ onDismiss } />
			</Notice.Root>
		</div>
	);
}
