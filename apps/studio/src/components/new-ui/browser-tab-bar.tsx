import type { BrowserTab } from 'src/hooks/use-browser-panel';

interface BrowserTabBarProps {
	tabs: BrowserTab[];
	activeTabId: string;
	onSelectTab: ( id: string ) => void;
	onCloseTab: ( id: string ) => void;
	onNewTab: () => void;
	canAddTab: boolean;
}

function tabLabel( tab: BrowserTab ): string {
	if ( tab.title ) {
		return tab.title;
	}
	try {
		const url = new URL( tab.displayUrl );
		return url.pathname === '/' ? url.host : url.pathname;
	} catch {
		return tab.displayUrl || 'New Tab';
	}
}

export function BrowserTabBar( {
	tabs,
	activeTabId,
	onSelectTab,
	onCloseTab,
	onNewTab,
	canAddTab,
}: BrowserTabBarProps ) {
	return (
		<div className="flex items-center flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			{ tabs.map( ( tab ) => {
				const isActive = tab.id === activeTabId;
				return (
					<button
						key={ tab.id }
						onClick={ () => onSelectTab( tab.id ) }
						className={ `group flex items-center gap-1.5 px-2.5 h-6 text-[11px] min-w-0 max-w-[180px] rounded transition-colors cursor-default select-none app-no-drag-region ${
							isActive
								? 'text-white bg-white/10'
								: 'text-[#a7aaad] hover:text-white/80 hover:bg-white/5'
						}` }
					>
						{ tab.isLoading && (
							<span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
						) }
						<span className="truncate">{ tabLabel( tab ) }</span>
						{ tabs.length > 1 && (
							<button
								onClick={ ( e ) => {
									e.stopPropagation();
									onCloseTab( tab.id );
								} }
								className={ `flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-opacity app-no-drag-region ${
									isActive
										? 'opacity-50 hover:opacity-100'
										: 'opacity-0 group-hover:opacity-50 hover:!opacity-100'
								}` }
								aria-label="Close tab"
							>
								<svg width="8" height="8" viewBox="0 0 8 8" className="block">
									<path
										d="M1.5 1.5L6.5 6.5M6.5 1.5L1.5 6.5"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
									/>
								</svg>
							</button>
						) }
					</button>
				);
			} ) }
			{ canAddTab && (
				<button
					onClick={ onNewTab }
					className="flex-shrink-0 flex items-center justify-center w-6 h-6 text-[#a7aaad] hover:text-white/80 rounded hover:bg-white/5 transition-colors app-no-drag-region"
					aria-label="New tab"
				>
					<svg width="12" height="12" viewBox="0 0 12 12" className="block">
						<path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
				</button>
			) }
		</div>
	);
}
