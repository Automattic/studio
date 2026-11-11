import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { designSheet, parseDesignMd, themeJsonDesign } from '@studio/design-md';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useMemo, useRef } from 'react';
import { previewTabsKey, usePreviewTabs } from '@/data/preview-tabs';
import { useSiteDesign } from '@/data/queries/use-site-design';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { useUserWorkspaceLayoutTransition } from '@/data/use-workspace-layout-tracks';
import { getSiteUrl } from '@/features/sites/get-site-url';
import {
	DATABASE_HOME_PATH,
	EMAIL_PREVIEW_PATH,
	getRealmNavigationPath,
} from '@/features/sites/site-preview/address-bar';
import { usePreviewOpenTracks } from '@/features/sites/site-preview/use-preview-open-tracks';
import { DatabaseIcon, DesignSystemIcon, GlobeIcon, MailIcon, WordPressIcon } from '@/lib/icons';
import { isDialogOpen, isTextEntry } from '@/lib/keyboard';
import { Button, Kbd, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function getSiteTool( id: 'frontend' | 'admin' | 'database' | 'email' | 'design' ) {
	return (
		{
			frontend: { label: __( 'Browser' ), Icon: GlobeIcon, shortcut: 'B', action: 'openBrowser' },
			admin: { label: __( 'Admin' ), Icon: WordPressIcon, shortcut: 'A', action: 'openAdmin' },
			database: {
				label: __( 'Database' ),
				Icon: DatabaseIcon,
				shortcut: 'D',
				action: 'openDatabase',
			},
			email: { label: __( 'Email log' ), Icon: MailIcon, shortcut: 'E', action: 'openEmail' },
			design: {
				label: __( 'Design System' ),
				Icon: DesignSystemIcon,
				shortcut: 'S',
				action: 'openDesignSystem',
			},
		} as const
	 )[ id ];
}

export function useSiteToolActions(
	site: SiteDetails,
	{ liveUrl, onNavigate }: { liveUrl?: string; onNavigate?: ( path: string ) => void } = {}
) {
	const navigate = useNavigate();
	const preview = useSessionPreviewUI();
	const startSite = useStartSiteWithChat();
	const tabs = usePreviewTabs( previewTabsKey( site.id, liveUrl ) );
	const runLayoutTransition = useUserWorkspaceLayoutTransition( site.id );
	const trackOpen = usePreviewOpenTracks();
	const open = async ( path: string ) => {
		const location = liveUrl ? path : getRealmNavigationPath( path, getSiteUrl( site ) );
		if ( onNavigate ) onNavigate( location );
		else {
			if ( ! liveUrl && ! site.running && tabs.workspace.tabs.length === 1 ) {
				tabs.patch( tabs.workspace.selectedId, { path: location, title: null } );
			} else tabs.add( location );
		}
		if (
			! liveUrl &&
			! site.running &&
			! ( await startSite.mutateAsync( site.id ).catch( () => false ) )
		)
			return;
		trackOpen( path );
		runLayoutTransition( () => {
			preview.setSite( site.id );
			preview.setOpen( true );
			if ( preview.siteId !== site.id ) {
				return navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
			}
		} );
	};
	return {
		openBrowser: () => void open( '/' ),
		openAdmin: () => void open( '/wp-admin/' ),
		openDatabase: () => void open( DATABASE_HOME_PATH ),
		openEmail: () => void open( EMAIL_PREVIEW_PATH ),
		openDesignSystem: () => void open( DESIGN_SYSTEM_PREVIEW_PATH ),
	};
}

function useAvailableSiteTools( site: SiteDetails, live: boolean ) {
	const { data: design } = useSiteDesign( site );
	const designAvailable = useMemo( () => {
		if ( ! design ) return false;
		try {
			designSheet(
				design.design ? parseDesignMd( design.design ) : themeJsonDesign( design.themeJson )
			);
			return true;
		} catch {
			return false;
		}
	}, [ design ] );
	return ( [ 'frontend', 'admin', 'design', 'database', 'email' ] as const )
		.filter(
			( id ) =>
				( ! live || id === 'frontend' || id === 'admin' ) && ( id !== 'design' || designAvailable )
		)
		.map( ( id ) => ( { id, ...getSiteTool( id ) } ) );
}

export function SiteToolLauncher( {
	site,
	actions,
	live = false,
	active = true,
}: {
	site: SiteDetails;
	actions: ReturnType< typeof useSiteToolActions >;
	live?: boolean;
	active?: boolean;
} ) {
	const tools = useAvailableSiteTools( site, live );
	const busy = useIsSiteBusy( site );
	useEffect( () => {
		if ( ! active || busy ) return;
		const onKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				isTextEntry( event.composedPath()[ 0 ] ?? event.target ) ||
				isDialogOpen() ||
				document.querySelector(
					'[role="menu"][data-open], [role="listbox"][data-open], [role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed]), [data-slot="popover-content"][data-open]'
				)
			)
				return;
			const tool = tools.find(
				( tool ) => tool.shortcut.toLowerCase() === event.key.toLowerCase()
			);
			if ( ! tool ) return;
			event.preventDefault();
			event.stopPropagation();
			actions[ tool.action ]();
		};
		document.addEventListener( 'keydown', onKeyDown, true );
		return () => document.removeEventListener( 'keydown', onKeyDown, true );
	}, [ active, busy, tools, actions ] );
	return (
		<div className={ styles.launcher } role="group" aria-label={ __( 'Project tools' ) }>
			{ tools.map( ( { id, label, Icon, shortcut, action } ) => (
				<Button
					key={ id }
					variant="muted"
					layout="inline"
					disabled={ busy }
					onClick={ actions[ action ] }
					aria-keyshortcuts={ shortcut }
				>
					<Icon data-icon="inline-start" />
					<span>{ label }</span>
					<Kbd className={ styles.shortcut }>{ shortcut }</Kbd>
				</Button>
			) ) }
		</div>
	);
}

