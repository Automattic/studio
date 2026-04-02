import { SelectControl } from '@wordpress/components';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch } from 'src/stores';
import { createNewTask } from 'src/stores/tasks-slice';

export function TaskNewPanel() {
	const dispatch = useAppDispatch();
	const { sites } = useSiteDetails();
	const realSites = sites.filter( ( s ) => ! s.isAddingSite );

	const handleSiteSelected = ( siteId: string ) => {
		if ( siteId ) {
			void dispatch( createNewTask( siteId ) );
		}
	};

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
			<div className="text-sm text-frame-text-secondary">A new task for&hellip;</div>
			<div className="w-full max-w-xs">
				<SelectControl
					value=""
					onChange={ handleSiteSelected }
					options={ [
						{ label: 'Choose a site', value: '', disabled: true },
						...realSites.map( ( site ) => ( {
							label: site.name,
							value: site.id,
						} ) ),
					] }
				/>
			</div>
		</div>
	);
}
