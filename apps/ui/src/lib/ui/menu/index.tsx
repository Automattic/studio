import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { ChevronDownIcon } from '@/lib/icons';
import { FloatingSurface } from '@/lib/ui/surface';
import surface from '@/lib/ui/surface/style.module.css';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const Group = BaseMenu.Group;
export const SubmenuRoot = BaseMenu.SubmenuRoot;
export const ContextMenuRoot = BaseContextMenu.Root;

/** Opens its menu on right-click, and from the keyboard with Shift+F10 or the context menu key. */
export const ContextMenuTrigger = forwardRef<
	ElementRef< typeof BaseContextMenu.Trigger >,
	ComponentPropsWithoutRef< typeof BaseContextMenu.Trigger >
>( function ContextMenuTrigger( { onKeyDown, ...props }, ref ) {
	return (
		<BaseContextMenu.Trigger
			ref={ ref }
			onKeyDown={ ( event ) => {
				onKeyDown?.( event );
				if (
					event.defaultPrevented ||
					! ( event.key === 'ContextMenu' || ( event.shiftKey && event.key === 'F10' ) )
				) {
					return;
				}
				event.preventDefault();
				const target = event.target as HTMLElement;
				const { left, bottom } = target.getBoundingClientRect();
				target.dispatchEvent(
					new MouseEvent( 'contextmenu', {
						bubbles: true,
						cancelable: true,
						clientX: left,
						clientY: bottom,
					} )
				);
			} }
			{ ...props }
		/>
	);
} );

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

/** Popup for context menus, anchored at the pointer and opening to its right. */
export function ContextPopup( { children, className, ...props }: ContextPopupProps ) {
	return (
		<BaseMenu.Portal>
			<BaseMenu.Positioner
				side="right"
				align="start"
				alignOffset={ 4 }
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
