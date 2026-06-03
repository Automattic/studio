import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { __, sprintf } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	external,
	grid,
	Icon,
	layout,
	navigation,
	page,
	pencil,
	preformatted,
	styles as stylesIcon,
	symbolFilled,
	widget as widgetIcon,
} from '@wordpress/icons';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { Button } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_SHORTCUTS_WIDGET_TYPE, type SiteShortcutsWidgetProps } from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { ComponentProps, PointerEvent } from 'react';

type SiteShortcutsWidgetComponentProps = DeskWidgetComponentProps< SiteShortcutsWidgetProps >;
type ShortcutIcon = NonNullable< ComponentProps< typeof Button >[ 'icon' ] >;

interface SiteShortcutAction {
	id: string;
	label: string;
	icon: ShortcutIcon;
	emphasis?: 'primary';
	disabled?: boolean;
	run: () => Promise< void >;
}

interface SiteShortcutGroup {
	id: string;
	title: string;
	actions: SiteShortcutAction[];
}

export function SiteShortcutsWidgetComponent( {
	id,
	widgetProps,
}: SiteShortcutsWidgetComponentProps ) {
	const connector = useConnector();
	const desk = useDesk();
	const { data: sites } = useSites();
	const { data: userPreferences } = useUserPreferences();
	const startSite = useStartSite();
	const effectiveSiteId = widgetProps.siteId ?? desk.siteId;
	const site = sites?.find( ( candidate ) => candidate.id === effectiveSiteId );
	const isStarting = useIsSiteStarting( effectiveSiteId );
	const isStopping = useIsSiteStopping( effectiveSiteId );
	const [ busyActionId, setBusyActionId ] = useState< string | null >( null );
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );
	const hasSite = Boolean( effectiveSiteId && site );
	const isRuntimeBusy = isStarting || isStopping || startSite.isPending;
	const isActionBusy = Boolean( busyActionId );
	const runtimeActionDisabled = ! hasSite || isRuntimeBusy || isActionBusy;
	const localActionDisabled = ! hasSite || isActionBusy;
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label()
		: __( 'Editor' );
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name()
		: __( 'Terminal' );

	const getRequiredSiteId = () => {
		if ( ! effectiveSiteId ) {
			throw new Error( 'No site selected.' );
		}
		return effectiveSiteId;
	};

	const openSitePath = async (
		path = '',
		options?: Parameters< typeof connector.openSiteUrl >[ 2 ]
	) => {
		const siteId = getRequiredSiteId();
		if ( ! site?.running ) {
			await startSite.mutateAsync( siteId );
		}
		if ( options ) {
			await connector.openSiteUrl( siteId, path, options );
			return;
		}
		await connector.openSiteUrl( siteId, path );
	};

	const openLocalTool = async ( tool: 'folder' | 'editor' | 'terminal' ) => {
		const siteId = getRequiredSiteId();
		if ( tool === 'folder' ) {
			await connector.openSiteFolder( siteId );
			return;
		}
		if ( tool === 'editor' ) {
			await connector.openSiteInEditor( siteId );
			return;
		}
		await connector.openSiteInTerminal( siteId );
	};

	const groups: SiteShortcutGroup[] = [
		{
			id: 'wordpress',
			title: __( 'WordPress' ),
			actions: [
				{
					id: 'open-site',
					label: __( 'Open site' ),
					icon: external,
					emphasis: 'primary',
					disabled: runtimeActionDisabled,
					run: () => openSitePath( '', { autoLogin: false } ),
				},
				{
					id: 'wp-admin',
					label: __( 'WP Admin' ),
					icon: desktop,
					emphasis: 'primary',
					disabled: runtimeActionDisabled,
					run: () => openSitePath( '/wp-admin/' ),
				},
				{
					id: 'phpmyadmin',
					label: __( 'phpMyAdmin' ),
					icon: grid,
					disabled: runtimeActionDisabled,
					run: () => openSitePath( '/phpmyadmin/index.php?route=/database/structure&db=wordpress' ),
				},
			],
		},
		{
			id: 'customize',
			title: __( 'Customize' ),
			actions: getCustomizeActions( Boolean( site?.themeDetails?.isBlockTheme === false ) ).map(
				( action ) => ( {
					...action,
					disabled: runtimeActionDisabled,
					run: () => openSitePath( action.path ),
				} )
			),
		},
		{
			id: 'local',
			title: __( 'Local' ),
			actions: [
				{
					id: 'files',
					label: __( 'Files' ),
					icon: archive,
					disabled: localActionDisabled,
					run: () => openLocalTool( 'folder' ),
				},
				{
					id: 'editor',
					label: editorLabel,
					icon: code,
					disabled: localActionDisabled || ! userPreferences?.editor,
					run: () => openLocalTool( 'editor' ),
				},
				{
					id: 'terminal',
					label: terminalLabel,
					icon: preformatted,
					disabled: localActionDisabled,
					run: () => openLocalTool( 'terminal' ),
				},
			],
		},
	];

	const runShortcut = async ( action: SiteShortcutAction ) => {
		if ( action.disabled || busyActionId ) {
			return;
		}

		setBusyActionId( action.id );
		setErrorMessage( null );
		try {
			await action.run();
		} catch ( error ) {
			console.error( 'Failed to run site shortcut:', error );
			setErrorMessage(
				sprintf(
					/* translators: %s: shortcut label, such as "WP Admin". */
					__( 'Could not open %s.' ),
					action.label
				)
			);
		} finally {
			setBusyActionId( null );
		}
	};

	return (
		<section
			className={ styles.card }
			data-studio-desk-widget={ SITE_SHORTCUTS_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<header className={ styles.header }>
				<h2 className={ styles.title }>{ __( 'Site shortcuts' ) }</h2>
			</header>

			{ hasSite ? (
				<div className={ styles.groups }>
					{ groups.map( ( group ) => (
						<div className={ styles.group } key={ group.id }>
							<h3 className={ styles.groupTitle }>{ group.title }</h3>
							<div className={ styles.actions }>
								{ group.actions.map( ( action ) => (
									<Button
										key={ action.id }
										className={ styles.action }
										icon={ action.icon }
										label={ action.label }
										variant="filled"
										tone={ action.emphasis === 'primary' ? 'inverse' : 'neutral' }
										size="large"
										disabled={ action.disabled }
										aria-busy={ busyActionId === action.id ? 'true' : undefined }
										onPointerDown={ stopCanvasPointer }
										onClick={ () => void runShortcut( action ) }
									>
										<span>{ action.label }</span>
									</Button>
								) ) }
							</div>
						</div>
					) ) }
				</div>
			) : (
				<div className={ styles.empty }>{ __( 'Choose a site to use shortcuts.' ) }</div>
			) }

			{ errorMessage ? <div className={ styles.error }>{ errorMessage }</div> : null }
		</section>
	);
}

