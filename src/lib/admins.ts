import { readAdminIds } from "./entity-repository";

/** Preserve the original administrator while supporting additional accounts. */
export async function getAdminIds(): Promise<string[]> {
  return readAdminIds();
}
