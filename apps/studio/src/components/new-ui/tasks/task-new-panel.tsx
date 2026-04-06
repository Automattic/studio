import { SelectControl } from '@wordpress/components';
import { useEffect, useRef } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch } from 'src/stores';
import { createNewTask } from 'src/stores/tasks-slice';

export function TaskNewPanel() {
	const dispatch = useAppDispatch();
	const { sites } = useSiteDetails();
	const realSites = sites.filter( ( s ) => ! s.isAddingSite );
	const autoCreated = useRef( false );

	useEffect( () => {
		if ( realSites.length === 1 && ! autoCreated.current ) {
			autoCreated.current = true;
			void dispatch( createNewTask( realSites[ 0 ].id ) );
		}
	}, [ realSites, dispatch ] );

	const handleSiteSelected = ( siteId: string ) => {
		if ( siteId ) {
			void dispatch( createNewTask( siteId ) );
		}
	};

	if ( realSites.length <= 1 ) {
		return null;
	}

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
