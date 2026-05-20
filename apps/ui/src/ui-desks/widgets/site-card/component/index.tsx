import { useQueryClient } from '@tanstack/react-query';
import { store as coreDataStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { Icon, image } from '@wordpress/icons';
import { useEffect, useRef, useState } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY, useSites } from '@/data/queries/use-sites';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { WordPressDataProvider } from '@/data/wordpress/provider';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getSitePreviewUrl, withPreviewFlag } from '@/ui-desks/widgets/site-preview/url';
import { registerSiteCardEditSession, type SiteCardEditAction } from '../edit-session';
import { SITE_CARD_WIDGET_TYPE, type SiteCardWidgetProps } from '../types';
import { parseSiteIdentitySettings, type SiteIdentitySettings } from './settings';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { ChangeEvent, PointerEvent } from 'react';

type SiteCardWidgetComponentProps = DeskWidgetComponentProps< SiteCardWidgetProps >;
type SiteCardWidgetContentProps = SiteCardWidgetComponentProps & {
	effectiveSiteId: string | undefined;
};
type CoreDataSiteIdentitySettings = {
	title?: string;
	description?: string;
	site_icon?: number;
	site_icon_url?: string;
	site_logo_url?: string;
};
type CoreDataResolutionState =
	| {
			status: 'resolving' | 'finished';
	  }
	| {
			status: 'error';
			error: Error | unknown;
	  };

const SITE_IDENTITY_ENTITY_ARGS: [ string, string ] = [ 'root', 'site' ];

export function SiteCardWidgetComponent( props: SiteCardWidgetComponentProps ) {
	const { widgetProps } = props;
	const desk = useDesk();
	const effectiveSiteId = widgetProps.siteId ?? desk.siteId;
	const content = <SiteCardWidgetContent { ...props } effectiveSiteId={ effectiveSiteId } />;

	if ( effectiveSiteId && effectiveSiteId !== desk.siteId ) {
		return (
			<WordPressDataProvider key={ effectiveSiteId } siteId={ effectiveSiteId }>
				{ content }
			</WordPressDataProvider>
		);
	}

	return content;
}

