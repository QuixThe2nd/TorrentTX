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

    let listenPort = 6901;
    const findPortAndBind = () => {
        if (listenPort >= 7000) {
            console.log('Failed to bind to any port in the specified range.');
            return;
        }

        console.log(`Trying to listen on port ${listenPort}`);
        clients.dgram.bind(listenPort);
    };

    clients.dgram.on('error', (err) => {
        console.log('test');
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${listenPort} is already in use, trying next available port.`);
            listenPort++;
            findPortAndBind();
        } else {
            console.error(`Server error: ${err.code}`);
            clients.dgram.close();
        }
    });

    findPortAndBind();

    clients.dgram.on('listening', () => {
        const address = clients.dgram.address();
        console.log(`Client listening ${address.address}:${address.port}`);

        const torrents = fs.readFileSync('./infohashes.txt').toString().split('\n');
        const peers = fs.readFileSync('./peers.txt').toString().split('\n');

        for (const i in peers) {
            const peer = peers[i].split(':');
            clients.dgram.send(JSON.stringify({torrents, peers}), peer[1], peer[0], (err) => {
                if (err) {
                    if (err.code === 'ENOTFOUND')
                        console.warn('Failed to send payload to:', peers[i]);
                    else if (err.code === 'EHOSTUNREACH')
                        console.warn('Failed to send payload to:', peers[i]);
                    else
                        console.warn(err);
                } else {
                    console.log('Sent payload to:', peers[i]);
                }
            });
        }
    });

    clients.dgram.on('message', (msg, rinfo) => {
        const payload = JSON.parse(msg.toString());
        console.log(`Received payload from ${rinfo.address}:${rinfo.port}`);

        // insert sender into peers list
        const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), `${rinfo.address}:${rinfo.port}`]);
        fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));

        if (payload['peers']) {
            const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), ...payload['peers']]);
            fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
        }

        if (payload['torrents']) {
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

    let connections = 0;
    clients.dgram.on('connect', () => {
        console.log('Client connected');
        connections++;
        console.log('Connections:', connections);
    });

    clients.dgram.on('close', () => {
        console.log('Client closed');
        connections--;
        console.log('Connections:', connections);
    });
}