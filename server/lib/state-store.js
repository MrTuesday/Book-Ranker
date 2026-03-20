import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { cloneState, normalizeLibraryState } from "./library-model.js";

export class JsonStateStore {
  constructor(filePath, createSeedState) {
    this.filePath = filePath;
    this.createSeedState = createSeedState;
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return cloneState(normalizeLibraryState(JSON.parse(raw)));
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        const nextState = this.createSeedState();
        await this.write(nextState);
        return cloneState(nextState);
      }

      const nextState = this.createSeedState();
      await this.write(nextState);
      return cloneState(nextState);
    }
  }

  async write(state) {
    const normalizedState = normalizeLibraryState(state);
    const nextState = cloneState(normalizedState);
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(nextState, null, 2));
    await rename(temporaryPath, this.filePath);

    return cloneState(nextState);
  }
}
