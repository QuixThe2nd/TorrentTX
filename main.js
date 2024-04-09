import fetch from 'node-fetch';
import fs from 'fs';
import readline from 'readline';
import WebTorrent from 'webtorrent';
import ethUtil from 'ethereumjs-util';
import bip39 from 'bip39';
import HDWallet from 'ethereumjs-wallet';
import dgram from "dgram";
const hdkey = HDWallet.hdkey;

const listenPort = 6901;

/*
TODO:
Instead of staking, users can create "bonds" with other users.
Technically, the protocol allows multiple tx json's in a single torrent file.
A bond is when 2 different addresses back eachother's funds 1:1.
This means, both nodes sign their own transactions to themselves, but they are both put in the same torrent file.
After a bond is made, either party can cancel the bond by re-signing the transaction with an added notice that the bond is cancelled.
The person who initiated the cancellation looses 5%, while the other party makes 5%.
People can form bonds to increase the chances of their funds being stored safely. But bonds are ultra-long term.
Because if you break a bond, you pay the other person 5%.


If a transaction is "lost". Someone can issue a request for the block, and someone else can re-seed the transaction.
The request can have a signed transfer attached, with the previous block marked as a UTXO.
This will mean your money is only valid if you can broadcast the original transaction.
*/

class Wallet {
    constructor(walletFilePath = 'wallet.json') {
        this.walletFilePath = walletFilePath;
        const keys = fs.existsSync(this.walletFilePath) ? this.loadKeys() : this.createKeys();
        for (const key in keys) {
            this[key] = keys[key];
        }
        this.getBalances()
    }

    generateAddress(path = "m/44'/60'/0'/0/0") {
        this.seed = bip39.mnemonicToSeedSync(this.mnemonic);
        this.hdWallet = hdkey.fromMasterSeed(this.seed);
        this.key = this.hdWallet.derivePath(path);
        this.wallet = this.key.getWallet();
    }

    createKeys() {
        console.log("Creating Keys");
        this.mnemonic = bip39.generateMnemonic();

        const walletData = {
            mnemonic: this.mnemonic
        };

        fs.writeFileSync(this.walletFilePath, JSON.stringify(walletData, null, 4));
        return walletData;
    }

    loadKeys() {
        console.log("Loading Keys");
        return JSON.parse(fs.readFileSync(this.walletFilePath));
    }

    signMessage(message) {
        // Ensure the message is a Buffer
        const messageBuffer = Buffer.from(message);
        // Hash the message to get a fixed-length hash
        const messageHash = ethUtil.keccak256(messageBuffer);
        // Get the private key from the wallet in Buffer format
        const privateKeyBuffer = this.wallet.getPrivateKey();
        // Sign the message hash using the private key
        const signatureObject = ethUtil.ecsign(messageHash, privateKeyBuffer);
        // Convert the signature to a hex string format
        const signatureHex = ethUtil.toRpcSig(signatureObject.v, signatureObject.r, signatureObject.s);
        return signatureHex;
    }

    verifySignature(message, signature, walletAddress) {
        const messageBuffer = Buffer.from(message);
        const messageHash = ethUtil.keccak256(messageBuffer);

        // Split the signature into its components
        const signatureBuffer = ethUtil.toBuffer(signature);
        const signatureParams = ethUtil.fromRpcSig(signatureBuffer);

        // Use ecrecover to obtain the public key that made the signature
        const publicKey = ethUtil.ecrecover(messageHash, signatureParams.v, signatureParams.r, signatureParams.s);

        // Get the wallet address from the public key
        const addressBuffer = ethUtil.pubToAddress(publicKey);
        const address = ethUtil.bufferToHex(addressBuffer);

        // Now, compare this address with the expected address
        // Assuming `walletAddress` is the address you expect the signature to come from
        return address.toLowerCase() === walletAddress.toLowerCase();
    }

    findUnusedUTXOs(address, amount) {
        const UTXOs = [];
        if (!fs.existsSync('transactions'))
            fs.mkdirSync('transactions');
        const transactions = fs.readdirSync('transactions');
        for (const i in transactions) {
            const file = transactions[i];
            const data = JSON.parse(fs.readFileSync(`transactions/${file}`));
            const { tx, signature, hash } = data;
            if (tx.to === address)
                UTXOs.push({tx, signature, hash});
        }

        // sort UTXOs by amount, lowest first
        UTXOs.sort((a, b) => a.tx.amount - b.tx.amount);

        // Loop through UTXOs from smallest to largest till you find one bigger than amount
        const selectedUTXOs = [];
        for (const i in UTXOs) {
            const UTXO = UTXOs[i];
            if (UTXO.tx.amount >= amount){
                selectedUTXOs.push(UTXO.hash);
                break;
            }
        }

        if (selectedUTXOs.length === 0)
            console.log("Can't find UTXO  (error de-escalated to warning on devnet)");
        //     throw new Error("Can't find UTXO")

        return selectedUTXOs;
    }

