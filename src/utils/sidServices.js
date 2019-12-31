import { Auth } from 'aws-amplify'
import Amplify from 'aws-amplify';

const AWS = require('aws-sdk')
const ethers = require('ethers')

const SSS = require('shamirs-secret-sharing')
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
                                          // (See: https://github.com/feross/buffer)

// TODO: clean up for security best practices
//       currently pulled from .env
//       see: https://create-react-app.dev/docs/adding-custom-environment-variables/
const amplifyAuthObj = {
  region: process.env.REACT_APP_REGION,
  userPoolId: process.env.REACT_APP_USER_POOL_ID,
  userPoolWebClientId: process.env.REACT_APP_USER_POOL_WEB_CLIENT_ID,
  identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID
}
Amplify.configure({
  Auth: amplifyAuthObj
});

// TODO: move these to dynamo / lambda system in milestone 2
const KEY_FARM_IDS = [
  '66d158b8-ecbd-4962-aedb-15d5dd4024ee',   // Key 0
  '2fe4d745-6685-4581-93ca-6fd7aff92426',   // Key 1
  'ba920788-7c6a-4553-b804-958870279f53'    // Key 2
]

// Local storage key for sid services data and static symmetric encryption
// key obfuscate locally stored data:
const SID_SVCS_LS_KEY = 'SID_SVCS'
//const SID_SVCS_LS_ENC_KEY = 'fsjl-239i-sjn3-wen3' TODO: AC code, do we need this? Wasn't being used

// Adapted from: https://stackoverflow.com/questions/34557889/how-to-deserialize-a-nested-buffer-using-json-parse
function jsonParseToBuffer(aStringifiedObj) {
  return JSON.parse(
    aStringifiedObj,
    (k, v) => {
      if ( v != null               &&
           typeof v === 'object'   &&
           'type' in v             &&
           v.type === 'Buffer'     &&
           'data' in v             &&
           Array.isArray(v.data) ) {
        return Buffer.from(v.data)
      }
      return v
    }
  )
}

export class SidServices
{
  constructor() {
    this.cognitoUser = undefined
    this.signUpUserOnConfirm = false

    this.keyId1 = undefined
    this.keyId2 = undefined

    this.persist = {
      email: undefined,
      address: undefined,
      secretCipherText1: undefined,
      secretCipherText2: undefined
    }

    console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    console.log('DBG: attempting to fetch data from local storage')
    try {
      // TODO: de-obfuscate using static symmetric encryption key SID_SVCS_LS_ENC_KEY
      const stringifiedData = localStorage.getItem(SID_SVCS_LS_KEY)
      console.log(`DBG: recovered persistent data from local storage.\n${stringifiedData}`)
      const persistedData = jsonParseToBuffer(stringifiedData)
      if (persistedData.hasOwnProperty('email') &&
          persistedData.hasOwnProperty('address') &&
          persistedData.email && persistedData.address) {
        console.log(`DBG: successfully recovered and inflated persisted data.`)
        this.persist = persistedData
      }
    } catch (suppressedError) {
      console.log(`DBG: error recovering persistent data from local storage.\n${suppressedError}`)
    }

    this.neverPersist = {
      wallet: undefined,
    }
  }

  getEmail() {
    return this.persist.email
  }

  async getWallet() {
    // If the wallet is undefined, then the iframe has been collapsed and removed
    // from memory. Need to re-compose the user's secrets after decrypting them first
    // (assumes tokens still valid--if not will need sign in with MFA):
    if (!this.neverPersist.wallet &&
         this.persist.secretCipherText1 &&
         this.persist.secretCipherText2) {
      // CopyPasta from 2nd half of sign-in
      // TODO: clean up

      // 2. Decrypt the secrets on the appropriate HSM KMS CMKs
      // TODO: -should these be Buffer.from()?
      const secretPlainText1 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText1)
      const secretPlainText2 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText2)

      // 3. Merge the secrets to recover the keychain
      const secretMnemonic = SSS.combine([secretPlainText1, secretPlainText2])

      // 4. Inflate the wallet and persist it to state.
      const mnemonicStr = secretMnemonic.toString()
      this.neverPersist.wallet = new ethers.Wallet.fromMnemonic(mnemonicStr)

