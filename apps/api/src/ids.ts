import { randomInt } from "node:crypto";

/** Random ids from an alphabet (no look-alike characters), for short public links. */
export function customAlphabet(alphabet: string, size: number): () => string {
  return () => Array.from({ length: size }, () => alphabet[randomInt(alphabet.length)]).join("");
}
