/**
 * Addon Storage — Namespaced read/write into UserData.addonData.
 * Uses lockAppdata() / unlockAppdata() per existing convention.
 */
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { AddonStorageApi } from 'src/modules/addons/addon-api';

export function createAddonStorage< T = unknown >( addonId: string ): AddonStorageApi< T > {
	return {
		async read(): Promise< T | undefined > {
			const userData = await loadUserData();
			return ( userData.addonData?.[ addonId ] as T ) ?? undefined;
		},

		async write( data: T ): Promise< void > {
			try {
				await lockAppdata();
				const userData = await loadUserData();
				userData.addonData = {
					...( userData.addonData ?? {} ),
					[ addonId ]: data,
				};

				await saveUserData( userData );
			} finally {
				await unlockAppdata();
			}
		},
	};
}
