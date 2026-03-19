import type { WPCOM } from 'wpcom/types';

let wpcomClient: WPCOM | undefined;

export const setWpcomClient = ( client: WPCOM | undefined ) => {
	wpcomClient = client;
};

export const getWpcomClient = (): WPCOM | undefined => {
	return wpcomClient;
};
