import { canonicalize, type AdapterDeclaration as Hcs21Declaration } from "@hashgraphonline/standards-sdk";
import { sha384 } from "../lib/hash.js";

export type AdapterDeclaration = Hcs21Declaration;

export const declarationHash = (decl: AdapterDeclaration): string => sha384(canonicalize(decl));
