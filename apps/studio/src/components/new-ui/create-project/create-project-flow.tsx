import { useState, useCallback } from 'react';
import { SETUP_SITE_ID } from 'src/constants';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import {
	appendTaskMessage,
	createNewTask,
	setSelectedTaskId,
	setTaskStreaming,
} from 'src/stores/tasks-slice';
import { DotGrid } from '../dot-grid';
import { TaskChatInput } from '../tasks/task-chat-input';
import { ImportProjectStep } from './import-project-step';

type Step = 'choose' | 'new' | 'import';

export function CreateProjectFlow() {
	const [ step, setStep ] = useState< Step >( 'choose' );

	const handleBack = useCallback( () => setStep( 'choose' ), [] );

	let content;
	if ( step === 'new' ) {
		content = <NewProjectStep onBack={ handleBack } />;
	} else if ( step === 'import' ) {
		content = <ImportProjectStep onBack={ handleBack } />;
	} else {
		content = (
			<ChooseStep onNew={ () => setStep( 'new' ) } onImport={ () => setStep( 'import' ) } />
		);
	}

	return (
		<div className="relative flex-1 flex flex-col overflow-hidden">
			<div className="absolute inset-0 text-frame-text-tertiary pointer-events-none">
				<DotGrid rippleStrength={ 1 } repulsion={ 0.25 } opacity={ 0.15 } />
			</div>
			<div className="relative z-10 flex-1 flex flex-col">{ content }</div>
		</div>
	);
}

function ChooseStep( { onNew, onImport }: { onNew: () => void; onImport: () => void } ) {
	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
			<div className="text-center">
				<h1 className="text-2xl font-medium text-frame-text">What do you want to build?</h1>
			</div>
			<div className="flex gap-3 w-full max-w-lg">
				<ChoiceCard
					title="Something new"
					description="A blog, a game, an app, a store, a social network — anything."
					onClick={ onNew }
				/>
				<ChoiceCard
					title="Bring something you already have"
					description="From WordPress.com, a backup, a URL, or anywhere else."
					onClick={ onImport }
				/>
			</div>
		</div>
	);
}

function ChoiceCard( {
	title,
	description,
	onClick,
}: {
	title: string;
	description: string;
	onClick: () => void;
} ) {
	return (
		<button
			onClick={ onClick }
			className={ cx(
				'flex-1 p-5 rounded-xl text-left transition-colors',
				'bg-frame/60 hover:bg-frame/80 backdrop-blur-md',
				'border border-frame-border hover:border-frame-theme'
			) }
		>
			<div className="text-sm font-medium text-frame-text">{ title }</div>
			<div className="mt-1 text-xs text-frame-text-secondary leading-relaxed">{ description }</div>
		</button>
	);
}

function NewProjectStep( { onBack }: { onBack: () => void } ) {
	const [ isCreating, setIsCreating ] = useState( false );
	const dispatch = useAppDispatch();

	const handleSubmit = useCallback(
		async ( text: string ) => {
			const trimmed = text.trim();
			if ( ! trimmed || isCreating ) {
				return;
			}

			setIsCreating( true );

			try {
				// Create a task with a placeholder site — no real site on disk yet.
				// The agent will create the real site later via site_create,
				// and the task will be migrated to it automatically.
				const task = await dispatch( createNewTask( SETUP_SITE_ID ) ).unwrap();
				await getIpcApi().updateTask( task.id, { title: 'Project setup' } );

				// Add the user's description as the first visible message
				dispatch(
					appendTaskMessage( {
						taskId: task.id,
						message: {
							id: `user-${ Date.now() }`,
							role: 'user',
							content: trimmed,
							timestamp: Date.now(),
						},
					} )
				);
				dispatch( setTaskStreaming( { taskId: task.id, streaming: true } ) );

				// Select the task — this exits creation mode and shows TaskChatPanel
				dispatch( setSelectedTaskId( task.id ) );

				// Send the description as the first message to kick off the spec skill
				await getIpcApi().startTaskAgentHandler( task.id, trimmed );
			} catch {
				setIsCreating( false );
			}
		},
		[ isCreating, dispatch ]
	);

	return (
		<div className="flex-1 flex flex-col items-center justify-center px-8">
			<div className="text-center mb-6">
				<h1 className="text-2xl font-medium text-frame-text">What are you building?</h1>
				<p className="mt-2 text-sm text-frame-text-secondary">
					Describe your project and we&apos;ll set it up for you.
				</p>
			</div>
			<div className="w-full max-w-lg">
				<TaskChatInput
					onSubmit={ handleSubmit }
					placeholder="A portfolio site for a photographer, a blog about hiking, a site for my local bakery..."
				/>
			</div>
			<button
				onClick={ onBack }
				disabled={ isCreating }
				className="fixed bottom-4 left-4 text-xs text-frame-text-tertiary hover:text-frame-text-secondary transition-colors disabled:opacity-50"
			>
				&larr; Back
			</button>
		</div>
	);
}
