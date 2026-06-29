import { CheckboxControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import {
	useGetPluginDevelopmentEnabledQuery,
	useSavePluginDevelopmentEnabledMutation,
} from 'src/stores/installed-apps-api';

export const DevelopmentTab = () => {
	const { __ } = useI18n();
	const { data: pluginDevelopmentEnabled, isLoading } = useGetPluginDevelopmentEnabledQuery();
	const [ savePluginDevelopmentEnabled, { isLoading: isSaving } ] =
		useSavePluginDevelopmentEnabledMutation();

	const isEnabled = pluginDevelopmentEnabled ?? false;

	const handleChange = ( checked: boolean ) => {
		void savePluginDevelopmentEnabled( checked );
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-sm border border-frame-border bg-frame-surface p-4">
				<CheckboxControl
					label={ __( 'Enable Plugin Development and Publishing' ) }
					checked={ isEnabled }
					disabled={ isLoading || isSaving }
					onChange={ handleChange }
				/>
				<p className="mt-2 max-w-[60ch] text-sm leading-5 text-frame-text-secondary">
					{ __(
						'Show plugin development tools in the Studio sidebar so you can add local plugin projects, inspect release metadata, and prepare publishing workflows from Studio.'
					) }
				</p>
			</div>
			<p className="max-w-[60ch] text-sm leading-5 text-frame-text-secondary">
				{ __(
					'When this is off, Studio keeps any saved plugin projects but hides the development workspace from the sidebar.'
				) }
			</p>
		</div>
	);
};
