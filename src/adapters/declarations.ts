import { canonicalize } from "../lib/canonicalize.js";
import { sha384 } from "../lib/hash.js";

export type AdapterDeclaration = {
  p: "hcs-21";
  op: "register";
  adapter_id: string;
  entity: string;
  package: {
    registry: string;
    name: string;
    version: string;
    integrity: string;
  };
  manifest: string;
  config: {
    type: "flora";
    account: string;
    threshold: string;
    ctopic: string;
    ttopic: string;
    stopic: string;
  };
  state_model: string;
  signature?: string;
};

export const declarationHash = (decl: AdapterDeclaration): string => sha384(canonicalize(decl));
