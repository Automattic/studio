import { useNavigate } from '@tanstack/react-router';
import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';
import { chevronLeft, comment, download, globe, plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { IconControlButton, Menu } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { getCreatableWidgetDefinitions } from '@/ui-desks/widgets/registry';
import styles from './style.module.css';
import type { DeskChatsSearch } from '../chats/search';
import type { DeskWidgetDefinition } from '@/ui-desks/widgets/types';

export function DeskCreateMenu() {
	const navigate = useNavigate();
	const desk = useDesk();
	const creatableWidgetDefinitions = getCreatableWidgetDefinitions().filter( ( definition ) =>
		isWidgetAvailableInDeskContext( definition, Boolean( desk.siteId ) )
	);
	const [ mode, setMode ] = useState< 'menu' | 'pick-post' | 'pick-page' >( 'menu' );
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const isSiteRunning = Boolean( site?.running );

	const createChat = () => {
		void navigate( {
			to: '.',
			search: ( previous: DeskChatsSearch ) => ( {
				...previous,
				chats: true,
				newChat: Date.now(),
			} ),
		} );
	};

	const openCreateSite = () => {
		void navigate( { to: '/onboarding' } );
	};

	const openImportSite = () => {
		void navigate( { to: '/onboarding/import', search: { step: 'select' } } );
	};

	return (
		<Menu.Root modal={ false } onOpenChange={ ( open ) => ! open && setMode( 'menu' ) }>
			<Menu.Trigger render={ <IconControlButton icon={ plus } label={ __( 'Create new' ) } /> } />
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
						<Menu.Item onClick={ createChat }>
							<Icon icon={ comment } />
							<span>{ __( 'New chat' ) }</span>
						</Menu.Item>
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
	);
}

function isWidgetAvailableInDeskContext(
	definition: DeskWidgetDefinition,
	hasSiteContext: boolean
) {
	return hasSiteContext || ! definition.requiresRunningSite;
}

function isWidgetCreationDisabled(
	definition: DeskWidgetDefinition,
	canAddWidgets: boolean,
	isSiteRunning: boolean
) {
	return ! canAddWidgets || ( definition.requiresRunningSite && ! isSiteRunning );
}

function ExistingContentPickerMenuItems( {
	type,
	onBack,
}: {
	type: 'post' | 'page';
	onBack: () => void;
} ) {
	const desk = useDesk();
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === desk.siteId );
	const canQueryPosts = Boolean( site?.running );
	const query = useMemo(
		() => ( {
			per_page: 20,
			context: 'view',
			orderby: type === 'page' ? 'menu_order' : 'date',
			order: type === 'page' ? 'asc' : 'desc',
			_fields: 'id,title,excerpt,status,date,link,slug',
		} ),
		[ type ]
	);

	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< CoreDataPost >( 'postType', type, query, {
		enabled: canQueryPosts,
	} );

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
			{ isLoadingSites && (
				<div className={ styles.postPickerStatus }>{ __( 'Checking site…' ) }</div>
			) }
			{ ! isLoadingSites && ! site && (
				<div className={ styles.postPickerStatus }>{ __( 'Site not found.' ) }</div>
			) }
			{ site && ! site.running && (
				<div className={ styles.postPickerStatus }>{ __( 'Site is not running.' ) }</div>
			) }
			{ canQueryPosts && isResolving && ! records && (
				<div className={ styles.postPickerStatus }>
					{ type === 'page' ? __( 'Loading pages…' ) : __( 'Loading posts…' ) }
				</div>
			) }
			{ canQueryPosts && records && records.length === 0 && (
				<div className={ styles.postPickerStatus }>
					{ type === 'page' ? __( 'No pages found.' ) : __( 'No posts found.' ) }
				</div>
			) }
			{ canQueryPosts && resolutionStatus === 'ERROR' && (
				<div className={ styles.postPickerStatus }>
					{ type === 'page' ? __( 'Unable to load pages.' ) : __( 'Unable to load posts.' ) }
				</div>
			) }
			{ records?.map( ( record ) => {
				const title = decodeEntities( record.title?.rendered ?? '' ).trim() || __( 'Untitled' );
				return (
					<Menu.Item
						key={ record.id }
						className={ styles.postPickerItem }
						disabled={ ! desk.canAddWidgets }
						onClick={ () =>
							desk.addWidget( type === 'page' ? PAGE_WIDGET_TYPE : POST_WIDGET_TYPE, {
								widgetProps: {
									...( type === 'page'
										? { pageId: record.id, tone: 'neutral' }
										: { postId: record.id } ),
								},
								shouldStartEditing: false,
							} )
						}
					>
						<span className={ styles.postPickerTitle }>{ title }</span>
						{ record.status && <span className={ styles.postPickerMeta }>{ record.status }</span> }
					</Menu.Item>
				);
			} ) }
		</>
	);
}
