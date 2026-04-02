import { Button, Popover } from '@wordpress/components';
import { archive, chevronRight, Icon, plus } from '@wordpress/icons';
import { useCallback, useMemo, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	archiveTaskThunk,
	clearArchivedTasksThunk,
	setSelectedTaskId,
	setPendingNewTask,
} from 'src/stores/tasks-slice';
import { TaskListItem } from './task-list-item';

export function TaskList() {
	const dispatch = useAppDispatch();
	const { tasks, selectedTaskId } = useRootSelector( ( state ) => state.tasks );
	const { sites } = useSiteDetails();
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

	const groupedTasks = useMemo( () => {
		const groups: { siteId: string; siteName: string; tasks: typeof activeTasks }[] = [];
		const map = new Map< string, typeof activeTasks >();
		for ( const task of activeTasks ) {
			const existing = map.get( task.siteId );
			if ( existing ) {
				existing.push( task );
			} else {
				const list = [ task ];
				map.set( task.siteId, list );
				groups.push( {
					siteId: task.siteId,
					siteName: siteNameMap[ task.siteId ] || 'Unknown',
					tasks: list,
				} );
			}
		}
		return groups;
	}, [ activeTasks, siteNameMap ] );

	const archivedTasks = useMemo(
		() => tasks.filter( ( t ) => t.archived ).sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks ]
	);

	const handleArchiveTask = ( taskId: string ) => {
		void dispatch( archiveTaskThunk( taskId ) );
	};

	const handleClearArchived = () => {
		void dispatch( clearArchivedTasksThunk() );
	};

	const [ collapsedSites, setCollapsedSites ] = useState< Set< string > >( new Set() );
	const toggleSite = useCallback( ( siteId: string ) => {
		setCollapsedSites( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( siteId ) ) {
				next.delete( siteId );
			} else {
				next.add( siteId );
			}
			return next;
		} );
	}, [] );

	return (
		<div className="flex flex-col gap-1">
			<header className="flex items-center justify-between pl-2 pr-0">
				<h3 className="a8c-label text-chrome-text">Tasks</h3>
				<div className="flex items-center">
					{ archivedTasks.length > 0 && (
						<div className="relative">
							<Button
								icon={ archive }
								label={ showArchived ? 'Hide archived tasks' : 'Show archived tasks' }
								className={ cx(
									'app-no-drag-region',
									showArchived
										? 'text-chrome-text'
										: 'text-chrome-text-secondary hover:text-chrome-text'
								) }
								onClick={ () => setShowArchived( ! showArchived ) }
							/>
							{ showArchived && (
								<Popover
									placement="bottom-end"
									offset={ 4 }
									noArrow
									onClose={ () => setShowArchived( false ) }
									className="[&>div]:!shadow-none [&>div]:bg-transparent"
								>
									<div className="w-60 rounded-lg bg-chrome-bg border border-chrome-border shadow-lg overflow-hidden">
										<div className="flex items-center justify-between px-3 py-2">
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
										<div className="flex flex-col max-h-60 overflow-y-auto">
											{ archivedTasks.map( ( task ) => (
												<TaskListItem
													key={ task.id }
													task={ task }
													isSelected={ task.id === selectedTaskId }
													onClick={ () => {
														dispatch( setSelectedTaskId( task.id ) );
														setShowArchived( false );
													} }
												/>
											) ) }
										</div>
									</div>
								</Popover>
							) }
						</div>
					) }
					{ sites.length > 0 && (
						<Button
							icon={ plus }
							label="New task"
							className="app-no-drag-region text-chrome-text-secondary hover:text-chrome-text"
							onClick={ () => dispatch( setPendingNewTask( true ) ) }
						/>
					) }
				</div>
			</header>

			{ activeTasks.length === 0 && (
				<div className="text-chrome-text-tertiary text-xs px-2">No tasks yet</div>
			) }

			<div className="flex flex-col gap-2">
				{ groupedTasks.map( ( group ) => {
					const isOpen = ! collapsedSites.has( group.siteId );
					return (
						<div key={ group.siteId } className="flex flex-col">
							<button
								onClick={ () => toggleSite( group.siteId ) }
								className="flex items-center px-2 py-1 text-xs text-chrome-text-secondary"
							>
								<span>{ group.siteName }</span>
								<Icon
									icon={ chevronRight }
									size={ 16 }
									className={ cx(
										'fill-chrome-text-secondary transition-transform duration-200',
										isOpen ? 'rotate-90' : 'rotate-0'
									) }
								/>
							</button>
							<div
								className={ cx(
									'grid transition-[grid-template-rows] duration-200 ease-in-out',
									isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
								) }
							>
								<div className="overflow-hidden">
									<div className="flex flex-col gap-0.5">
										{ group.tasks.map( ( task ) => (
											<TaskListItem
												key={ task.id }
												task={ task }
												isSelected={ task.id === selectedTaskId }
												onClick={ () => dispatch( setSelectedTaskId( task.id ) ) }
												onArchive={ () => handleArchiveTask( task.id ) }
											/>
										) ) }
									</div>
								</div>
							</div>
						</div>
					);
				} ) }
			</div>
		</div>
	);
}
