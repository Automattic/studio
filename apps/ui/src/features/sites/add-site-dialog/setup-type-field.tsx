import { __ } from '@wordpress/i18n';
import { SelectField } from '@/features/sites/site-fields';
import { useAddSite, type SetupType } from './context';

export function SetupTypeField( { disabled = false }: { disabled?: boolean } ) {
	const { source, changeSourceType } = useAddSite();
	return (
		<SelectField
			label={ __( 'Type' ) }
			orientation="vertical"
			fullWidth
			value={ source.type === 'blueprint' || source.type === 'import' ? source.type : 'blank' }
			disabled={ disabled }
			options={ [
				{ value: 'blank', label: __( 'Blank' ) },
				{ value: 'blueprint', label: __( 'Blueprint' ) },
				{ value: 'import', label: __( 'Backup or export' ) },
			] }
			onChange={ ( value ) => changeSourceType( value as SetupType ) }
		/>
	);
}
