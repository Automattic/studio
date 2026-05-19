import { Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from 'react';

type ButtonVariant = 'chrome' | 'quiet' | 'filled';
type ButtonTone = 'neutral' | 'primary' | 'inverse';
type ButtonSize = 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge';
type ButtonIntent = 'default' | 'chat';

const ICON_SIZE_BY_BUTTON_SIZE: Record< ButtonSize, number > = {
	xsmall: 16,
	small: 18,
	medium: 24,
	large: 24,
	xlarge: 24,
};

type ButtonProps = Omit< ComponentPropsWithoutRef< 'button' >, 'children' > & {
	children?: ReactNode;
	icon?: ComponentProps< typeof Icon >[ 'icon' ];
	intent?: ButtonIntent;
	label: string;
	size?: ButtonSize;
	tone?: ButtonTone;
	tooltipLabel?: string | false;
	tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
	variant?: ButtonVariant;
};

export const Button = forwardRef< HTMLButtonElement, ButtonProps >( function Button(
	{
		children,
		className,
		disabled,
		icon,
		intent = 'default',
		label,
		size = 'large',
		tone = 'neutral',
		tooltipLabel,
		tooltipSide,
		type = 'button',
		variant = 'chrome',
		...props
	},
	ref
) {
	const resolvedTooltipLabel = tooltipLabel ?? ( icon && ! children ? label : false );
	const isIconOnly = Boolean( icon && ! children );
	const buttonClassName = clsx(
		styles.button,
		styles[ variant ],
		styles[ size ],
		tone !== 'neutral' && styles[ tone ],
		intent !== 'default' && styles[ `${ intent }Intent` ],
		className
	);
	const resolvedTooltipSide = tooltipSide ?? ( variant === 'quiet' ? 'top' : 'bottom' );
	const content = (
		<>
			{ icon ? (
				<Icon icon={ icon } size={ ICON_SIZE_BY_BUTTON_SIZE[ size ] } className={ styles.icon } />
			) : null }
			{ children }
		</>
	);

	if ( resolvedTooltipLabel === false ) {
		return (
			<button
				{ ...props }
				ref={ ref }
				aria-label={ label }
				className={ buttonClassName }
				data-icon-only={ isIconOnly ? 'true' : 'false' }
				disabled={ disabled }
				type={ type }
			>
				{ content }
			</button>
		);
	}

	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger
					ref={ ref }
					className={ buttonClassName }
					data-icon-only={ isIconOnly ? 'true' : 'false' }
					disabled={ disabled }
					render={
						<button { ...props } aria-label={ label } disabled={ disabled } type={ type } />
					}
				>
					{ content }
				</Tooltip.Trigger>
				<Tooltip.Popup side={ resolvedTooltipSide }>{ resolvedTooltipLabel }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
} );
