import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { removeQuestionRequest } from 'src/stores/tasks-slice';

interface TaskQuestionPromptProps {
	taskId: string;
}

export function TaskQuestionPrompt( { taskId }: TaskQuestionPromptProps ) {
	const dispatch = useAppDispatch();
	const requests = useRootSelector( ( state ) =>
		state.tasks.pendingQuestions.filter( ( q ) => q.taskId === taskId )
	);

	if ( requests.length === 0 ) {
		return null;
	}

	const request = requests[ 0 ];

	const handleSelect = ( label: string ) => {
		dispatch( removeQuestionRequest( request.requestId ) );
		void getIpcApi().respondToQuestionHandler( request.requestId, label, taskId );
	};

	return (
		<div className="px-4 py-3">
			<div className="text-sm text-frame-text mb-2">{ request.question }</div>
			<div className="flex flex-col gap-1">
				{ request.options.map( ( option ) => (
					<button
						key={ option.label }
						onClick={ () => handleSelect( option.label ) }
						className={ cx(
							'text-left text-sm py-1 transition-colors',
							'text-frame-text hover:text-frame-theme'
						) }
					>
						<span className="font-medium">{ option.label }</span>
						{ option.description && (
							<span className="text-frame-text-tertiary ml-1.5">{ option.description }</span>
						) }
					</button>
				) ) }
			</div>
		</div>
	);
}
