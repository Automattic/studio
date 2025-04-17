import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import ProgressBar from 'src/components/progress-bar';
import { useOffline } from 'src/hooks/use-offline';
import { usePromptUsage } from 'src/hooks/use-prompt-usage';

export function PromptInfo() {
	const { __ } = useI18n();
	const { promptCount, promptLimit } = usePromptUsage();
	const isOffline = useOffline();

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">{ __( 'AI assistant' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8 ">
						<div className="flex flex-row items-center text-right">
							<span className="text-a8c-gray-70">
								{ isOffline
									? __( "You're currently offline" )
									: sprintf( __( '%1s of %2s monthly prompts used' ), promptCount, promptLimit ) }
							</span>
						</div>
					</div>
					<ProgressBar value={ promptCount } maxValue={ promptLimit } />
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}
