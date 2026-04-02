import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { removePermissionRequest } from 'src/stores/tasks-slice';
import type { PermissionResponse } from 'src/modules/ai/types';

interface TaskPermissionPromptProps {
	taskId: string;
}

export function TaskPermissionPrompt( { taskId }: TaskPermissionPromptProps ) {
	const dispatch = useAppDispatch();
	const requests = useRootSelector( ( state ) =>
		state.tasks.pendingPermissions.filter( ( p ) => p.taskId === taskId )
	);

	if ( requests.length === 0 ) {
		return null;
	}

	const request = requests[ 0 ];

	const handleResponse = ( response: PermissionResponse ) => {
		dispatch( removePermissionRequest( request.requestId ) );
		void getIpcApi().respondToPermissionRequestHandler( request.requestId, response, taskId );
	};

	return (
		<div className="border-t border-frame-border bg-frame-surface p-4">
			<div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
				<div className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
					Permission Required
				</div>
				<div className="text-xs text-amber-700 dark:text-amber-300 mb-3">
					{ request.description }
				</div>
				<div className="flex gap-2">
					<button
						onClick={ () => handleResponse( 'allow_once' ) }
						className={ cx(
							'px-3 py-1.5 rounded text-xs font-medium',
							'bg-amber-600 text-white hover:bg-amber-700',
							'transition-colors'
						) }
					>
						Allow once
					</button>
					<button
						onClick={ () => handleResponse( 'allow_session' ) }
						className={ cx(
							'px-3 py-1.5 rounded text-xs font-medium',
							'bg-amber-100 text-amber-800 hover:bg-amber-200',
							'dark:bg-amber-800 dark:text-amber-200 dark:hover:bg-amber-700',
							'transition-colors'
						) }
					>
						Allow for session
					</button>
					<button
						onClick={ () => handleResponse( 'deny' ) }
						className={ cx(
							'px-3 py-1.5 rounded text-xs font-medium',
							'bg-gray-100 text-gray-700 hover:bg-gray-200',
							'dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
							'transition-colors'
						) }
					>
						Deny
					</button>
				</div>
			</div>
		</div>
	);
}
