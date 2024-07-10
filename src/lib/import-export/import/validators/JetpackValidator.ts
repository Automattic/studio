import path from "path";
import { BackupContents } from "../types";
import { Validator } from "./Validator";

export class JetpackValidator implements Validator {
  canHandle(fileList: string[]): boolean {
    const requiredDirs = [
      "sql",
      "wp-content/uploads",
      "wp-content/plugins",
      "wp-content/themes",
    ];
    return (
      requiredDirs.some((dir) =>
        fileList.some((file) => file.startsWith(dir + "/")),
      ) &&
      fileList.some((file) => file.startsWith("sql/") && file.endsWith(".sql"))
    );
  }

  getBackup(fileList: string[], extractedDir: string): BackupContents {
    const extractedBackup: BackupContents = {
      extractedPath: extractedDir,
      sqlFiles: [],
      wpContent: {
        uploads: [],
        plugins: [],
        themes: [],
      },
    };

    for (const file of fileList) {
      // Ignore wp-config.php
      if (file === "wp-config.php") continue;

      const fullPath = path.join(extractedDir, file);

      if (file.startsWith("sql/") && file.endsWith(".sql")) {
        extractedBackup.sqlFiles.push(fullPath);
      } else if (file.startsWith("wp-content/uploads/")) {
        extractedBackup.wpContent.uploads.push(fullPath);
      } else if (file.startsWith("wp-content/plugins/")) {
        extractedBackup.wpContent.plugins.push(fullPath);
      } else if (file.startsWith("wp-content/themes/")) {
        extractedBackup.wpContent.themes.push(fullPath);
      } else if (file === "studio.json") {
        extractedBackup.metaFile = fullPath;
      }
    }
    extractedBackup.sqlFiles.sort((a: string, b: string) =>
      path.basename(a).localeCompare(path.basename(b)),
    );

    return extractedBackup;
  }
}