      // Sanity check
      if (this.persist.address !== this.neverPersist.wallet.address) {
        // eslint-disable-next-line
        throw `ERR: wallet addresses not equal. Persisted ${this.persist.address} vs. recovered ${this.neverPersist.wallet.address}`
      }
    }

    return this.neverPersist.wallet
  }

  getWalletAddress() {
    return this.persist.address
  }

  // TODO: do we want to expand this to use phone numbers?
  // See: https://aws-amplify.github.io/docs/js/authentication#lambda-triggers for more error handling etc.
  signInOrUp = async (anEmail) => {
    // TODO:
    //  - this should check to see if the user is already signed in / authenticated
    //    and return if they are
    //  - for testing there should be a flag that automatically signs them out
    //
    console.log('DBG: Forcing sign out ...')
    try {
      await Auth.signOut()
      console.log('DBG: success')
    } catch (error) {
      console.log('DBG: failure')
      console.log(error)
    }

    try {
      this.cognitoUser = await Auth.signIn(anEmail)
      this.persist.email = anEmail
      return
    } catch (error) {
      if (error.code !== 'UserNotFoundException') {
        throw Error(`ERROR: Sign in attempt has failed.\n${error}`)
      }
    }

    // The error code was 'UserNotFoundException' indicating anEmail is not in
    // our user pool. Sign them up:
    try {
      // TODO: move this to dynamo / lambda system in milestone 2 (the max keys value so it's dynamic)
      const MAX_KEYS = KEY_FARM_IDS.length

      // TODO: - always ensure key selection isn't repeated (i.e. KFA1 !== KFA2)
      //       - consider using crypto's getRandomValues method as below
      const KFA1 = Math.floor(Math.random() * MAX_KEYS)
      const KFA2 = Math.floor(Math.random() * MAX_KEYS)

      const params = {
        username: anEmail,
        password: SidServices._getRandomString(30),
        attributes: {
          "custom:kfa1" : KEY_FARM_IDS[KFA1],
          "custom:kfa2" : KEY_FARM_IDS[KFA2]
        }
      }

      await Auth.signUp(params)
      this.cognitoUser = await Auth.signIn(anEmail)

      // Local state store items for sign-up process after successfully answering
      // a challenge question:
      this.persist.email = anEmail

      this.keyId1 = KEY_FARM_IDS[KFA1]
      this.keyId2 = KEY_FARM_IDS[KFA2]
      this.signUpUserOnConfirm = true
    } catch (error) {
      throw Error(`ERROR: Sign up attempt has failed.\n${error}`)
    }
  }

  // TODO: what's the best thing to do here?
  //         - clobber token and sign out
  //         - block specific calling app
  //
  signOut = async () => {
    try {
      await Auth.signOut()
    } catch (error) {
      throw Error(`ERROR: Signing out encounted an error.\n${error}`)
    }
  }

  answerCustomChallenge = async (anAnswer, nonSignInEvent) => {
    try {
      console.log("COGNITO USER: ", this.cognitoUser);
      console.log("anAnswer: ", anAnswer);
      this.cognitoUser = await Auth.sendCustomChallengeAnswer(this.cognitoUser, anAnswer)
    } catch (error) {
      console.log("CUSTOM CHALLENGE ERROR: ", error)
      throw error
    }

    const authenticated = await this.isAuthenticated()

    // TODO: refactor to better spot
    if (authenticated && this.signUpUserOnConfirm) {
      try {
        // Sign Up specific operations:
        //

        //  1. Generate keychain
        this.neverPersist.wallet = ethers.Wallet.createRandom()
        this.persist.address = this.neverPersist.wallet.address

        //  2. SSS
        const secret = Buffer.from(this.neverPersist.wallet.mnemonic)
        const shares = SSS.split(secret, { shares: 3, threshold: 2 })

        //  3. Encrypt & store private / secret user data
        // TODO: separate email / wallet address as per dicussions on firewalling
        this.persist.secretCipherText1 =
          await this.encryptKeyAssignmentWithIdpCredentials(this.keyId1, shares[0])

        this.persist.secretCipherText2 =
          await this.encryptKeyAssignmentWithIdpCredentials(this.keyId2, shares[1])

        const userData = {
          email: this.persist.email,
          address: this.persist.address,
          secretCipherText1: this.persist.secretCipherText1,
          secretCipherText2: this.persist.secretCipherText2,
        }

        //  4. Store user data
        await this.writeToDynamoWithIdpCredentials( userData )

        //  5. Email / Save PDF secret
        // TODO: Justin solution to share w/ user
        console.log('DBG: DELETE this comment after debugging / system ready')
        console.log('*******************************************************')
        console.log('Eth Wallet:')
        console.log(this.neverPersist.wallet)
        console.log('*******************************************************')
      } catch (error) {
        throw Error(`ERROR: signing up user after successfully answering customer challenge failed.\n${error}`)
      } finally {
        // For now abort the operation.
        // TODO: future, robust recovery process
        this.signUpUserOnConfirm = false
      }
    } else if (authenticated) {
      // Sign in specific operations:
      //

      // 1. Fetch the encrypted secrets from Dynamo
      const userData = await this.readFromDynamoWithIdpCredentials()
      this.persist.secretCipherText1 = userData.Item.secretCipherText1
      this.persist.secretCipherText2 = userData.Item.secretCipherText2


      // 2. Decrypt the secrets on the appropriate HSM KMS CMKs
      // TODO: -should these be Buffer.from()?
      const secretPlainText1 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText1)
      const secretPlainText2 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText2)

      // 3. Merge the secrets to recover the keychain
      const secretMnemonic = SSS.combine([secretPlainText1, secretPlainText2])

      // 4. Inflate the wallet and persist it to state.
      const mnemonicStr = secretMnemonic.toString()
      this.neverPersist.wallet = new ethers.Wallet.fromMnemonic(mnemonicStr)
      this.persist.address = this.neverPersist.wallet.address

      // TODO: Justin solution to persist (local storage in encrypted state so
      //       no need to hit AWS (faster, cheaper))
      console.log('DBG: DELETE this comment after debugging / system ready')
      console.log('*******************************************************')
      console.log('Eth Wallet:')
      console.log(this.neverPersist.wallet)

      // if(nonSignInEvent) {
      //   //For transactions and messages, we need the wallet for signing
      //   return {
      //     ethWallet: this.neverPersist.wallet,
      //     signedIn: true,
      //     address: this.neverPersist.wallet && this.neverPersist.wallet.address ?
      //                this.neverPersist.wallet.address : ""
      //   }
      //
      //   //return ethWallet;
      // }
      //
      // console.log(`  address: ${this.neverPersist.wallet.address}`)
      // console.log('*******************************************************')
      //
      // return {
      //   signedIn: true,
      //   address: ethWallet && ethWallet.address ? ethWallet.address : ""
      // }
    }

    if (authenticated) {
      try {
        // TODO: obfuscate using static symmetric encryption key SID_SVCS_LS_ENC_KEY
        localStorage.setItem(SID_SVCS_LS_KEY, JSON.stringify(this.persist))
      } catch (error) {
        console.log('ERROR persisting SID services data to local store.')
      }
    }

    return authenticated;
  }

  isAuthenticated = async () => {
    try {
      await Auth.currentSession();
      return true;
    } catch {
      return false;
    }
  }

  // TODO: need a way to shortcut this if we already have the credentials
  requestIdpCredentials = async (
      aRegion:string=process.env.REACT_APP_REGION,
      aUserPoolId:string=process.env.REACT_APP_USER_POOL_ID,
      anIdentityPoolId:string=process.env.REACT_APP_IDENTITY_POOL_ID ) => {

    let session = undefined
    try {
      session = await Auth.currentSession()
    } catch (error) {
      console.log(`ERROR: unable to get current session.\n${error}`)
      throw error
    }

    AWS.config.region = aRegion

    const data = { UserPoolId: aUserPoolId }
    const cognitoLogin = `cognito-idp.${AWS.config.region}.amazonaws.com/${data.UserPoolId}`
    const logins = {}
    logins[cognitoLogin] = session.getIdToken().getJwtToken()

    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: anIdentityPoolId,
      Logins: logins
    })

    try {
      // Modified to use getPromise from:
      //    https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html#get-property
      //
      await AWS.config.credentials.getPromise()
    } catch (error) {
      console.log(`ERROR: getting / refreshing the existing credentials.\n${error}`)
      throw error
    }
  }


  encryptKeyAssignmentWithIdpCredentials = async (keyId, plainText) => {
    await this.requestIdpCredentials()

    // Now that the AWS creds are configured with the cognito login above, we
    // should be able to access the KMS key if we got the IAMs users/roles/grants
    // correct.
    const kms = new AWS.KMS( {region:'us-west-2'} )

    let cipherText = undefined
    try {
      cipherText = await new Promise((resolve, reject) => {
        const params = {
          KeyId: keyId,
          Plaintext: plainText
        }
        kms.encrypt(params, (err, data) => {
          if (err) {
            reject(err)
          } else {
            resolve(data.CiphertextBlob)
          }
        })
      })
      console.log('DBG: Encryption with Idp Credentials succeeded.')
      console.log(cipherText)
    } catch (error) {
      console.log(`ERROR: Unable to encrypt plainText with Idp Credentials.\n${error}`)
    }

    return cipherText
  }


  decryptKeyAssignmentWithIdpCredentials = async (cipherText) => {
    console.log('decryptKeyAssignmentWithIdpCredentials')
    console.log('-------------------------------------------------------------')

    await this.requestIdpCredentials()

    // Now that the AWS creds are configured with the cognito login above, we
    // should be able to access the KMS key if we got the IAMs users/roles/grants
    // correct.
    const kms = new AWS.KMS( {region:'us-west-2'} )

    let plainText = undefined
    try {
      plainText = await new Promise((resolve, reject) => {
        const params = {
          // KeyId: <Not needed--built into cipher text>,
          CiphertextBlob: cipherText
        }
        kms.decrypt(params, (err, data) => {
          if (err) {
            reject(err)
          } else {
            // TODO: probably stop string encoding this
            // resolve(data.Plaintext.toString('utf-8'))
            resolve(data.Plaintext)
          }
        })
      })
      console.log('Decryption using Cognito credentials succeeded.')
      console.log(plainText)
    } catch (error) {
      console.log(`ERROR: Unable to decrypt encrypted plainText using Cognito credentials.\n${error}`)
    }

    return plainText
  }

  // TODO: abstract the restricted sub out of this code so it's more generic and
  //       not just for restricted row access dynamos.
  readFromDynamoWithIdpCredentials = async () => {
    console.log('readFromDynamoWithIdpCredentials')
    console.log('-------------------------------------------------------------')

    await this.requestIdpCredentials()

    let id = undefined
    try {
      id = AWS.config.credentials.identityId
      console.log(`Cognito Identity ID: ${id}`)
    } catch (error) {
      throw Error(`ERROR: getting credential id.\n${error}`)
    }

    let docClient = undefined
    try {
      docClient =
        new AWS.DynamoDB.DocumentClient({ region: process.env.REACT_APP_REGION })

      const dbParams = {
        Key: {
          sub: id
        },
        TableName: process.env.REACT_APP_UD_TABLE,
      }

      const awsDynDbRequest = await new Promise(
        (resolve, reject) => {
          docClient.get(dbParams, (err, data) => {
            if (err) {
              reject(err)
            } else {
              resolve(data)
            }
          })
        }
      )

      console.log('Successfully read from dynamo db, result =')
      console.log(awsDynDbRequest)
      return awsDynDbRequest
    } catch (error) {
      console.log(`ERROR: configuring and writing to Dynamo.\n${error}`)
    }
  }

  writeToDynamoWithIdpCredentials = async (kvData) => {
    // Adapted from the JS on:
    //    https://aws.amazon.com/blogs/mobile/building-fine-grained-authorization-using-amazon-cognito-user-pools-groups/
    //
    console.log('writeToDynamoWithIdpCredentials')
    console.log('-------------------------------------------------------------')

    await this.requestIdpCredentials()

    // Modified to use getPromise from:
    //    https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html#get-property
    //
    let id = undefined
    try {
      id = AWS.config.credentials.identityId
      console.log(`Cognito Identity ID: ${id}`)
    } catch (error) {
      throw Error(`ERROR: getting credential id.\n${error}`)
    }

    let docClient = undefined
    try {
      docClient =
        new AWS.DynamoDB.DocumentClient({ region: process.env.REACT_APP_REGION })

      const d = new Date(Date.now());
      const item = {
        'sub': `${id}`,
        'last_access': d.toUTCString()
      }
      for (const k in kvData) {
        item[k] = kvData[k]
      }

      const dbParams = {
        Item: item,
        TableName: process.env.REACT_APP_UD_TABLE,
      }

      const awsDynDbRequest = await new Promise(
        (resolve, reject) => {
          docClient.put(dbParams, (err, data) => {
            if (err) {
              reject(err)
            } else {
              resolve(data)
            }
          })
        }
      )

      console.log('Successfully wrote to dynamo db, result =')
      console.log(awsDynDbRequest)
    } catch (error) {
      console.log(`ERROR: configuring and writing to Dynamo.\n${error}`)
    }

    // TODO: delete this after test
    // // Test to make sure we can't write to the wrong row:
    // try {
    //   const d = new Date(Date.now());
    //   const dbParams = {
    //     Item: {
    //       'user_id': `7b34007d-4ff9-437e-a4fc-43abaf0d524f`,
    //       'last_access': d.toUTCString()
    //     },
    //     TableName: "sid-user-table",
    //   }
    //
    //   const awsDynDbRequest = await new Promise(
    //     (resolve, reject) => {
    //       docClient.put(dbParams, (err, data) => {
    //         if (err) {
    //           reject(err)
    //         } else {
    //           resolve(data)
    //         }
    //       })
    //     }
    //   )
    //
    //   console.log('Successfully wrote to dynamo db using sub instead of idp id, result =')
    //   console.log(awsDynDbRequest)
    // } catch (error) {
    //   console.log(`ERROR: configuring and writing to Dynamo as sub (vs idp id).\n${error}`)
    // }
  }


  //
  // Private Methods
  //////////////////////////////////////////////////////////////////////////////

  static _getRandomString(numBytes) {
    const randomValues = new Uint8Array(numBytes)
    // TODO: any environments where window will not be available?
    if (!window) {
      throw Error(`ERROR: SID Services unable to access window.`)
    }
    window.crypto.getRandomValues(randomValues)
    return Array.from(randomValues).map(SidServices._intToHex).join('');
  }

  static _intToHex(aNumber) {
    return aNumber.toString(16).padStart(2, '0');
  }

}
