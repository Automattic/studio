import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { Icon, plus } from '@wordpress/icons';
import Button from 'src/components/button';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';

interface AddDevelopmentProjectButtonProps {
	className?: string;
	variant?: 'primary' | 'secondary' | 'tertiary';
}

export function AddDevelopmentProjectButton( {
	className,
	variant = 'secondary',
}: AddDevelopmentProjectButtonProps ) {
	const { addProject } = useDevelopmentProjects();

	const handleAddProject = async () => {
		const ipcApi = getIpcApi();
		const response = await ipcApi.showOpenFolderDialog( __( 'Choose plugin folder' ), '' );
		if ( ! response?.path ) {
			return;
		}

		try {
			await addProject( response.path );
		} catch ( error ) {
			Sentry.captureException( error );
			ipcApi.showErrorMessageBox( {
				title: __( 'Could not add plugin project' ),
				message: __( 'Select a folder that contains a WordPress plugin header and try again.' ),
				error: simplifyErrorForDisplay( error ),
			} );
		}
	};

	return (
		<Button
			className={ className }
			variant={ variant }
			icon={ <Icon icon={ plus } size={ 18 } /> }
			iconSize={ 18 }
			onClick={ handleAddProject }
		>
			{ __( 'Add plugin project' ) }
		</Button>
	);
}
