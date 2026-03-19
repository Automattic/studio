import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { Gravatar } from 'src/components/gravatar';
import { Tooltip } from 'src/components/tooltip';
import { WPCOM_PROFILE_URL } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const UserInfo = ( {
	user,
	onLogout,
}: {
	user?: { displayName: string; email: string };
	onLogout: () => void;
} ) => {
	const { __ } = useI18n();
	return (
		<div className="flex w-full gap-5 py-1">
			<div className="flex w-full items-center gap-3">
				<Tooltip text={ __( 'Edit profile' ) } placement="bottom">
					<Button
						onClick={ () => getIpcApi().openURL( WPCOM_PROFILE_URL ) }
						aria-label={ __( 'Edit profile' ) }
						variant="icon"
					>
						<Gravatar detailedDefaultImage size={ 32 } isBlack />
					</Button>
				</Tooltip>
				<div className="flex flex-col">
					<span className="overflow-ellipsis">{ user?.displayName }</span>
					<span className="text-a8c-gray-700 text-[10px] leading-[10px]">{ user?.email }</span>
				</div>
			</div>
			<Button variant="secondary" className="!gap-3" onClick={ onLogout }>
				{ __( 'Log out' ) }
			</Button>
		</div>
	);
};
