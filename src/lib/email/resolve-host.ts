import { lookup } from "node:dns/promises";

/**
 * Connection options for an SMTP host, resolved through the operating
 * system's resolver (getaddrinfo).
 *
 * nodemailer resolves names itself with c-ares, which ignores some local
 * setups - a VPN or proxy that serves DNS on 127.0.0.1, for example - and
 * then times out with "queryA ETIMEOUT". Resolving here and connecting to the
 * address works everywhere the OS can resolve. `servername` keeps TLS
 * certificate checks against the real hostname, so nothing is weakened.
 */
export async function smtpHostOptions(host: string): Promise<{ host: string; tls: { servername: string } }> {
  try {
    const { address } = await lookup(host);
    return { host: address, tls: { servername: host } };
  } catch {
    // Let nodemailer try, and report, on its own.
    return { host, tls: { servername: host } };
  }
}
