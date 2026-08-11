import { GATED_TOOL_NAMES, supportsAlwaysAllow } from '@studio/common/ai/tool-permissions';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import { SettingsFormField } from './settings-form-field';
import type {
	GatedToolName,
	ToolPermissionLevel,
	ToolPermissionOverrides,
} from '@studio/common/ai/tool-permissions';

interface ToolPermissionsSectionProps {
	value: ToolPermissionOverrides;
	onChange: ( toolName: GatedToolName, level: ToolPermissionLevel ) => void;
}

// site_delete is intentionally absent: it always asks and cannot be relaxed.
const CONFIGURABLE_TOOLS = GATED_TOOL_NAMES.filter( supportsAlwaysAllow );

export const ToolPermissionsSection = ( { value, onChange }: ToolPermissionsSectionProps ) => {
	const { __ } = useI18n();

	const toolLabels: Record< string, string > = {
		preview_delete: __( 'Delete preview sites' ),
		site_push: __( 'Push sites to WordPress.com' ),
		site_pull: __( 'Pull sites from WordPress.com' ),
		site_import: __( 'Import backups into sites' ),
		wp_cli: __( 'Destructive WP-CLI commands' ),
	};

	const levels: Array< { value: ToolPermissionLevel; label: string } > = [
		{ value: 'ask', label: __( 'Ask' ) },
		{ value: 'allow', label: __( 'Always allow' ) },
	];

	return (
		<SettingsFormField label={ __( 'Agent permissions' ) }>
			<p className="m-0 text-sm text-frame-text-secondary">
				{ __(
					'Risky agent actions ask for your approval before running. Deleting a site always asks.'
				) }
			</p>
			<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
				{ CONFIGURABLE_TOOLS.map( ( toolName ) => {
					const current: ToolPermissionLevel = value[ toolName ] === 'allow' ? 'allow' : 'ask';
					return (
						<li key={ toolName } className="flex items-center justify-between gap-3">
							<span className="text-sm text-frame-text whitespace-nowrap">
								{ toolLabels[ toolName ] ?? toolName }
							</span>
							<div
								role="radiogroup"
								aria-label={ toolLabels[ toolName ] ?? toolName }
								className="grid w-fit grid-cols-2 overflow-hidden rounded-sm border border-frame-border"
							>
								{ levels.map( ( level, index ) => {
									const isSelected = current === level.value;
									return (
										<button
											key={ level.value }
											type="button"
											role="radio"
											aria-checked={ isSelected }
											onClick={ () => onChange( toolName, level.value ) }
											className={ cx(
												'px-3 py-1 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:bg-frame-surface',
												index > 0 && 'border-l border-frame-border',
												isSelected
													? 'bg-frame-text text-frame font-medium'
													: 'bg-frame text-frame-text hover:bg-frame-surface'
											) }
										>
											{ level.label }
										</button>
									);
								} ) }
							</div>
						</li>
					);
				} ) }
			</ul>
		</SettingsFormField>
	);
};
