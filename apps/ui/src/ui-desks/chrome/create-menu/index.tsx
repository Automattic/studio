import { useNavigate } from '@tanstack/react-router';
import { useRegistry } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { chevronLeft, chevronRight, download, globe, link, plus, verse } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useState, type ReactNode } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { useSites } from '@/data/queries/use-sites';
import { Button, Menu } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import {
	isWidgetAvailableInDeskContext,
	isWidgetCreationDisabled,
} from '@/ui-desks/widget-actions/availability';
import { getCreateWidgetOptions } from '@/ui-desks/widget-actions/create-widget-options';
import {
	getExistingContentWidgetProps,
	getExistingContentWidgetType,
	useExistingContentPicker,
	type ExistingContentType,
} from '@/ui-desks/widget-actions/existing-content-picker';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { getCreatableWidgetDefinitions } from '@/ui-desks/widgets/registry';
import { siteCardWidgetDefinition } from '@/ui-desks/widgets/site-card/definition';
import { getThemePatterns, getThemeTemplates } from '@/ui-desks/widgets/theme/api';
import { themeWidgetDefinition } from '@/ui-desks/widgets/theme/definition';
import {
	createThemePatternBrowserMaterialization,
	themePatternBrowserWidgetDefinition,
} from '@/ui-desks/widgets/theme-pattern-browser/definition';
import {
	createThemeTemplateBrowserMaterialization,
	themeTemplateBrowserWidgetDefinition,
} from '@/ui-desks/widgets/theme-template-browser/definition';
import { LinkFromUrlDialog } from '../link-from-url-dialog';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { DeskWidgetDefinition } from '@/ui-desks/widgets/types';

