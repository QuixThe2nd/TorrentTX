import fs from 'fs';
import readline from 'readline';
import dgram from "dgram";
import transactionListener from './src/transaction_listener.js';
import {initClients} from './src/clients.js';
import Wallet from './src/wallet.js'
import Transaction from './src/transaction.js';
import Transactions from './src/transactions.js';
import WebTorrent from 'webtorrent';

if (!fs.existsSync('peers.txt'))
    fs.writeFileSync('peers.txt', '');
if (!fs.existsSync('infohashes.txt'))
    fs.writeFileSync('infohashes.txt', "");
if (!fs.existsSync('genesis.txt'))
    fs.writeFileSync('genesis.txt', "28a11d5eb078b4acd7a6867d7cde86d7dc719e93b76e79d0c5d52681c925267c");

var colorSet = {
    error: "\x1b[31m",
    info: "\x1b[32m",
    warn: "\x1b[33m",
    log: "\x1b[34m",
    verbose: "\x1b[90m",
};

console.verbose = console.log;

for (const type in colorSet) {
    const old = console[type];
    console[type] = function () {
        const args = Array.from(arguments);
        args.unshift(colorSet[type]);
        args.push("\x1b[0m");
        old.apply(console, args);
    };
}

if (!WebTorrent.WEBRTC_SUPPORT) {
    console.warn("WebRTC Not Supported");
}

const clients = initClients();

clients.wallet = new Wallet(clients);
clients.dgram = dgram.createSocket('udp4');
clients.webtorrent = new WebTorrent();
clients.transactions = new Transactions(clients);
clients.transactions.loadSavedTransactions();

clients.webtorrent.on('listening', () => {
    const address = clients.webtorrent.address();
    console.info(`Torrent client listening 0.0.0.0:${address.port}`);
});

clients.webtorrent.on('error', console.error);

clients.wallet.generateAddress();
const address = clients.wallet.wallet.getAddressString();
console.info("Address:", address);

transactionListener(clients);

const proofs = fs.readdirSync('proofs');
if (proofs.length > 0) {
    console.info("Proofs:");
    for (const i in proofs) {
        console.info(proofs[i]);
        new Transaction(clients, {torrentPath: `proofs/${proofs[i]}`});
    }
}

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

const userInput = async function (prompt){
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve, reject) => {
        rl.question(`\n============\n${prompt}\n============\n\n`, (input) => {
            rl.close();
            resolve(input);
        });
    });
}

const main = async () => {
    const torrents = clients.webtorrent.torrents;
    console.info("Transaction Count:", Object.keys(clients.transactions.transactions).length);
    const seedingTorrentCount = torrents.filter(torrent => torrent.done).length;
    console.info("Seeding Transactions:", seedingTorrentCount);
    const leechingTorrentCount = torrents.filter(torrent => !torrent.done).length;
    console.info("Downloading Transactions:", leechingTorrentCount);

    console.info("Ratio:", clients.webtorrent.ratio);
    console.info("Download Speed:", clients.webtorrent.downloadSpeed);
    console.info("Upload Speed:", clients.webtorrent.uploadSpeed);
    console.info("Progress:", clients.webtorrent.progress);

    const input = (await userInput("T = Transfer\nB = Balance\nG = Change Genesis\nS = Search\nP = Proof")).toLowerCase();
    if (input === 't') {
        console.log("Transfer");

        const amount = await userInput("Amount");
        if (!clients.transactions.balances[address] || amount > clients.transactions.balances[address]) {
            console.log("Insufficient balance");
            main();
            return;
        }

        const to = await userInput("To");
        const message = await userInput("Message");

        const transaction = new Transaction(clients, {from: address, to, amount, message});
        clients.transactions.addTransaction(transaction);
        console.log("Created Transaction:", transaction.content.hash);
        transaction.announce();
    } else if (input === 'g') {
        const genesisHash = await userInput("Transaction Hash");
        fs.writeFileSync(`genesis.txt`, genesisHash);

        const infohash = await userInput("Infohash");
        fs.writeFileSync('infohashes.txt', infohash);

        console.log("Genesis Transaction Set");
        console.log("Please restart the program");
        process.exit();
    } else if (input === 'b') {
        console.info("=====Balances=====");
        console.info("You:", clients.transactions.balances[address] ?? 0, "\n");
        const balances = clients.transactions.balances;
        for (const address in balances) {
            const balance = balances[address];
            console.info(`${address}: ${balance}`);
        }
        console.info("=====Balances=====");
    } else if (input === 's') {
        const query = await userInput("Search");
        console.info(clients.transactions.search(clients, {query}));
    } else if (input === 'p') {
        const query = await userInput("Transaction Hash");
        const torrent = await clients.transactions.search(clients, {query})['transactions'].getTorrent();
        console.info("Proof:", torrent.infoHash);
        fs.writeFileSync(`proofs/${query}.torrent`, torrent.torrentFile);
    }
    main();
};
main();