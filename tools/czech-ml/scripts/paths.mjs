import { fileURLToPath } from "node:url";
import path from "node:path";

export const mlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const caatuuRoot = path.resolve(mlRoot, "..", "..");
export const appRoot = path.join(caatuuRoot, "apps", "languages", "czech");
export const appDataRoot = path.join(appRoot, "static", "data");
export const mlDataRoot = path.join(mlRoot, "data");
export const mlModelsRoot = path.join(mlDataRoot, "models");

export function fromRoot(...parts) {
  return path.join(mlRoot, ...parts);
}

export function fromModels(...parts) {
  return path.join(mlModelsRoot, ...parts);
}
