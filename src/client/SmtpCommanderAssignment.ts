import { Readable } from "stream";

export interface SmtpClientAssignment {
    // Data.
    from: string;
    to: string[];
    data: Readable;
    // Callbacks.
    callback: (err: Error | null) => void;
}
