import { useContext } from "preact/hooks";
import { BootstrapContext } from "../bootstrap";
import type { User } from "../shared/types";

/** The signed-in user, or null. Signing in and out are full page loads, so this never changes in place. */
export function useUser(): User | null {
  return useContext(BootstrapContext).user;
}
