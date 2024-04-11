import os from 'os';
import fs from 'fs';
import fetch from 'node-fetch';
import readline from 'readline';
import dgram from "dgram";
import transactionListener from './src/transaction_listener.js';
import {initClients} from './src/clients.js';
import Wallet from './src/wallet.js'
import Torrents from './src/torrents.js';

if(!fs.existsSync('transactions'))
    fs.mkdirSync('transactions');
if (!fs.existsSync('peers.txt'))
    fs.writeFileSync('peers.txt', `127.0.0.1:${listenPort}`);
if (!fs.existsSync('infohashes.txt'))
    fs.writeFileSync('infohashes.txt', "28a11d5eb078b4acd7a6867d7cde86d7dc719e93b76e79d0c5d52681c925267c");

const clients = initClients();

clients.wallet = new Wallet;
clients.dgram = dgram.createSocket('udp4');
clients.torrents = new Torrents;

const interfaces = os.networkInterfaces();
const ipAddresses = [];
for (let i in interfaces) {
    for (let interfaceInfo of interfaces[i]) {
        if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal)
            ipAddresses.push(interfaceInfo.address);
    }
}

let listenPort = 6901;
for (; listenPort < 7000; listenPort++){
    try {
        clients.dgram.bind(listenPort);
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');
        if (!peers.includes(`127.0.0.1:${listenPort}`)) {
            peers.push(`127.0.0.1:${listenPort}`);
            fs.writeFileSync('./peers.txt', peers.join('\n'));
        }
        break
    } catch(err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${listenPort} is already in use`);
            listenPort++;
        }else console.error(err.code);
    }
}

// write ip:port to peers.txt if not exists
const peers = fs.readFileSync('./peers.txt').toString().split('\n');
fs.writeFileSync('./peers.txt', Array.from(new Set([...peers, `${ipAddresses[0]}:${listenPort}`]).values()).join('\n'));

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
        rl.question(prompt + ': ', (input) => {
            rl.close();
            resolve(input);
        });
    });
}

clients.wallet.generateAddress();
const address = clients.wallet.wallet.getAddressString();
console.log("Address:", address);

transactionListener(clients);

const main = async () => {
    const torrents = clients.torrents.getTorrents();
    const transactionCount = fs.readdirSync('transactions').length;
    console.log("Transaction Count:", transactionCount);
    const seedingTorrentCount = torrents.filter(torrent => torrent.done).length;
    console.log("Seeding Transactions:", seedingTorrentCount);
    const leechingTorrentCount = torrents.filter(torrent => !torrent.done).length;
    console.log("Downloading Transactions:", leechingTorrentCount);

    clients.wallet.recalculateBalances();
    clients.wallet.checkTransactionDag();
    clients.wallet.recalculateBalances();
    const balances = clients.wallet.balances;
    console.log("Balances:", balances);

    const input = (await userInput("T = Transfer, B = Balance, R = Refresh,  A = Address, D = Delete Transaction Dag")).toLowerCase();
    if (input === 't') {
        console.log("Transfer");

        const amount = await userInput("Amount");
        if (!clients.wallet.balances[address] || amount > clients.wallet.balances[address]) {
            console.log("Insufficient balance");
            main();
            return;
        }

        const to = await userInput("To");
        const message = await userInput("Message");

        const { tx, signature, hash } = clients.wallet.createTransaction(address, to, amount, message);
        console.log("Transaction:", tx);
        console.log("Transaction Signature:", signature);
        console.log("Transaction Hash:", hash);

        fs.writeFileSync(`transactions/${hash}.json`, JSON.stringify({ tx, signature, hash }, null, 4));

        console.log("Creating Torrent");
        clients.torrents.seedTransaction(hash);
        clients.torrents.getTransactionInfohash(hash).then(infohash => {
            const peers = fs.readFileSync('./peers.txt').toString().split('\n');
            fetch('https://ttx-dht.starfiles.co/' + infohash).then(response => response.text()).then(data => console.log(data));
            for (const i in peers) {
                console.log('Broadcasting transaction to:', peers[i]);
                const peer = peers[i].split(':');
                clients.dgram.send(JSON.stringify({torrents: [infohash]}), peer[1], peer[0], (err) => {
                    if (err) {
                        console.error(err);
                    }
                });
            }
        }).catch(err => {
            console.error(err);
        });
    } else if (input === 'b') {
        console.log("Balances");
        clients.wallet.recalculateBalances();
        console.log(clients.wallet.balances);
    } else if (input === 'r') {
        console.log("Refreshing");
        // Do nothing cause we refresh every loop
    } else if (input === 'd') {
        console.log("Deleting Transaction Dag");
        fs.rmdirSync('transactions', {recursive: true});
        fs.rmdirSync('mempool', {recursive: true});
        fs.mkdirSync('transactions');
        fs.mkdirSync('mempool');
        clients.wallet.balances = {};
        clients.torrents.clearTorrents();
        console.log("Torrent Transaction Deleted");
    } else if (input === 'a') {
        console.log("Address:", address);
    }
    main();
};
main();