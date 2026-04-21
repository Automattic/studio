import { Popover } from '@base-ui/react/popover';
import { __ } from '@wordpress/i18n';
import { arrowDown, arrowUp, check, closeSmall, seen } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useSiteSyncActivity } from '@/data/sync-activity';
import styles from './sync-activity-indicator.module.css';
import type { SyncDirection } from '@/data/sync-activity';

function getPendingIcon( direction: SyncDirection ) {
	if ( direction === 'preview' ) {
		return seen;
	}
	return direction === 'push' ? arrowUp : arrowDown;
}

function getPendingLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Publishing preview…' );
	}
	return direction === 'push' ? __( 'Publishing to live…' ) : __( 'Pulling from live…' );
}

function getSuccessLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Preview published' );
	}
	return direction === 'push' ? __( 'Published to live' ) : __( 'Pulled from live' );
}

function getErrorLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Publishing preview failed' );
	}
	return direction === 'push'
		? __( 'Publishing to live failed' )
		: __( 'Pulling from live failed' );
}

// All three states render an IconButton so we reuse its built-in tooltip
// wiring (@wordpress/ui wraps each IconButton in its own Tooltip.Provider
// with delay=0). `focusableWhenDisabled` keeps the tooltip trigger active
// even when the button itself is visually disabled for pending/success.
export function SyncActivityIndicator( { siteId }: { siteId: string } ) {
	const activity = useSiteSyncActivity( siteId );
	if ( ! activity ) {
		return null;
	}

	if ( activity.kind === 'pending' ) {
		return (
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ getPendingIcon( activity.direction ) }
				label={ getPendingLabel( activity.direction ) }
				disabled
				focusableWhenDisabled
				className={ clsx( styles.indicator, styles.pending ) }
			/>
		);
	}

	if ( activity.kind === 'success' ) {
		return (
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ check }
				label={ getSuccessLabel( activity.direction ) }
				disabled
				focusableWhenDisabled
				className={ clsx( styles.indicator, styles.success ) }
			/>
		);
	}

	// Error: active IconButton that opens a popover with the full message.
	// The built-in tooltip shows the short label on hover; clicking reveals
	// the details. Popover.Trigger receives the IconButton via its `render`
	// prop so both behaviours share the same DOM element.
	const label = getErrorLabel( activity.direction );
	return (
		<Popover.Root>
			<Popover.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ closeSmall }
						label={ label }
						className={ clsx( styles.indicator, styles.error ) }
					/>
				}
			/>
			<Popover.Portal>
				<Popover.Positioner side="bottom" align="end" sideOffset={ 6 }>
					<Popover.Popup className={ styles.errorPopup }>
						<div className={ styles.errorPopupTitle }>{ label }</div>
						<div className={ styles.errorPopupMessage }>{ activity.message }</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
