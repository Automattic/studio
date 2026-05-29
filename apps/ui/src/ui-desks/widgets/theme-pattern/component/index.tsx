import { __ } from '@wordpress/i18n';
import { footer, header, symbol, symbolFilled } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useEffect, useRef, useState } from 'react';
import { renderPattern } from '@/ui-desks/widgets/theme/api';
import styles from './style.module.css';
import type { ThemePatternWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

const PREVIEW_RENDER_WIDTH = 1200;
const FALLBACK_PREVIEW_SIZE = {
	width: 188,
	height: 80,
};

const renderResults = new Map< string, string | null >();
const renderInflight = new Map< string, Promise< string | null > >();

export function ThemePatternWidgetComponent( {
	id,
	widgetProps,
}: DeskWidgetComponentProps< ThemePatternWidgetProps > ) {
	return (
		<PatternCard
			id={ id }
			widgetProps={ widgetProps }
			className={ styles.card }
			dataWidget="theme-pattern"
		/>
	);
}

export function ThemePatternWidgetThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ThemePatternWidgetProps > ) {
	return (
		<PatternCard
			widgetProps={ widgetProps }
			className={ styles.thumbnail }
			dataWidget="theme-pattern"
		/>
	);
}

function PatternCard( {
	id,
	widgetProps,
	className,
	dataWidget,
}: {
	id?: string;
	widgetProps: ThemePatternWidgetProps;
	className: string;
	dataWidget: string;
} ) {
	const { icon, label } = pickTypeBadge( widgetProps );

	return (
		<article
			className={ className }
			data-source={ widgetProps.source }
			data-studio-desk-widget={ dataWidget }
			data-studio-desk-widget-id={ id }
		>
			<header className={ styles.header }>
				<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: widgetProps.title } } />
				<span
					className={ styles.typeIcon }
					data-source={ widgetProps.source }
					aria-label={ label }
					title={ label }
				>
					<Icon icon={ icon } size={ 24 } />
				</span>
			</header>
			<PatternPreview widgetProps={ widgetProps } />
		</article>
	);
}

function PatternPreview( { widgetProps }: { widgetProps: ThemePatternWidgetProps } ) {
	const html = usePatternRender( widgetProps );
	const previewRef = useRef< HTMLDivElement >( null );
	const iframeRef = useRef< HTMLIFrameElement >( null );
	const [ previewSize, setPreviewSize ] = useState( FALLBACK_PREVIEW_SIZE );
	const [ naturalHeight, setNaturalHeight ] = useState< number | null >( null );

	useEffect( () => {
		setNaturalHeight( null );
	}, [ html ] );

	useEffect( () => {
		const element = previewRef.current;
		if ( ! element ) {
			return;
		}

		const updateSize = () => {
			const rect = element.getBoundingClientRect();
			if ( rect.width > 0 && rect.height > 0 ) {
				setPreviewSize( { width: rect.width, height: rect.height } );
			}
		};

		updateSize();
		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateSize );
			return () => window.removeEventListener( 'resize', updateSize );
		}

		const observer = new ResizeObserver( updateSize );
		observer.observe( element );
		return () => observer.disconnect();
	}, [] );

	const previewWidth = Math.max( 80, previewSize.width );
	const previewHeight = Math.max( 60, previewSize.height );
	const scaleWidth = previewWidth / PREVIEW_RENDER_WIDTH;
	const scaleHeight = naturalHeight ? previewHeight / naturalHeight : scaleWidth;
	const scale = Math.min( scaleWidth, scaleHeight );
	const iframeHeight = naturalHeight ?? previewHeight / scaleWidth;
	const visibleWidth = PREVIEW_RENDER_WIDTH * scale;
	const visibleHeight = iframeHeight * scale;
	const offsetX = ( previewWidth - visibleWidth ) / 2;
	const offsetY = ( previewHeight - visibleHeight ) / 2;

	function handleIframeLoad() {
		const body = iframeRef.current?.contentDocument?.body;
		const height = body?.scrollHeight;
		if ( height && height > 0 ) {
			setNaturalHeight( height );
		}
	}

	return (
		<div ref={ previewRef } className={ styles.preview } aria-hidden>
			{ html ? (
				<iframe
					ref={ iframeRef }
					className={ styles.iframe }
					srcDoc={ html }
					title={ widgetProps.title }
					tabIndex={ -1 }
					scrolling="no"
					onLoad={ handleIframeLoad }
					style={ {
						width: PREVIEW_RENDER_WIDTH,
						height: iframeHeight,
						left: offsetX,
						top: offsetY,
						transform: `scale(${ scale })`,
						transformOrigin: 'top left',
					} }
				/>
			) : (
				<span className={ styles.previewStub }>{ widgetProps.title }</span>
			) }
		</div>
	);
}

function usePatternRender( widgetProps: ThemePatternWidgetProps ) {
	const key = `${ widgetProps.source }:${ widgetProps.patternId }`;
	const cached = renderResults.has( key ) ? renderResults.get( key ) ?? null : null;
	const [ html, setHtml ] = useState< string | null >( cached );

	useEffect( () => {
		if ( renderResults.has( key ) ) {
			setHtml( renderResults.get( key ) ?? null );
			return;
		}

		let isMounted = true;
		let inflight = renderInflight.get( key );
		if ( ! inflight ) {
			inflight = renderPattern( widgetProps.content ).then(
				( result ) => result ?? createStaticPatternPreviewHtml( widgetProps.content )
			);
			renderInflight.set( key, inflight );
		}

		void inflight.then( ( result ) => {
			renderResults.set( key, result );
			renderInflight.delete( key );
			if ( isMounted ) {
				setHtml( result );
			}
		} );

		return () => {
			isMounted = false;
		};
	}, [ key, widgetProps.content ] );

	return html;
}

function createStaticPatternPreviewHtml( content: string ) {
	if ( ! content.trim() ) {
		return null;
	}

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,
body {
	margin: 0;
	padding: 0;
}

body {
	box-sizing: border-box;
	width: ${ PREVIEW_RENDER_WIDTH }px;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color: #111;
	background: #fff;
}

img,
video,
svg {
	max-width: 100%;
	height: auto;
}

figure {
	margin: 0;
}
</style>
</head>
<body class="wp-embed-responsive">
${ content }
</body>
</html>`;
}

function pickTypeBadge( widgetProps: ThemePatternWidgetProps ) {
	if ( widgetProps.source === 'reusable' ) {
		return { icon: symbolFilled, label: __( 'Reusable block' ) };
	}

	if ( widgetProps.source === 'template-part' ) {
		if ( widgetProps.area === 'header' ) {
			return { icon: header, label: __( 'Header template part' ) };
		}
		if ( widgetProps.area === 'footer' ) {
			return { icon: footer, label: __( 'Footer template part' ) };
		}
		return { icon: symbol, label: __( 'Template part' ) };
	}

	return { icon: symbol, label: __( 'Block pattern' ) };
}
