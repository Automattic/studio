import { __ } from '@wordpress/i18n';
import { download, Icon } from '@wordpress/icons';

const DragAndDropOverlay = () => {
	return (
		<div className="absolute inset-0 bg-white bg-opacity-80 z-10 backdrop-blur-sm flex flex-col items-center justify-center">
			<Icon width={ 49 } height={ 51 } icon={ download } className="fill-a8c-blueberry" />
			<span className="text-[13px] leading-[16px] text-black mt-4">
				{ __( 'Drop backup to import' ) }
			</span>
		</div>
	);
};

export default DragAndDropOverlay;
