import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import { createContext, useContext } from 'react';
import styles from './style.module.css';
import type { ComponentProps, CSSProperties, PropsWithChildren } from 'react';

type TooltipAppearance = {
	className?: string;
	style?: CSSProperties;
	colorScheme?: 'light' | 'dark';
};

const TooltipAppearanceContext = createContext< TooltipAppearance | undefined >( undefined );

export function TooltipAppearanceProvider( {
	children,
	value,
}: PropsWithChildren< { value?: TooltipAppearance } > ) {
	return (
		<TooltipAppearanceContext.Provider value={ value }>
			{ children }
		</TooltipAppearanceContext.Provider>
	);
}

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
	style,
	side = 'top',
	sideOffset = 2,
	align = 'center',
	alignOffset = 0,
	...props
}: ComponentProps< typeof BaseTooltip.Popup > &
	Pick< PositionerProps, 'align' | 'alignOffset' | 'side' | 'sideOffset' > ) {
	const appearance = useContext( TooltipAppearanceContext );
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
					data-color-scheme={ appearance?.colorScheme }
					className={ clsx( styles.content, appearance?.className, className ) }
					style={
						appearance?.style
							? typeof style === 'function'
								? ( state ) => ( { ...appearance.style, ...style( state ) } )
								: { ...appearance.style, ...style }
							: style
					}
					{ ...props }
				/>
			</BaseTooltip.Positioner>
		</BaseTooltip.Portal>
	);
}