export function DeskCreateMenu() {
	const navigate = useNavigate();
	const desk = useDesk();
	const registry = useRegistry();
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions().filter( ( definition ) =>
		isWidgetAvailableInDeskContext( definition, Boolean( desk.siteId ) )
	);
	const [ mode, setMode ] = useState< 'menu' | 'pick-post' | 'pick-page' | 'pick-site-card' >(
		'menu'
	);
	const [ isLinkDialogOpen, setIsLinkDialogOpen ] = useState( false );
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const isSiteRunning = Boolean( site?.running );
	const addCreatableWidget = async (
		definition: ReturnType< typeof getCreatableWidgetDefinitions >[ number ]
	) => {
		desk.addWidget(
			definition.type,
			await getCreateWidgetOptions( definition, registry, {
				shouldStartEditing: definition.shouldStartEditingOnCreate,
			} )
		);
	};
	const addPatternBrowser = async () => {
		const patterns = await getThemePatterns( { registry } );
		desk.addMaterializedDesk( ( context ) =>
			createThemePatternBrowserMaterialization( context, patterns )
		);
	};
	const addTemplateBrowser = async () => {
		const templates = await getThemeTemplates( { registry } );
		desk.addMaterializedDesk( ( context ) =>
			createThemeTemplateBrowserMaterialization( context, templates )
		);
	};

	const openCreateSite = () => {
		void navigate( { to: '/onboarding' } );
	};

	const openImportSite = () => {
		void navigate( { to: '/onboarding/import', search: { step: 'select' } } );
	};

	return (
		<>
			<Menu.Root modal={ false } onOpenChange={ ( open ) => ! open && setMode( 'menu' ) }>
				<Menu.Trigger render={ <Button icon={ plus } label={ __( 'Create new' ) } /> } />
				<Menu.Popup
					side="bottom"
					align="start"
					className={ `${ styles.popup } ${ mode !== 'menu' ? styles.postPickerPopup : '' }` }
				>
					{ mode === 'menu' ? (
						<>
							{ creatableWidgetDefinitions.map( ( definition ) => (
								<CreateWidgetMenuItem
									key={ definition.type }
									definition={ definition }
									canAddWidgets={ desk.canAddWidgets }
									isSiteRunning={ isSiteRunning }
									onClick={ () => void addCreatableWidget( definition ) }
								>
									{ definition.type === themeWidgetDefinition.type && (
										<>
											<CreateWidgetMenuItem
												definition={ themePatternBrowserWidgetDefinition }
												canAddWidgets={ desk.canAddWidgets }
												isSiteRunning={ isSiteRunning }
												onClick={ () => void addPatternBrowser() }
											/>
											<CreateWidgetMenuItem
												definition={ themeTemplateBrowserWidgetDefinition }
												canAddWidgets={ desk.canAddWidgets }
												isSiteRunning={ isSiteRunning }
												onClick={ () => void addTemplateBrowser() }
											/>
										</>
									) }
								</CreateWidgetMenuItem>
							) ) }
							{ desk.siteId ? (
								<Menu.Item
									disabled={ ! desk.canAddWidgets }
									onClick={ () =>
										desk.addWidget( siteCardWidgetDefinition.type, {
											shouldStartEditing: false,
										} )
									}
								>
									{ siteCardWidgetDefinition.icon && (
										<Icon icon={ siteCardWidgetDefinition.icon } />
									) }
									<span>{ siteCardWidgetDefinition.labels.add() }</span>
								</Menu.Item>
							) : (
								<Menu.Item
									disabled={ ! desk.canAddWidgets || ! sites?.length }
									closeOnClick={ false }
									onClick={ ( event ) => {
										event.preventDefault();
										setMode( 'pick-site-card' );
									} }
								>
									{ siteCardWidgetDefinition.icon && (
										<Icon icon={ siteCardWidgetDefinition.icon } />
									) }
									<span>{ siteCardWidgetDefinition.labels.add() }</span>
									<Icon icon={ chevronRight } />
								</Menu.Item>
							) }
							<Menu.Item
								disabled={ ! desk.canAddWidgets }
								onClick={ () => setIsLinkDialogOpen( true ) }
							>
								<Icon icon={ link } />
								<span>{ __( 'New link from URL' ) }</span>
							</Menu.Item>
							<Menu.Item disabled={ ! desk.canAddWidgets } onClick={ desk.startDrawing }>
								<Icon icon={ verse } />
								<span>{ __( 'New drawing' ) }</span>
							</Menu.Item>
							{ desk.siteId && (
								<>
									<Menu.Item
										disabled={ isWidgetCreationDisabled(
											postWidgetDefinition,
											desk.canAddWidgets,
											isSiteRunning
										) }
										closeOnClick={ false }
										onClick={ ( event ) => {
											event.preventDefault();
											setMode( 'pick-post' );
										} }
									>
										{ postWidgetDefinition.icon && <Icon icon={ postWidgetDefinition.icon } /> }
										<span>{ postWidgetDefinition.labels.add() }</span>
									</Menu.Item>
									<Menu.Item
										disabled={ isWidgetCreationDisabled(
											pageWidgetDefinition,
											desk.canAddWidgets,
											isSiteRunning
										) }
										closeOnClick={ false }
										onClick={ ( event ) => {
											event.preventDefault();
											setMode( 'pick-page' );
										} }
									>
										{ pageWidgetDefinition.icon && <Icon icon={ pageWidgetDefinition.icon } /> }
										<span>{ pageWidgetDefinition.labels.add() }</span>
									</Menu.Item>
								</>
							) }
							{ ( creatableWidgetDefinitions.length > 0 || sites?.length || desk.siteId ) && (
								<Menu.Separator />
							) }
							<Menu.Item onClick={ openCreateSite }>
								<Icon icon={ globe } />
								<span>{ __( 'New site' ) }</span>
							</Menu.Item>
							<Menu.Item onClick={ openImportSite }>
								<Icon icon={ download } />
								<span>{ __( 'Import from…' ) }</span>
							</Menu.Item>
						</>
					) : mode === 'pick-site-card' ? (
						<SiteCardPickerMenuItems
							onBack={ () => setMode( 'menu' ) }
							onSelect={ ( selectedSiteId ) => {
								desk.addWidget( siteCardWidgetDefinition.type, {
									widgetProps: {
										siteId: selectedSiteId,
									},
									shouldStartEditing: false,
								} );
							} }
						/>
					) : (
						<ExistingContentPickerMenuItems
							type={ mode === 'pick-page' ? 'page' : 'post' }
							onBack={ () => setMode( 'menu' ) }
						/>
					) }
				</Menu.Popup>
			</Menu.Root>
			{ isLinkDialogOpen && <LinkFromUrlDialog onClose={ () => setIsLinkDialogOpen( false ) } /> }
		</>
	);
}

