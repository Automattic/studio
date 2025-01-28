import { __ } from '@wordpress/i18n';
import { arrowDown, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';

export function PreviewLinksTableHeader() {
	const { __ } = useI18n();
	return (
		<div className="border-b border-a8c-gray-5">
			<div className="flex items-center h-12 px-8 text-gray-900 text-xs uppercase">
				<div className="w-[51%]">{ __( 'Preview link' ) }</div>
				<div className="flex ml-auto">
					<div className="w-[110px] flex items-center pl-4">
						{ __( 'Updated' ) }
						<Icon icon={ arrowDown } height={ 13 } width={ 16 } />
					</div>
					<div className="w-[100px] pl-4">{ __( 'Expires' ) }</div>
					<div className="w-[60px] text-right">{ __( 'Actions' ) }</div>
				</div>
			</div>
		</div>
	);
}
