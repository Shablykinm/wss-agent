const crypto = require('crypto');

function signChallenge(challenge, privateKeyPem) {
    const signature = crypto.sign(null, Buffer.from(challenge), {
        key: privateKeyPem,
        format: 'pem',
        type: 'pkcs8'
    });
    return signature.toString('base64');
}

module.exports = { signChallenge };