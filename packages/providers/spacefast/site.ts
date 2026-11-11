// A Space: a static site on Spacefast, served at `url`, in one of the account's teams.
export interface Space {
	id: string;
	name: string;
	url: string;
	slug: string;
	teamId: string;
	teamName?: string;
}
