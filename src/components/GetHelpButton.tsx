import { useI18n } from '@wordpress/react-i18n';
import { STUDIO_DOCS_URL_GET_HELP_UNSUPPORTED_SITES } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

export const GetHelpButton = () => {
	const { __ } = useI18n();

	return (
		<Button
			variant="link"
			onClick={ () => getIpcApi().openURL( STUDIO_DOCS_URL_GET_HELP_UNSUPPORTED_SITES ) }
		>
			{ __( 'Get help ↗️' ) }
		</Button>
	);
};