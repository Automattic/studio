import { BackupContents } from "../types";

export interface Validator {
  canHandle(allFiles: string[]): boolean;
  getBackup(allFiles: string[], extractDir: string): BackupContents;
}
