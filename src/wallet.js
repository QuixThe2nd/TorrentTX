import fs from 'fs';
import ethUtil from 'ethereumjs-util';
import bip39 from 'bip39';
import HDWallet from 'ethereumjs-wallet';
import { sign } from 'crypto';

const hdkey = HDWallet.hdkey;

export default class Wallet {
    constructor(walletFilePath = 'wallet.json') {
        this.balances = {};
        this.walletFilePath = walletFilePath;
        this.genesisHash = fs.readFileSync('genesis.txt').toString().trim();

        const keys = fs.existsSync(this.walletFilePath) ? this.loadKeys() : this.createKeys();
        for (const key in keys) {
            this[key] = keys[key];
        }

        this.recalculateBalances();
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

        if (selectedUTXOs.length === 0) {
            // Sort UTXOs by amount, largest first
            UTXOs.sort((a, b) => b.tx.amount - a.tx.amount);

            let total = 0;
            for (const i in UTXOs) {
                const UTXO = UTXOs[i];
                selectedUTXOs.push(UTXO.hash);
                total += UTXO.tx.amount;
                if (total >= amount)
                    break;
            }
        }

        if (selectedUTXOs.length === 0) {
            console.log("Can't find UTXO");
            throw new Error("Can't find UTXO")
        }

        return selectedUTXOs;
    }

    createTransaction(from, to, amount, message, isGenesis) {
        const tx = {
            nonce: Math.random(),
            from: from,
            to: to,
            amount: amount / 1,
            message: message,
            prev: isGenesis ? [] : this.findUnusedUTXOs(from, amount),
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

    recalculateBalances() {
        // Get the balance of the address from transactions dir
        const transactions = fs.readdirSync('transactions');
        const balances = {};
        const remaining_utxos = {};
        for (const i in transactions) {
            const file = transactions[i];
            const path = `transactions/${file}`;
            const { tx, signature, hash } = JSON.parse(fs.readFileSync(path).toString());
            const isValid = this.validateTransaction(tx, signature, hash);

            if (isValid) {
                if (remaining_utxos[hash])
                    remaining_utxos[hash] += tx.amount;
                else
                    remaining_utxos[hash] = tx.amount;
                for (const i in tx.prev) {
                    const hash = tx.prev[i];
                    if (remaining_utxos[hash])
                        remaining_utxos[hash] -= tx.amount;
                    else
                        remaining_utxos[hash] = -tx.amount;
                }

                if (balances[tx.to])
                    balances[tx.to] += tx.amount;
                else
                    balances[tx.to] = tx.amount;

                if (hash !== this.genesisHash) {
                    if (balances[tx.from])
                        balances[tx.from] -= tx.amount;
                    else
                        balances[tx.from] = -tx.amount;
                }
            } // else console.log("Invalid transaction:", tx);
        }
        console.log('Remaining UTXOs', remaining_utxos);
        this.balances = balances;
        return this.balances;
    }

    calculateBalanceState() {
        const supply = Object.values(this.balances).reduce((a, b) => a + b, 0);
        const usedAddresses = Object.keys(this.balances).length;
        const transactionCount = fs.readdirSync('transactions').length;
        const hash = ethUtil.sha256(Buffer.from(JSON.stringify(this.balances, null, 4))).toString('hex');
        console.log('Supply', supply);
        console.log('Used Addresses', usedAddresses);
        console.log('Transaction Count', transactionCount);
        console.log('Hash', hash);
        const state = `${hash}.${supply}.${usedAddresses}.${transactionCount}`;
        return state;
    }

    validateTransaction(tx, signature, hash) {
        if(hash === this.genesisHash)
            return true;
        if(!this.balances[tx.from] || this.balances[tx.from] < tx.amount)
            return false;
        const prev = tx['prev'];
        if (prev.length == 0)
            return false;
        for (const i in prev) {
            const prevTx = prev[i];
            if (!fs.existsSync(`transactions/${prevTx}.json`))
                return false;
        }
        return this.verifySignature(hash, signature, tx.from);
    }

    checkTransactionDag() {
        const transactions = fs.readdirSync('transactions');
        for (const i in transactions) {
            const transaction = transactions[i];
            const data = JSON.parse(fs.readFileSync(`transactions/${transaction}`));
            const { tx, signature, hash } = data;
            if (!this.validateTransaction(tx, signature, hash)) {
                fs.unlink(`transactions/${transaction}`, (err) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    console.log('Transaction deleted');
                });
            }
        }
    }

    checkMempool(clients) {
        const mempool = fs.readdirSync('mempool');
        for (const i in mempool) {
            const infohash = mempool[i];
            const files = fs.readdirSync(`mempool/${infohash}`);
            for (const j in files) {
                const file = files[j];
                const data = JSON.parse(fs.readFileSync(`mempool/${infohash}/${file}`));
                const { tx, signature, hash } = data;
                if (this.validateTransaction(tx, signature, hash)) {
                    fs.writeFileSync(`transactions/${hash}.json`, JSON.stringify(data, null, 4));
                    const torrent = clients.torrents.torrentClient.torrents.find(torrent => torrent.path === `mempool/${infohash}`);
                    if(torrent)
                        torrent.destroy();
                    clients.torrents.seedTransaction(hash);
                    fs.unlink(`mempool/${file}`, (err) => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                        console.log('Transaction deleted from mempool');
                    });
                    if (fs.readdirSync('mempool').length === 0)
                        fs.rmdirSync('mempool');
                }
            }
        }
    }
}