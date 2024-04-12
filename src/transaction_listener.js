import fs from "fs";
import Transaction from './transaction.js';

export default function transactionListener(clients) {
    fetch('https://ttx-dht.starfiles.co/peers.txt?c=' + Math.random()).then(response => response.text()).then(data => {
        for (const i in data.split('\n')) {
            const peer = data.split('\n')[i].split(':');
            if (!peer[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/))
                continue;
            if (peer[1] < 1024 || peer[1] > 65535)
                continue;
            const uniquePeers = new Set([...fs.readFileSync('./peers.txt').toString().split('\n'), data.split('\n')[i]]);
            fs.writeFileSync('./peers.txt', Array.from(uniquePeers).join('\n'));
        }
    });
    const pullFromDHT = () => {
        fetch('https://ttx-dht.starfiles.co/transactions.txt?c=' + Math.random()).then(response => response.text()).then(data => {
            const infohashes = data.split('\n');
            for (const i in infohashes) {
                new Transaction(clients, {infohash: infohashes[i]});
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
            if (!peer[0].match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/))
                continue;
            if (peer[1] < 1024 || peer[1] > 65535)
                continue;
            clients.dgram.send(JSON.stringify({torrents, peers}), peer[1], peer[0], (err) => {
                if (!err)
                    console.log('Sent payload to:', peers[i]);
                else
                    console.warn(err.code, 'Failed to send payload to:', peers[i]);
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
                new Transaction(clients, {infohash: payload['torrents'][i]});
            }
        }

        if(!payload['pong']) {
            const response = {
                torrents: fs.readFileSync('./infohashes.txt').toString().split('\n'),
                peers: fs.readFileSync('./peers.txt').toString().split('\n'),
                pong: true,
            };

            clients.dgram.send(JSON.stringify(response), rinfo.port, rinfo.address, (err) => {
                if (!err)
                    console.log('Sent payload to:', rinfo.address);
                else
                    console.warn(err.code, 'Failed to send payload to:', rinfo.address);
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