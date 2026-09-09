import { sprintf, __ } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import styles from './cards.module.css';

export function RowLink( {
	label,
	url,
	tooltip,
}: {
	label: string;
	url: string;
	tooltip?: string;
} ) {
	const connector = useConnector();

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.rowLink }
						aria-label={ sprintf(
							/* translators: %s: a site address */
							__( 'Open %s in your browser' ),
							label
						) }
						onClick={ () => void connector.openExternalUrl( url ) }
					>
						{ label }
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ tooltip || url }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
