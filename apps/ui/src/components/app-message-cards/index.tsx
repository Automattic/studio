import { __, sprintf } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import toastStyles from '@/components/app-toasts/style.module.css';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useActivePersistentMessages } from '@/data/queries/use-app-messages';
import { REPORT_ISSUE_URL } from '@/lib/docs-links';
import styles from './style.module.css';

export function StudioBetaCard( { className }: { className?: string } ) {
	const connector = useConnector();
	const { data: appGlobals } = useAppGlobals();

	return (
		<Menu.Root>
			<div className={ clsx( styles.stack, className ) }>
				<div className={ styles.cell }>
					<Menu.Trigger
						render={
							<button
								type="button"
								className={ styles.betaCardButton }
								aria-label={ __( 'Studio Beta options' ) }
							/>
						}
					>
						<span className={ styles.betaLabel }>{ __( 'Beta' ) }</span>
					</Menu.Trigger>
				</div>
			</div>
			<Menu.Popup side="top" align="start">
				{ connector.capabilities.switchToClassicUi ? (
					<Menu.Item onClick={ () => void connector.disableAgenticUi() }>
						{ __( 'Switch to Studio Classic' ) }
					</Menu.Item>
				) : null }
				<Menu.Item onClick={ () => void connector.openExternalUrl( REPORT_ISSUE_URL ) }>
					{ __( 'Send feedback' ) }
				</Menu.Item>
				{ appGlobals?.appVersion ? (
					<>
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>
								{ sprintf( __( 'Studio %s' ), appGlobals.appVersion ) }
							</Menu.GroupLabel>
						</Menu.Group>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}

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
