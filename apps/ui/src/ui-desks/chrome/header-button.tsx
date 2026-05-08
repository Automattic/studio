import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './header-button.module.css';
import type { ComponentProps, ReactNode } from 'react';

type DeskHeaderButtonProps = Omit< ComponentProps< typeof Button >, 'children' > & {
	children: ReactNode;
	label: string;
	tooltipLabel?: string;
};

type DeskHeaderIconButtonProps = Omit< DeskHeaderButtonProps, 'children' > & {
	icon: ComponentProps< typeof Icon >[ 'icon' ];
};

export const DeskHeaderButton = forwardRef< HTMLButtonElement, DeskHeaderButtonProps >(
	function DeskHeaderButton(
		{
			children,
			className,
			disabled,
			focusableWhenDisabled,
			label,
			size = 'small',
			tooltipLabel = label,
			tone = 'neutral',
			variant = 'minimal',
			...props
		},
		ref
	) {
		return (
			<Tooltip.Provider delay={ 0 }>
				<Tooltip.Root>
					<Tooltip.Trigger
						ref={ ref }
						disabled={ disabled && ! focusableWhenDisabled }
						render={
							<Button
								{ ...props }
								aria-label={ label }
								disabled={ disabled }
								focusableWhenDisabled={ focusableWhenDisabled }
								size={ size }
								tone={ tone }
								variant={ variant }
							/>
						}
						className={ clsx( styles.trigger, className ) }
					>
						{ children }
					</Tooltip.Trigger>
					<Tooltip.Popup side="bottom">{ tooltipLabel }</Tooltip.Popup>
				</Tooltip.Root>
			</Tooltip.Provider>
		);
	}
);

export const DeskHeaderIconButton = forwardRef< HTMLButtonElement, DeskHeaderIconButtonProps >(
	function DeskHeaderIconButton( { icon, ...props }, ref ) {
		return (
			<DeskHeaderButton ref={ ref } { ...props }>
				<Icon icon={ icon } size={ 24 } className={ styles.icon } />
			</DeskHeaderButton>
		);
	}
);
