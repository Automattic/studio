import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import toastStyles from '@/components/app-toasts/style.module.css';
import { useActivePersistentMessages } from '@/data/queries/use-app-messages';
import styles from './style.module.css';

export function AppMessageCards( { className }: { className?: string } ) {
	const { messages, dismiss } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return (
		<div className={ clsx( styles.stack, className ) }>
			{ messages.map( ( message ) => (
				<div key={ message.id } className={ styles.cell }>
					<Notice.Root
						intent={ message.intent }
						icon={ null }
						className={ clsx( toastStyles.notice, styles.card ) }
					>
						<Notice.Title>{ message.title }</Notice.Title>
						{ message.description ? (
							<Notice.Description>{ message.description }</Notice.Description>
						) : null }
						{ message.cta ? (
							<Notice.Actions>
								<Button
									size="small"
									variant="solid"
									tone="neutral"
									className={ toastStyles.actionButton }
									onClick={ message.cta.onClick }
								>
									{ message.cta.label }
								</Button>
							</Notice.Actions>
						) : null }
						<Notice.CloseIcon label={ __( 'Dismiss' ) } onClick={ () => dismiss( message ) } />
					</Notice.Root>
				</div>
			) ) }
		</div>
	);
}

export function AppMessageCardsDot( { className }: { className?: string } ) {
	const { messages } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return <span className={ clsx( styles.dot, className ) } aria-hidden="true" />;
}
