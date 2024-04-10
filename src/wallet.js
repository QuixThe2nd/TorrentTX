import fs from 'fs';
import ethUtil from 'ethereumjs-util';
import bip39 from 'bip39';
import HDWallet from 'ethereumjs-wallet';

const hdkey = HDWallet.hdkey;

export default class Wallet {
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
                    if (remaining_utxos[hash]) {
                        remaining_utxos[hash] -= tx.amount;
                    } else {
                        remaining_utxos[hash] = -tx.amount;
                    }
                }

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
        console.log(remaining_utxos);
        this.balances = balances;
        return this.balances;
    }

    validateTransaction(tx, signature, hash) {
        return this.verifySignature(hash, signature, tx.from);
    }
}