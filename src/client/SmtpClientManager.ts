import { SmtpClient } from "./SmtpClient";
import { SmtpClientAssignment } from "./SmtpClientAssignment";

export class SmtpClientManager {
    protected _connections: {[key: string]: SmtpClient} = {}; // the key is the hostname.
    
    public async assign(hostname: string, assignment: SmtpClientAssignment): Promise<void> {
        if (!this._connections[hostname]) {

        }
    }
}