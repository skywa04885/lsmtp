import { TLSSocketOptions } from "tls";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpUser } from "../shared/SmtpUser";
import { SmtpServerConnection } from "./SmtpServerConnection";
import { SmtpServerMail } from "./SmtpServerMail";
import { XOATH2Token } from "lxoauth2/dist/XOAUTH2Token";
import { SmtpServerMessageTarget } from "./SmtpServerMessageTarget";
import { SmtpServerMessageFrom } from "./SmtpServerMessageFrom";

export enum SmtpServerFeatureFlag {
  Chunking = 1 << 0, // Chunking and BinaryMIME.
  Vrfy = 1 << 1, // VRFY command.
  Expn = 1 << 2, // EXPN command.
  XClient = 1 << 3, // XClient command.
  XForward = 1 << 4, // XForward command.
  Auth = 1 << 5, // Authentication.
  EightBitMime = 1 << 6, // 8BITMIME.
}

export interface SmtpServerConfigCallbacks {
  handle_mail_from: (
    address: string,
    connection: SmtpServerConnection
  ) => Promise<SmtpServerMessageFrom | Error>;
  handle_rcpt_to: (
    target: SmtpServerMessageTarget,
    connection: SmtpServerConnection
  ) => Promise<null | Error>;
  verify_name: (
    name: string,
    connection: SmtpServerConnection
  ) => Promise<SmtpMailbox[]>;
  verify_mailbox: (
    mailbox: string,
    connection: SmtpServerConnection
  ) => Promise<SmtpMailbox | null>;
  handle_mail: (
    mail: SmtpServerMail,
    connection: SmtpServerConnection
  ) => Promise<Error | null>;
  get_user: (
    user: string,
    connection: SmtpServerConnection
  ) => Promise<SmtpUser | null>;
  password_compare: (pass: string, hash: string) => Promise<boolean>;
  verify_xoath2: (
    token: XOATH2Token,
    connection: SmtpServerConnection
  ) => Promise<SmtpUser | null>;
}

export class SmtpServerConfig {
  public constructor(
    public readonly callbacks: SmtpServerConfigCallbacks,
    public readonly domain: string,
    public readonly enabled_features: number,
    public readonly size_limit: number | null,
    public readonly tls_config: TLSSocketOptions
  ) {}

  /**
   * Checks if the given feature is enabled.
   * @param feature the feature to check.
   * @returns if the feature is enabled.
   */
  public feature_enabled(feature: SmtpServerFeatureFlag): boolean {
    return (this.enabled_features & feature) !== 0;
  }
}