function SiteCardWidgetContent( {
	id,
	widgetProps,
	isEditing,
	onEditComplete,
	effectiveSiteId,
}: SiteCardWidgetContentProps ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { saveEntityRecord } = useDispatch( coreDataStore );
	const desk = useDesk();
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === effectiveSiteId );
	const settingsQuery = useSiteIdentitySettings( Boolean( site?.running ) );
	const settings = settingsQuery.settings;
	const title = settings?.title || site?.name || __( 'Site unavailable' );
	const tagline = settings?.tagline ?? '';
	const currentIconSrc = settings?.siteIconUrl || site?.siteIcon || null;
	const isFocusedSiteCard =
		desk.focusMode?.widgetId === id &&
		desk.focusedWidget?.id === id &&
		desk.focusedWidget.type === SITE_CARD_WIDGET_TYPE;
	const isEditingIdentity = isEditing || isFocusedSiteCard;
	const [ draftTitle, setDraftTitle ] = useState( title );
	const [ draftTagline, setDraftTagline ] = useState( tagline );
	const [ draftIconFile, setDraftIconFile ] = useState< File | null >( null );
	const [ draftIconPreview, setDraftIconPreview ] = useState< string | null >( null );
	const [ isIconRemoved, setIsIconRemoved ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );
	const iconInputRef = useRef< HTMLInputElement | null >( null );
	const titleRef = useRef< HTMLDivElement | null >( null );
	const taglineRef = useRef< HTMLDivElement | null >( null );
	const previewUrl = getSitePreviewUrl( site, '/' );
	const canUseSiteRest = Boolean( effectiveSiteId && site?.running );
	const isLoadingSiteIdentity = canUseSiteRest && settingsQuery.isLoading;
	const canSave = canUseSiteRest && Boolean( draftTitle.trim() ) && ! settingsQuery.isLoading;
	const previewFrameUrl = previewUrl ? withPreviewFlag( previewUrl ) : '';
	const displayedIconSrc = isIconRemoved ? null : draftIconPreview || currentIconSrc;
	const isDirty =
		draftTitle.trim() !== title ||
		draftTagline.trim() !== tagline ||
		Boolean( draftIconFile ) ||
		isIconRemoved;

	useEffect( () => {
		if ( isEditingIdentity ) {
			return;
		}

		setDraftTitle( title );
		setDraftTagline( tagline );
		setDraftIconFile( null );
		setDraftIconPreview( null );
		setIsIconRemoved( false );
		setError( null );
	}, [ isEditingIdentity, tagline, title ] );

	useEffect( () => {
		return () => {
			if ( draftIconPreview ) {
				URL.revokeObjectURL( draftIconPreview );
			}
		};
	}, [ draftIconPreview ] );

	useEffect( () => {
		const titleNode = titleRef.current;
		if (
			titleNode &&
			document.activeElement !== titleNode &&
			titleNode.textContent !== draftTitle
		) {
			titleNode.textContent = draftTitle;
		}

		const taglineNode = taglineRef.current;
		if (
			taglineNode &&
			document.activeElement !== taglineNode &&
			taglineNode.textContent !== draftTagline
		) {
			taglineNode.textContent = draftTagline;
		}
	}, [ draftTagline, draftTitle ] );

	useEffect( () => {
		if ( ! isEditingIdentity ) {
			return;
		}

		const frame = window.requestAnimationFrame( () => {
			const titleNode = titleRef.current;
			if ( ! titleNode ) {
				return;
			}

			titleNode.focus();
			const range = document.createRange();
			range.selectNodeContents( titleNode );
			range.collapse( false );
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange( range );
		} );

		return () => window.cancelAnimationFrame( frame );
	}, [ isEditingIdentity ] );

	const completeEditing = () => {
		if ( isFocusedSiteCard ) {
			desk.stopFocusMode();
		}
		onEditComplete();
	};

	const cancelEditing = () => {
		setDraftTitle( title );
		setDraftTagline( tagline );
		setDraftIconFile( null );
		setDraftIconPreview( null );
		setIsIconRemoved( false );
		setError( null );
		completeEditing();
	};

	const saveIdentity = async () => {
		if ( ! effectiveSiteId || ! site || ! canSave || isSaving ) {
			return;
		}

		const nextTitle = draftTitle.trim();
		const nextTagline = draftTagline.trim();
		setIsSaving( true );
		setError( null );

		try {
			const nextSiteIconId = draftIconFile
				? ( await uploadSiteMedia( draftIconFile ) ).id
				: isIconRemoved
				? 0
				: undefined;

			await saveEntityRecord(
				...SITE_IDENTITY_ENTITY_ARGS,
				{
					title: nextTitle,
					description: nextTagline,
					...( nextSiteIconId !== undefined ? { site_icon: nextSiteIconId } : {} ),
				} satisfies CoreDataSiteIdentitySettings,
				{ throwOnError: true }
			);

			if ( site.name !== nextTitle ) {
				await connector.updateSite( { ...site, name: nextTitle } );
			}

			if ( nextSiteIconId !== undefined ) {
				await connector.refreshSiteIcon( effectiveSiteId );
			}

			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			setDraftIconFile( null );
			setDraftIconPreview( null );
			setIsIconRemoved( false );
			completeEditing();
		} catch ( saveError ) {
			setError(
				saveError instanceof Error ? saveError.message : __( 'Unable to save site identity.' )
			);
		} finally {
			setIsSaving( false );
		}
	};

	useEffect( () => {
		if ( ! isFocusedSiteCard ) {
			return;
		}

		return registerSiteCardEditSession( id, {
			isDirty,
			isSaving,
			canSave,
			requestAction: ( action: SiteCardEditAction ) => {
				if ( action === 'save' ) {
					void saveIdentity();
					return;
				}

				cancelEditing();
			},
		} );
	} );

	const handleIconChange = ( event: ChangeEvent< HTMLInputElement > ) => {
		const [ file ] = Array.from( event.target.files ?? [] );
		if ( ! file ) {
			return;
		}

		if ( ! file.type.startsWith( 'image/' ) ) {
			setError( __( 'Choose an image file for the site icon.' ) );
			return;
		}

		setDraftIconFile( file );
		setDraftIconPreview( URL.createObjectURL( file ) );
		setIsIconRemoved( false );
		setError( null );
		event.target.value = '';
	};

	const isLoading = isLoadingSites || isLoadingSiteIdentity;
	const emptyMessage = getEmptyMessage( {
		hasSiteId: Boolean( effectiveSiteId ),
		hasSite: Boolean( site ),
		isRunning: Boolean( site?.running ),
	} );

	return (
		<div
			className={ styles.card }
			data-preview-visible={ widgetProps.previewVisible ? 'true' : 'false' }
			data-editing={ isEditingIdentity ? 'true' : 'false' }
			data-studio-desk-widget={ SITE_CARD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ isLoading && ! site ? (
				<div className={ styles.loading }>
					<LoadingPlaceholder text={ __( 'Loading site card' ) } />
				</div>
			) : (
				<>
					{ widgetProps.previewVisible && (
						<div className={ styles.preview }>
							{ previewFrameUrl ? (
								<>
									<iframe
										className={ styles.frame }
										src={ previewFrameUrl }
										title={ __( 'Site preview' ) }
										sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
										referrerPolicy="no-referrer"
									/>
									<div className={ styles.previewShield } aria-hidden="true" />
								</>
							) : (
								<div className={ styles.previewEmpty }>{ emptyMessage }</div>
							) }
						</div>
					) }
					<button
						type="button"
						className={ styles.iconButton }
						aria-disabled={ ! isEditingIdentity || isSaving || ! canUseSiteRest }
						aria-label={ __( 'Change site icon' ) }
						title={ __( 'Change site icon' ) }
						onPointerDown={ stopCanvasPointer }
						onClick={ () => {
							if ( isEditingIdentity && ! isSaving && canUseSiteRest ) {
								iconInputRef.current?.click();
							}
						} }
					>
						{ displayedIconSrc ? (
							<SiteIcon
								className={ styles.icon }
								seed={ site ? `${ site.id }:${ site.name }:${ site.path }` : 'site-card' }
								imageSrc={ displayedIconSrc }
							/>
						) : (
							<Icon icon={ image } size={ 28 } />
						) }
					</button>
					<input
						ref={ iconInputRef }
						className={ styles.fileInput }
						type="file"
						accept="image/*"
						disabled={ ! isEditingIdentity || isSaving }
						onChange={ handleIconChange }
						onPointerDown={ stopCanvasPointer }
					/>
					{ isLoadingSiteIdentity ? (
						<div className={ styles.identity }>
							<LoadingPlaceholder
								className={ styles.identityLoading }
								text={ __( 'Loading site information' ) }
							/>
						</div>
					) : (
						<div className={ styles.identity }>
							<div
								ref={ titleRef }
								className={ styles.title }
								contentEditable={ isEditingIdentity && canUseSiteRest && ! isSaving }
								suppressContentEditableWarning
								spellCheck={ false }
								data-empty={ draftTitle.trim() ? 'false' : 'true' }
								data-placeholder={ __( 'Site title' ) }
								onInput={ () => setDraftTitle( titleRef.current?.textContent ?? '' ) }
								onPointerDown={ isEditingIdentity ? stopCanvasPointer : undefined }
							/>
							<div
								ref={ taglineRef }
								className={ styles.tagline }
								contentEditable={ isEditingIdentity && canUseSiteRest && ! isSaving }
								suppressContentEditableWarning
								spellCheck={ false }
								data-empty={ draftTagline.trim() ? 'false' : 'true' }
								data-placeholder={ __( 'Tagline' ) }
								onInput={ () => setDraftTagline( taglineRef.current?.textContent ?? '' ) }
								onPointerDown={ isEditingIdentity ? stopCanvasPointer : undefined }
							/>
							<div className={ styles.url } title={ site ? getSiteDisplayUrl( site ) : undefined }>
								{ site ? getSiteDisplayUrl( site ) : '' }
							</div>
						</div>
					) }
					{ error && <div className={ styles.error }>{ error }</div> }
				</>
			) }
		</div>
	);
}

