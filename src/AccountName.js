// Account name validation.
//
// The C4 client can emit non-ASCII bytes in the login field when the OS
// keyboard layout was non-Latin at client start, even after the user switches
// back to English (see upstream issue #131).  Two failures follow from that:
//
//   1. "test1" arrives as "ôtest1" and silently auto-creates a second account,
//      so the player lands in an empty character hall next session.
//   2. A login made entirely of such bytes can reach character creation and
//      crash the server on a rejected account lookup.
//
// Rejecting the login outright is preferred over stripping the bad bytes:
// stripping still resolves to an account the player did not type.

const MAX_LENGTH = 14; // Client login field width.
const PATTERN = /^[A-Za-z0-9_-]{1,14}$/;

function isValid(name) {
    return typeof name === 'string' && PATTERN.test(name);
}

// Characters the client may legitimately produce that we still reject, kept
// separate from `isValid` so callers can log why a login was refused.
function reason(name) {
    if (typeof name !== 'string' || name.length === 0) return 'empty';
    if (name.length > MAX_LENGTH) return 'too_long';
    // eslint-disable-next-line no-control-regex
    if (/[^\x20-\x7E]/.test(name)) return 'non_ascii';
    return 'unsupported_characters';
}

module.exports = { isValid, reason, MAX_LENGTH, PATTERN };