    createTransaction(from, to, amount, message) {
        const tx = {
            nonce: Math.random(),
            from: from,
            to: to,
            amount: amount / 1,
            message: message,
            prev: this.findUnusedUTXOs(from, amount),
        }
        const txString = JSON.stringify(tx);

        const hash = ethUtil.sha256(Buffer.from(txString)).toString('hex');

        const signature = this.signMessage(hash);
        return {
            tx,
            signature,
            hash
        }
    }

    getBalances() {
        // Get the balance of the address from transactions dir
        if(!fs.existsSync('transactions'))
            fs.mkdirSync('transactions');
        const transactions = fs.readdirSync('transactions');
        const balances = {};
        // const remaining_utxos = {};
        for (const i in transactions) {
            const file = transactions[i];
            const path = `transactions/${file}`;
            const { tx, signature, hash } = JSON.parse(fs.readFileSync(path).toString());
            const isValid = this.validateTransaction(tx, signature, hash);

            if (isValid) {
                // if (remaining_utxos[hash])
                //     remaining_utxos[hash] += tx.amount;
                // else
                //     remaining_utxos[hash] = tx.amount;
                // for (const i in tx.prev) {
                //     const hash = tx.prev[i];
                //     if (remaining_utxos[hash]) {
                //         remaining_utxos[hash] -= tx.amount;
                //     } else {
                //         remaining_utxos[hash] = -tx.amount;
                //     }
                // }

                if (balances[tx.to])
                    balances[tx.to] += tx.amount;
                else
                    balances[tx.to] = tx.amount;

                if (hash !== "a6d501fece933802ec51863c1248c5a29ec834bf392cc5eb919e7801da5d2284") { // If not genesis
                    if (balances[tx.from])
                        balances[tx.from] -= tx.amount;
                    else
                        balances[tx.from] = -tx.amount;
                }
            } else {
                console.log("Invalid transaction");
            }
        }
        this.balances = balances;
        return this.balances;
    }

    validateTransaction(tx, signature, hash) {
        return this.verifySignature(hash, signature, tx.from);
    }
}

const userInput = async function (prompt){
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve, reject) => {
        rl.question(prompt + ': ', (input) => {
            rl.close();
            resolve(input);
        });
    });
}

const client = new WebTorrent();
const wallet = new Wallet();
wallet.generateAddress();
const address = wallet.wallet.getAddressString();
console.log("Address:", address);

const receiveTransaction = (infohash) => {
    if (infohash.length !== 40 || !/^[0-9A-Fa-f]+$/.test(infohash)) {
        console.log("Invalid infohash");
        return;
    }

    const matchedTorrents = client.torrents.filter(torrent => torrent.path === `mempool/${infohash}`);
    if (matchedTorrents.length > 0) {
        for (const i in matchedTorrents) {
            const torrent = matchedTorrents[i];
            if (torrent.infoHash !== infohash) {
                console.log("Removing old torrent:", torrent.infoHash);
                torrent.destroy();
            }
        }
        console.log("Torrent is already being downloaded");
        return;
    }

    console.log("Receiving Transaction:", infohash);
    if (!fs.existsSync(`torrents/${infohash}.torrent`)) {
        try {
            client.add(infohash, {path: `mempool/${infohash}`, announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrent) => {
                console.log('Downloading Transaction:', torrent.infoHash);
                torrent.on('done', function () {
                    console.log('Client has finished downloading:', torrent.infoHash);

                    fs.readdir(`mempool/${infohash}`, (err, files) => {
                        for (const i in files) {
                            const file = files[i];
                            fs.readFile(`mempool/${infohash}/${file}`, 'utf8', (err, data) => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                                const {tx, signature, hash} = JSON.parse(data);
                                if (wallet.validateTransaction(tx, signature, hash)) {
                                    console.log("Valid Transaction");
                                    fs.writeFileSync(`transactions/${hash}.json`, data);
                                    fs.writeFileSync(`torrents/${infohash}.torrent`, torrent.torrentFile);
                                }
                            });
                        }
                        ;
                    });
                });
            });
        } catch(e) {
            console.log(e.message);
        }
    }else{
        console.log("Transaction already received");
    }
}

