// TODO:  re-think. This is likely a sub-optimal way to share state w/o rerender.\
// WARNING: Order is important for this require
import { getSidSvcs } from '../index.js'

import connectToParent from 'penpal/lib/connectToParent';
import { getGlobal, setGlobal } from 'reactn';
const CryptoJS = require("crypto-js");
const WIDGET_KEYCHAIN = "widget-keychain";
const ethers = require('ethers');

export function closeWidget(close) {
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      //
    }
  });

  connection.promise.then(parent => {
    parent.close(close).then(() => console.log("Closed"));
  });
}

export async function signIn() {
  const { nonSignInEvent, action } = getGlobal();
  console.log("COGNITO FLOW: ", process.env.REACT_APP_COGNITO_FLOW);
  if (process.env.REACT_APP_COGNITO_FLOW === 'true') {
    // New AC Flow
    setGlobal({ auth: nonSignInEvent ? false : true, action: "loading" });
    const { email } = await getGlobal();
    const signInFlow = await getSidSvcs().signInOrUp(email)
    const sidSvcWalletAddr = getSidSvcs().getWalletAddress()
    const walletAddr = sidSvcWalletAddr ? sidSvcWalletAddr : "";
    const sid = getSidSvcs().getSID();

    if(signInFlow === 'already-logged-in') {
      //This means a cognito token was still available
      //TODO: If we decide to blow away cognito local storage on sign out, need to revisit this
      //TODO: There's a more efficient way of handling this
      const connection = connectToParent({
        // Methods child is exposing to parent
        methods: {
          //
        }
      });
  
      connection.promise.then(parent => {
        const userData = {
          wallet: {
            ethAddr: walletAddr
          }, 
          orgId: sid ? sid : null
        }
  
        parent.storeWallet(JSON.stringify(userData)).then((res) => {
          closeWidget(true);
        })
      });
    } else {
      setGlobal({ auth: nonSignInEvent ? false : true, action: nonSignInEvent ? action : 'sign-in-approval' })
    }
  } else {  // Original Justin Flow
    setGlobal({ auth: true, action: "loading" });
    const { email } = await getGlobal();
    const connection = connectToParent({
      // Methods child is exposing to parent
      methods: {
        //
      }
    });

    connection.promise.then((parent) => {
      //checkDB
      parent.fetchUser(email).then((res) => {
        if(res.success === true) {
          //user found and encrypted keychain returned
          //decrypt later with with user's password
          //store encrypted keychain in localStorage
          const userKeychain = res.body.Item.encryptedKeychain;
          localStorage.setItem(WIDGET_KEYCHAIN, JSON.stringify(userKeychain));
          setGlobal({ auth: true, action: "enter-password" });
        } else {
          //No user found, create new keychain
          generateKeychain();
        }
      })
    }).catch(e => console.log(e));
  }
}

export async function handlePassword(e, actionType) {
  setGlobal({ auth: actionType === "auth" ? true : false, action: "loading" });
  const { password, keychain, email } = getGlobal();
  if(actionType === "new-auth") {
    //we are encrypting the keychain and storing on the db
    const encryptedKeychain = CryptoJS.AES.encrypt(JSON.stringify(keychain), password);
    // const decryptedKeychain = CryptoJS.AES.decrypt(encryptedKeychain.toString(), password);
    // console.log("DECRYPTED: ", decryptedKeychain.toString(CryptoJS.enc.Utf8));
    localStorage.setItem(WIDGET_KEYCHAIN, encryptedKeychain.toString());
    const payload = {
      email,
      encryptedKeychain: encryptedKeychain.toString()
    }
    //now we fire this off to the db
    const connection = connectToParent({
      // Methods child is exposing to parent
      methods: {
        //
      }
    });

    connection.promise.then(parent => {
      parent.storeKeychain(JSON.stringify(payload)).then((res) => {
        if(res.success) {
          //Keychain has been saved.
          //Store wallet address for retreival client-side
          const userData = {
            email,
            wallet: {
              ethAddr: keychain.address
            }
          }
          parent.storeWallet(JSON.stringify(userData)).then(() => {
            closeWidget(true);
          })
        } else {
          console.log(res.body);
        }
      });
    });
  } else {
    const encryptedKeychain = localStorage.getItem(WIDGET_KEYCHAIN);
    //we have fetched the encrypted keychain and need to decrypt
    let eKcp = undefined
    try {
      eKcp = JSON.parse(encryptedKeychain)
    } catch (error) {
      console.log(error);
    }
    const decryptedKeychain = CryptoJS.AES.decrypt(eKcp, password);
    const parsedDecKeyChain = JSON.parse(decryptedKeychain.toString(CryptoJS.enc.Utf8));
    //console.log("DECRYPTED KEYCHAIN: ", JSON.parse(decryptedKeychain.toString(CryptoJS.enc.Utf8)));
    setGlobal({ keychain: parsedDecKeyChain });
    if(actionType === "auth") {
      const connection = connectToParent({
        // Methods child is exposing to parent
        methods: {
          //
        }
      });

      connection.promise.then(parent => {
        const userData = {
          email,
          wallet: {
            ethAddr: parsedDecKeyChain.signingKey.address
          }
        }

        parent.storeWallet(JSON.stringify(userData)).then((res) => {
          closeWidget(true);
        })
      });
    } else if(actionType === "tx") {
      return decryptedKeychain
    }
  }
}

