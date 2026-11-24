import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function TooltipProvider( {
	delay = 700,
	timeout = 400,
	...props
}: ComponentProps< typeof BaseTooltip.Provider > ) {
	return <BaseTooltip.Provider delay={ delay } timeout={ timeout } { ...props } />;
}

export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

type PositionerProps = ComponentProps< typeof BaseTooltip.Positioner >;

export function TooltipContent( {
	className,
	side = 'top',
	sideOffset = 2,
	align = 'center',
	alignOffset = 0,
	...props
}: ComponentProps< typeof BaseTooltip.Popup > &
	Pick< PositionerProps, 'align' | 'alignOffset' | 'side' | 'sideOffset' > ) {
	return (
		<BaseTooltip.Portal>
			<BaseTooltip.Positioner
				align={ align }
				alignOffset={ alignOffset }
				side={ side }
				sideOffset={ sideOffset }
				className={ styles.positioner }
			>
				<BaseTooltip.Popup
					data-slot="tooltip-content"
					className={ clsx( styles.content, className ) }
					{ ...props }
				/>
			</BaseTooltip.Positioner>
		</BaseTooltip.Portal>
	);
}
