import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getSitePreviewUrl, urlLabelFor, withPreviewFlag } from '../url';
import styles from './style.module.css';
import type { SitePreviewWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type SitePreviewWidgetComponentProps = DeskWidgetComponentProps< SitePreviewWidgetProps >;

export function SitePreviewWidgetComponent( {
	id,
	widgetProps,
	isEditing,
	isHovered,
	isSelected,
}: SitePreviewWidgetComponentProps ) {
	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const { siteId } = useDesk();
	const { data: sites, isLoading } = useSites();
	const site = sites?.find( ( currentSite ) => currentSite.id === siteId );
	const sitePreviewUrl = getSitePreviewUrl( site, widgetProps.path );
	const previewFrameUrl = sitePreviewUrl ? withPreviewFlag( sitePreviewUrl ) : '';
	const [ liveUrl, setLiveUrl ] = useState( sitePreviewUrl );
	const [ isFrameLoading, setIsFrameLoading ] = useState( false );

	useEffect( () => {
		setLiveUrl( sitePreviewUrl );
	}, [ sitePreviewUrl ] );

	useEffect( () => {
		setIsFrameLoading( Boolean( previewFrameUrl ) );
	}, [ previewFrameUrl ] );

	const handleIframeLoad = () => {
		setIsFrameLoading( false );
		try {
			const href = iframeRef.current?.contentWindow?.location.href;
			if ( href ) {
				setLiveUrl( href );
			}
		} catch {
			// Cross-origin navigation is expected for local sites in Electron.
		}
	};

	const emptyMessage = getEmptyMessage( {
		hasSiteId: Boolean( siteId ),
		isLoading,
		hasSite: Boolean( site ),
		isRunning: Boolean( site?.running ),
	} );
	const urlLabel = urlLabelFor( liveUrl );

	return (
		<div
			className={ styles.wrapper }
			data-studio-desk-widget="site-preview"
			data-studio-desk-widget-id={ id }
		>
			{ urlLabel && (
				<div
					className={ styles.url }
					data-visible={ isHovered || isSelected ? 'true' : 'false' }
					title={ urlLabel }
				>
					{ urlLabel }
				</div>
			) }
			<div className={ styles.preview } data-is-editing={ isEditing ? 'true' : 'false' }>
				{ previewFrameUrl ? (
					<>
						<iframe
							ref={ iframeRef }
							className={ styles.frame }
							src={ previewFrameUrl }
							title={ __( 'Site preview' ) }
							sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
							referrerPolicy="no-referrer"
							onLoad={ handleIframeLoad }
						/>
						{ isFrameLoading && (
							<div className={ styles.loading }>
								<LoadingPlaceholder text={ __( 'Loading site preview' ) } />
							</div>
						) }
					</>
				) : (
					<div className={ isLoading ? styles.loading : styles.empty }>
						{ isLoading ? (
							<LoadingPlaceholder text={ __( 'Loading site preview' ) } />
						) : (
							emptyMessage
						) }
					</div>
				) }
				{ ! isEditing && <div className={ styles.shield } aria-hidden="true" /> }
			</div>
		</div>
	);
}

export function SitePreviewWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< SitePreviewWidgetProps > ) {
	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget="site-preview"
			data-studio-desk-widget-id={ id }
		>
			<div className={ styles.thumbnailDomain }>{ formatPathLabel( widgetProps.path ) }</div>
		</div>
	);
}

function getEmptyMessage( {
	hasSiteId,
	isLoading,
	hasSite,
	isRunning,
}: {
	hasSiteId: boolean;
	isLoading: boolean;
	hasSite: boolean;
	isRunning: boolean;
} ) {
	if ( ! hasSiteId ) {
		return __( 'Site preview unavailable' );
	}

	if ( isLoading ) {
		return __( 'Loading site…' );
	}

	if ( ! hasSite ) {
		return __( 'Site not found.' );
	}

	if ( ! isRunning ) {
		return __( 'Start the site to see a live preview.' );
	}

	return __( 'Site preview unavailable' );
}

function formatPathLabel( path: string ) {
	const trimmed = path.trim();
	if ( ! trimmed || trimmed === '/' ) {
		return __( 'Site' );
	}

	return trimmed.startsWith( '/' ) ? trimmed : `/${ trimmed }`;
}