export function SiteCardWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< SiteCardWidgetProps > ) {
	const { siteId } = useDesk();
	const effectiveSiteId = widgetProps.siteId ?? siteId;
	const { data: sites } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === effectiveSiteId );

	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget={ SITE_CARD_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<SiteIcon
				className={ styles.thumbnailIcon }
				seed={ site ? `${ site.id }:${ site.name }:${ site.path }` : 'site-card' }
				imageSrc={ site?.siteIcon }
			/>
			<span>{ site?.name || __( 'Site card' ) }</span>
		</div>
	);
}

function useSiteIdentitySettings( enabled: boolean ): {
	settings: SiteIdentitySettings | undefined;
	isLoading: boolean;
} {
	return useSelect(
		( select ) => {
			if ( ! enabled ) {
				return {
					settings: undefined,
					isLoading: false,
				};
			}

			const coreData = select( coreDataStore );
			const record = coreData.getEntityRecord( ...SITE_IDENTITY_ENTITY_ARGS ) as
				| CoreDataSiteIdentitySettings
				| undefined;
			const resolutionState = coreData.getResolutionState(
				'getEntityRecord',
				SITE_IDENTITY_ENTITY_ARGS
			) as CoreDataResolutionState | undefined;

			return {
				settings: record ? parseSiteIdentitySettings( record ) : undefined,
				isLoading: ! record && ( ! resolutionState || resolutionState.status === 'resolving' ),
			};
		},
		[ enabled ]
	);
}

function stopCanvasPointer( event: PointerEvent< HTMLElement > ) {
	event.stopPropagation();
}

function getEmptyMessage( {
	hasSiteId,
	hasSite,
	isRunning,
}: {
	hasSiteId: boolean;
	hasSite: boolean;
	isRunning: boolean;
} ) {
	if ( ! hasSiteId ) {
		return __( 'Choose a site to use this card.' );
	}

	if ( ! hasSite ) {
		return __( 'Site not found.' );
	}

	if ( ! isRunning ) {
		return __( 'Start the site to edit identity or preview it.' );
	}

	return '';
}
