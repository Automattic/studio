import {
	clampQuotaFraction,
	formatAiCreditsAvailableLabel,
	formatAiCreditsCallout,
	formatAiCreditsUsedLabel,
	formatQuotaPercentage,
	formatQuotaResetDate,
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { AddAiCreditsButton } from 'src/components/add-ai-credits-button';
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
	const showsCreditBalances =
		!! assistantQuota &&
		! isOffline &&
		! isError &&
		! isDenied &&
		( assistantQuota.allowanceRemaining !== undefined ||
			assistantQuota.purchasedRemaining !== undefined );
	const creditMeter = showsCreditBalances ? getAiCreditsMeter( assistantQuota ) : null;
	const creditMeterIntent = creditMeter ? getAiCreditsMeterIntent( creditMeter.fraction ) : 'ok';
	// The meter's fill escalates with the fraction spent, matching the callout
	// copy's thresholds.
	const creditMeterFillClass = {
		ok: 'bg-frame-text',
		warning: 'bg-[var(--color-frame-warning)]',
		critical: 'bg-[var(--color-frame-critical)]',
		exhausted: 'bg-frame-error',
	}[ creditMeterIntent ];
	const assistantQuotaWithCostCap =
		assistantQuota &&
		assistantQuota.costCap > 0 &&
		! isOffline &&
		! isError &&
		! isDenied &&
		! showsCreditBalances
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
								{ showsCreditBalances && creditMeter && (
									<span className="flex flex-col gap-1 tabular-nums text-left">
										{ formatAiCreditsUsedLabel( creditMeter, locale ) }
									</span>
								) }
								{ showsCreditBalances && ! creditMeter && (
									// No usable denominator (e.g. billing unreachable):
									// plain figures instead of a bar, only the known ones.
									<span className="flex flex-col gap-1 tabular-nums text-left">
										{ assistantQuota?.allowanceRemaining !== undefined && (
											<span>
												{ sprintf(
													/* translators: %s: number of free AI credits remaining (e.g. 960,000). */
													__( 'Free credits remaining: %s' ),
													credits.format( assistantQuota.allowanceRemaining )
												) }
											</span>
										) }
										{ assistantQuota?.purchasedRemaining !== undefined && (
											<span>
												{ sprintf(
													/* translators: %s: number of purchased AI credits remaining (e.g. 150,000). */
													__( 'Purchased credits remaining: %s' ),
													credits.format( assistantQuota.purchasedRemaining )
												) }
											</span>
										) }
									</span>
								) }
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
									! showsCreditBalances &&
									__( 'Studio Code limits are temporarily unavailable.' ) }
							</span>
						</div>
						{ showsCreditBalances && creditMeter && (
							<strong className="text-frame-text self-end font-semibold tabular-nums whitespace-nowrap">
								{ formatAiCreditsAvailableLabel( creditMeter, locale ) }
							</strong>
						) }
					</div>
					{ ! isOffline && isLoading && <ProgressBar /> }
					{ assistantQuotaWithCostCap && (
						<ProgressBar
							value={ assistantQuotaWithCostCap.costUsage }
							maxValue={ assistantQuotaWithCostCap.costCap }
						/>
					) }
					{ showsCreditBalances && creditMeter && (
						<div
							className="bg-frame-border h-1.5 w-full overflow-hidden rounded-full"
							data-testid="ai-credits-meter"
							aria-hidden="true"
						>
							<div
								className={ cx( 'h-full rounded-full', creditMeterFillClass ) }
								style={ { width: `${ creditMeter.fraction * 100 }%` } }
							/>
						</div>
					) }
					{ showsCreditBalances && (
						<div className="flex flex-wrap items-center gap-3">
							<AddAiCreditsButton
								variant={ creditMeterIntent === 'exhausted' ? 'primary' : 'secondary' }
							/>
							{ creditMeter && (
								<span className="text-frame-text-secondary text-sm">
									{ formatAiCreditsCallout( assistantQuota, creditMeter, locale ) }
								</span>
							) }
						</div>
					) }
				</div>
				<div className="h-6 w-6"></div>
			</div>
		</div>
	);
}