export function SiteToolMenuItems( {
	site,
	actions,
	live = false,
}: {
	site: SiteDetails;
	actions: ReturnType< typeof useSiteToolActions >;
	live?: boolean;
} ) {
	const tools = useAvailableSiteTools( site, live );
	const group = useRef< HTMLDivElement >( null );
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			const scope = group.current;
			const menu = scope?.closest( '[role="menu"]' );
			const target = event.target instanceof Element ? event.target : null;
			if (
				! scope ||
				! menu?.hasAttribute( 'data-open' ) ||
				! target ||
				( ! target.closest( '[role="menu"]' ) &&
					target.getAttribute( 'aria-controls' ) !== menu.id ) ||
				event.defaultPrevented ||
				event.repeat ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				isTextEntry( target )
			)
				return;
			const item = Array.from(
				scope.querySelectorAll< HTMLElement >( '[data-site-tool-key]' )
			).find(
				( item ) =>
					item.dataset.siteToolKey === event.key.toLowerCase() &&
					! item.matches( ':disabled, [aria-disabled="true"], [data-disabled]' )
			);
			if ( ! item ) return;
			event.preventDefault();
			event.stopPropagation();
			item.click();
		};
		document.addEventListener( 'keydown', onKeyDown, true );
		return () => document.removeEventListener( 'keydown', onKeyDown, true );
	}, [] );
	return (
		<Menu.Group ref={ group }>
			{ tools.map( ( { id, label, Icon, shortcut, action } ) => {
				return (
					<Menu.Item
						key={ id }
						onClick={ actions[ action ] }
						data-site-tool-key={ shortcut.toLowerCase() }
						aria-keyshortcuts={ shortcut }
					>
						<Icon />
						{ label }
						<Menu.Shortcut>{ shortcut }</Menu.Shortcut>
					</Menu.Item>
				);
			} ) }
		</Menu.Group>
	);
}
