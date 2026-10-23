import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { FloatingSurface } from '@/components/ui/surface';
import surface from '@/components/ui/surface/style.module.css';
import { ChevronDownIcon } from '@/lib/icons/chevron-down-icon';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const Group = BaseMenu.Group;
export const RadioGroup = BaseMenu.RadioGroup;
export const SubmenuRoot = BaseMenu.SubmenuRoot;
export const ContextMenuRoot = BaseContextMenu.Root;
export const ContextMenuTrigger = BaseContextMenu.Trigger;

type ContextPopupProps = Omit<
	ComponentPropsWithoutRef< typeof BaseMenu.Popup >,
	'render' | 'className' | 'children'
> & {
	children: ReactNode;
	className?: string;
};

type PopupProps = ContextPopupProps & {
	/** Side relative to the trigger. Defaults to `top` (opens upward). */
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	alignOffset?: number;
};

/**
 * Wraps Portal + Positioner + Popup so consumers only need one component.
 */
export function Popup( {
	children,
	side = 'top',
	align = 'start',
	sideOffset = 4,
	alignOffset,
	className,
	...props
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
					render={
						<FloatingSurface className={ clsx( surface.padded, styles.popup, className ) } />
					}
					{ ...props }
				>
					{ children }
				</BaseMenu.Popup>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

/** A submenu's popup, opening to the right with its first item level with the trigger. */
export function SubmenuPopup( props: Omit< PopupProps, 'side' | 'align' > ) {
	return <Popup side="right" align="start" sideOffset={ 10 } alignOffset={ -6 } { ...props } />;
}

/** Popup for context menus: no side/align, so Base UI anchors it at the pointer. */
export function ContextPopup( { children, className, ...props }: ContextPopupProps ) {
	return (
		<BaseMenu.Portal>
			<BaseMenu.Positioner className={ styles.positioner }>
				<BaseMenu.Popup
					render={
						<FloatingSurface className={ clsx( surface.padded, styles.popup, className ) } />
					}
					{ ...props }
				>
					{ children }
				</BaseMenu.Popup>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

type ItemProps = ComponentPropsWithoutRef< typeof BaseMenu.Item > & {
	/** Renders the item in error colors, for actions that destroy data. */
	destructive?: boolean;
};

export const Item = forwardRef< ElementRef< typeof BaseMenu.Item >, ItemProps >( function Item(
	{ className, children, destructive, ...props },
	ref
) {
	return (
		<BaseMenu.Item
			ref={ ref }
			className={ clsx( surface.item, destructive && styles.destructive, className ) }
			{ ...props }
		>
			{ children }
		</BaseMenu.Item>
	);
} );

type SubmenuTriggerProps = ComponentPropsWithoutRef< typeof BaseMenu.SubmenuTrigger >;

export const SubmenuTrigger = forwardRef<
	ElementRef< typeof BaseMenu.SubmenuTrigger >,
	SubmenuTriggerProps
>( function SubmenuTrigger( { className, children, ...props }, ref ) {
	return (
		<BaseMenu.SubmenuTrigger ref={ ref } className={ clsx( surface.item, className ) } { ...props }>
			{ children }
			<ChevronDownIcon className={ styles.submenuChevron } />
		</BaseMenu.SubmenuTrigger>
	);
} );

type RadioItemProps = ComponentPropsWithoutRef< typeof BaseMenu.RadioItem >;

export const RadioItem = forwardRef< ElementRef< typeof BaseMenu.RadioItem >, RadioItemProps >(
	function RadioItem( { className, children, ...props }, ref ) {
		return (
			<BaseMenu.RadioItem
				ref={ ref }
				className={ clsx( surface.item, styles.radioItem, className ) }
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

export function Shortcut( { children }: { children: ReactNode } ) {
	return (
		<span className={ styles.shortcut } aria-hidden="true">
			{ children }
		</span>
	);
}

export function GroupLabel( { children }: { children: ReactNode } ) {
	return <BaseMenu.GroupLabel className={ styles.groupLabel }>{ children }</BaseMenu.GroupLabel>;
}

export function Separator( { className }: { className?: string } ) {
	return <BaseMenu.Separator className={ clsx( surface.separator, className ) } />;
}
