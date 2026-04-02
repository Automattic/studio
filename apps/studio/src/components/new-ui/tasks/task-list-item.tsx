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
				'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors',
				'hover:bg-chrome-surface',
				isSelected && 'bg-chrome-surface'
			) }
		>
			<button onClick={ onClick } className="flex-1 min-w-0 text-left">
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
			</button>
			<div className="group relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
				<StatusDot status={ task.status } />
				{ onArchive && (
					<button
						onClick={ ( e ) => {
							e.stopPropagation();
							onArchive();
						} }
						className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-chrome-text-tertiary hover:text-chrome-text transition-opacity"
						title="Archive task"
					>
						<span className="[&>svg]:w-5 [&>svg]:h-5 [&>svg]:fill-current">{ archive }</span>
					</button>
				) }
			</div>
		</div>
	);
}
