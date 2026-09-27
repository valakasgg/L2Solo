const assert = require('assert');

require('../src/Global');

const AccountName = invoke('AccountName');

// --- Validator ------------------------------------------------------------

['test1', 'Test_1', 'a', 'player-01', 'A1234567890123'].forEach((name) => {
    assert.strictEqual(AccountName.isValid(name), true, `expected "${name}" to be accepted`);
});

// The exact strings reported in upstream issue #131.
assert.strictEqual(AccountName.isValid('ôtest1'), false, 'mangled login must be rejected');
assert.strictEqual(AccountName.isValid('âûôâôûâûôâôûâô'), false, 'all-bad login must be rejected');

assert.strictEqual(AccountName.reason('ôtest1'), 'non_ascii');
assert.strictEqual(AccountName.reason(''), 'empty');
assert.strictEqual(AccountName.reason('A12345678901234'), 'too_long');
assert.strictEqual(AccountName.reason('has space'), 'unsupported_characters');

[undefined, null, 42, {}, 'bad name', 'drop;table', 'a'.repeat(15)].forEach((name) => {
    assert.strictEqual(AccountName.isValid(name), false, `expected ${String(name)} to be rejected`);
});

// --- Auth server refuses the login instead of auto-creating an account ----

const authLogin = invoke('AuthenticationServer/Network/Request/AuthLogin');
const Database = invoke('Database');

const originalFetch = Database.fetchUserPassword;
const originalCreate = Database.createAccount;
const originalLog = console.log;

let lookups = 0;
let creates = 0;
Database.fetchUserPassword = (username) => { lookups += 1; return Promise.resolve([]); };
Database.createAccount = () => { creates += 1; return Promise.resolve(); };
console.log = () => {};

function attempt(username) {
    const sent = [];
    const session = { dataSend(packet) { sent.push(packet); } };
    // Exercise the account-name gate directly; the packet path above it is
    // covered by the RSA decipher in production.
    const consume = authLogin.consumeForTests || null;
    assert.ok(consume, 'authLogin must expose consumeForTests');
    consume(session, { username, password: 'x', sessionId: 1 });
    return { session, sent };
}

const bad = attempt('ôtest1');
console.log = originalLog;

assert.strictEqual(lookups, 0, 'rejected login must not reach the database');
assert.strictEqual(creates, 0, 'rejected login must not auto-create an account');
assert.strictEqual(bad.sent.length, 1, 'client must receive a login failure');

Database.fetchUserPassword = originalFetch;
Database.createAccount = originalCreate;

console.log('Account name validation checks passed');
