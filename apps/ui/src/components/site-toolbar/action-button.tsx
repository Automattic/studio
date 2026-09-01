import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ToolbarAction } from './derive-toolbar-state';
import type { ComponentProps, CSSProperties, ElementRef } from 'react';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	action: ToolbarAction;
};

/**
 * One of the toolbar's actions. The label says what the button does; its
 * tooltip says when it last did it, and results arrive as toasts.
 *
 * While work runs, the button fills from the leading edge with whatever
 * progress the sync actually reports. Phases that can't report leave it flat
 * and spin instead, rather than animating a bar that means nothing.
 *
 * Forwards refs and props so it can also serve as a menu trigger (Publish
 * opens the site picker; push and pull open a target list when the site has
 * more than one connection).
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
			size="small"
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
			{ action.progress === undefined ? null : (
				<span
					className={ styles.actionProgress }
					style={ { '--action-progress': `${ Math.round( action.progress ) }%` } as CSSProperties }
					aria-hidden="true"
				/>
			) }
			{ /* Keyed on the action so a lifecycle change animates the swap
				  rather than silently relabelling the button in place. */ }
			<span key={ action.id } className={ styles.actionLabel }>
				{ action.label }
			</span>
		</Button>
	);

	if ( ! action.hint ) {
		return button;
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger render={ button } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
				{ action.hint }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
} );
