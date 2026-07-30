import { Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ToolbarStatus } from './derive-toolbar-state';

/**
 * The toolbar's status half: what the live site is doing right now, and when.
 * Read-only text — every action lives in the split button beside it, so this
 * never has to look clickable.
 *
 * When there's more to say than the label carries (an error message, or what
 * a phase is actually doing) it goes in a tooltip rather than a menu the user
 * has to discover.
 */
export function StatusText( { status }: { status: ToolbarStatus } ) {
	const text = (
		<span className={ clsx( styles.status, styles[ `status_${ status.tone }` ] ) }>
			<span className={ styles.statusLabel }>{ status.label }</span>
			{ status.meta ? <span className={ styles.statusMeta }>{ status.meta }</span> : null }
		</span>
	);

	if ( ! status.detail ) {
		return text;
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger render={ text } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
				{ status.detail }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
