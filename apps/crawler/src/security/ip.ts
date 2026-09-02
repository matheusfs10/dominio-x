import ipaddr from "ipaddr.js";

/**
 * Destination address policy. Only globally routable unicast addresses are allowed.
 * Everything else (loopback, private, link-local incl. cloud metadata, CGNAT, multicast,
 * unspecified, documentation/benchmark, reserved, IPv4-embedded IPv6 forms) is blocked.
 */
export interface AddressVerdict {
  allowed: boolean;
  reason?: string;
  normalized: string;
}

const EXPLICIT_BLOCK = new Set([
  "169.254.169.254", // AWS/GCP/Azure/OpenStack metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "192.0.0.192", // Oracle Cloud metadata
  "fd00:ec2::254", // AWS IPv6 metadata
]);

const IPV4_BLOCKED_RANGES: [string, number, string][] = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier_grade_nat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link_local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "ietf_protocol_assignments"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "6to4_relay_deprecated"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
  ["255.255.255.255", 32, "broadcast"],
];

function classifyV4(addr: ipaddr.IPv4): AddressVerdict {
  const normalized = addr.toString();
  if (EXPLICIT_BLOCK.has(normalized))
    return { allowed: false, reason: "metadata_endpoint", normalized };
  for (const [net, bits, reason] of IPV4_BLOCKED_RANGES) {
    if (addr.match(ipaddr.IPv4.parse(net), bits)) return { allowed: false, reason, normalized };
  }
  return { allowed: true, normalized };
}

function classifyV6(addr: ipaddr.IPv6): AddressVerdict {
  const normalized = addr.toNormalizedString();
  if (EXPLICIT_BLOCK.has(normalized))
    return { allowed: false, reason: "metadata_endpoint", normalized };
  if (addr.isIPv4MappedAddress()) {
    const inner = classifyV4(addr.toIPv4Address());
    return inner.allowed
      ? { allowed: false, reason: "ipv4_mapped", normalized }
      : { allowed: false, reason: `ipv4_mapped:${inner.reason}`, normalized };
  }
  const range = addr.range();
  switch (range) {
    case "unicast":
      return { allowed: true, normalized };
    case "rfc6052": // 64:ff9b::/96 IPv4-embedded
    case "6to4": // 2002::/16
    case "teredo": // 2001::/32
    case "rfc6145":
      return { allowed: false, reason: `ipv4_embedded:${range}`, normalized };
    default:
      return { allowed: false, reason: range, normalized };
  }
}

export function classifyAddress(ip: string): AddressVerdict {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(ip.replace(/^\[|\]$/g, ""));
  } catch {
    return { allowed: false, reason: "unparseable", normalized: ip };
  }
  return parsed.kind() === "ipv4"
    ? classifyV4(parsed as ipaddr.IPv4)
    : classifyV6(parsed as ipaddr.IPv6);
}

export function isIpLiteral(host: string): boolean {
  return ipaddr.isValid(host.replace(/^\[|\]$/g, ""));
}
