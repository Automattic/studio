import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { getUrlHostname } from '@/ui-desks/widget-actions/url';
import { getEmbedSandboxPermissions, getUrlEmbedInfo } from '../embed-info';
import { EMBED_WIDGET_TYPE, type EmbedWidgetProps } from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type EmbedWidgetComponentProps = DeskWidgetComponentProps< EmbedWidgetProps >;

export function EmbedWidgetComponent( { id, widgetProps, isEditing }: EmbedWidgetComponentProps ) {
	const embedInfo = getUrlEmbedInfo( widgetProps.url );

	if ( ! embedInfo ) {
		return <EmbedFallback id={ id } url={ widgetProps.url } />;
	}

	const isInteractive = isEditing;
	const title = embedInfo.definition.title || __( 'Embedded content' );
	const borderRadius = embedInfo.definition.overrideOutlineRadius ?? 8;

	return (
		<div
			className={ styles.embed }
			data-studio-desk-widget={ EMBED_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
			data-is-editing={ isEditing ? 'true' : 'false' }
			style={ {
				borderRadius,
				background: embedInfo.definition.backgroundColor,
			} }
		>
			{ embedInfo.definition.type === 'github_gist' ? (
				<GistFrame url={ embedInfo.url } title={ title } isInteractive={ isInteractive } />
			) : (
				<iframe
					className={ styles.frame }
					title={ title }
					sandbox={ getEmbedSandboxPermissions( embedInfo.definition.overridePermissions ) }
					src={ embedInfo.embedUrl }
					draggable={ false }
					frameBorder="0"
					referrerPolicy="strict-origin-when-cross-origin"
					tabIndex={ isInteractive ? 0 : -1 }
					style={ {
						pointerEvents: isInteractive ? 'auto' : 'none',
					} }
				/>
			) }
			{ ! isInteractive && <div className={ styles.shield } aria-hidden="true" /> }
		</div>
	);
}

export function EmbedWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< EmbedWidgetProps > ) {
	const embedInfo = getUrlEmbedInfo( widgetProps.url );
	const title = embedInfo?.definition.title || __( 'Embedded content' );
	const hostname = getUrlHostname( widgetProps.url );

	return (
		<div
			className={ styles.contextThumbnail }
			data-studio-desk-widget={ EMBED_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			<span className={ styles.contextThumbnailIcon } aria-hidden="true">
				<Icon icon={ external } size={ 20 } />
			</span>
			<div className={ styles.contextThumbnailTitle }>{ title }</div>
			<div className={ styles.contextThumbnailHost }>{ hostname }</div>
		</div>
	);
}

function EmbedFallback( { id, url }: { id: string; url: string } ) {
	return (
		<div
			className={ styles.empty }
			data-studio-desk-widget={ EMBED_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ url ? __( 'Embed unavailable' ) : __( 'No embed URL' ) }
		</div>
	);
}

function GistFrame( {
	url,
	title,
	isInteractive,
}: {
	url: string;
	title: string;
	isInteractive: boolean;
} ) {
	const gistId = url.split( '/' ).filter( Boolean ).at( -1 );
	if ( ! gistId?.match( /^[0-9a-f]+$/ ) ) {
		return null;
	}

	return (
		<iframe
			className={ styles.frame }
			title={ title }
			sandbox={ getEmbedSandboxPermissions() }
			draggable={ false }
			frameBorder="0"
			referrerPolicy="no-referrer-when-downgrade"
			tabIndex={ isInteractive ? 0 : -1 }
			style={ {
				pointerEvents: isInteractive ? 'auto' : 'none',
			} }
			srcDoc={ `
				<html>
					<head>
						<base target="_blank">
					</head>
					<body>
						<script src="https://gist.github.com/${ gistId }.js"></script>
						<style>
							* { box-sizing: border-box; margin: 0; }
							body { height: 100vh; overflow: hidden; }
							.gist { height: 100%; }
							.gist .gist-file {
								height: 100%;
								margin: 0;
								display: grid;
								grid-template-rows: 1fr auto;
							}
							.gist .blob-wrapper { overflow: auto; }
						</style>
					</body>
				</html>` }
		/>
	);
}
