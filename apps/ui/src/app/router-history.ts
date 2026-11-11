import { createHashHistory, type RouterHistory } from '@tanstack/react-router';

export function createPackagedRouterHistory(): RouterHistory | undefined {
	if ( window.location.protocol !== 'file:' ) {
		return undefined;
	}

	return createHashHistory();
}
