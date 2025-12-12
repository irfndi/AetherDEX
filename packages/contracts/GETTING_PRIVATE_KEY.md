# Obtaining a Private Key from MetaMask and Setting Environment Variable

This guide will walk you through the process of creating a new MetaMask wallet, obtaining a private key, and setting the `PRIVATE_KEY` environment variable for deployment.

## Step 1: Install MetaMask

If you don't have MetaMask installed, you'll need to add it to your browser:

1. Go to the MetaMask website: [https://metamask.io/](https://metamask.io/)
2. Click on "Download" and select your browser.
3. Follow the instructions to add the MetaMask extension to your browser.

## Step 2: Create a New Wallet

Once MetaMask is installed, create a new wallet:

1. Open the MetaMask extension in your browser.
2. Click on "Get Started".
3. Click on "Create a Wallet".
4. Set a strong password for your wallet.
5. **Important:** MetaMask will display your Secret Recovery Phrase. Write this phrase down and store it in a secure location. **Do not share this phrase with anyone, as it grants full access to your wallet.**
6. Confirm your Secret Recovery Phrase by entering it in the correct order.
7. Click on "All Done".

## Step 3: Add Polygon Network

Now, you need to add the Polygon network to your MetaMask wallet:

1. Open the MetaMask extension.
2. Click on the network dropdown menu at the top (it probably says "Ethereum Mainnet").
3. Click on "Add network".
4. Select "Add a network manually".
5. Enter the following network details:
    *   **Network Name:** Polygon
    *   **New RPC URL:** `https://polygon-rpc.com`
    *   **Chain ID:** 137
    *   **Currency Symbol:** MATIC
    *   **Block Explorer URL:** `https://polygonscan.com/`
6. Click "Save".

## Step 4: Fund Your Wallet

You'll need some MATIC on Polygon to pay for the contract deployment. You can either bridge ETH from another network or purchase MATIC directly on Polygon using a fiat on-ramp.

## Step 5: Export Your Private Key

Once your wallet is funded, you can export your private key:

1. Open the MetaMask extension.
2. Make sure you have selected the Polygon network.
3. Click on the account icon in the top right corner.
4. Select "Account details".
5. Click on "Export Private Key".
6. Enter your MetaMask password.
7. **Important:** Your private key will be displayed. **Copy this key and store it securely. Do not share this key with anyone.**

## Step 6: Set the PRIVATE_KEY Environment Variable

To avoid hardcoding your private key directly into commands, you can set it as an environment variable. The method for doing this varies depending on your operating system:

**macOS/Linux:**

1. Open your terminal.
2. Run the following command, replacing `your_private_key` with your actual private key:
    ```bash
    export PRIVATE_KEY=your_private_key
    ```

**Windows:**

1. Search for "environment variables" in the Start menu.
2. Click on "Edit the system environment variables".
3. Click on the "Environment Variables..." button.
4. Under "User variables", click "New...".
5. Enter `PRIVATE_KEY` as the variable name and your private key as the variable value.
6. Click "OK" on all open windows to save the changes.

**Important:** This sets the environment variable only for the current terminal session. If you close the terminal, you will need to set it again. For more permanent storage, consider using a dedicated secrets management tool.

Once you have set the `PRIVATE_KEY` environment variable, you can use it in the deployment command as follows:

```bash
cd backend
forge create --rpc-url $POLYGON_RPC_URL --private-key $PRIVATE_KEY src/AetherFactory.sol:AetherFactory
```

Please let me know when you have set the environment variable, and I will proceed with the deployment.
