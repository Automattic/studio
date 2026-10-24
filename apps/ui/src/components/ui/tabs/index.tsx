import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** Tabs; the `sidebar` layout puts a TabsSidebar beside the content. */
export function Tabs( {
	className,
	orientation = 'horizontal',
	layout = 'default',
	...props
}: ComponentProps< typeof BaseTabs.Root > & { layout?: 'default' | 'sidebar' } ) {
	return (
		<BaseTabs.Root
			data-slot="tabs"
			data-layout={ layout }
			orientation={ orientation }
			className={ clsx( styles.tabs, className ) }
			{ ...props }
		/>
	);
}

export function TabsSidebar( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div data-slot="tabs-sidebar" className={ clsx( styles.sidebar, className ) } { ...props } />
	);
}

/** `scope` is a segmented switch, `sidebar` a vertical list of sections. */
export function TabsList( {
	className,
	variant,
	...props
}: ComponentProps< typeof BaseTabs.List > & { variant: 'scope' | 'sidebar' } ) {
	return (
		<BaseTabs.List
			data-slot="tabs-list"
			data-variant={ variant }
			className={ clsx( styles.list, className ) }
			{ ...props }
		/>
	);
}

/** `highlighted` marks the tab Enter would pick, like a search's top result. */
export function TabsTrigger( {
	className,
	highlighted = false,
	...props
}: ComponentProps< typeof BaseTabs.Tab > & { highlighted?: boolean } ) {
	return (
		<BaseTabs.Tab
			data-slot="tabs-trigger"
			data-highlighted={ highlighted ? '' : undefined }
			className={ clsx( styles.trigger, className ) }
			{ ...props }
		/>
	);
}

/** The pill under a `scope` list's active tab. */
export function TabsScopeIndicator() {
	return <BaseTabs.Indicator data-slot="tabs-scope-indicator" className={ styles.indicator } />;
}

/** Which scope a `sidebar` tab belongs to, at its end. */
export function TabsScopeLabel( { className, ...props }: ComponentProps< 'span' > ) {
	return <span className={ clsx( styles.scopeLabel, className ) } { ...props } />;
}
