import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { privateApis } from '@wordpress/theme';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type {
	ComponentPropsWithoutRef,
	ElementRef,
	MouseEventHandler,
	PointerEventHandler,
	ReactNode,
} from 'react';

const { ThemeProvider } = unlock( privateApis );

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const Group = BaseMenu.Group;
export const RadioGroup = BaseMenu.RadioGroup;
export const SubmenuRoot = BaseMenu.SubmenuRoot;
export const ContextMenuRoot = BaseContextMenu.Root;
export const ContextMenuTrigger = BaseContextMenu.Trigger;

type PopupProps = {
	children: ReactNode;
	/** Side relative to the trigger. Defaults to `top` (opens upward). */
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	alignOffset?: number;
	className?: string;
	onClick?: MouseEventHandler< HTMLElement >;
	onPointerDown?: PointerEventHandler< HTMLElement >;
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
	onClick,
	onPointerDown,
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
				{ /* Portals mount into document.body, escaping the app-root
					ThemeProvider's `data-wpds-density='compact'` wrapper and
					breaking the global SVG-shrink rule in `index.css`. Re-
					establish the density context here so icons inside the
					popup render at 16px like the rest of the app. */ }
				<ThemeProvider density="compact">
					<BaseMenu.Popup
						className={ `${ styles.popup } ${ motionStyles.motion } ${ className ?? '' }` }
						onClick={ onClick }
						onPointerDown={ onPointerDown }
					>
						{ children }
					</BaseMenu.Popup>
				</ThemeProvider>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

/**
 * Popup for context menus. Same chrome as `Popup`, but passes no `side`/
 * `align`/offsets: with those undefined, Base UI's positioner anchors a
 * context menu at the pointer instead of a trigger edge.
 */
export function ContextPopup( {
	children,
	className,
	onClick,
	onPointerDown,
}: {
	children: ReactNode;
	className?: string;
	onClick?: MouseEventHandler< HTMLElement >;
	onPointerDown?: PointerEventHandler< HTMLElement >;
} ) {
	return (
		<BaseMenu.Portal>
			<BaseMenu.Positioner className={ styles.positioner }>
				{ /* Re-establish density context outside the app-root ThemeProvider,
					 same as `Popup` above. */ }
				<ThemeProvider density="compact">
					<BaseMenu.Popup
						className={ `${ styles.popup } ${ motionStyles.motion } ${ className ?? '' }` }
						onClick={ onClick }
						onPointerDown={ onPointerDown }
					>
						{ children }
					</BaseMenu.Popup>
				</ThemeProvider>
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
			className={ clsx( styles.item, destructive && styles.itemDestructive, className ) }
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
		<BaseMenu.SubmenuTrigger
			ref={ ref }
			className={ `${ styles.item } ${ styles.submenuTrigger } ${ className ?? '' }` }
			{ ...props }
		>
			{ children }
		</BaseMenu.SubmenuTrigger>
	);
} );

type RadioItemProps = ComponentPropsWithoutRef< typeof BaseMenu.RadioItem >;

export const RadioItem = forwardRef< ElementRef< typeof BaseMenu.RadioItem >, RadioItemProps >(
	function RadioItem( { className, children, ...props }, ref ) {
		return (
			<BaseMenu.RadioItem
				ref={ ref }
				className={ `${ styles.item } ${ styles.indicatorItem } ${ className ?? '' }` }
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

type CheckboxItemProps = ComponentPropsWithoutRef< typeof BaseMenu.CheckboxItem >;

export const CheckboxItem = forwardRef<
	ElementRef< typeof BaseMenu.CheckboxItem >,
	CheckboxItemProps
>( function CheckboxItem( { className, children, ...props }, ref ) {
	return (
		<BaseMenu.CheckboxItem
			ref={ ref }
			className={ `${ styles.item } ${ styles.indicatorItem } ${ className ?? '' }` }
			{ ...props }
		>
			<span className={ styles.indicator } aria-hidden="true">
				<BaseMenu.CheckboxItemIndicator className={ styles.indicatorMark } keepMounted>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path
							d="M5 12l5 5L20 7"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</BaseMenu.CheckboxItemIndicator>
			</span>
			<span className={ styles.itemLabel }>{ children }</span>
		</BaseMenu.CheckboxItem>
	);
} );

export function GroupLabel( { children }: { children: ReactNode } ) {
	return <BaseMenu.GroupLabel className={ styles.groupLabel }>{ children }</BaseMenu.GroupLabel>;
}

export function Separator( { className }: { className?: string } ) {
	return <BaseMenu.Separator className={ `${ styles.separator } ${ className ?? '' }` } />;
}
