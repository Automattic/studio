import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft, download, globe, link, plus, verse } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useState } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { Button, Menu } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import {
	isWidgetAvailableInDeskContext,
	isWidgetCreationDisabled,
} from '@/ui-desks/widget-actions/availability';
import {
	getExistingContentWidgetProps,
	getExistingContentWidgetType,
	useExistingContentPicker,
	type ExistingContentType,
} from '@/ui-desks/widget-actions/existing-content-picker';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { getCreatableWidgetDefinitions } from '@/ui-desks/widgets/registry';
import { LinkFromUrlDialog } from '../link-from-url-dialog';
import styles from './style.module.css';

export function DeskCreateMenu() {
	const navigate = useNavigate();
	const desk = useDesk();
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions().filter( ( definition ) =>
		isWidgetAvailableInDeskContext( definition, Boolean( desk.siteId ) )
	);
	const [ mode, setMode ] = useState< 'menu' | 'pick-post' | 'pick-page' >( 'menu' );
	const [ isLinkDialogOpen, setIsLinkDialogOpen ] = useState( false );
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const isSiteRunning = Boolean( site?.running );

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
								<Menu.Item
									key={ definition.type }
									disabled={ isWidgetCreationDisabled(
										definition,
										desk.canAddWidgets,
										isSiteRunning
									) }
									onClick={ () =>
										desk.addWidget( definition.type, {
											shouldStartEditing: definition.shouldStartEditingOnCreate,
										} )
									}
								>
									{ definition.icon && <Icon icon={ definition.icon } /> }
									<span>{ definition.labels.add() }</span>
								</Menu.Item>
							) ) }
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
							{ ( creatableWidgetDefinitions.length > 0 || desk.siteId ) && <Menu.Separator /> }
							<Menu.Item onClick={ openCreateSite }>
								<Icon icon={ globe } />
								<span>{ __( 'New site' ) }</span>
							</Menu.Item>
							<Menu.Item onClick={ openImportSite }>
								<Icon icon={ download } />
								<span>{ __( 'Import from…' ) }</span>
							</Menu.Item>
						</>
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
