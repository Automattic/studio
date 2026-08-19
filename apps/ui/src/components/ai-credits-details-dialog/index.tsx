import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import styles from './style.module.css';

export function AiCreditsDetailsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small" initialFocus={ false }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'How AI credits work' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description className={ styles.details }>
						<span>
							{ __(
								'AI credits are Studio’s way of measuring AI-powered work. They are not cash, and they are different from the tokens an AI provider uses to count pieces of text.'
							) }
						</span>
						<span>
							{ __(
								'You get a welcome gift of 1.5 million free AI credits. AI credits do not expire, including credits you purchase later.'
							) }
						</span>
						<span>
							{ __(
								'Different models use AI credits at different rates. More capable models generally use more credits, and longer or more complex tasks can cost more because they require more model work.'
							) }
						</span>
					</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Close' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
