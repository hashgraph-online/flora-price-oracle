import { createHash } from "crypto";

export const sha384 = (input: string): string => {
  return createHash("sha384").update(input).digest("hex");
};
