import { useCallback } from 'react';

const BANNER_HEIGHT = 40;

interface SiteIframeProps {
	iframeRef: React.RefObject< HTMLIFrameElement | null >;
	onReady: () => void;
}

export function SiteIframe( { iframeRef, onReady }: SiteIframeProps ) {
	const handleLoad = useCallback( () => {
		onReady();
	}, [ onReady ] );

	return (
		<iframe
			ref={ iframeRef }
			src="/"
			title="Site preview"
			onLoad={ handleLoad }
			style={ {
				position: 'fixed',
				top: BANNER_HEIGHT,
				left: 0,
				right: 0,
				bottom: 0,
				width: '100%',
				height: `calc(100% - ${ BANNER_HEIGHT }px)`,
				border: 'none',
			} }
		/>
	);
}
