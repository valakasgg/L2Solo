const ServerResponse = invoke('AuthenticationServer/Network/Response');
const ReceivePacket  = invoke('Packet/Receive');
const Database       = invoke('Database');
const AccountName    = invoke('AccountName');

function authLogin(session, buffer) {
    const packet = new ReceivePacket(buffer);

    packet
        .readB(128) // Enciphered Block
        .readD();   // Session ID

    const deciphered = require('rsa-raw').decipher(
        packet.data[0]
    );

    consume(session, {
        username: utils.stripNull(deciphered.slice(0x62, 0x62 + 14)).trim(),
        password: utils.stripNull(deciphered.slice(0x70, 0x70 + 16)).trim(),
        sessionId: packet.data[1],
    });
}

function consume(session, data) {
    // Refuse logins the client mangled with a non-Latin keyboard layout
    // instead of auto-creating an account the player never typed (#131).
    if (!AccountName.isValid(data.username)) {
        console.log(`AuthServer :: rejected login, ${AccountName.reason(data.username)}`);
        return failure(session, 0x03); // USER_OR_PASS_WRONG
    }

    Database.fetchUserPassword(data.username).then((rows) => {
        const account = rows[0];
        const password = account?.password;

        // Username exists in database
        if (password) {
            data.password === password ? passwordMatch(session, account.username) : failure(session, 0x02);
        }
        else { // User account does not exist, create if needed
            const optn = options.default.AuthServer;

            if (optn.autoCreate) {
                Database.createAccount(data.username, data.password).then(() => {
                    consume(session, data);
                });
            }
            else { // Auto-create not permitted
                failure(session, 0x04);
            }
        }
    });
}

function passwordMatch(session, username) {
    session.setAccountId(username);
    session.dataSend(ServerResponse.loginSuccess(session));
}

function failure(session, reason) {
    session.dataSend(ServerResponse.loginFail(reason));
}

module.exports = authLogin;
// Exposed so the account-name gate can be tested without an RSA block.
module.exports.consumeForTests = consume;
