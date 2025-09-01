import { useI18n } from '@wordpress/react-i18n';
import emptyStudioIllustration from 'src/components/empty-studio/empty-studio.svg';
import AddSite from 'src/modules/add-site';

export function EmptyStudio() {
	const { __ } = useI18n();

	return (
		<div className="w-full h-full flex items-center app-no-drag-region">
			<div className="mx-auto px-[85px] flex items-center gap-[44px] max-w-[786px]">
				<div>
					<div className="text-[16px] font-semibold text-black mb-[4px]">
						{ __( 'Ready for a new start?' ) }
					</div>
					<p className="text-[13px] text-gray-700 mb-[32px]">
						{ __( "You don't have any sites right now. Add a new one to get started again." ) }
					</p>

					<AddSite variant="primary" />
				</div>

				<img src={ emptyStudioIllustration } alt={ __( 'Empty Studio illustration' ) } />
			</div>
		</div>
	);
}
