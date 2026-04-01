import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface SidebarProps {
	className?: string;
}

// Placeholder chat data until chat is wired up
const PLACEHOLDER_CHATS: { id: string; name: string; time: string }[] = [];

export function Sidebar( { className }: SidebarProps ) {
	const { sites, selectedSite, setSelectedSiteId } = useSiteDetails();

	const runningSiteCount = sites.filter( ( s ) => s.running ).length;

	return (
		<aside
			className={ cx(
				'w-[280px] flex-shrink-0 flex flex-col overflow-hidden app-no-drag-region',
				className
			) }
		>
			{ /* Gear icon - top right */ }
			<div className="flex items-center justify-end px-4 pb-2">
				<button
					onClick={ () => getIpcApi().openSettingsWindow() }
					className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
					aria-label="Settings"
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
						<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				</button>
			</div>

			{ /* Chats section */ }
			<div className="flex flex-col">
				<div className="flex items-center justify-between px-4 py-1.5">
					<span className="a8c-label text-white/40">Chats ({ PLACEHOLDER_CHATS.length })</span>
					<div className="flex gap-0.5">
						<button
							className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
							aria-label="Filter chats"
						>
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
								<rect width="7" height="7" x="3" y="3" rx="1" />
								<rect width="7" height="7" x="14" y="3" rx="1" />
								<rect width="7" height="7" x="3" y="14" rx="1" />
								<rect width="7" height="7" x="14" y="14" rx="1" />
							</svg>
						</button>
						<button
							className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
							aria-label="New chat"
						>
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
								<path d="M5 12h14" />
								<path d="M12 5v14" />
							</svg>
						</button>
					</div>
				</div>

				{ PLACEHOLDER_CHATS.length === 0 && (
					<div className="px-4 py-3 text-white/20 a8c-body">No chats yet</div>
				) }

				{ PLACEHOLDER_CHATS.map( ( chat ) => (
					<button
						key={ chat.id }
						className="flex items-center justify-between px-4 py-2 text-left hover:bg-white/5 transition-colors"
					>
						<span className="a8c-body text-white/80 truncate">{ chat.name }</span>
						<span className="a8c-body-small text-white/30 flex-shrink-0 ml-2">{ chat.time }</span>
					</button>
				) ) }
			</div>

			{ /* Flexible spacer */ }
			<div className="flex-1" />

			{ /* Projects section */ }
			<div className="flex flex-col">
				<div className="flex items-center justify-between px-4 py-1.5">
					<div className="flex items-center gap-1">
						<span className="a8c-label text-white/40">Projects ({ sites.length })</span>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-white/30"
						>
							<path d="m6 9 6 6 6-6" />
						</svg>
					</div>
					<button
						className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
						aria-label="Add project"
					>
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
							<path d="M5 12h14" />
							<path d="M12 5v14" />
						</svg>
					</button>
				</div>

				<div className="flex flex-col pb-3 overflow-y-auto sites-scrollbar">
					{ sites.map( ( site ) => {
						const isSelected = selectedSite?.id === site.id;
						return (
							<button
								key={ site.id }
								onClick={ () => setSelectedSiteId( site.id ) }
								className={ cx(
									'flex items-center justify-between pl-4 pr-4 py-[7px] text-left transition-colors',
									isSelected
										? 'bg-white/10 border-l-[3px] border-l-frame-theme pl-[13px]'
										: 'hover:bg-white/5'
								) }
							>
								<span
									className={ cx(
										'a8c-body truncate',
										isSelected ? 'text-white' : 'text-white/80'
									) }
								>
									{ site.name }
								</span>
								{ site.running && (
									<span className="w-[7px] h-[7px] rounded-full bg-frame-running flex-shrink-0 ml-2" />
								) }
							</button>
						);
					} ) }
				</div>

				{ runningSiteCount > 0 && (
					<div className="px-4 pb-3 a8c-body-small text-white/30">{ runningSiteCount } running</div>
				) }
			</div>
		</aside>
	);
}
