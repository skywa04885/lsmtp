export class SmtpMailbox {
  public constructor(
    public readonly address: string,
    public readonly name: string | null = null
  ) {}

  /**
   * Encodes the mailbox for commands such as VRFY and EXPN.
   * @returns the encoded address.
   */
  public encode(): string {
    if (!this.name || this.name.length === 0) {
      return `<${this.address}>`;
    }

    return `${this.name} <${this.address}>`;
  }
}
