import { BlockList, isIP } from "node:net";

export const defaultAllowedIP = "127.0.0.1";

/** Compile once at startup; forwarded headers are deliberately not inputs. */
export function createIPFilter(
  entry: unknown = defaultAllowedIP,
  setting = "allowedIP",
) {
  if (typeof entry !== "string")
    throw new Error(`${setting} must be an IP address or CIDR string`);
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
    throw new Error(`Invalid ${setting}: ${entry}`);
  const type = family === 4 ? "ipv4" : "ipv6";
  if (parts.length === 2) allow.addSubnet(parts[0], Number(parts[1]), type);
  else allow.addAddress(parts[0], type);
  return (address: string | undefined) => {
    if (!address) return false;
    const family = isIP(address);
    return !!family && allow.check(address, family === 4 ? "ipv4" : "ipv6");
  };
}

function normalizeIP(address: string | undefined): string | undefined {
  if (!address || address.includes("%")) return;
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  // Use one login-rate-limit key for IPv4 and its mapped IPv6 representation.
  if (canonical.startsWith("::ffff:")) {
    const words = canonical
      .slice(7)
      .split(":")
      .map((word) => parseInt(word, 16));
    return [words[0] >> 8, words[0] & 255, words[1] >> 8, words[1] & 255].join(
      ".",
    );
  }
  return canonical;
}

export function createClientIPResolver(trustedProxy?: string) {
  const isTrusted =
    trustedProxy === undefined
      ? () => false
      : createIPFilter(trustedProxy, "trustedProxy");
  return (
    peer: string | undefined,
    forwarded: string | null,
  ): string | undefined => {
    const direct = normalizeIP(peer);
    if (!direct || !isTrusted(direct)) return direct;
    if (!forwarded || forwarded.length > 4096) return;
    const entries = forwarded.split(",");
    if (entries.length > 32) return;
    const addresses = entries.map((entry) => normalizeIP(entry.trim()));
    if (addresses.some((address) => !address)) return;
    for (let i = addresses.length - 1; i >= 0; i--) {
      if (!isTrusted(addresses[i])) return addresses[i];
    }
    // A chain containing only proxies does not identify an actual client.
    return;
  };
}
