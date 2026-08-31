import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { AiSettings } from '@studio/common/ai/providers';

/**
 * The saved AI provider settings from the main process. `undefined` until the
 * first read resolves; consumers treat that as the default WordPress.com
 * provider (see `getEffectiveSessionProvider`).
 */
export function useAiSettings(): AiSettings | undefined {
	const [ settings, setSettings ] = useState< AiSettings | undefined >( undefined );
	useEffect( () => {
		void getIpcApi()
			.getAiSettings()
			.then( setSettings )
			.catch( () => undefined );
	}, [] );
	return settings;
}
