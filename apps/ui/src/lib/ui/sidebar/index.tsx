import { useRender } from '@base-ui/react/use-render';
import { clsx } from 'clsx';
import { ChevronRightIcon } from 'lucide-react';
import { Skeleton } from '@/lib/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui/tooltip';
import styles from './style.module.css';
import type { ComponentProps, CSSProperties } from 'react';

/** A titled section of a sidebar, like Pinned or Sites. `open` spaces it for its unfolded rows. */
export function SidebarGroup( {
	open = false,
	className,
	...props
}: ComponentProps< 'div' > & { open?: boolean } ) {
	return (
		<div
			data-slot="sidebar-group"
			data-open={ open || undefined }
			className={ clsx( styles.group, className ) }
			{ ...props }
		/>
	);
}

/** A group's label row, holding its label and any group actions. */
export function SidebarGroupHeader( { className, ...props }: ComponentProps< 'div' > ) {
	return <div className={ clsx( styles.groupHeader, className ) } { ...props } />;
}

/**
 * A group's title. Given `expanded`, it is a button that folds the group, with
 * a chevron that shows on hover and stays while the group is folded.
 */
export function SidebarGroupLabel( {
	expanded,
	onExpandedChange,
	children,
}: {
	expanded?: boolean;
	onExpandedChange?: ( expanded: boolean ) => void;
	children: string;
} ) {
	if ( expanded === undefined ) {
		return <span className={ styles.groupLabel }>{ children }</span>;
	}
	return (
		<button
			type="button"
			className={ styles.groupLabel }
			aria-expanded={ expanded }
			onClick={ () => onExpandedChange?.( ! expanded ) }
		>
			{ children }
			<ChevronRightIcon />
		</button>
	);
}

/** A placeholder for a group label that's loading. */
export function SidebarGroupLabelSkeleton() {
	return <Skeleton className={ styles.groupLabelSkeleton } />;
}

export function SidebarMenu( { className, ...props }: ComponentProps< 'ul' > ) {
	return <ul data-slot="sidebar-menu" className={ clsx( styles.menu, className ) } { ...props } />;
}

/**
 * A row of a menu: its button, then its actions, then any nested menu. Right-click
 * menus and selection mark it `data-popup-open` and `data-selected`.
 */
export function SidebarMenuItem( { className, ...props }: ComponentProps< 'li' > ) {
	return (
		<li data-slot="sidebar-menu-item" className={ clsx( styles.item, className ) } { ...props } />
	);
}

/**
 * A row's main control: an icon, then a label that truncates. `active` keeps it
 * highlighted, `inset` lines it up with a parent row's label, and `muted` dims
 * it. Rendered as another element, like a `div` holding its own buttons, it
 * shows their keyboard focus. A `tooltip` shows on hover, to the side.
 */
export function SidebarMenuButton( {
	render,
	active = false,
	inset = false,
	muted = false,
	tooltip,
	className,
	ref,
	...props
}: useRender.ComponentProps< 'button' > & {
	active?: boolean;
	inset?: boolean;
	muted?: boolean;
	tooltip?: string;
} ) {
	const element = useRender( {
		defaultTagName: 'button',
		render,
		ref,
		props: {
			type: render ? undefined : 'button',
			'data-slot': 'sidebar-menu-button',
			'data-active': active || undefined,
			'data-inset': inset || undefined,
			'data-muted': muted || undefined,
			className: clsx( styles.button, className ),
			...props,
		},
	} );
	if ( ! tooltip ) {
		return element;
	}
	return (
		<Tooltip>
			<TooltipTrigger render={ element } />
			<TooltipContent side="right">{ tooltip }</TooltipContent>
		</Tooltip>
	);
}

/** A row's label, cut short with an ellipsis. Rendered as a button, it is the row's own control. */
export function SidebarMenuLabel( {
	render,
	className,
	ref,
	...props
}: useRender.ComponentProps< 'span' > ) {
	return useRender( {
		defaultTagName: 'span',
		render,
		ref,
		props: { className: clsx( styles.label, className ), ...props },
	} );
}

/**
 * A row's trailing icon buttons, over its button's end. With `showOnHover` they
 * show only while the row is hovered, focused or has its menu open, apart from a
 * busy one; the button makes room for them while they show.
 */
export function SidebarMenuActions( {
	showOnHover = false,
	className,
	...props
}: ComponentProps< 'span' > & { showOnHover?: boolean } ) {
	return (
		<span
			data-slot="sidebar-menu-actions"
			data-show-on-hover={ showOnHover || undefined }
			className={ clsx( styles.actions, className ) }
			{ ...props }
		/>
	);
}

/** A placeholder row: an icon and a label of the given width. */
export function SidebarMenuSkeleton( { width }: { width: string } ) {
	return (
		<div className={ styles.skeleton }>
			<Skeleton className={ styles.skeletonIcon } />
			<Skeleton
				className={ styles.skeletonLabel }
				style={ { '--skeleton-width': width } as CSSProperties }
			/>
		</div>
	);
}
