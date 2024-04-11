import fetch from 'node-fetch';
import fs from 'fs';
import readline from 'readline';
import WebTorrent from 'webtorrent';
import dgram from "dgram";
import transactionListener from './src/transaction_listener.js';
import Wallet from './src/wallet.js'

const listenPort = 6901;
for (; listenPort < 7000; listenPort++){
    try {
        // dgramClient.bind(listenPort);
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

if (!fs.existsSync('torrents'))
    fs.mkdirSync('torrents');
if(!fs.existsSync('transactions'))
    fs.mkdirSync('transactions');
if (!fs.existsSync('peers.txt'))
    fs.writeFileSync('peers.txt', `127.0.0.1:${listenPort}`);

const torrentClient = new WebTorrent();
const wallet = new Wallet();
const dgramClient = dgram.createSocket('udp4');

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

wallet.generateAddress();
const address = wallet.wallet.getAddressString();
console.log("Address:", address);

transactionListener(wallet, torrentClient, dgramClient);

const main = async () => {
    const transactionCount = fs.readdirSync('transactions').length;
    console.log("Transaction Count:", transactionCount);
    const torrentCount = fs.readdirSync('torrents').length;
    console.log("Torrent Count:", torrentCount);
    const loadedTorrentsCount = torrentClient.torrents.length;
    console.log("Loaded Torrents Count:", loadedTorrentsCount);
    const seedingTorrentsCount = torrentClient.torrents.filter(torrent => torrent.done).length;
    console.log("Seeding Torrents Count:", seedingTorrentsCount);
    const leechingTorrentsCount = torrentClient.torrents.filter(torrent => !torrent.done).length;
    console.log("Leeching Torrents Count:", leechingTorrentsCount);

    wallet.recalculateBalances();
    wallet.checkTransactionDag();
    wallet.recalculateBalances();
    const balances = wallet.balances;
    console.log("Balances:", balances);

    const input = (await userInput("T = Transfer, B = Balance, R = Refresh, E = Exit, D = Delete Transaction Dag")).toLowerCase();
    if (input === 't') {
        console.log("Transfer");

        const amount = await userInput("Amount");
        if (!wallet.balances[address] || amount > wallet.balances[address]) {
            console.log("Insufficient balance");
            main();
            return;
        }

        const to = await userInput("To");
        const message = await userInput("Message");

        const { tx, signature, hash } = wallet.createTransaction(address, to, amount, message);
        console.log("Transaction:", tx);
        console.log("Transaction Signature:", signature);
        console.log("Transaction Hash:", hash);

        const txPath = `transactions/${hash}.json`;

        fs.writeFileSync(txPath, JSON.stringify({ tx, signature, hash }, null, 4));

        console.log("Creating Torrent");
        torrentClient.seed(txPath, {announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrent) => {
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
                    dgramClient.send(JSON.stringify({torrents: [torrent.infoHash]}), peer[1], peer[0], (err) => {
                        if (err) {
                            console.error(err);
                        }
                    });
                }
            });
        });
    } else if (input === 'b') {
        console.log("Balances");
        wallet.recalculateBalances();
        console.log(wallet.balances);
    } else if (input === 'r') {
        console.log("Refreshing");
        // Do nothing cause we refresh every loop
    } else if (input === 'e') {
        return;
    } else if (input === 'd') {
        console.log("Deleting Transaction Dag");
        fs.rmdirSync('transactions', {recursive: true});
        fs.rmdirSync('torrents', {recursive: true});
        fs.rmdirSync('mempool', {recursive: true});
        fs.mkdirSync('transactions');
        fs.mkdirSync('torrents');
        fs.mkdirSync('mempool');
        wallet.balances = {};
        console.log("Torrent Transaction Deleted");
    }
    main();
};
main();