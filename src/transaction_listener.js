import fs from "fs";
import dgram from "dgram";

const receiveTransaction = (wallet, torrentClient, infohash) => {

    if (fs.existsSync(`torrents/${infohash}.torrent`)) {
        // console.log('Torrent already known');
        return;
    }
    
    if (infohash.length !== 40 || !/^[0-9A-Fa-f]+$/.test(infohash)) {
        // console.log("Invalid infohash");
        return;
    }

    const matchedTorrents = torrentClient.torrents.filter(torrent => torrent.path === `mempool/${infohash}`);
    if (matchedTorrents.length > 0){
        // console.log('Torrent is already downloading');
        return;
    }

    console.log("\nReceived transaction:", infohash);
    console.log('Downloading Metadata', infohash)
    torrentClient.add(infohash, {path: `mempool/${infohash}`, announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrent) => {
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
                            wallet.recalculateBalances();

                            // Delete the transaction from the mempool
                            fs.unlink(`mempool/${infohash}/${file}`, (err) => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                                console.log('Transaction deleted from mempool');
                            });
                            wallet.checkMempool(torrentClient);
                        }
                    });
                };
            });
        });
    });
}

export default function transactionListener(wallet, torrentClient, dgramClient) {
    const transactions = fs.readdirSync('transactions');
    for (const i in transactions) {
        const transaction = transactions[i];
        console.log("Seeding", transaction);
        torrentClient.seed(`transactions/${transaction}`,{announce: ['udp://tracker.openbittorrent.com:80', 'wss://tracker.openwebtorrent.com/', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce', 'ws://tracker.files.fm:7072/announce']}, (torrentEl) => {
            console.log('Seeding Started:', torrentEl.infoHash);
        });
    }

    setInterval(() => {
        fetch('https://ttx-dht.starfiles.co/transactions.txt?c=' + Math.random()).then(response => response.text()).then(data => {
            const infohashes = data.split('\n');
            for (const i in infohashes) {
                receiveTransaction(wallet, torrentClient, infohashes[i]);
            }
        });
    }, 30000);

    dgramClient.on('listening', () => {
        const address = dgramClient.address();
        console.log(`Client listening ${address.address}:${address.port}`);

        const torrents = fs.readdirSync('torrents').map(file => file.replace('.torrent', ''));
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');

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
                receiveTransaction(wallet, torrentClient, infohash);
            }
        }

        if(!payload['pong']) {
            const response = {}

            response['torrents'] = fs.readdirSync('./torrents').map(file => file.replace('.torrent', ''));
            response['peers'] = fs.readFileSync('./peers.txt').toString().split('\n');
            response['pong'] = true;

            dgramClient.send(JSON.stringify(response), rinfo.port, rinfo.address, (err) => {
                if (err) {
                    console.error(err);
                    dgramClient.close();
                }
            });
        }
    });
}