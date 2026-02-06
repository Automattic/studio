import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { SettingsFormField } from './settings-form-field';

interface DefaultDirectoryPickerProps {
	directory?: string;
	isLoading: boolean;
	isSelecting: boolean;
	onPick: () => void;
}

export const DefaultDirectoryPicker = ( {
	directory,
	isLoading,
	isSelecting,
	onPick,
}: DefaultDirectoryPickerProps ) => {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'Default site directory' ) }>
			<div className="flex flex-col gap-2">
				<p className="a8c-body-small text-a8c-gray-700 break-words">
					{ isLoading ? __( 'Loading...' ) : directory ?? '' }
				</p>
				<div className="flex gap-2">
					<Button
						variant="secondary"
						onClick={ onPick }
						disabled={ isLoading || isSelecting }
						data-testid="preferences-change-default-directory-button"
					>
						{ __( 'Change folder' ) }
					</Button>
				</div>
			</div>
		</SettingsFormField>
	);
};
