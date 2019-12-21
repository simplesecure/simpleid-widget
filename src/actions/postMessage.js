import connectToParent from 'penpal/lib/connectToParent';
import { SidServices } from '../utils/sidServices'
import { getGlobal, setGlobal } from 'reactn';
const CryptoJS = require("crypto-js");
const WIDGET_KEYCHAIN = "widget-keychain";
const ethers = require('ethers');

const JUSTIN_FLOW = false

const ss = new SidServices()

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
  const FN = 'simpleid-widget::signIn'
  console.log(`DBG: ${FN}`)
  console.log('DBG: ---------------------------------------------------------------')

  if (!JUSTIN_FLOW) {  // New AC Flow
    setGlobal({ auth: true, action: "loading" });
    const { email } = await getGlobal();
    const connection = connectToParent({
      // Methods child is exposing to parent
      methods: {
        //
      }
    });

    console.log(`DBG: ${FN} setting auth true, action loading`)
    console.log(`DBG: ${FN} fetched email = ${email}`)

    console.log(`DBG: ${FN} calling SimpleID Services Sign In or Up ...`)
    await ss.signInOrUp(email)
    console.log(`DBG: ${FN} call succeeded.`)
    setGlobal({ auth: true, action: 'sign-in-approval' })
    console.log(`DBG: ${FN} setting auth true, action sign-in-approval`)
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
  const FN = 'simpleid-widget::approveSignIn'
  console.log(`DBG: ${FN}`)
  console.log('DBG: ---------------------------------------------------------------')

  if (!JUSTIN_FLOW) { // New AC Flow
    // WARNING:
    //  - Do not comment out the line below. For some reason, if you do
    //    the call to answerCustomChallenge will fail in the browser (the
    //    request gets cancelled). It's not clear why, but a starting point
    //    to understand this is browser optimizations within iFrames:
    //    https://stackoverflow.com/questions/12009423/what-does-status-canceled-for-a-resource-mean-in-chrome-developer-tools
    setGlobal({ auth: true, action: "loading" });
    const { email, token } = await getGlobal();
    const connection = connectToParent({
      // Methods child is exposing to parent
      methods: {
        //
      }
    });

    console.log(`DBG: ${FN} setting auth true, action loading`)
    console.log(`DBG: ${FN} fetched email = ${email}`)
    console.log(`DBG: ${FN} fetched token = ${token}`)

    console.log(`DBG: ${FN} answering custom challenge with token:`)
    let authenticatedUser = false
    try {
      authenticatedUser = await ss.answerCustomChallenge(token)
    } catch (error) {
      // TODO: Cognito gives 3 shots at this
      // throw `ERROR: Failed trying to submit or match the code.\n${error}`
      console.log(`ERROR: Failed trying to submit or match the code.\n`)
      console.log(error)
      console.log('  authenticatedUser')
      console.log(authenticatedUser)
      console.log()
    }
    if (authenticatedUser) {
      console.log(`DBG: ${FN} succeeded!`)
      console.log(`DBG: ${FN} closing widget.`)
      closeWidget(true)
    } else {
      console.log(`DBG: ${FN} failed!`)
      setGlobal({ auth: true, action: 'sign-in-approval' })
      console.log(`DBG: ${FN} setting auth true, action sign-in-approval`)
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
