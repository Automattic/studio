import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import styles from './info-dialog.module.css';
import type { ReactNode } from 'react';

type Props = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	title: string;
	children: ReactNode;
};

export function InfoDialog( { open, onOpenChange, title, children }: Props ) {
	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ title }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content className={ styles.content }>{ children }</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="solid" tone="brand">
						{ __( 'Got it' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
