import {
	ADD_AI_CREDITS_URL,
	clampQuotaFraction,
	formatQuotaPercentage,
	formatQuotaResetDate,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { sprintf } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { AiAccessRequiredNotice, AiBlockedNotice } from 'src/components/ai-access-required-notice';
import Button from 'src/components/button';
import ProgressBar from 'src/components/progress-bar';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
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
	const creditBalances =
		assistantQuota &&
		! isOffline &&
		! isError &&
		! isDenied &&
		( assistantQuota.allowanceRemaining !== undefined ||
			assistantQuota.purchasedRemaining !== undefined )
			? {
					allowance: assistantQuota.allowanceRemaining ?? 0,
					purchased: assistantQuota.purchasedRemaining ?? 0,
			  }
			: undefined;
	const assistantQuotaWithCostCap =
		assistantQuota &&
		assistantQuota.costCap > 0 &&
		! isOffline &&
		! isError &&
		! isDenied &&
		! creditBalances
			? assistantQuota
			: undefined;
	const credits = new Intl.NumberFormat( locale );

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
								{ creditBalances && (
									<span className="flex flex-col gap-1 tabular-nums text-left">
										{ creditBalances.allowance > 0 && (
											<span>
												{ sprintf(
													/* translators: %s: number of free AI credits remaining (e.g. 960,000). */
													__( 'Free credits remaining: %s' ),
													credits.format( creditBalances.allowance )
												) }
											</span>
										) }
										<span>
											{ sprintf(
												/* translators: %s: number of purchased AI credits remaining (e.g. 150,000). */
												__( 'Purchased credits remaining: %s' ),
												credits.format( creditBalances.purchased )
											) }
										</span>
									</span>
								) }
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
									! isDenied &&
									! assistantQuotaWithCostCap &&
									! creditBalances &&
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
					{ creditBalances && (
						<Button
							className="self-start"
							variant="secondary"
							icon={ external }
							iconPosition="right"
							iconSize={ 16 }
							onClick={ () => void getIpcApi().openURL( ADD_AI_CREDITS_URL ) }
						>
							{ __( 'Add AI credits' ) }
						</Button>
					) }
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}
