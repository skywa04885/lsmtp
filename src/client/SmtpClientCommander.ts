import EventEmitter from "events";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";

export declare interface SmtpClientCommander {
    on(event: 'destroy', listener: () => void): this;
    on(event: 'ready', listener: () => void): this;
}

export class SmtpClientCommander extends EventEmitter {
    public assign(assignment: SmtpClientAssignment) {

    }
}