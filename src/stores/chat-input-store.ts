import { create } from 'zustand';

type ChatInputState = {
	inputBySite: Record< string, string >;
	getChatInput: ( siteId: string ) => string;
	saveChatInput: ( input: string, siteId: string ) => void;
};

export const useChatInputStore = create< ChatInputState >( ( set, get ) => ( {
	inputBySite: {},
	getChatInput: ( siteId ) => get().inputBySite[ siteId ] ?? '',
	saveChatInput: ( input, siteId ) =>
		set( ( state ) => ( {
			inputBySite: {
				...state.inputBySite,
				[ siteId ]: input,
			},
		} ) ),
} ) );
