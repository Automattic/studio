import { useRef, useState, useEffect } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';

export function BrowserPanel( { className }: { className?: string } ) {
	const { selectedSite } = useSiteDetails();
	const iframeRef = useRef< HTMLIFrameElement >( null );
	const [ displayUrl, setDisplayUrl ] = useState( '' );

	const siteUrl = selectedSite?.running ? selectedSite.url : undefined;

	useEffect( () => {
		if ( siteUrl ) {
			setDisplayUrl( siteUrl );
		}
	}, [ siteUrl ] );

	const handleBack = () => {
		try {
			iframeRef.current?.contentWindow?.history.back();
		} catch {
			// Cross-origin restriction - ignore
		}
	};

	const handleForward = () => {
		try {
			iframeRef.current?.contentWindow?.history.forward();
		} catch {
			// Cross-origin restriction - ignore
		}
	};

	const handleReload = () => {
		if ( iframeRef.current && siteUrl ) {
			iframeRef.current.src = siteUrl;
		}
	};

	if ( ! siteUrl ) {
		return (
			<div
				className={ cx(
					'flex-1 flex items-center justify-center text-frame-text-secondary a8c-body',
					className
				) }
			>
				Start the site to preview it
			</div>
		);
	}

	return (
		<div className={ cx( 'flex-1 flex flex-col overflow-hidden min-w-0', className ) }>
			{ /* Browser navigation bar */ }
			<div className="flex items-center gap-1 px-3 h-[46px] flex-shrink-0 app-drag-region">
				<div className="flex items-center gap-0.5 app-no-drag-region">
					<button
						onClick={ handleBack }
						className="p-1.5 rounded-md hover:bg-frame-surface text-frame-text-secondary hover:text-frame-text transition-colors"
						aria-label="Back"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="m15 18-6-6 6-6" />
						</svg>
					</button>
					<button
						onClick={ handleForward }
						className="p-1.5 rounded-md hover:bg-frame-surface text-frame-text-secondary hover:text-frame-text transition-colors"
						aria-label="Forward"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="m9 18 6-6-6-6" />
						</svg>
					</button>
					<button
						onClick={ handleReload }
						className="p-1.5 rounded-md hover:bg-frame-surface text-frame-text-secondary hover:text-frame-text transition-colors"
						aria-label="Reload"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
							<path d="M3 3v5h5" />
							<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
							<path d="M16 16h5v5" />
						</svg>
					</button>
				</div>
				<div className="flex-1 text-center app-no-drag-region">
					<span className="a8c-body text-frame-text-secondary">{ displayUrl }</span>
				</div>
			</div>

			{ /* Iframe content */ }
			<div className="flex-1 overflow-hidden border-t border-frame-border">
				<iframe
					ref={ iframeRef }
					src={ siteUrl }
					className="w-full h-full border-0 bg-white"
					title={ selectedSite?.name || 'Site preview' }
				/>
			</div>
		</div>
	);
}
