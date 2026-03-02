export type UserSettingsTabName = 'account' | 'preferences' | 'usage' | 'addons';
export type UserSettingsTab = {
	name: UserSettingsTabName | ( string & Record< never, never > );
	title: string;
};
