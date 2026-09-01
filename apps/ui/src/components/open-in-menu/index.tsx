import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import splitStyles from '@/components/split-button/style.module.css';
import styles from './style.module.css';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { OpenInDestination } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

// Scoped per site: which app you reach for depends on what you're doing with
// that site, even though the apps themselves come from global preferences.
const lastUsedStorageKey = ( siteId: string ) => `studio:open-in-menu:last-used:${ siteId }`;
const DEFAULT_DESTINATION: OpenInDestination = 'browser';

function isOpenInDestination( value: string | null ): value is OpenInDestination {
	return value === 'browser' || value === 'files' || value === 'editor' || value === 'terminal';
}

function getStoredDestination( siteId: string ): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( lastUsedStorageKey( siteId ) );
		return isOpenInDestination( stored ) ? stored : DEFAULT_DESTINATION;
	} catch {
		return DEFAULT_DESTINATION;
	}
}

function storeLastUsedDestination( siteId: string, destination: OpenInDestination ): void {
	try {
		window.localStorage.setItem( lastUsedStorageKey( siteId ), destination );
	} catch {
		// Storage failures only mean the split trigger won't persist.
	}
}

/**
 * Split button for the preview toolbar: the left half repeats the last
 * destination the user opened, the chevron half opens the full list.
 *
 * The caller keys this on the site id, so the remembered destination is read
 * fresh when the preview switches sites.
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
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( () =>
		getStoredDestination( site.id )
	);

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		storeLastUsedDestination( site.id, destination );
	};

	const destinations = useOpenInDestinations( site, browserPath, rememberDestination );
	const lastUsedDestination =
		destinations.find( ( destination ) => destination.id === lastUsed ) ?? destinations[ 0 ];

	const actionLabel = sprintf(
		// translators: %s is the app the site opens in, e.g. "Finder".
		__( 'Open in %s' ),
		lastUsedDestination.label
	);

	return (
		<Menu.Root>
			<div className={ splitStyles.splitTrigger }>
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ splitStyles.splitAction }
								aria-label={ actionLabel }
								disabled={ lastUsedDestination.disabled }
								onClick={ () => lastUsedDestination.open() }
							/>
						}
					>
						<Icon icon={ lastUsedDestination.logo } size={ 18 } />
						<span className={ styles.label }>{ lastUsedDestination.label }</span>
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ actionLabel }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Tooltip.Root>
					<Menu.Trigger
						render={
							<Tooltip.Trigger
								render={
									<Button
										variant="minimal"
										tone="neutral"
										size="small"
										className={ splitStyles.splitMenuButton }
										aria-label={ __( 'Open in…' ) }
									/>
								}
							>
								{ /* data-keep-size opts out of the classic-UI rule that
								     forces svgs to 16px, letting the chevron render
								     small enough for a narrow tab. */ }
								<Icon
									icon={ chevronDown }
									size={ 12 }
									className={ splitStyles.chevron }
									data-keep-size
								/>
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ __( 'Open in…' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
			</div>
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
