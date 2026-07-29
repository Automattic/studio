import {
	clampQuotaFraction,
	formatAiBlockedNotice,
	formatQuotaPercentage,
	formatQuotaResetDate,
} from '@studio/common/lib/studio-assistant-quota';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import ProgressBar from 'src/components/progress-bar';
import { useOffline } from 'src/hooks/use-offline';
import { useI18nLocale } from 'src/stores';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';

export function PromptInfo() {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	const isOffline = useOffline();
	const {
		data: assistantQuota,
		isError,
		isLoading,
	} = useGetStudioAssistantQuota( undefined, {
		refetchOnMountOrArgChange: true,
	} );
	const isBlocked = Boolean( assistantQuota?.isStudioCodeAiBlocked ) && ! isOffline && ! isError;
	const assistantQuotaWithCostCap =
		assistantQuota && assistantQuota.costCap > 0 && ! isOffline && ! isError && ! isBlocked
			? assistantQuota
			: undefined;

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">{ __( 'Studio Code' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8 ">
						<div className="flex flex-row items-center text-right">
							<span className="text-frame-text-secondary">
								{ isOffline && __( "You're currently offline" ) }
								{ isBlocked && formatAiBlockedNotice() }
								{ ! isOffline && ! isBlocked && isLoading && __( 'Loading Studio Code limits…' ) }
								{ assistantQuotaWithCostCap &&
									sprintf(
										/* translators: %1$s: percentage of monthly limit used (e.g. 7.5%). %2$s: date the limit resets (e.g. July 1, 2026). */
										__( '%1$s of monthly limit used (resets on %2$s)' ),
										formatQuotaPercentage(
											clampQuotaFraction(
												assistantQuotaWithCostCap.costUsage,
												assistantQuotaWithCostCap.costCap
											),
											locale
										),
										formatQuotaResetDate( assistantQuotaWithCostCap.costResetDate, locale )
									) }
								{ ! isLoading &&
									! isOffline &&
									! isBlocked &&
									! assistantQuotaWithCostCap &&
									__( 'Studio Code limits are temporarily unavailable.' ) }
							</span>
						</div>
					</div>
					{ ! isOffline && isLoading && <ProgressBar /> }
					{ assistantQuotaWithCostCap && (
						<ProgressBar
							value={ assistantQuotaWithCostCap.costUsage }
							maxValue={ assistantQuotaWithCostCap.costCap }
						/>
					) }
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}
