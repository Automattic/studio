import { useI18n } from '@wordpress/react-i18n';

export function PromptInfo() {
	const { __ } = useI18n();

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">{ __( 'Studio Code' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8 ">
						<div className="flex flex-row items-center text-right">
							<span className="text-frame-text-secondary">
								{ __( 'Generous token limits while Studio Code is in beta.' ) }
							</span>
						</div>
					</div>
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}
