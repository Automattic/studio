import {
	clampQuotaFraction,
	formatQuotaPercentage,
	formatQuotaResetDate,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { AiAccessRequiredNotice, AiBlockedNotice } from 'src/components/ai-access-required-notice';
import ProgressBar from 'src/components/progress-bar';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
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
	const accessState =
		assistantQuota && ! isOffline && ! isError
			? getStudioCodeAiAccessState( assistantQuota )
			: 'available';
	const isDenied = accessState !== 'available';
	const assistantQuotaWithCostCap =
		assistantQuota && assistantQuota.costCap > 0 && ! isOffline && ! isError && ! isDenied
			? assistantQuota
			: undefined;
	const usedPercentage = assistantQuotaWithCostCap
		? formatQuotaPercentage(
				clampQuotaFraction(
					assistantQuotaWithCostCap.costUsage,
					assistantQuotaWithCostCap.costCap
				),
				locale
		  )
		: '';

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold">{ __( 'Studio Code' ) }</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8 ">
						<div className={ cx( 'flex flex-row items-center', ! isDenied && 'text-right' ) }>
							<span className="text-frame-text-secondary">
								{ isOffline && __( "You're currently offline" ) }
								{ accessState === 'blocked' && <AiBlockedNotice /> }
								{ accessState === 'not-enabled' && (
									<AiAccessRequiredNotice quota={ assistantQuota } />
								) }
								{ ! isOffline && ! isDenied && isLoading && __( 'Loading Studio Code limits…' ) }
								{ assistantQuotaWithCostCap &&
									( assistantQuotaWithCostCap.costResetDate
										? sprintf(
												/* translators: %1$s: percentage of monthly limit used (e.g. 7.5%). %2$s: date the limit resets (e.g. July 1, 2026). */
												__( '%1$s of monthly limit used (resets on %2$s)' ),
												usedPercentage,
												formatQuotaResetDate( assistantQuotaWithCostCap.costResetDate, locale )
										  )
										: sprintf(
												/* translators: %s: percentage of monthly limit used (e.g. 7.5%). */
												__( '%s of monthly limit used' ),
												usedPercentage
										  ) ) }
								{ ! isLoading &&
									! isOffline &&
									! isDenied &&
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
