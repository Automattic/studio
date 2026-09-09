import { Menu as BaseMenu } from '@base-ui/react/menu';
import { forwardRef } from 'react';
import motionStyles from '../floating-surface-motion/style.module.css';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const RadioGroup = BaseMenu.RadioGroup;

type PopupProps = {
	children: ReactNode;
	/** Side relative to the trigger. Defaults to `top` (opens upward). */
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	alignOffset?: number;
	className?: string;
};

/**
 * Wraps Portal + Positioner + Popup so consumers only need one component.
 * Styled to match @wordpress/components `Popover`: surface-strong background,
 * neutral stroke, elevation-md, radius-md.
 */
export function Popup( {
	children,
	side = 'top',
	align = 'start',
	sideOffset = 4,
	alignOffset,
	className,
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
				<BaseMenu.Popup
					className={ `${ styles.popup } ${ motionStyles.motion } ${ className ?? '' }` }
				>
					{ children }
				</BaseMenu.Popup>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

type ItemProps = ComponentPropsWithoutRef< typeof BaseMenu.Item >;

export const Item = forwardRef< ElementRef< typeof BaseMenu.Item >, ItemProps >( function Item(
	{ className, children, ...props },
	ref
) {
	return (
		<BaseMenu.Item ref={ ref } className={ `${ styles.item } ${ className ?? '' }` } { ...props }>
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
				className={ `${ styles.item } ${ styles.radioItem } ${ className ?? '' }` }
				{ ...props }
			>
				<span className={ styles.indicator } aria-hidden="true">
					<BaseMenu.RadioItemIndicator className={ styles.indicatorMark } keepMounted>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
							<path
								d="M5 12l5 5L20 7"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
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
	return <BaseMenu.Separator className={ `${ styles.separator } ${ className ?? '' }` } />;
}
