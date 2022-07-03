export enum SmtpServerMessageFromType {
  Remote = 'REMOTE',
  Local = 'LOCAL',
}

export class SmtpServerMessageFrom {
  public constructor(
    public readonly type: SmtpServerMessageFromType,
    public readonly address: string
  ) {}
}