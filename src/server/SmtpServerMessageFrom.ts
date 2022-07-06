import {EmailAddress} from "llibemailaddress";

export enum SmtpServerMessageFromType {
  Remote = 'REMOTE',
  Local = 'LOCAL',
}

export class SmtpServerMessageFrom {
  /**
   * Constructs a new from address.
   * @param type the type.
   * @param email the E-Mail address.
   */
  public constructor(
    public readonly type: SmtpServerMessageFromType,
    public readonly email: EmailAddress
  ) {}

  /**
   * Gets the username.
   */
  public get username(): string {
    return this.email.username;
  }

  /**
   * Gets the hostname.
   */
  public get hostname(): string {
    return this.email.hostname;
  }
}