export async function approveSignIn() {
  const { nonSignInEvent } = getGlobal();
  console.log(nonSignInEvent);
  if (process.env.REACT_APP_COGNITO_FLOW === 'true') {  // New AC Flow
    // WARNING:
    //  - Do not comment out the line below. For some reason, if you do
    //    the call to answerCustomChallenge will fail in the browser (the
    //    request gets cancelled). It's not clear why, but a starting point
    //    to understand this is browser optimizations within iFrames:
    //    https://stackoverflow.com/questions/12009423/what-does-status-canceled-for-a-resource-mean-in-chrome-developer-tools
    setGlobal({ auth: true, action: "loading" });
    const { token } = await getGlobal();

    let authenticatedUser = false
    let walletAddr = "";
    let wallet = {};
    let sid = {};
    try {
      authenticatedUser = await getSidSvcs().answerCustomChallenge(token, nonSignInEvent)
      const sidSvcWalletAddr = getSidSvcs().getWalletAddress()
      walletAddr = sidSvcWalletAddr ? sidSvcWalletAddr : ""
      const sidSvcWallet = getSidSvcs().getWallet()
      wallet = sidSvcWallet ? sidSvcWallet : {}
      sid = getSidSvcs().getSID();

    } catch (error) {
      // TODO: Cognito gives 3 shots at this
      // throw `ERROR: Failed trying to submit or match the code.\n${error}`
      console.log(`ERROR: Failed trying to submit or match the code:\n`)
      console.log(error)
    }

    console.log("AUTHENTICATED USER: ", authenticatedUser);
    console.log("NON SIGN IN EVENT: ", nonSignInEvent);
    //TODO: @AC needs to review because this might be a place where we are revealing too much to the parent
    if (authenticatedUser && !nonSignInEvent) {
      const connection = connectToParent({
        // Methods child is exposing to parent
        methods: {
          //
        }
      });

      connection.promise.then(parent => {
        const userData = {
          email: "", //TODO: remove this
          wallet: {
            ethAddr: walletAddr
          }, 
          orgId: sid ? sid : null
        }

        parent.storeWallet(JSON.stringify(userData)).then((res) => {
          closeWidget(true);
        })
      });
    } else if(nonSignInEvent) {
      //This is where we should return the keychain for transaction handling and messaging signing events
      return wallet;
      //return authenticatedUser;
    } else {
      // TODO: something more appropriate here (i.e. try to sign-in-approval again
      //       which I think this should be doing, but it's not).
      setGlobal({ auth: true, action: 'sign-in-approval' })
    }
  } else {
    setGlobal({ auth: true, action: "loading" });
    const { email, token } = await getGlobal();
    const connection = connectToParent({
      // Methods child is exposing to parent
      methods: {
        //
      }
    });

    connection.promise.then(parent => {
      parent.signIn({email, token}).then((res) => {
        if(res === true) {
          console.log("Success");
          closeWidget(true)
        } else {
          console.log("Failed");
        }
      });
    });
  }
}

export async function generateKeychain() {
  //Generate a new wallet
  const newWallet = await ethers.Wallet.createRandom();
  setGlobal({ keychain: newWallet });
  setGlobal({ auth: true, action: "enter-new-password" });
}

export async function getTxDetails() {
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      //
    }
  });

  connection.promise.then(parent => {
    parent.getPopUpInfo().then((res) => {
      setGlobal({ txDetails: res });
    });
  });
}

export function handleHash(hash) {
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      //
    }
  });

  connection.promise.then(parent => {
    parent.displayHash(hash).then(() => {
      closeWidget(false);
    })
  });
}

export function returnSignedMessage(signedMsg) {
  console.log("SIGNED MESSAGE FROM IFRAME");
  const connection = connectToParent({
    // Methods child is exposing to parent
    methods: {
      //
    }
  });

  connection.promise.then(parent => {
    parent.signedMessage(signedMsg).then(() => {
      closeWidget(false);
    })
  });
}
