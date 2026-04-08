import { cx } from 'src/lib/cx';

type ImportSource = 'wpcom' | 'pressable' | 'jetpack' | 'local' | 'kinsta' | 'export' | 'url';

interface ImportOption {
	key: ImportSource;
	title: string;
	description: string;
	icon: React.ReactNode;
}

function WordPressIcon() {
	return (
		<svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden="true">
			<path
				fill="currentColor"
				d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0"
			/>
		</svg>
	);
}

function PressableIcon() {
	return (
		<svg viewBox="0 0 72 72" className="w-7 h-7" aria-hidden="true">
			<path
				fill="currentColor"
				d="M41,24.1c-1.2-.9-3-1.4-5.5-1.4h-4.1v12h4.1c2.3,0,4.1-.5,5.4-1.4,1.3-.9,1.9-2.4,1.9-4.6s-.6-3.7-1.8-4.7Z"
			/>
			<path
				fill="currentColor"
				d="M69.4.2H4.8C2.9.2,1.3,1.8,1.3,3.7v64.6c0,1.9,1.6,3.5,3.5,3.5h37.5l30.5-30.5V3.7c0-1.9-1.6-3.5-3.5-3.5ZM49.9,40.5c-3.1,2.8-7.9,4.2-14.2,4.2h-4.3v13.7c0,.6-.4,1-1,1h-9.8c-.6,0-1-.4-1-1V13.7c0-.6.4-1,1-1h15c6.7,0,11.5,1.4,14.5,4.1,3,2.8,4.5,6.8,4.5,12s-1.6,9-4.7,11.7Z"
			/>
		</svg>
	);
}

function JetpackIcon() {
	return (
		<svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden="true">
			<path
				fill="currentColor"
				d="M16,0C7.2,0,0,7.2,0,16s7.2,16,16,16s16-7.2,16-16S24.8,0,16,0z M15,19H7l8-16V19z M17,29V13h8L17,29z"
			/>
		</svg>
	);
}

function LocalIcon() {
	return (
		<svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden="true">
			<path
				fill="currentColor"
				d="m4.49 11.97 6.682-6.681a.638.638 0 0 0 .204-.476V.838a.7.7 0 0 0-.42-.624.68.68 0 0 0-.736.148L1.4 9.193c-.94.94-1.388 1.85-1.4 2.805s.434 1.85 1.36 2.774l8.858 8.86a.638.638 0 0 0 .476.203.39.39 0 0 0 .26-.082.68.68 0 0 0 .42-.626v-4a.692.692 0 0 0-.204-.476L4.489 11.97h.002zm-2.64 1.32c-.34-.45-.502-.872-.502-1.28.012-.57.34-1.182 1.007-1.85l7.66-7.662v2.057l-7.06 7.06A4.355 4.355 0 0 0 1.85 13.29zm8.166 8.205-6.451-6.45a.748.748 0 0 0-.094-.12c-.204-.207-.816-.819.094-1.961l6.45 6.449v2.082zM13.782.376a.668.668 0 0 0-.734-.15.68.68 0 0 0-.422.626v4.015c.004.18.076.35.204.476l6.681 6.68-6.681 6.682a.638.638 0 0 0-.204.476v3.96a.682.682 0 0 0 1.156.49l8.817-8.817c.94-.94 1.389-1.85 1.4-2.804.017-.952-.433-1.85-1.36-2.775L13.782.376zm.204 4.205V2.5l6.451 6.448c.026.044.06.084.094.122.204.204.816.817-.094 1.96l-6.449-6.45-.002.002zm7.647 9.267-7.66 7.661v-2.04l7.06-7.077a4.451 4.451 0 0 0 1.104-1.674c.34.45.504.872.504 1.28-.014.57-.34 1.17-1.008 1.85zm-4.626-1.294H6.9a.516.516 0 0 1-.516-.516v-.054c0-.286.23-.518.516-.518h10.11a.52.52 0 0 1 .518.518v.054a.526.526 0 0 1-.518.516h-.004zm-1.44-2.544v.056a.516.516 0 0 1-.52.516H8.842a.516.516 0 0 1-.518-.516v-.056c0-.285.232-.517.518-.517h6.205c.286 0 .516.232.516.517h.002zm-1.92-1.987v.054a.516.516 0 0 1-.517.518h-2.464a.516.516 0 0 1-.516-.518v-.054c0-.286.232-.516.516-.516h2.464a.508.508 0 0 1 .516.516zm-.517 7.443c.284 0 .516.232.516.518v.054a.516.516 0 0 1-.516.516h-2.464a.516.516 0 0 1-.516-.516v-.054c0-.286.232-.518.516-.518h2.464zm1.918-.912H8.843a.516.516 0 0 1-.518-.516v-.054a.52.52 0 0 1 .518-.518h6.205c.286 0 .516.232.516.518v.054a.516.516 0 0 1-.516.516z"
			/>
		</svg>
	);
}

