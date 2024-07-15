import { BackupContents } from '../types';
import { DefaultImporter, Importer } from './Importer';

export * from './Importer';

export const allImporters: { [ key: string ]: new ( contents: BackupContents ) => Importer } = {
	JetpackValidator: DefaultImporter,
	SqlValidator: DefaultImporter,
};
