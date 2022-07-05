import util from "util";
import dns from "dns";

export class SmtpMailExchanges {
  protected _hostname: string;
  protected _exchanges: dns.MxRecord[];
  protected _exchange_index: number = 0;

  /**
   * Constructs a new SmtpMailExchanges class.
   * @param hostname the hostname.
   * @param exchanges the exchanges.
   */
  public constructor(hostname: string, exchanges: dns.MxRecord[]) {
    this._hostname = hostname;
    this._exchanges = exchanges;
  }

  /**
   * Gets all the exchanges.
   */
  public get exchanges(): dns.MxRecord[] {
    return this._exchanges;
  }

  /**
   * Gets the hostname.
   */
  public get hostname(): string {
    return this._hostname;
  }

  /**
   * Gets one of the mail exchanges.
   */
  public get exchange(): dns.MxRecord {
    const exchange: dns.MxRecord = this._exchanges[this._exchange_index];
    this._exchange_index = (this._exchange_index + 1) % this._exchanges.length;
    return exchange;
  }

  /**
   * Gets the MX records from the given hostname.
   * @param hostname the hostname.
   */
  public static async resolve(hostname: string): Promise<SmtpMailExchanges> {
    const records: dns.MxRecord[] = await util.promisify(dns.resolveMx)(
      hostname
    );
    return new SmtpMailExchanges(hostname, records);
  }
}
