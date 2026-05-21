import { useSelector } from 'react-redux';
import type { RootState } from 'src/stores';

export function useBetaFeatures(): BetaFeatures {
	return useSelector( ( state: RootState ) => state.betaFeatures.features );
}
