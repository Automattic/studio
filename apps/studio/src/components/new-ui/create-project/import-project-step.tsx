import { cx } from 'src/lib/cx';

type ImportSource = 'wpcom' | 'pressable' | 'jetpack' | 'export';

interface ImportOption {
	key: ImportSource;
	title: string;
	description: string;
}

const IMPORT_OPTIONS: ImportOption[] = [
	{
		key: 'wpcom',
		title: 'WordPress.com',
		description: 'Pull a project from your WordPress.com account',
	},
	{
		key: 'pressable',
		title: 'Pressable',
		description: 'Pull a project from your Pressable hosting',
	},
	{
		key: 'jetpack',
		title: 'Jetpack Backup',
		description: 'Restore from a Jetpack backup archive',
	},
	{
		key: 'export',
		title: 'WordPress Export',
		description: 'Import from a WordPress export file (.xml or .zip)',
	},
];

export function ImportProjectStep( { onBack }: { onBack: () => void } ) {
	const handleSelect = ( _source: ImportSource ) => {
		// TODO: wire up each import flow
	};

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
			<div className="text-center">
				<h1 className="text-2xl font-medium text-chrome-text">Where is your project?</h1>
				<p className="mt-2 text-sm text-chrome-text-secondary">
					Choose where you want to import from.
				</p>
			</div>
			<div className="w-full max-w-lg flex flex-col gap-2">
				{ IMPORT_OPTIONS.map( ( option ) => (
					<button
						key={ option.key }
						onClick={ () => handleSelect( option.key ) }
						className={ cx(
							'w-full p-4 rounded-xl text-left transition-colors',
							'bg-chrome-surface/50 hover:bg-chrome-surface',
							'border border-chrome-border hover:border-chrome-text-tertiary'
						) }
					>
						<div className="text-sm font-medium text-chrome-text">{ option.title }</div>
						<div className="mt-0.5 text-xs text-chrome-text-secondary">{ option.description }</div>
					</button>
				) ) }
			</div>
			<button
				onClick={ onBack }
				className="text-xs text-chrome-text-tertiary hover:text-chrome-text-secondary transition-colors"
			>
				&larr; Back
			</button>
		</div>
	);
}
