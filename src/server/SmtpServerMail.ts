import { SmtpServerMessageTarget } from "./SmtpServerMessageTarget";

export interface SmtpServerMailMeta {
    remote_address: string,
    remote_family: string,
    remote_port: number,
    secure: boolean,
    remote_domain: string,
    date: Date,

}

export class SmtpServerMail {
    public constructor(public readonly contents: string, public readonly from: string, public readonly to: SmtpServerMessageTarget[], public readonly meta: SmtpServerMailMeta) { }
}