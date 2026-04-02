import { Button } from '@wordpress/components';
import { plus } from '@wordpress/icons';
import { useMemo, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { createNewTask, setSelectedTaskId } from 'src/stores/tasks-slice';
import { TaskListItem } from './task-list-item';
import { TaskSitePicker } from './task-site-picker';

export function TaskList() {
	const dispatch = useAppDispatch();
	const { tasks, selectedTaskId } = useRootSelector( ( state ) => state.tasks );
	const { sites } = useSiteDetails();
	const [ showSitePicker, setShowSitePicker ] = useState( false );

	const siteNameMap = useMemo( () => {
		const map: Record< string, string > = {};
		for ( const site of sites ) {
			map[ site.id ] = site.name;
		}
		return map;
	}, [ sites ] );

	const visibleTasks = useMemo(
		() => tasks.filter( ( t ) => ! t.archived ).sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks ]
	);

	const handleCreateTask = () => {
		if ( sites.length === 1 ) {
			void dispatch( createNewTask( sites[ 0 ].id ) );
		} else if ( sites.length > 1 ) {
			setShowSitePicker( true );
		}
	};

	const handleSiteSelected = ( siteId: string ) => {
		setShowSitePicker( false );
		void dispatch( createNewTask( siteId ) );
	};

	return (
		<div className="flex flex-col gap-1">
			<header className="flex items-center justify-between px-4">
				<h3 className="a8c-label text-chrome-text">Tasks</h3>
				{ sites.length > 0 && (
					<Button
						icon={ plus }
						label="New task"
						className="app-no-drag-region text-chrome-text-secondary hover:text-chrome-text"
						onClick={ handleCreateTask }
						size="small"
					/>
				) }
			</header>

			{ showSitePicker && (
				<TaskSitePicker
					sites={ sites }
					onSelect={ handleSiteSelected }
					onCancel={ () => setShowSitePicker( false ) }
				/>
			) }

			{ visibleTasks.length === 0 && ! showSitePicker && (
				<div className="text-chrome-text-tertiary text-xs px-4">No tasks yet</div>
			) }

			<div className="flex flex-col">
				{ visibleTasks.map( ( task ) => (
					<TaskListItem
						key={ task.id }
						task={ task }
						siteName={ siteNameMap[ task.siteId ] }
						isSelected={ task.id === selectedTaskId }
						onClick={ () => dispatch( setSelectedTaskId( task.id ) ) }
					/>
				) ) }
			</div>
		</div>
	);
}
