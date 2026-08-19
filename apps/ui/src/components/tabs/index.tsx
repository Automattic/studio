/**
 * Thin wrapper around `@wordpress/components`' `Tabs` (which is still behind
 * the private-apis lock) that applies our condensed, DS-token-driven look:
 *
 *   - 1px active-tab indicator in `fg-content-neutral` (matches active label).
 *   - Inactive tabs in `fg-content-neutral-weak`; selected tab bumps to the
 *     primary fg token + semibold.
 *   - No inline padding so the active underline aligns with label text; the
 *     list spaces tabs with a gap instead.
 *   - `margin-bottom: -1px` on the list so the active indicator lands on top
 *     of a sibling container's 1px border-bottom, reading as one line.
 *
 * Callers are still responsible for any outer layout (e.g. a full-width bar
 * with a baseline border) — this module only owns the tabs' own styling.
 *
 * Use as:
 *
 *   import * as Tabs from '@/components/tabs';
 *
 *   <Tabs.Root selectedTabId={...} onSelect={...}>
 *     <Tabs.List>
 *       <Tabs.Tab tabId="general">General</Tabs.Tab>
 *       <Tabs.Tab tabId="debugging">Debugging</Tabs.Tab>
 *     </Tabs.List>
 *     <Tabs.Panel tabId="general">...</Tabs.Panel>
 *     <Tabs.Panel tabId="debugging">...</Tabs.Panel>
 *   </Tabs.Root>
 */

import { privateApis as componentsPrivateApis } from '@wordpress/components';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type {
	ComponentPropsWithoutRef,
	ComponentType,
	ElementRef,
	MouseEventHandler,
	ReactNode,
} from 'react';

type RootProps = {
	selectedTabId?: string | null;
	onSelect?: ( tabId: string | null | undefined ) => void;
	orientation?: 'horizontal' | 'vertical';
	className?: string;
	children: ReactNode;
};

type ListProps = {
	className?: string;
	children: ReactNode;
};

type TabProps = {
	tabId: string;
	className?: string;
	children: ReactNode;
	disabled?: boolean;
	'aria-label'?: string;
	'aria-expanded'?: boolean;
	'aria-haspopup'?: 'menu';
	onClick?: MouseEventHandler< HTMLButtonElement >;
};

type PanelProps = {
	tabId: string;
	className?: string;
	children: ReactNode;
	focusable?: boolean;
};

type WpTabs = ComponentType< RootProps > & {
	TabList: ComponentType< ListProps >;
	Tab: ComponentType< TabProps >;
	TabPanel: ComponentType< PanelProps >;
};

const { Tabs: WpTabs } = unlock( componentsPrivateApis ) as { Tabs: WpTabs };

export const Root = WpTabs;

export const List = forwardRef<
	ElementRef< 'div' >,
	ComponentPropsWithoutRef< typeof WpTabs.TabList >
>( function List( { className, children, ...props }, ref ) {
	// @wordpress/components TabList forwards refs to its underlying div.
	const ListComponent = WpTabs.TabList as unknown as ComponentType<
		ListProps & { ref?: React.Ref< HTMLDivElement > }
	>;
	return (
		<ListComponent ref={ ref } className={ clsx( styles.list, className ) } { ...props }>
			{ children }
		</ListComponent>
	);
} );

export const Tab = forwardRef<
	ElementRef< 'button' >,
	ComponentPropsWithoutRef< typeof WpTabs.Tab >
>( function Tab( { className, children, ...props }, ref ) {
	const TabComponent = WpTabs.Tab as unknown as ComponentType<
		TabProps & { ref?: React.Ref< HTMLButtonElement > }
	>;
	return (
		<TabComponent ref={ ref } className={ clsx( styles.tab, className ) } { ...props }>
			{ children }
		</TabComponent>
	);
} );

export const Panel = forwardRef<
	ElementRef< 'div' >,
	ComponentPropsWithoutRef< typeof WpTabs.TabPanel >
>( function Panel( { className, focusable = false, children, ...props }, ref ) {
	const PanelComponent = WpTabs.TabPanel as unknown as ComponentType<
		PanelProps & { ref?: React.Ref< HTMLDivElement > }
	>;
	return (
		<PanelComponent
			ref={ ref }
			className={ clsx( styles.panel, className ) }
			focusable={ focusable }
			{ ...props }
		>
			{ children }
		</PanelComponent>
	);
} );
