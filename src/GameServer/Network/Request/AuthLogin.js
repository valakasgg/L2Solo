const Shared         = invoke('GameServer/Network/Shared');
const ReceivePacket  = invoke('Packet/Receive');
const AccountName    = invoke('AccountName');

function authLogin(session, buffer) {
    const packet = new ReceivePacket(buffer);

    packet
        .readS()  // Username
        .readD()  // Session Key (last)
        .readD(); // Session Key (first)

    consume(session, {
        username: packet.data[0].trim(),
            key2: packet.data[1],
            key1: packet.data[2],
    });
}

function consume(session, data) { // TODO: Need to match the Session Keys
    // The auth server already refuses these, but a game-server connection can
    // be made directly.  Drop it rather than letting an unusable account name
    // reach character creation (#131).
    if (!AccountName.isValid(data.username)) {
        console.log(`GameServer :: rejected login, ${AccountName.reason(data.username)}`);
        session.close?.();
        return;
    }

    session.setAccountId(data.username);

    Shared.fetchCharacters(session.accountId).then((characters) => {
        Shared.enterCharacterHall(session, characters);
    });
}

module.exports = authLogin;
