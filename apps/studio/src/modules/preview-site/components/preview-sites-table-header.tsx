import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';

export function PreviewSitesTableHeader() {
	const { __ } = useI18n();
	return (
		<div className="border-b border-frame-border">
			<div className="flex items-center h-12 px-8 a8c-label uppercase">
				<div className="w-[51%]">{ __( 'Preview site' ) }</div>
				<div className="flex ltr:ml-auto rtl:mr-auto">
					<div className="w-[150px] flex items-center pl-4">{ __( 'Updated' ) }</div>
					<div className="w-[150px] pl-4">{ __( 'Expires' ) }</div>
					<div className="w-[60px] ltr:text-right rtl:text-left">{ __( 'Actions' ) }</div>
				</div>
			</div>
		</div>
	);
}
