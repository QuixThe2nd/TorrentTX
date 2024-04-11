import fs from "fs";

export default function transactionListener(clients) {
    const transactions = fs.readdirSync('transactions');
    for (const i in transactions) {
        const hash = transactions[i].replace('.json', '');
        console.log("Seeding transaction:", hash);
        clients.torrents.seedTransaction(hash);
    }

    const pullFromDHT = () => {
        fetch('https://ttx-dht.starfiles.co/transactions.txt?c=' + Math.random()).then(response => response.text()).then(data => {
            const infohashes = data.split('\n');
            for (const i in infohashes) {
                clients.torrents.saveTransactionToMempool(infohashes[i]);
            }
        });
        setTimeout(() => pullFromDHT, 5000);
    };
    pullFromDHT();

    clients.dgram.on('listening', () => {
        const address = clients.dgram.address();
        console.log(`Client listening ${address.address}:${address.port}`);

        const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');

        for (const i in peers) {
            const peer = peers[i].split(':');
            clients.dgram.send(JSON.stringify({torrents, peers}), peer[1], peer[0], (err) => {
                if (err) {
                    console.error(err);
                    clients.dgram.close();
                }
            });
        }
    });

    clients.dgram.on('message', (msg, rinfo) => {
        const payload = JSON.parse(msg.toString());
        console.log(`Received payload from ${rinfo.address}:${rinfo.port}`);

        if(payload['peers']) {
            const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...payload['peers']]);
            fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
        }

        if(payload['torrents']) {
            for (const i in payload['torrents']) {
                const infohash = payload['torrents'][i];
                clients.torrents.saveTransactionToMempool(infohash);
            }
        }

        if(!payload['pong']) {
            const response = {
                torrents: fs.readFileSync('./infohashes.txt').toString().split('\n'),
                peers: fs.readFileSync('./peers.txt').toString().split('\n'),
                pong: true,
            };

            clients.dgram.send(JSON.stringify(response), rinfo.port, rinfo.address, (err) => {
                if (err) {
                    console.error(err);
                    clients.dgram.close();
                }
            });
        }
    });
}