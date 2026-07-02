import { Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface IconSwitchProps {
	/** True puts the thumb on the end (right) side. */
	checked: boolean;
	onChange: () => void;
	/** Accessible name; also shown as the tooltip. */
	label: string;
	disabled?: boolean;
	startIcon: ReactNode;
	endIcon: ReactNode;
}

/**
 * A two-state sliding switch with an icon on each side. Unlike a plain
 * checkbox switch, both icons stay visible: the thumb slides underneath
 * them and the active side's icon is emphasized.
 */
export function IconSwitch( {
	checked,
	onChange,
	label,
	disabled,
	startIcon,
	endIcon,
}: IconSwitchProps ) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				disabled={ disabled }
				render={
					<button
						type="button"
						role="switch"
						aria-checked={ checked }
						aria-label={ label }
						className={ styles.root }
						disabled={ disabled }
						onClick={ onChange }
					>
						<span
							className={ clsx( styles.icon, ! checked && styles.iconActive ) }
							aria-hidden="true"
						>
							{ startIcon }
						</span>
						<span
							className={ clsx( styles.icon, checked && styles.iconActive ) }
							aria-hidden="true"
						>
							{ endIcon }
						</span>
						<span className={ styles.thumb } aria-hidden="true" />
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}
