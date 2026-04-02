import { Button } from '@wordpress/components';
import { archive, plus } from '@wordpress/icons';
import { useMemo, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	archiveTaskThunk,
	clearArchivedTasksThunk,
	createNewTask,
	setSelectedTaskId,
} from 'src/stores/tasks-slice';
import { TaskListItem } from './task-list-item';
import { TaskSitePicker } from './task-site-picker';

export function TaskList() {
	const dispatch = useAppDispatch();
	const { tasks, selectedTaskId } = useRootSelector( ( state ) => state.tasks );
	const { sites } = useSiteDetails();
	const [ showSitePicker, setShowSitePicker ] = useState( false );
	const [ showArchived, setShowArchived ] = useState( false );

	const siteNameMap = useMemo( () => {
		const map: Record< string, string > = {};
		for ( const site of sites ) {
			map[ site.id ] = site.name;
		}
		return map;
	}, [ sites ] );

	const activeTasks = useMemo(
		() => tasks.filter( ( t ) => ! t.archived ).sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks ]
	);

	const archivedTasks = useMemo(
		() => tasks.filter( ( t ) => t.archived ).sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks ]
	);

	const visibleTasks = showArchived ? archivedTasks : activeTasks;

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

	const handleArchiveTask = ( taskId: string ) => {
		void dispatch( archiveTaskThunk( taskId ) );
	};

	const handleClearArchived = () => {
		void dispatch( clearArchivedTasksThunk() );
	};

	return (
		<div className="flex flex-col gap-1">
			<header className="flex items-center justify-between px-4">
				<h3 className="a8c-label text-chrome-text">Tasks</h3>
				<div className="flex items-center gap-0.5">
					{ archivedTasks.length > 0 && (
						<Button
							icon={ archive }
							label={ showArchived ? 'Show active tasks' : 'Show archived tasks' }
							className={ cx(
								'app-no-drag-region',
								showArchived
									? 'text-chrome-text'
									: 'text-chrome-text-secondary hover:text-chrome-text'
							) }
							onClick={ () => setShowArchived( ! showArchived ) }
							size="small"
						/>
					) }
					{ ! showArchived && sites.length > 0 && (
						<Button
							icon={ plus }
							label="New task"
							className="app-no-drag-region text-chrome-text-secondary hover:text-chrome-text"
							onClick={ handleCreateTask }
							size="small"
						/>
					) }
				</div>
			</header>

			{ showSitePicker && (
				<TaskSitePicker
					sites={ sites }
					onSelect={ handleSiteSelected }
					onCancel={ () => setShowSitePicker( false ) }
				/>
			) }

			{ showArchived && archivedTasks.length > 0 && (
				<div className="flex items-center justify-between px-4">
					<span className="text-chrome-text-tertiary text-[10px]">
						{ archivedTasks.length } archived
					</span>
					<button
						onClick={ handleClearArchived }
						className="text-chrome-text-tertiary hover:text-chrome-text text-[10px] transition-colors"
					>
						Clear all
					</button>
				</div>
			) }

			{ visibleTasks.length === 0 && ! showSitePicker && (
				<div className="text-chrome-text-tertiary text-xs px-4">
					{ showArchived ? 'No archived tasks' : 'No tasks yet' }
				</div>
			) }

			<div className="flex flex-col">
				{ visibleTasks.map( ( task ) => (
					<TaskListItem
						key={ task.id }
						task={ task }
						siteName={ siteNameMap[ task.siteId ] }
						isSelected={ task.id === selectedTaskId }
						onClick={ () => dispatch( setSelectedTaskId( task.id ) ) }
						onArchive={ ! showArchived ? () => handleArchiveTask( task.id ) : undefined }
					/>
				) ) }
			</div>
		</div>
	);
}
