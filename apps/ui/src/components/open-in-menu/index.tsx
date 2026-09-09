import { __ } from '@wordpress/i18n';
import { chevronDown, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import styles from './style.module.css';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

/**
 * "Open in…" menu for the session header: one trigger that lists every app
 * the site can open in, mirroring the Overview's shortcuts.
 */
export function OpenInMenu( {
	site,
	// The site-relative path the "Browser" destination opens — the preview's
	// current page.
	browserPath,
}: {
	site: SiteDetails;
	browserPath: string;
} ) {
	const destinations = useOpenInDestinations( site, browserPath );

	return (
		<Menu.Root>
			<Tooltip.Root>
				<Menu.Trigger
					render={
						<Tooltip.Trigger
							render={
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.trigger }
									aria-label={ __( 'Open in…' ) }
								/>
							}
						>
							<span className={ styles.triggerLabel }>{ __( 'Open in…' ) }</span>
							<span className={ styles.triggerLabelCompact }>{ __( 'Open…' ) }</span>
							{ /* data-keep-size opts out of the classic-UI rule that
							     forces svgs to 16px, letting the chevron render small. */ }
							<Icon icon={ chevronDown } size={ 12 } className={ styles.chevron } data-keep-size />
						</Tooltip.Trigger>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ __( 'Open this site in another app' ) }
				</Tooltip.Popup>
			</Tooltip.Root>
			<Menu.Popup side="bottom" align="end" className={ styles.popup }>
				{ destinations.map( ( destination ) => (
					<Menu.Item
						key={ destination.id }
						disabled={ destination.disabled }
						onClick={ destination.open }
					>
						<span className={ styles.itemIcon } aria-hidden="true">
							<Icon icon={ destination.logo } size={ 18 } />
						</span>
						{ destination.label }
					</Menu.Item>
				) ) }
			</Menu.Popup>
		</Menu.Root>
	);
}