function DevKinstaIcon() {
	return (
		<svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden="true">
			<rect x="3" y="4" width="7.5" height="16" rx="2.5" fill="currentColor" />
			<rect x="13.5" y="4" width="7.5" height="16" rx="2.5" fill="currentColor" />
		</svg>
	);
}

function GlobeIcon() {
	return (
		<svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden="true">
			<path
				fill="currentColor"
				d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8Zm6.5 8c0 .6 0 1.2-.2 1.8h-2.7c0-.6.2-1.1.2-1.8s0-1.2-.2-1.8h2.7c.2.6.2 1.1.2 1.8Zm-.9-3.2h-2.4c-.3-.9-.7-1.8-1.1-2.4-.1-.2-.2-.4-.3-.5 1.6.5 3 1.6 3.8 3ZM12.8 17c-.3.5-.6 1-.8 1.3-.2-.3-.5-.8-.8-1.3-.3-.5-.6-1.1-.8-1.7h3.3c-.2.6-.5 1.2-.8 1.7Zm-2.9-3.2c-.1-.6-.2-1.1-.2-1.8s0-1.2.2-1.8H14c.1.6.2 1.1.2 1.8s0 1.2-.2 1.8H9.9ZM11.2 7c.3-.5.6-1 .8-1.3.2.3.5.8.8 1.3.3.5.6 1.1.8 1.7h-3.3c.2-.6.5-1.2.8-1.7Zm-1-1.2c-.1.2-.2.3-.3.5-.4.7-.8 1.5-1.1 2.4H6.4c.8-1.4 2.2-2.5 3.8-3Zm-1.8 8H5.7c-.2-.6-.2-1.1-.2-1.8s0-1.2.2-1.8h2.7c0 .6-.2 1.1-.2 1.8s0 1.2.2 1.8Zm-2 1.4h2.4c.3.9.7 1.8 1.1 2.4.1.2.2.4.3.5-1.6-.5-3-1.6-3.8-3Zm7.4 3c.1-.2.2-.3.3-.5.4-.7.8-1.5 1.1-2.4h2.4c-.8 1.4-2.2 2.5-3.8 3Z"
			/>
		</svg>
	);
}

const IMPORT_OPTIONS: ImportOption[] = [
	{
		key: 'wpcom',
		title: 'WordPress.com',
		description: 'Pull from your WordPress.com account',
		icon: <WordPressIcon />,
	},
	{
		key: 'pressable',
		title: 'Pressable',
		description: 'Pull from your Pressable hosting',
		icon: <PressableIcon />,
	},
	{
		key: 'jetpack',
		title: 'Jetpack Backup',
		description: 'Restore from a Jetpack backup archive',
		icon: <JetpackIcon />,
	},
	{
		key: 'local',
		title: 'Local',
		description: 'Import a site from Local by WP Engine',
		icon: <LocalIcon />,
	},
	{
		key: 'kinsta',
		title: 'DevKinsta',
		description: 'Import a site from Kinsta DevKinsta',
		icon: <DevKinstaIcon />,
	},
	{
		key: 'export',
		title: 'WordPress Export',
		description: 'Import from an export file (.xml or .zip)',
		icon: <WordPressIcon />,
	},
	{
		key: 'url',
		title: 'URL',
		description: 'Paste any website URL and we\u2019ll pull it in',
		icon: <GlobeIcon />,
	},
];

export function ImportProjectStep( { onBack }: { onBack: () => void } ) {
	const handleSelect = ( _source: ImportSource ) => {
		// TODO: wire up each import flow
	};

	return (
		<div className="flex-1 flex flex-col items-center px-8 py-12 overflow-y-auto">
			<div className="text-center mb-8">
				<h1 className="text-2xl font-medium text-frame-text">Where is your project?</h1>
				<p className="mt-2 text-sm text-frame-text-secondary">
					Choose where you want to import from.
				</p>
			</div>
			<div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-2">
				{ IMPORT_OPTIONS.map( ( option ) => (
					<button
						key={ option.key }
						onClick={ () => handleSelect( option.key ) }
						className={ cx(
							'flex items-start gap-3 p-4 rounded-xl text-left transition-colors',
							'bg-frame/60 hover:bg-frame/80 backdrop-blur-md',
							'border border-frame-border hover:border-frame-theme'
						) }
					>
						<div className="shrink-0 text-frame-text-secondary">{ option.icon }</div>
						<div className="min-w-0">
							<div className="text-sm font-medium text-frame-text">{ option.title }</div>
							<div className="mt-0.5 text-xs text-frame-text-secondary leading-relaxed">
								{ option.description }
							</div>
						</div>
					</button>
				) ) }
			</div>
			<button
				onClick={ onBack }
				className="mt-8 text-xs text-frame-text-tertiary hover:text-frame-text-secondary transition-colors"
			>
				&larr; Back
			</button>
		</div>
	);
}
