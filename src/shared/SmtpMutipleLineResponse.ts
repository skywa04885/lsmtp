import { LINE_SEPARATOR, SEGMENT_SEPARATOR } from "./SmtpConstants";
import { SmtpResponse } from "./SmtpResponse";
import { SmtpSocket } from "./SmtpSocket";

export class SmtpMultipleLineRespons {
    /**
     * Writes a multiple line response, using a callback method.
     * @param smtp_socket the smtp socket.
     * @param response the response.
     * @param cb the callback to get lines from.
     * @param prefix the prefix char.
     */
    public static write_line_callback(smtp_socket: SmtpSocket, response: SmtpResponse, cb: (index: number) => { v: string, n: boolean }, prefix: string = '-') {
        let i: number = 0;
        let { v, n } = cb(i++);

        // Writes the initial response (modified version of encode).
        {
            let arr: string[] = [];
    
            if (response.enhanced_status_code !== null) {
                arr.push(response.enhanced_status_code.encode());
            }
    
            if (response.message !== null) {
                if (typeof (response.message) === 'string') {
                    arr.push(response.message.trim());
                } else {
                    for (const message_item of response.message) {
                        arr.push(message_item.trim());
                    }
                }
            }
    
            smtp_socket.write(`${response.status.toString()}${n ? prefix : ' '}${arr.join(SEGMENT_SEPARATOR)}${LINE_SEPARATOR}`);
        }

        // Returns if there is nothing to write anyways.
        if (!n) {
            return;
        }

        // Writes the lines.
        while (true) {
            // Writes the line.
            if (n) {
                smtp_socket.write(`${response.status}${prefix}${v}${LINE_SEPARATOR}`);
            } else {
                smtp_socket.write(`${response.status} ${v}${LINE_SEPARATOR}`);
            }

            // If there is no next value break.
            if (!n) {
                break;
            }

            // Gets the next callback value.
            let new_values = cb(i++);
            v = new_values.v;
            n = new_values.n;
        }
    }
}