const transactionListener = () => {
    // setInterval(() => {
        fetch('https://ttx-dht.starfiles.co/transactions.txt?c=' + Math.random()).then(response => response.text()).then(data => {
            const infohashes = data.split('\n');
            for (const i in infohashes) {
                if (!fs.existsSync(`torrents/${infohashes[i]}.torrent`))
                    receiveTransaction(infohashes[i]);
            }
        });
    // }, 5000);

    if (!fs.existsSync('torrents'))
        fs.mkdirSync('torrents');
    if (!fs.existsSync('peers.txt'))
        fs.writeFileSync('peers.txt', `127.0.0.1:${listenPort}`);
    const torrents = fs.readdirSync('torrents')
        .map(file => file.replace('.torrent', ''))
    const peers = fs.readFileSync('./peers.txt')
        .toString().split('\n');

    const dgramClient = dgram.createSocket('udp4');

    dgramClient.on('listening', () => {
        const address = dgramClient.address();
        console.log(`Client listening ${address.address}:${address.port}`);

        for (const i in peers) {
            const peer = peers[i].split(':');
            dgramClient.send(JSON.stringify({torrents, peers}), peer[1], peer[0], (err) => {
                if (err) {
                    console.error(err);
                    dgramClient.close();
                }
            });
        }
    });

    dgramClient.on('message', (msg, rinfo) => {
        const payload = JSON.parse(msg.toString());
        console.log(`Received payload from ${rinfo.address}:${rinfo.port}`);

        if(payload['peers']) {
            const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...payload['peers']]);
            fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
        }

        if(payload['torrents']) {
            for (const i in payload['torrents']) {
                const infohash = payload['torrents'][i];
                receiveTransaction(infohash);
            }
        }

        if(!payload['pong']) {
            const response = {}

            response['peers'] = fs.readFileSync('./peers.txt').toString().split('\n');
            response['torrents'] = fs.readdirSync('./torrents').map(file => file.replace('.torrent', ''));
            response['pong'] = true;

            dgramClient.send(JSON.stringify(response), rinfo.port, rinfo.address, (err) => {
                if (err) {
                    console.error(err);
                    dgramClient.close();
                }
            });
        }
    });

    dgramClient.bind(listenPort);
};
transactionListener();

const transactions = fs.readdirSync('transactions');
for (const i in transactions) {
    const transaction = transactions[i];
    console.log("Seeding", transaction);
    client.seed(`transactions/${transaction}`,{announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrentEl) => {
        console.log('Seeding Started:', torrentEl.infoHash);
    });
}

const main = async () => {
    const input = (await userInput("T = Transfer, B = Balance, E = Exit")).toLowerCase();
    if (input === 't') {
        console.log("Transfer");

        const amount = await userInput("Amount");
        if (!wallet.balances[address] || amount > wallet.balances[address]) {
            console.log("Insufficient balance (error de-escalated to warning on devnet)");
            // main();
            // return;
        }

        const to = await userInput("To");
        const message = await userInput("Message");

        const { tx, signature, hash } = wallet.createTransaction(address, to, amount, message);
        console.log("Transaction:", tx);
        console.log("Transaction Signature:", signature);
        console.log("Transaction Hash:", hash);

        const txPath = `transactions/${hash}.json`;

        fs.writeFileSync(txPath, JSON.stringify({ tx, signature, hash }, null, 4));

        console.log("Creating Torrent")
        client.seed(txPath, {announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrent) => {
            console.log('Seeding:', torrent.infoHash);
            fs.writeFile( `torrents/${torrent.infoHash}.torrent`, torrent.torrentFile, (err) => {
                if (err)
                    return console.error('Failed to save the torrent file:', err);
                console.log('Torrent file saved successfully.');

                const peers = fs.readFileSync('./peers.txt')
                    .toString().split('\n');

                fetch('https://ttx-dht.starfiles.co/' + torrent.infoHash).then(response => response.text()).then(data => console.log(data));
                for (const i in peers) {
                    console.log('Broadcasting transaction to:', peers[i]);
                    const peer = peers[i].split(':');
                    const dgramClient = dgram.createSocket('udp4');
                    dgramClient.send(JSON.stringify({torrents: [torrent.infoHash]}), peer[1], peer[0], (err) => {
                        if (err) {
                            console.error(err);
                            dgramClient.close();
                        }
                    });
                }
            });
        });
    } else if (input === 'b') {
        console.log("Balances");
        console.log(wallet.getBalances());
    } else if (input === 'e') {
        return;
    }
    main();
};
main();