import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import Button from './button';

export const ChatRating = () => {
	return (
		<div className="flex mt-4 items-center gap-3">
			<span className="text-a8c-gray-70 text-xs">{ __( 'Was this helpful?' ) }</span>
			<Button variant="icon" className="text-a8c-green-50 flex items-center gap-1">
				<Icon size={ 18 } icon={ thumbsUp } />
				<span className="text-xs">{ __( 'Yes' ) }</span>
			</Button>
			<Button variant="icon" className="text-a8c-red-50 flex items-center gap-1">
				<Icon size={ 18 } icon={ thumbsDown } />
				<span className="text-xs">{ __( 'No' ) }</span>
			</Button>
		</div>
	);
};
