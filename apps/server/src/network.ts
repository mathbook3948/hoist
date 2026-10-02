import { BlockList, isIP } from "node:net";

export const defaultAllowedIP = "127.0.0.1";

/** Compile once at startup; forwarded headers are deliberately not inputs. */
export function createIPFilter(entry: unknown = defaultAllowedIP) {
  if (typeof entry !== "string")
    throw new Error("allowedIP must be an IP address or CIDR string");
  const allow = new BlockList();
  const parts = entry.split("/");
  const family = isIP(parts[0]);
  const bits = family === 4 ? 32 : 128;
  if (
    !family ||
    parts.length > 2 ||
    entry.includes("%") ||
    (parts.length === 2 &&
      (!/^(0|[1-9][0-9]*)$/.test(parts[1]) || Number(parts[1]) > bits))
  )
    throw new Error(`Invalid allowedIP: ${entry}`);
  const type = family === 4 ? "ipv4" : "ipv6";
  if (parts.length === 2) allow.addSubnet(parts[0], Number(parts[1]), type);
  else allow.addAddress(parts[0], type);
  return (address: string | undefined) => {
    if (!address) return false;
    const family = isIP(address);
    return !!family && allow.check(address, family === 4 ? "ipv4" : "ipv6");
  };
}