export function SiteShortcutsWidgetThumbnailComponent( {
	id,
}: DeskWidgetThumbnailComponentProps< SiteShortcutsWidgetProps > ) {
	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget={ SITE_SHORTCUTS_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<span className={ styles.thumbnailIcon } aria-hidden="true">
				<Icon icon={ external } size={ 16 } />
			</span>
			<span>{ __( 'Site shortcuts' ) }</span>
		</div>
	);
}

function getCustomizeActions( isClassicTheme: boolean ) {
	if ( isClassicTheme ) {
		return [
			{
				id: 'customizer',
				label: __( 'Customizer' ),
				icon: pencil,
				path: '/wp-admin/customize.php',
			},
			{
				id: 'menus',
				label: __( 'Menus' ),
				icon: navigation,
				path: '/wp-admin/nav-menus.php',
			},
			{
				id: 'widgets',
				label: __( 'Widgets' ),
				icon: widgetIcon,
				path: '/wp-admin/widgets.php',
			},
		];
	}

	return [
		{
			id: 'site-editor',
			label: __( 'Site Editor' ),
			icon: desktop,
			path: '/wp-admin/site-editor.php',
		},
		{
			id: 'styles',
			label: __( 'Styles' ),
			icon: stylesIcon,
			path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
		},
		{
			id: 'patterns',
			label: __( 'Patterns' ),
			icon: symbolFilled,
			path: '/wp-admin/site-editor.php?path=%2Fpatterns',
		},
		{
			id: 'navigation',
			label: __( 'Navigation' ),
			icon: navigation,
			path: '/wp-admin/site-editor.php?path=%2Fnavigation',
		},
		{
			id: 'templates',
			label: __( 'Templates' ),
			icon: layout,
			path: '/wp-admin/site-editor.php?path=%2Fwp_template',
		},
		{
			id: 'pages',
			label: __( 'Pages' ),
			icon: page,
			path: '/wp-admin/site-editor.php?path=%2Fpage',
		},
	];
}

function stopCanvasPointer( event: PointerEvent< HTMLButtonElement > ) {
	event.stopPropagation();
}
