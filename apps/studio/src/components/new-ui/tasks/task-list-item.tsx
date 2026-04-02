import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { archive, moreVertical } from '@wordpress/icons';
import { useState } from 'react';
import { cx } from 'src/lib/cx';
import type { TaskMetadata } from 'src/modules/ai/types';

interface TaskListItemProps {
	task: TaskMetadata;
	isSelected: boolean;
	onClick: () => void;
	onArchive?: () => void;
}

export function TaskListItem( { task, isSelected, onClick, onArchive }: TaskListItemProps ) {
	const [ menuOpen, setMenuOpen ] = useState( false );

	return (
		<div
			className={ cx(
				'group flex items-center w-full h-9 rounded-md text-left transition-colors',
				'hover:bg-chrome-surface',
				isSelected && 'bg-chrome-surface'
			) }
		>
			<button
				onClick={ onClick }
				className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2"
			>
				<span
					className={ cx(
						'text-sm truncate',
						isSelected ? 'text-chrome-text' : 'text-chrome-text'
					) }
				>
					{ task.title }
				</span>
				{ task.status === 'in-progress' && (
					<span className="w-1.5 h-1.5 rounded-full bg-[#4f94f8] animate-pulse flex-shrink-0" />
				) }
			</button>
			{ onArchive && (
				<div
					className={ cx(
						'flex-shrink-0',
						menuOpen
							? 'relative'
							: 'absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:relative group-hover:top-auto group-hover:translate-y-0 group-hover:opacity-100'
					) }
				>
					<DropdownMenu
						icon={ moreVertical }
						label="Task options"
						className="text-chrome-text-tertiary hover:text-chrome-text"
						onToggle={ setMenuOpen }
					>
						{ ( { onClose }: { onClose: () => void } ) => (
							<MenuGroup>
								<MenuItem
									icon={ archive }
									onClick={ () => {
										onArchive();
										onClose();
									} }
								>
									Archive
								</MenuItem>
							</MenuGroup>
						) }
					</DropdownMenu>
				</div>
			) }
		</div>
	);
}
