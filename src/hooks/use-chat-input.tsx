import { action, makeObservable, observable } from 'mobx';

class ChatInputStore {
	inputBySite: Record< string, string > = {};

	constructor() {
		makeObservable( this, {
			inputBySite: observable,
			getChatInput: action,
			saveChatInput: action,
		} );
	}

	getChatInput( siteId: string ) {
		return this.inputBySite[ siteId ] ?? '';
	}

	saveChatInput( input: string, siteId: string ) {
		this.inputBySite[ siteId ] = input;
	}
}

export const chatInputStore = new ChatInputStore();
