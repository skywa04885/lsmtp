import dns from "dns";
import util from "util";

export class SmtpClientDNS {
  /**
   * Resolves the mail exchanges for the given hostname.
   * @param hostname the hostname to solve for.
   * @returns the string of exchanges ordered by priority.
   */
  public static async mx(hostname: string): Promise<string[]> {
    const results: dns.MxRecord[] = await util.promisify(dns.resolveMx)(
      hostname
    );

    return results
      .sort((a: dns.MxRecord, b: dns.MxRecord): number => {
        return a.priority > b.priority ? 1 : -1;
      })
      .map((record: dns.MxRecord): string => {
        return record.exchange;
      });
  }
}
