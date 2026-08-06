import { sprintf, __ } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import styles from './cards.module.css';

/**
 * A site's address, as a link that hands off to the real browser.
 *
 * The visible text is the bare host (it's the thing that tells two sites
 * apart); the tooltip carries whatever context the row has — the site's title,
 * or the untruncated URL.
 */
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
							// translators: %s: a site address.
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
