import { archive } from '@wordpress/icons';
import { cx } from 'src/lib/cx';
import type { TaskMetadata } from 'src/modules/ai/types';

interface TaskListItemProps {
	task: TaskMetadata;
	siteName?: string;
	isSelected: boolean;
	onClick: () => void;
	onArchive?: () => void;
}

function StatusDot( { status }: { status: TaskMetadata[ 'status' ] } ) {
	return (
		<span
			className={ cx(
				'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
				status === 'in-progress' && 'bg-[#4f94f8] animate-pulse',
				status === 'waiting' && 'bg-chrome-text-tertiary',
				status === 'done' && 'bg-[#4ab866]'
			) }
		/>
	);
}

export function TaskListItem( {
	task,
	siteName,
	isSelected,
	onClick,
	onArchive,
}: TaskListItemProps ) {
	return (
		<div
			className={ cx(
				'group w-full flex items-center gap-2 px-4 py-1.5 rounded-sm text-left transition-colors',
				'hover:bg-chrome-surface',
				isSelected && 'bg-chrome-surface'
			) }
		>
			<button onClick={ onClick } className="flex items-center gap-2 flex-1 min-w-0">
				<StatusDot status={ task.status } />
				<div className="flex-1 min-w-0">
					<div
						className={ cx(
							'text-xs truncate',
							isSelected ? 'text-chrome-text' : 'text-chrome-text-secondary'
						) }
					>
						{ task.title }
					</div>
					{ siteName && (
						<div className="text-[10px] text-chrome-text-tertiary truncate">{ siteName }</div>
					) }
				</div>
			</button>
			{ onArchive && (
				<button
					onClick={ ( e ) => {
						e.stopPropagation();
						onArchive();
					} }
					className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-chrome-text-tertiary hover:text-chrome-text transition-opacity"
					title="Archive task"
				>
					<span className="[&>svg]:w-4 [&>svg]:h-4 [&>svg]:fill-current">{ archive }</span>
				</button>
			) }
		</div>
	);
}
