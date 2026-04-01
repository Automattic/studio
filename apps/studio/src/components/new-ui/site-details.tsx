import { useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

function CopyButton( { text }: { text: string } ) {
	const [ copied, setCopied ] = useState( false );

	const handleCopy = async () => {
		await navigator.clipboard.writeText( text );
		setCopied( true );
		setTimeout( () => setCopied( false ), 1500 );
	};

	return (
		<button
			onClick={ handleCopy }
			className="p-0.5 rounded hover:bg-frame-surface text-frame-text-secondary hover:text-frame-text transition-colors flex-shrink-0"
			aria-label={ copied ? 'Copied' : 'Copy' }
		>
			{ copied ? (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M20 6 9 17l-5-5" />
				</svg>
			) : (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
					<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
				</svg>
			) }
		</button>
	);
}

const TABS = [ 'Details', 'Map', 'Theme' ] as const;
type Tab = ( typeof TABS )[ number ];

function DetailsRow( {
	label,
	value,
	valueClassName,
}: {
	label: string;
	value: React.ReactNode;
	valueClassName?: string;
} ) {
	return (
		<div className="flex items-center justify-between px-4 py-3 border-b border-frame-border last:border-b-0">
			<span className="a8c-body text-frame-text-secondary">{ label }</span>
			<span className={ cx( 'a8c-body text-frame-text text-right', valueClassName ) }>
				{ value }
			</span>
		</div>
	);
}

function DetailsTable( { site }: { site: SiteDetails } ) {
	const siteUrl = site.running ? site.url : undefined;

	return (
		<div className="border border-frame-border rounded-lg overflow-hidden">
			<DetailsRow
				label="Status"
				value={ site.running ? 'Running' : 'Stopped' }
				valueClassName={ site.running ? 'text-frame-running font-medium' : 'text-frame-error' }
			/>
			{ siteUrl && <DetailsRow label="URL" value={ siteUrl } /> }
			{ site.customDomain && <DetailsRow label="Custom domain" value={ site.customDomain } /> }
			<DetailsRow label="Port" value={ site.port > 0 ? site.port : '—' } />
			<DetailsRow label="PHP" value={ site.phpVersion || '—' } />
			<DetailsRow label="HTTPS" value={ site.enableHttps ? 'Enabled' : 'Disabled' } />
			<DetailsRow label="Auto-start" value={ site.autoStart ? 'Yes' : 'No' } />
			<DetailsRow label="Auto-update" value={ site.isWpAutoUpdating ? 'Yes' : 'No' } />
		</div>
	);
}

function AdminDetails( { site }: { site: SiteDetails } ) {
	return (
		<div className="border border-frame-border rounded-lg overflow-hidden mt-4">
			<DetailsRow label="Admin username" value={ site.adminUsername || 'admin' } />
		</div>
	);
}

function ContentHeader( {
	sidebarVisible,
	browserVisible,
	onToggleSidebar,
	onToggleBrowser,
	siteName,
}: {
	sidebarVisible: boolean;
	browserVisible: boolean;
	onToggleSidebar: () => void;
	onToggleBrowser: () => void;
	siteName?: string;
} ) {
	return (
		<div className="flex items-center justify-between px-4 h-[46px] flex-shrink-0 app-drag-region">
			<div className="flex items-center gap-2 app-no-drag-region">
				<button
					onClick={ onToggleSidebar }
					className="p-1.5 rounded-md text-frame-text-secondary hover:text-frame-text hover:bg-frame-surface transition-colors"
					aria-label={ sidebarVisible ? 'Hide sidebar' : 'Show sidebar' }
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
						<rect width="18" height="18" x="3" y="3" rx="2" />
						<path d="M9 3v18" />
					</svg>
				</button>
				{ siteName && (
					<>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-frame-text-secondary"
						>
							<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
							<path d="M14 2v4a2 2 0 0 0 2 2h4" />
						</svg>
						<span className="a8c-subtitle-small text-frame-text">{ siteName }</span>
					</>
				) }
			</div>
			<div className="app-no-drag-region">
				<button
					onClick={ onToggleBrowser }
					className="p-1.5 rounded-md text-frame-text-secondary hover:text-frame-text hover:bg-frame-surface transition-colors"
					aria-label={ browserVisible ? 'Hide browser' : 'Show browser' }
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
						<rect width="18" height="18" x="3" y="3" rx="2" />
						<path d="M15 3v18" />
					</svg>
				</button>
			</div>
		</div>
	);
}

export function SiteDetailsView( {
	sidebarVisible,
	browserVisible,
	onToggleSidebar,
	onToggleBrowser,
}: {
	sidebarVisible: boolean;
	browserVisible: boolean;
	onToggleSidebar: () => void;
	onToggleBrowser: () => void;
} ) {
	const { selectedSite, startServer, stopServer, loadingServer } = useSiteDetails();
	const [ activeTab, setActiveTab ] = useState< Tab >( 'Details' );

	if ( ! selectedSite ) {
		return (
			<div className="flex-1 flex flex-col overflow-hidden">
				<ContentHeader
					sidebarVisible={ sidebarVisible }
					browserVisible={ browserVisible }
					onToggleSidebar={ onToggleSidebar }
					onToggleBrowser={ onToggleBrowser }
				/>
				<div className="flex-1 flex items-center justify-center text-frame-text-secondary a8c-body">
					Select a project to view details
				</div>
			</div>
		);
	}

	const isLoading = loadingServer[ selectedSite.id ];
	const siteUrl = selectedSite.running ? selectedSite.url : undefined;

	const handleToggleServer = async () => {
		if ( selectedSite.running ) {
			await stopServer( selectedSite.id );
		} else {
			await startServer( selectedSite );
		}
	};

	const handleOpenUrl = () => {
		if ( siteUrl ) {
			getIpcApi().openURL( siteUrl );
		}
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<ContentHeader
				sidebarVisible={ sidebarVisible }
				browserVisible={ browserVisible }
				onToggleSidebar={ onToggleSidebar }
				onToggleBrowser={ onToggleBrowser }
				siteName={ selectedSite.name }
			/>

			{ /* Site details content */ }
			<div className="flex-1 overflow-y-auto px-6 pb-6">
				{ /* Site title */ }
				<h2 className="a8c-title-small text-frame-text mb-2">{ selectedSite.name }</h2>

				{ /* URL */ }
				{ siteUrl && (
					<div className="flex items-center gap-1.5 mb-1">
						<button
							onClick={ handleOpenUrl }
							className="a8c-body text-frame-theme hover:text-frame-theme-hover hover:underline cursor-pointer bg-transparent border-0 p-0 text-left"
						>
							{ siteUrl }
						</button>
						<CopyButton text={ siteUrl } />
					</div>
				) }

				{ /* Path */ }
				<div className="flex items-center gap-1.5 mb-5">
					<span className="a8c-body text-frame-text-secondary">{ selectedSite.path }</span>
					<CopyButton text={ selectedSite.path } />
				</div>

				{ /* Action buttons */ }
				<div className="flex gap-2 mb-6">
					<button
						onClick={ handleToggleServer }
						disabled={ isLoading }
						className={ cx(
							'flex items-center gap-2 px-3 py-1.5 rounded-md border a8c-body transition-colors app-no-drag-region',
							'border-frame-border text-frame-text hover:bg-frame-surface',
							isLoading && 'opacity-50 cursor-not-allowed'
						) }
					>
						{ selectedSite.running ? (
							<>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<rect width="16" height="16" x="4" y="4" rx="2" />
								</svg>
								Stop site
							</>
						) : (
							<>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
									<polygon points="6,4 20,12 6,20" />
								</svg>
								Start site
							</>
						) }
					</button>
					<button className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-frame-border text-frame-text hover:bg-frame-surface a8c-body transition-colors app-no-drag-region">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
						</svg>
						Chat about this site
					</button>
				</div>

				{ /* Tabs */ }
				<div className="flex gap-0 border-b border-frame-border mb-5">
					{ TABS.map( ( tab ) => (
						<button
							key={ tab }
							onClick={ () => setActiveTab( tab ) }
							className={ cx(
								'px-3 py-2 a8c-body transition-colors relative app-no-drag-region',
								activeTab === tab
									? 'text-frame-text font-medium'
									: 'text-frame-text-secondary hover:text-frame-text'
							) }
						>
							{ tab }
							{ activeTab === tab && (
								<span className="absolute bottom-0 left-0 right-0 h-[2px] bg-frame-tab-active" />
							) }
						</button>
					) ) }
				</div>

				{ /* Tab content */ }
				{ activeTab === 'Details' && (
					<>
						<DetailsTable site={ selectedSite } />
						<AdminDetails site={ selectedSite } />
					</>
				) }
				{ activeTab === 'Map' && (
					<div className="text-frame-text-secondary a8c-body py-8 text-center">
						Site map coming soon
					</div>
				) }
				{ activeTab === 'Theme' && (
					<div className="text-frame-text-secondary a8c-body py-8 text-center">
						Theme details coming soon
					</div>
				) }
			</div>
		</div>
	);
}
