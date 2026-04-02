import { Spinner } from '@wordpress/components';
import { useEffect, useRef } from 'react';
import type { BrowserTab } from 'src/hooks/use-browser-panel';

interface BrowserIframeProps {
	tab: BrowserTab;
	isActive: boolean;
	autoLoginSrc: string;
	siteName: string;
	setIframeRef: ( tabId: string, el: HTMLIFrameElement | null ) => void;
	onLoad: ( tabId: string ) => void;
	onBeforeUnload: ( tabId: string ) => void;
}

function BrowserIframe( {
	tab,
	isActive,
	autoLoginSrc,
	siteName,
	setIframeRef,
	onLoad,
	onBeforeUnload,
}: BrowserIframeProps ) {
	const localRef = useRef< HTMLIFrameElement | null >( null );

	// Manage beforeunload listener for this iframe
	useEffect( () => {
		const iframe = localRef.current;
		if ( ! iframe ) {
			return;
		}

		const handleBeforeUnloadEvent = () => {
			onBeforeUnload( tab.id );
		};

		const attachListener = () => {
			try {
				iframe.contentWindow?.addEventListener( 'beforeunload', handleBeforeUnloadEvent );
			} catch {
				// Cross-origin restriction
			}
		};

		iframe.addEventListener( 'load', attachListener );
		attachListener();

		return () => {
			iframe.removeEventListener( 'load', attachListener );
			try {
				iframe.contentWindow?.removeEventListener( 'beforeunload', handleBeforeUnloadEvent );
			} catch {
				// Cross-origin restriction
			}
		};
	}, [ tab.id, onBeforeUnload ] );

	return (
		<div className={ `absolute inset-0 ${ isActive ? '' : 'hidden' }` }>
			{ isActive && tab.isInitialLoad && (
				<div className="absolute inset-0 flex items-center justify-center z-10">
					<Spinner className="!mt-0 [&>circle]:stroke-[#a7aaad]" />
				</div>
			) }
			<iframe
				ref={ ( el ) => {
					localRef.current = el;
					setIframeRef( tab.id, el );
				} }
				src={ autoLoginSrc }
				onLoad={ () => onLoad( tab.id ) }
				className={ `w-full h-full border-0 transition-opacity duration-150 ${
					tab.isInitialLoad ? 'opacity-0' : 'opacity-100'
				}` }
				title={ siteName || 'Site preview' }
			/>
		</div>
	);
}

interface BrowserIframeContainerProps {
	tabs: BrowserTab[];
	activeTabId: string;
	autoLoginSrc: string;
	siteName: string;
	setIframeRef: ( tabId: string, el: HTMLIFrameElement | null ) => void;
	onLoad: ( tabId: string ) => void;
	onBeforeUnload: ( tabId: string ) => void;
}

export function BrowserIframeContainer( {
	tabs,
	activeTabId,
	autoLoginSrc,
	siteName,
	setIframeRef,
	onLoad,
	onBeforeUnload,
}: BrowserIframeContainerProps ) {
	return (
		<div className="flex-1 overflow-hidden relative">
			{ tabs.map( ( tab ) => (
				<BrowserIframe
					key={ tab.id }
					tab={ tab }
					isActive={ tab.id === activeTabId }
					autoLoginSrc={ autoLoginSrc }
					siteName={ siteName }
					setIframeRef={ setIframeRef }
					onLoad={ onLoad }
					onBeforeUnload={ onBeforeUnload }
				/>
			) ) }
		</div>
	);
}
