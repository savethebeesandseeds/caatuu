import { czechStandardRecordsProvider } from "./standard-corpus.mjs";
import { czechSemanticBankRecordsProvider } from "./czech-semantic-bank.mjs";

const providers = new Map([czechStandardRecordsProvider, czechSemanticBankRecordsProvider].map(provider => [provider.id, provider]));

export function resolveRecordProjectionProvider(id) {
  return providers.get(id) ?? null;
}
