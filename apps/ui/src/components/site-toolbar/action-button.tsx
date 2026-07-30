import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ToolbarAction } from './derive-toolbar-state';
import type { ComponentProps, ElementRef } from 'react';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	action: ToolbarAction;
};

/**
 * The toolbar's single primary action. It never leaves the toolbar: it spins
 * in place while its own work runs, greys out (with a reason) when it can't
 * happen, and crossfades its label when the site's lifecycle moves it on —
 * Publish becomes Push once the first live site exists. Keeping one stable
 * slot means the button is always where the user last saw it.
 *
 * Forwards refs and props so it can also serve as a menu trigger (Publish
 * opens the site picker anchored to itself).
 */
export const ActionButton = forwardRef< ElementRef< typeof Button >, Props >( function ActionButton(
	{ action, className, onClick, ...props },
	ref
) {
	const button = (
		<Button
			ref={ ref }
			variant={ action.variant }
			tone={ action.tone }
			size="compact"
			className={ clsx( styles.action, className ) }
			data-action={ action.id }
			loading={ action.busy }
			loadingAnnouncement={ action.label }
			disabled={ action.disabled }
			focusableWhenDisabled
			{ ...props }
			onClick={ ( event ) => {
				if ( action.disabled || action.busy ) {
					return;
				}
				onClick?.( event );
			} }
		>
			{ /* Keyed on the action so a lifecycle change animates the swap
				     rather than silently relabelling the button in place. */ }
			<span key={ action.id } className={ styles.actionLabel }>
				{ action.label }
			</span>
		</Button>
	);

	if ( ! action.disabledReason ) {
		return button;
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger render={ button } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
				{ action.disabledReason }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
} );
