import { cx } from 'src/lib/cx';

interface TaskSitePickerProps {
	sites: SiteDetails[];
	onSelect: ( siteId: string ) => void;
	onCancel: () => void;
}

export function TaskSitePicker( { sites, onSelect, onCancel }: TaskSitePickerProps ) {
	return (
		<div className="px-2">
			<div className="rounded bg-chrome-surface border border-chrome-border overflow-hidden">
				<div className="px-3 py-2 text-[10px] text-chrome-text-tertiary uppercase tracking-wide">
					Select a site
				</div>
				<div className="max-h-32 overflow-y-auto">
					{ sites
						.filter( ( s ) => ! s.isAddingSite )
						.map( ( site ) => (
							<button
								key={ site.id }
								onClick={ () => onSelect( site.id ) }
								className={ cx(
									'w-full px-3 py-1.5 text-left text-xs',
									'text-chrome-text-secondary hover:bg-chrome-border hover:text-chrome-text',
									'transition-colors'
								) }
							>
								{ site.name }
							</button>
						) ) }
				</div>
				<button
					onClick={ onCancel }
					className="w-full px-3 py-1.5 text-left text-xs text-chrome-text-tertiary hover:text-chrome-text-secondary border-t border-chrome-border transition-colors"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
