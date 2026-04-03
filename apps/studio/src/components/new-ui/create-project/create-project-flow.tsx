import { useState } from 'react';
import { cx } from 'src/lib/cx';
import { ImportProjectStep } from './import-project-step';

type Step = 'choose' | 'new' | 'import';

export function CreateProjectFlow() {
	const [ step, setStep ] = useState< Step >( 'choose' );

	if ( step === 'new' ) {
		return <NewProjectStep onBack={ () => setStep( 'choose' ) } />;
	}

	if ( step === 'import' ) {
		return <ImportProjectStep onBack={ () => setStep( 'choose' ) } />;
	}

	return <ChooseStep onNew={ () => setStep( 'new' ) } onImport={ () => setStep( 'import' ) } />;
}

function ChooseStep( { onNew, onImport }: { onNew: () => void; onImport: () => void } ) {
	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
			<div className="text-center">
				<h1 className="text-2xl font-medium text-chrome-text">Start a new project</h1>
				<p className="mt-2 text-sm text-chrome-text-secondary">
					WordPress can power anything. What are you building?
				</p>
			</div>
			<div className="flex gap-3 w-full max-w-lg">
				<ChoiceCard
					title="Create new"
					description="Start fresh with a blank project and build it with AI"
					onClick={ onNew }
				/>
				<ChoiceCard
					title="Bring existing"
					description="Import from WordPress.com, a backup, or an export file"
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
				'bg-chrome-surface/50 hover:bg-chrome-surface',
				'border border-chrome-border hover:border-chrome-text-tertiary'
			) }
		>
			<div className="text-sm font-medium text-chrome-text">{ title }</div>
			<div className="mt-1 text-xs text-chrome-text-secondary leading-relaxed">{ description }</div>
		</button>
	);
}

function NewProjectStep( { onBack }: { onBack: () => void } ) {
	const [ value, setValue ] = useState( '' );

	const handleKeyDown = ( e: React.KeyboardEvent ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			// TODO: wire up to project creation
		}
	};

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
			<div className="text-center">
				<h1 className="text-2xl font-medium text-chrome-text">What are you building?</h1>
				<p className="mt-2 text-sm text-chrome-text-secondary">
					Describe your project and we&apos;ll set it up for you.
				</p>
			</div>
			<div className="w-full max-w-lg">
				<div className="rounded-xl task-chat-input-card border border-chrome-border">
					<textarea
						value={ value }
						onChange={ ( e ) => setValue( e.target.value ) }
						onKeyDown={ handleKeyDown }
						placeholder="A portfolio site for a photographer, a blog about hiking, a site for my local bakery..."
						rows={ 1 }
						autoFocus
						className={ cx(
							'w-full resize-none bg-transparent px-4 pt-4 pb-2',
							'text-sm text-chrome-text placeholder:text-chrome-text-tertiary',
							'focus:outline-none',
							'max-h-32'
						) }
						style={ { fieldSizing: 'content' } as React.CSSProperties }
					/>
					<div className="flex items-center justify-between px-3 pb-3">
						<button
							onClick={ onBack }
							className="text-xs text-chrome-text-tertiary hover:text-chrome-text-secondary transition-colors px-1"
						>
							&larr; Back
						</button>
						<button
							disabled={ ! value.trim() }
							className={ cx(
								'w-8 h-8 flex items-center justify-center rounded-full transition-colors',
								value.trim()
									? 'bg-frame-theme text-white'
									: 'bg-chrome-surface text-chrome-text-tertiary',
								'disabled:cursor-not-allowed'
							) }
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<line x1="12" y1="19" x2="12" y2="5" />
								<polyline points="5 12 12 5 19 12" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
