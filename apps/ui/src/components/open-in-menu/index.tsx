import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import styles from './style.module.css';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { OpenInDestination } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

const LAST_USED_STORAGE_KEY = 'studio:open-in-menu:last-used';
const DEFAULT_DESTINATION: OpenInDestination = 'browser';

function isOpenInDestination( value: string | null ): value is OpenInDestination {
	return value === 'browser' || value === 'files' || value === 'editor' || value === 'terminal';
}

function getStoredDestination(): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( LAST_USED_STORAGE_KEY );
		return isOpenInDestination( stored ) ? stored : DEFAULT_DESTINATION;
	} catch {
		return DEFAULT_DESTINATION;
	}
}

function storeLastUsedDestination( destination: OpenInDestination ): void {
	try {
		window.localStorage.setItem( LAST_USED_STORAGE_KEY, destination );
	} catch {
		// Storage failures only mean the split trigger won't persist.
	}
}

/**
 * Split button for the preview toolbar: the left half repeats the last
 * destination the user opened, the chevron half opens the full list.
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
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( getStoredDestination );

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		storeLastUsedDestination( destination );
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
			<div className={ styles.splitTrigger }>
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.splitAction }
								aria-label={ actionLabel }
								disabled={ lastUsedDestination.disabled }
								onClick={ () => lastUsedDestination.open() }
							/>
						}
					>
						<Icon icon={ lastUsedDestination.logo } size={ 18 } />
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
										className={ styles.splitMenuButton }
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
									className={ styles.chevron }
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
