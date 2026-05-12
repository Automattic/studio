import { Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from 'react';

type ControlButtonVariant = 'chrome' | 'toolbar' | 'prompt';

type ControlButtonProps = Omit< ComponentPropsWithoutRef< 'button' >, 'children' > & {
	children: ReactNode;
	label: string;
	tooltipLabel?: string | false;
	tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
	variant?: ControlButtonVariant;
};

type IconControlButtonProps = Omit< ControlButtonProps, 'children' > & {
	icon: ComponentProps< typeof Icon >[ 'icon' ];
	iconSize?: number;
};

export const ControlButton = forwardRef< HTMLButtonElement, ControlButtonProps >(
	function ControlButton(
		{
			children,
			className,
			disabled,
			label,
			tooltipLabel = label,
			tooltipSide,
			type = 'button',
			variant = 'chrome',
			...props
		},
		ref
	) {
		const buttonClassName = clsx( styles.button, styles[ variant ], className );
		const resolvedTooltipSide = tooltipSide ?? ( variant === 'toolbar' ? 'top' : 'bottom' );

		if ( tooltipLabel === false ) {
			return (
				<button
					{ ...props }
					ref={ ref }
					aria-label={ label }
					className={ buttonClassName }
					disabled={ disabled }
					type={ type }
				>
					{ children }
				</button>
			);
		}

		return (
			<Tooltip.Provider delay={ 0 }>
				<Tooltip.Root>
					<Tooltip.Trigger
						ref={ ref }
						className={ buttonClassName }
						disabled={ disabled }
						render={
							<button { ...props } aria-label={ label } disabled={ disabled } type={ type } />
						}
					>
						{ children }
					</Tooltip.Trigger>
					<Tooltip.Popup side={ resolvedTooltipSide }>{ tooltipLabel }</Tooltip.Popup>
				</Tooltip.Root>
			</Tooltip.Provider>
		);
	}
);

export const IconControlButton = forwardRef< HTMLButtonElement, IconControlButtonProps >(
	function IconControlButton( { icon, iconSize = 24, ...props }, ref ) {
		return (
			<ControlButton ref={ ref } { ...props }>
				<Icon icon={ icon } size={ iconSize } className={ styles.icon } />
			</ControlButton>
		);
	}
);