function CreateWidgetMenuItem( {
	definition,
	canAddWidgets,
	isSiteRunning,
	onClick,
	children,
}: {
	definition: DeskWidgetDefinition;
	canAddWidgets: boolean;
	isSiteRunning: boolean;
	onClick: () => void;
	children?: ReactNode;
} ) {
	return (
		<>
			<Menu.Item
				disabled={ isWidgetCreationDisabled( definition, canAddWidgets, isSiteRunning ) }
				onClick={ onClick }
			>
				{ definition.icon && <Icon icon={ definition.icon } /> }
				<span>{ definition.labels.add() }</span>
			</Menu.Item>
			{ children }
		</>
	);
}

function SiteCardPickerMenuItems( {
	onBack,
	onSelect,
}: {
	onBack: () => void;
	onSelect: ( siteId: string ) => void;
} ) {
	const desk = useDesk();
	const { data: sites, isLoading } = useSites();

	return (
		<>
			<Menu.Item
				closeOnClick={ false }
				onClick={ ( event ) => {
					event.preventDefault();
					onBack();
				} }
			>
				<Icon icon={ chevronLeft } />
				<span>{ __( 'Back' ) }</span>
			</Menu.Item>
			<Menu.Separator />
			{ isLoading && <div className={ styles.postPickerStatus }>{ __( 'Loading sites…' ) }</div> }
			{ ! isLoading && ! sites?.length && (
				<div className={ styles.postPickerStatus }>{ __( 'No sites available.' ) }</div>
			) }
			{ sites?.map( ( site ) => (
				<Menu.Item
					key={ site.id }
					className={ styles.sitePickerItem }
					disabled={ ! desk.canAddWidgets }
					onClick={ () => onSelect( site.id ) }
				>
					<SiteCardPickerSite site={ site } />
				</Menu.Item>
			) ) }
		</>
	);
}

function SiteCardPickerSite( { site }: { site: SiteDetails } ) {
	return (
		<>
			<SiteIcon
				className={ styles.sitePickerIcon }
				seed={ `${ site.id }:${ site.name }:${ site.path }` }
				imageSrc={ site.siteIcon }
			/>
			<span className={ styles.postPickerContent }>
				<span className={ styles.postPickerTitle }>{ site.name }</span>
				<span className={ styles.postPickerMeta }>
					{ site.running ? __( 'Running' ) : __( 'Stopped' ) }
				</span>
			</span>
		</>
	);
}

function ExistingContentPickerMenuItems( {
	type,
	onBack,
}: {
	type: ExistingContentType;
	onBack: () => void;
} ) {
	const desk = useDesk();
	const { items, statusMessage } = useExistingContentPicker( { type, siteId: desk.siteId } );

	return (
		<>
			<Menu.Item
				closeOnClick={ false }
				onClick={ ( event ) => {
					event.preventDefault();
					onBack();
				} }
			>
				<Icon icon={ chevronLeft } />
				<span>{ __( 'Back' ) }</span>
			</Menu.Item>
			<Menu.Separator />
			{ statusMessage && <div className={ styles.postPickerStatus }>{ statusMessage }</div> }
			{ items?.map( ( item ) => {
				return (
					<Menu.Item
						key={ item.id }
						className={ styles.postPickerItem }
						disabled={ ! desk.canAddWidgets }
						onClick={ () =>
							desk.addWidget( getExistingContentWidgetType( type ), {
								widgetProps: getExistingContentWidgetProps( type, item.id ),
								shouldStartEditing: false,
							} )
						}
					>
						<span className={ styles.postPickerContent }>
							<span className={ styles.postPickerTitle }>{ item.title }</span>
							{ item.status && (
								<span className={ styles.postPickerMeta }>{ item.statusInfo.label }</span>
							) }
						</span>
						{ item.status && (
							<span
								className={ styles.postPickerStatusDot }
								style={ { background: item.statusInfo.color } }
								title={ item.statusInfo.label }
								aria-label={ item.statusInfo.label }
							/>
						) }
					</Menu.Item>
				);
			} ) }
		</>
	);
}
