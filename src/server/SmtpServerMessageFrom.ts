export enum SmtpServerMessageFromType {
  Remote = 'REMOTE',
  Local = 'LOCAL',
}

export class SmtpServerMessageFrom {
  /**
   * Constructs a new from address.
   * @param type the type.
   * @param address the address.
   */
  public constructor(
    public readonly type: SmtpServerMessageFromType,
    public readonly address: string
  ) {}

  /**
   * Gets the username.
   */
  public get username(): string {
    return this.address.split('@')[0]!;
  }

  /**
   * Gets the domain.
   */
  public get domain(): string {
    return this.address.split('@')[1]!;
  }
}