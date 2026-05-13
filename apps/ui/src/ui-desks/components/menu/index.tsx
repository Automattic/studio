import { Menu as BaseMenu } from '@base-ui/react/menu';
import { privateApis } from '@wordpress/theme';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const RadioGroup = BaseMenu.RadioGroup;

type PopupProps = {
	children: ReactNode;
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	alignOffset?: number;
	className?: string;
	layout?: 'column' | 'row';
	width?: 'default' | 'content';
};

export function Popup( {
	children,
	side = 'bottom',
	align = 'start',
	sideOffset = 8,
	alignOffset,
	className,
	layout = 'column',
	width = 'default',
}: PopupProps ) {
	return (
		<BaseMenu.Portal>
			<BaseMenu.Positioner
				side={ side }
				align={ align }
				sideOffset={ sideOffset }
				alignOffset={ alignOffset }
				className={ styles.positioner }
			>
				<ThemeProvider density="compact">
					<BaseMenu.Popup
						className={ clsx(
							styles.popup,
							layout === 'row' && styles.row,
							width === 'content' && styles.contentWidth,
							motionStyles.motion,
							className
						) }
					>
						{ children }
					</BaseMenu.Popup>
				</ThemeProvider>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

type ItemProps = ComponentPropsWithoutRef< typeof BaseMenu.Item > & {
	variant?: 'default' | 'custom';
};

export const Item = forwardRef< ElementRef< typeof BaseMenu.Item >, ItemProps >( function Item(
	{ className, children, variant = 'default', ...props },
	ref
) {
	return (
		<BaseMenu.Item
			ref={ ref }
			className={ clsx( variant === 'default' && styles.item, className ) }
			{ ...props }
		>
			{ children }
		</BaseMenu.Item>
	);
} );

type RadioItemProps = ComponentPropsWithoutRef< typeof BaseMenu.RadioItem >;

export const RadioItem = forwardRef< ElementRef< typeof BaseMenu.RadioItem >, RadioItemProps >(
	function RadioItem( { className, children, ...props }, ref ) {
		return (
			<BaseMenu.RadioItem
				ref={ ref }
				className={ clsx( styles.item, styles.radioItem, className ) }
				{ ...props }
			>
				<span className={ styles.indicator } aria-hidden="true">
					<BaseMenu.RadioItemIndicator className={ styles.indicatorMark } keepMounted>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
							<path
								d="M5 12l5 5L20 7"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
							/>
						</svg>
					</BaseMenu.RadioItemIndicator>
				</span>
				<span className={ styles.itemLabel }>{ children }</span>
			</BaseMenu.RadioItem>
		);
	}
);

export function Separator( { className }: { className?: string } ) {
	return <BaseMenu.Separator className={ clsx( styles.separator, className ) } />;
}
