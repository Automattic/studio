import { __ } from '@wordpress/i18n';
import { link } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import { useConnector, type Connector } from '@/data/core';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getFaviconUrl, getUrlHostname } from '@/ui-desks/widget-actions/url';
import { BOOKMARK_WIDGET_TYPE, type BookmarkWidgetProps } from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { MouseEvent, PointerEvent } from 'react';

type BookmarkWidgetComponentProps = DeskWidgetComponentProps< BookmarkWidgetProps >;

interface BookmarkUrlMeta {
	title: string;
	description: string;
	icon: string;
	image: string;
}

export function BookmarkWidgetComponent( { id, widgetProps }: BookmarkWidgetComponentProps ) {
	const connector = useConnector();
	const { siteId } = useDesk();
	const [ meta, setMeta ] = useState< BookmarkUrlMeta | null >( null );
	const [ isMetaLoading, setIsMetaLoading ] = useState( false );

	useEffect( () => {
		if ( ! widgetProps.url ) {
			setMeta( null );
			setIsMetaLoading( false );
			return;
		}

		let cancelled = false;
		setMeta( null );
		setIsMetaLoading( Boolean( siteId ) );
		void fetchBookmarkUrlMeta( connector, siteId, widgetProps.url )
			.then( ( meta ) => {
				if ( cancelled ) {
					return;
				}

				setMeta( meta );
			} )
			.catch( () => {
				if ( cancelled ) {
					return;
				}

				setMeta( null );
			} )
			.finally( () => {
				if ( cancelled ) {
					return;
				}

				setIsMetaLoading( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [ connector, siteId, widgetProps.url ] );

	const openUrl = ( event: MouseEvent< HTMLAnchorElement > ) => {
		event.preventDefault();
		void connector.openExternalUrl( widgetProps.url );
	};

	const stopCanvasPointer = ( event: PointerEvent< HTMLAnchorElement > ) => {
		event.stopPropagation();
	};

	return (
		<BookmarkCard
			id={ id }
			url={ widgetProps.url }
			title={ meta?.title }
			icon={ meta?.icon }
			image={ meta?.image }
			isLoading={ isMetaLoading }
			onOpen={ openUrl }
			onPointerDownLink={ stopCanvasPointer }
		/>
	);
}

export function BookmarkWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< BookmarkWidgetProps > ) {
	const hostname = getUrlHostname( widgetProps.url );

	return (
		<div
			className={ styles.contextThumbnail }
			data-studio-desk-widget={ BOOKMARK_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<span className={ styles.contextThumbnailIcon } aria-hidden="true">
				<Icon icon={ link } size={ 20 } />
			</span>
			<div className={ styles.contextThumbnailHost }>{ hostname || widgetProps.url }</div>
		</div>
	);
}

function BookmarkCard( {
	id,
	url,
	title,
	icon,
	image,
	isLoading = false,
	onOpen,
	onPointerDownLink,
}: {
	id: string;
	url: string;
	title?: string;
	icon?: string;
	image?: string;
	isLoading?: boolean;
	onOpen?: ( event: MouseEvent< HTMLAnchorElement > ) => void;
	onPointerDownLink?: ( event: PointerEvent< HTMLAnchorElement > ) => void;
} ) {
	const hostname = getUrlHostname( url );
	const label = title || url || __( 'Link unavailable' );

	return (
		<div
			className={ styles.card }
			data-studio-desk-widget={ BOOKMARK_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<div className={ styles.body }>
				{ isLoading ? (
					<LoadingPlaceholder
						className={ styles.loadingPlaceholder }
						text={ __( 'Loading link details' ) }
					/>
				) : (
					<>
						<a
							className={ styles.title }
							href={ url }
							title={ label }
							target="_blank"
							rel="noopener noreferrer"
							draggable={ false }
							onClick={ onOpen }
							onPointerDown={ onPointerDownLink }
						>
							{ label }
						</a>
						<a
							className={ styles.host }
							href={ url }
							target="_blank"
							rel="noopener noreferrer"
							draggable={ false }
							onClick={ onOpen }
							onPointerDown={ onPointerDownLink }
						>
							<span className={ styles.favicon } aria-hidden="true">
								<BookmarkFavicon url={ url } icon={ icon } />
							</span>
							<span>{ hostname }</span>
						</a>
					</>
				) }
			</div>
			{ ! isLoading && image && (
				<img
					className={ styles.thumbnail }
					src={ image }
					alt=""
					referrerPolicy="strict-origin-when-cross-origin"
					draggable={ false }
				/>
			) }
		</div>
	);
}

function BookmarkFavicon( { url, icon }: { url: string; icon?: string } ) {
	const [ didFail, setDidFail ] = useState( false );
	const faviconUrl = didFail ? '' : icon || getFaviconUrl( url );

	useEffect( () => {
		setDidFail( false );
	}, [ icon, url ] );

	if ( ! faviconUrl ) {
		return <Icon icon={ link } size={ 14 } />;
	}

	return (
		<img
			src={ faviconUrl }
			alt=""
			referrerPolicy="strict-origin-when-cross-origin"
			draggable={ false }
			onError={ () => setDidFail( true ) }
		/>
	);
}

async function fetchBookmarkUrlMeta(
	connector: Connector,
	siteId: string | undefined,
	url: string
): Promise< BookmarkUrlMeta | null > {
	if ( ! siteId ) {
		return null;
	}

	const response = await connector.fetchSiteRest( siteId, {
		path: `/wp-block-editor/v1/url-details?url=${ encodeURIComponent( url ) }`,
		method: 'GET',
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		return null;
	}

	try {
		const meta = JSON.parse( response.body ) as Partial< BookmarkUrlMeta >;
		return {
			title: typeof meta.title === 'string' ? meta.title : '',
			description: typeof meta.description === 'string' ? meta.description : '',
			icon: typeof meta.icon === 'string' ? meta.icon : '',
			image: typeof meta.image === 'string' ? meta.image : '',
		};
	} catch {
		return null;
	}
}
