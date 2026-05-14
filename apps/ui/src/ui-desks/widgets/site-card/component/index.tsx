import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { Icon, image } from '@wordpress/icons';
import { useEffect, useRef, useState } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY, useSites } from '@/data/queries/use-sites';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getSitePreviewUrl, withPreviewFlag } from '@/ui-desks/widgets/site-preview/url';
import { registerSiteCardEditSession, type SiteCardEditAction } from '../edit-session';
import { SITE_CARD_WIDGET_TYPE, type SiteCardWidgetProps } from '../types';
import { parseJsonObject, parseSiteIdentitySettings, type SiteIdentitySettings } from './settings';
import styles from './style.module.css';
import type { Connector } from '@/data/core';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { ChangeEvent, PointerEvent } from 'react';

type SiteCardWidgetComponentProps = DeskWidgetComponentProps< SiteCardWidgetProps >;

const SITE_CARD_SETTINGS_QUERY_KEY = [ 'ui-desks', 'site-card-settings' ] as const;

export function SiteCardWidgetComponent( {
	id,
	widgetProps,
	isEditing,
	onEditComplete,
}: SiteCardWidgetComponentProps ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const desk = useDesk();
	const { data: sites, isLoading: isLoadingSites } = useSites();
	const effectiveSiteId = widgetProps.siteId ?? desk.siteId;
	const site = sites?.find( ( currentSite ) => currentSite.id === effectiveSiteId );
	const settingsQuery = useSiteIdentitySettings( effectiveSiteId, Boolean( site?.running ) );
	const settings = settingsQuery.data;
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
				? await uploadSiteIcon( connector, effectiveSiteId, draftIconFile )
				: isIconRemoved
				? 0
				: undefined;

			await saveSiteIdentitySettings( connector, effectiveSiteId, {
				title: nextTitle,
				tagline: nextTagline,
				siteIconId: nextSiteIconId,
			} );

			if ( site.name !== nextTitle ) {
				await connector.updateSite( { ...site, name: nextTitle } );
			}

			if ( nextSiteIconId !== undefined ) {
				await connector.refreshSiteIcon( effectiveSiteId );
			}

			await Promise.all( [
				queryClient.invalidateQueries( {
					queryKey: getSiteIdentitySettingsQueryKey( effectiveSiteId ),
				} ),
				queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
			] );
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

	const isLoading = isLoadingSites || ( canUseSiteRest && settingsQuery.isLoading );
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

function useSiteIdentitySettings( siteId: string | undefined, enabled: boolean ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: siteId ? getSiteIdentitySettingsQueryKey( siteId ) : SITE_CARD_SETTINGS_QUERY_KEY,
		enabled: Boolean( siteId && enabled ),
		queryFn: async () => {
			if ( ! siteId ) {
				throw new Error( 'Site id is required.' );
			}
			return fetchSiteIdentitySettings( connector, siteId );
		},
	} );
}

async function fetchSiteIdentitySettings(
	connector: Connector,
	siteId: string
): Promise< SiteIdentitySettings > {
	const response = await connector.fetchSiteRest( siteId, {
		path: '/wp/v2/settings',
		method: 'GET',
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		throw new Error( __( 'Unable to load site identity.' ) );
	}

	return parseSiteIdentitySettings( response.body );
}

async function saveSiteIdentitySettings(
	connector: Connector,
	siteId: string,
	settings: {
		title: string;
		tagline: string;
		siteIconId?: number;
	}
) {
	const response = await connector.fetchSiteRest( siteId, {
		path: '/wp/v2/settings',
		method: 'POST',
		data: {
			title: settings.title,
			description: settings.tagline,
			...( settings.siteIconId !== undefined ? { site_icon: settings.siteIconId } : {} ),
		},
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		throw new Error( __( 'Unable to save site identity.' ) );
	}
}

async function uploadSiteIcon( connector: Connector, siteId: string, file: File ) {
	const response = await connector.fetchSiteRest( siteId, {
		path: '/wp/v2/media',
		method: 'POST',
		headers: {
			'Content-Disposition': `attachment; filename="${ sanitizeFileName( file.name ) }"`,
			'Content-Type': file.type || 'application/octet-stream',
		},
		body: await file.arrayBuffer(),
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		throw new Error( __( 'Unable to upload site icon.' ) );
	}

	const parsed = parseJsonObject( response.body );
	const id = parsed && typeof parsed.id === 'number' ? parsed.id : null;
	if ( id === null ) {
		throw new Error( __( 'Unable to upload site icon.' ) );
	}
	return id;
}

function getSiteIdentitySettingsQueryKey( siteId: string ) {
	return [ ...SITE_CARD_SETTINGS_QUERY_KEY, siteId ] as const;
}

function sanitizeFileName( fileName: string ) {
	return fileName.replace( /["\\\r\n]/g, '-' ) || 'site-icon';
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
