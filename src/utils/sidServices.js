import { Auth } from 'aws-amplify'
import Amplify from 'aws-amplify';
import { getGlobal } from 'reactn';

import { dbRequestDebugLog } from './dynamoBasics.js'

import { walletAnalyticsDataTablePut,
         walletToUuidMapTablePut,
         organizationDataTableGet,
         organizationDataTablePut,
         unauthenticatedUuidTableQueryByEmail,
         unauthenticatedUuidTableGetByUuid,
         unauthenticatedUuidTablePut,
         unauthenticatedUuidTableAppendAppId,
         walletToUuidMapTableGetUuids,
         walletToUuidMapTableAddCipherTextUuidForAppId,
         walletAnalyticsDataTableGetAppPublicKey,
         walletAnalyticsDataTableAddWalletForAnalytics } from './dynamoConveniences.js'

import { jsonParseToBuffer,
         getRandomString } from './misc.js'



const AWS = require('aws-sdk')
const ethers = require('ethers')

// v4 = random. Might consider using v5 (namespace, in conjunction w/ app id)
// see: https://github.com/kelektiv/node-uuid
const uuidv4 = require('uuid/v4')

const SSS = require('shamirs-secret-sharing')
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
                                          // (See: https://github.com/feross/buffer)

const eccrypto = require('eccrypto')



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

AWS.config.update({ region: process.env.REACT_APP_REGION })


const NON_SID_WALLET_USER_INFO = "non-sid-user-info";
const SID_ANALYTICS_APP_ID = '00000000000000000000000000000000'

// TODO: move these to dynamo / lambda system in milestone 2
const KEY_FARM_IDS = [
  '66d158b8-ecbd-4962-aedb-15d5dd4024ee',   // Key 0
  '2fe4d745-6685-4581-93ca-6fd7aff92426',   // Key 1
  'ba920788-7c6a-4553-b804-958870279f53'    // Key 2
]

/*******************************************************************************
 * Configuration Switches
 ******************************************************************************/
const TEST_ASYMMETRIC_DECRYPT = true

/*******************************************************************************
 * Test Switches - Remove / Disable in Production
 ******************************************************************************/
const TEST_SIGN_USER_UP_TO_NEW_APP = false

// Local storage key for sid services data and static symmetric encryption
// key obfuscate locally stored data:
const SID_SVCS_LS_KEY = 'SID_SVCS'
//const SID_SVCS_LS_ENC_KEY = 'fsjl-239i-sjn3-wen3' TODO: AC code, do we need this? Wasn't being used
//                                                        Justin: - this is going to get used to obfuscate
//                                                                  our local store when everything's done.


// TODO: move this to dynamo / lambda system in milestone 2 (the max keys value so it's dynamic)
//   - after moving we'll make these undefined and the lambda will set them for the user
function getKeyAssignments() {
  const MAX_KEYS = KEY_FARM_IDS.length

  // TODO: - always ensure key selection isn't repeated (i.e. KFA1 !== KFA2)
  //       - consider using crypto's getRandomValues method as below
  const KFA1 = Math.floor(Math.random() * MAX_KEYS)
  const KFA2 = Math.floor(Math.random() * MAX_KEYS)

  return {
    "custom:kfa1" : KEY_FARM_IDS[KFA1],
    "custom:kfa2" : KEY_FARM_IDS[KFA2]
  }
}


export class SidServices
{
  /**
   * constructor:
   *
   *         There is one required argument:
   *         @param anAppId is a string containing a uuid.
   *                        It is used to create and interact with user data. For
   *                        most apps this will control email preferences
   *                        from the developer and where analytics data is created
   *                        and stored. For the SimpleID analytics app this will
   *                        also result in the creation of additional data
   *                        (organization ids etc.)
   *
   * TODO (short-term, higher priority):
   *        1. Clean up / refactor the code fetching data from local storage.
   *
   */
  constructor(anAppId) {
    this.hostedApp = getGlobal().hostedApp

    this.cognitoUser = undefined
    this.signUpUserOnConfirm = false
    this.keyId1 = undefined
    this.keyId2 = undefined

    this.appId = anAppId
    this.appIsSimpleId = (this.appId === SID_ANALYTICS_APP_ID )

    this.persist = {
      userUuid: undefined,
      email: undefined,
      address: undefined,
      secretCipherText1: undefined,
      secretCipherText2: undefined,
    }

    this.neverPersist = {
      wallet: undefined,
      priKey: undefined
    }


    try {
      // TODO: de-obfuscate using static symmetric encryption key SID_SVCS_LS_ENC_KEY
      const stringifiedData = localStorage.getItem(SID_SVCS_LS_KEY)
      const persistedData = jsonParseToBuffer(stringifiedData)
      if (persistedData.hasOwnProperty('email') &&
          persistedData.hasOwnProperty('address') &&
          persistedData.email && persistedData.address) {
        this.persist = persistedData
      }
    } catch (suppressedError) {
      console.log(`WARN: problem recovering persistent data from local storage.\n${suppressedError}`)
    }
  }

  getEmail() {
    return this.persist.email
  }

  getAddress() {
    return this.persist.address
  }

  async getWallet() {
    // If the wallet is undefined, then the iframe has been collapsed and removed
    // from memory. Need to re-compose the user's secrets after decrypting them first
    // (assumes tokens still valid--if not will need sign in with MFA):
    if (!this.neverPersist.wallet) {
      if ( this.persist.secretCipherText1 && this.persist.secretCipherText2) {
        // CopyPasta from 2nd half of sign-in
        // TODO: clean up

        // 2. Decrypt the secrets on the appropriate HSM KMS CMKs
        // TODO: -should these be Buffer.from()?
        const secretPlainText1 =
          await this.decryptWithKmsUsingIdpCredentials(this.persist.secretCipherText1)
        const secretPlainText2 =
          await this.decryptWithKmsUsingIdpCredentials(this.persist.secretCipherText2)

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
      } else {
        // TODO: need to fetch persisted data from dynamo to re-inflate
      }
    }

    return this.neverPersist.wallet
  }

  getSID() {
    return this.persist.sid;
  }

  getWalletAddress() {
    return this.persist.address
  }

 /**
  * signInOrUp:
  *
  * Notes:  Signing in or up is a two part process. A user enters their email
  *         which is passed to this function and then to Cognito where a
  *         challenge is generated and sent to the provided email.
  *         Our UI collects the challenge response and sends it to the method
  *         'answerCustomChallenge'.
  *
  *         In signInOrUp their are really two use cases the Cognito User already
  *         exists (signIn) or we must create them (signUp).  Either way the
  *         flow is the same, a challenge is generated and sent to the provided
  *         email. The only difference is that we do some extra work on sign up,
  *         specifically:
  *           - wallet creation
  *           - key assignment
  *           - user data creation and storage in our user data db
  *
  *         There is one required argument:
  *         @param anAppId is a string containing a uuid.
  *                        It is used to create and interact with user data. For
  *                        most apps this will control email preferences
  *                        from the developer and where analytics data is created
  *                        and stored. For the SimpleID analytics app this will
  *                        also result in the creation of additional data
  *                        (organization ids etc.)
  *         @param anEmail is string containing a user's email.
  *
  * TODO (short-term, higher priority):
  *         1. Improve error handling. See:
  *              - https:*aws-amplify.github.io/docs/js/authentication#lambda-triggers for more error handling etc.
  *
  * TODO (long-term, lower priority):
  *         1. Do we want to expand this to use phone numbers?
  *         2. Do we want to collect other information (name etc.)?
  *              - two storage options--Cognito User Pool or DB
  *
  */
  signInOrUp = async (anEmail, anAppId) => {
    const authenticated = await this.isAuthenticated(anEmail)
    if (authenticated) {
      // If the user is already authenticated, then skip this function.
      return 'already-logged-in'
    }

    // Test to see if the user is already in our Cognito user pool. If they are
    // not in our user pool, a UserNotFoundException is thrown (we suppress that
    // error and continue to the signUp flow).
    try {
      // signIn flow:
      ///////////////
      this.cognitoUser = await Auth.signIn(anEmail)
      this.persist.email = anEmail
      return
    } catch (error) {
      if (error.code !== 'UserNotFoundException') {
        throw Error(`ERROR: Sign in attempt has failed.\n${error}`)
      }
    }

    // signUp flow:
    ///////////////
    try {
      const keyAssignments = getKeyAssignments()

      const params = {
        username: anEmail,
        password: getRandomString(30),
        attributes: keyAssignments
      }
      await Auth.signUp(params)

      this.cognitoUser = await Auth.signIn(anEmail)

      // Local state store items for sign-up process after successfully answering
      // a challenge question:
      this.persist.email = anEmail
      this.keyId1 = keyAssignments["custom:kfa1"]
      this.keyId2 = keyAssignments["custom:kfa2"]
      this.signUpUserOnConfirm = true
    } catch (error) {
      throw Error(`ERROR: Sign up attempt has failed.\n${error}`)
    }
  }

  /**
   * signOut:
   *
   */
  signOut = async () => {
    if (this.hostedApp) {
      // For now, if the user is on the hosted wallet page and not in a third parth app
      // We'll clear localStorage and refresh
      localStorage.clear();
      window.location.reload();
    } else {
      try {
        await Auth.signOut()
      } catch (error) {
        throw Error(`ERROR: Signing out encounted an error.\n${error}`)
      }
    }
  }

  /**
   * answerCustomChallenge:
   *
   * Notes:  This is phase two of the Sign Up and Sign In processes (collectively
   *         handled in signInOrUp for phase one).
   *         By this point Cognito has issued a challenge to a user via email
   *         and they have entered that received challenge in:
   *         @param anAnswer  a string containing the user's entry for a
   *                          Cognito issued 6 digit challenge.
   *
   *         There are two use case handled in this method:
   *         1. If the user already exists, their user data is fetched from the
   *            db (and possibly local storage) and we obtain a credentials from
   *            cognito to decrypt their wallet key for them.
   *         2. The user does not already exist in which case we create a wallet
   *            for them, split it using Shamir's Secret sharing and provide it
   *            to them as well as storing it encrypted in the user db.
   *
   *         Another consideration or special case is handled here for both new
   *         users and existing users when logging in from special appId
   *         corresponding to SimpleID. In this case we add additional user data
   *         (specifically the sid field) and also want to give credentialed
   *         access to additional db tables for mapping wallets to uuids,
   *         processing analytics data, and querying organization data.
   *
   * TODO:
   *        1. Make encrypt*IdpCredentials calls concurrent and wait for them (faster).
   *        2. Make access to certain tables below restricted or more restricted,
   *           for example:
   *             - could use cognito
   *             - could use a separate policy / user (wallet to uuid map is write only)
   *
   */
  answerCustomChallenge = async (anAnswer) => {
    let signUpMnemonicReveal = false

    // Following line throws and is intentionally unhandled.
    this.cognitoUser = await Auth.sendCustomChallengeAnswer(
      this.cognitoUser, anAnswer)

    // The user has entered a challenge answer and no error occured. Now test
    // to see if they are authenticated into Cognito (i.e. have a valid token):
    const authenticated = await this.isAuthenticated()

    if (authenticated && this.signUpUserOnConfirm) {
      // Phase 2 of signUp flow:
      //////////////////////////
      try {
        //  0. Generate uuid
        //
        this.persist.userUuid = uuidv4()

        //  1. Generate keychain
        //
        this.neverPersist.wallet = ethers.Wallet.createRandom()
        this.persist.address = this.neverPersist.wallet.address

        //  2. SSS
        //
        const secret = Buffer.from(this.neverPersist.wallet.mnemonic)
        const shares = SSS.split(secret, { shares: 3, threshold: 2 })

        //  3. Encrypt & store private / secret user data
        //
        this.persist.secretCipherText1 =
          await this.encryptWithKmsUsingIdpCredentials(this.keyId1, shares[0])
        this.persist.secretCipherText2 =
          await this.encryptWithKmsUsingIdpCredentials(this.keyId2, shares[1])

        //  4. a)  Create and store entry in Organization Data (simple_id_org_data_v001)
        //         the this.appIsSimpleId
        //
        //
        // Special case. User is signing into Simple ID analytics and needs to be
        // part of an organization (org_id) etc. Two scenarios (only #1 is
        // supported in Jan. 21 2020 release):
        //
        //    1. User is a new customer and we are assigning them a new
        //       organization id (org_id) which will be used to collect data
        //       for their apps (identified with app ids, app_id).
        //    2. User is an associate of an organization and has been invited
        //       to work with Simple ID analytics app.  (Not supported in
        //       Jan 21. release).
        //         - Justin idea: only make this possible with query string / link
        //         - AC idea: create org_id and allow it to be deleted / backgrounded
        //                    when they join anothe org through some mechanism.
        //
        // TODO:
        //       1. Should org_id be an array of org ids? (i.e. multiple orgs
        //          like AWS allows multiple accounts)
        //       2. Should we check for a uuid collision? (unlikely, but huge
        //          security fail if happens)
        //
        const sidObj = await this.createSidObject()

        //  4. b) Create and store User Data (simple_id_auth_user_data_v001)
        //
        //  IMPORTANT: Never put wallet address in user data (the whole point
        //             is to decouple the two with a cryptographic island).
        const userDataRow = {
          // sub: <cognito idp sub>  is implicitly added to this in call to tablePutWithIdpCredentials below.
          uuid: this.persist.userUuid,
          email: this.persist.email,
          secretCipherText1: this.persist.secretCipherText1,
          secretCipherText2: this.persist.secretCipherText2,
          apps: {
            [ this.appId ] : {}             // Empty Contact Prefs Etc.
          },
          sid: sidObj,
        }

        // Write this to the user data table:
        await this.tablePutWithIdpCredentials( userDataRow )

        //  4. c)  Create and store entry in Wallet to UUID map for this app
        //         (simple_id_wallet_uuid_map_v001)
        //
        const appPublicKey =
          await walletAnalyticsDataTableGetAppPublicKey(this.appId)
        const userUuidCipherText =
          await eccrypto.encrypt(appPublicKey, Buffer.from(this.persist.userUuid))
        const walletUuidMapRow = {
          wallet_address: this.persist.address,
          app_to_enc_uuid_map: {
            [ this.appId ] : userUuidCipherText
          }
        }
        //
        // TODO: Make this use Cognito to get write permission to the DB (for the
        //       time being we're using an AWS_SECRET):
        await walletToUuidMapTablePut(walletUuidMapRow)

        //  4. d)  Create and store Wallet Analytics Data
        //         (simple_id_cust_analytics_data_v001)
        //
        // TODO (Justin+AC): Events of some sort (i.e. sign-in, sign-up, date etc.)
        //
        await walletAnalyticsDataTableAddWalletForAnalytics(
          this.persist.address, this.appId)

        //  5. Email / Save PDF secret
        //   Setting this as true so we can return it to the approveSignIn function from postMessage.js
        //   If we don't do this, we'll have to set state in the sidServices file, which I don't think
        //   we want to do.
        //   see line 609 for how this will be returned
        signUpMnemonicReveal = true;
      } catch (error) {
        throw Error(`ERROR: signing up user after successfully answering customer challenge failed.\n${error}`)
      } finally {
        // For now abort the operation.
        // TODO: future, robust recovery process
        this.signUpUserOnConfirm = false
      }
    } else if (authenticated) {
      // Phase 2 of signIn flow:
      //////////////////////////
      // 0. Update the key IDs from the token in case we need to encrypt
      //    a public key
      const keyAssignments = await this.getKeyAssignmentFromTokenAttr()
      this.keyId1 = keyAssignments['kfa1']
      this.keyId2 = keyAssignments['kfa2']

      // 1. Fetch the encrypted secrets from Dynamo
      //
      const userDataDbRow = await this.tableGetWithIdpCredentials()
      const userData = userDataDbRow.Item
      this.persist.secretCipherText1 = userData.secretCipherText1
      this.persist.secretCipherText2 = userData.secretCipherText2

      // 2. Decrypt the secrets on the appropriate HSM KMS CMKs
      //
      const secretPlainText1 =
        await this.decryptWithKmsUsingIdpCredentials(this.persist.secretCipherText1)
      const secretPlainText2 =
        await this.decryptWithKmsUsingIdpCredentials(this.persist.secretCipherText2)

      // 3. Merge the secrets to recover the keychain
      //
      const secretMnemonic = SSS.combine([secretPlainText1, secretPlainText2])

      // 4. Inflate the wallet and persist it to state.
      //
      const mnemonicStr = secretMnemonic.toString()
      this.neverPersist.wallet = new ethers.Wallet.fromMnemonic(mnemonicStr)
      this.persist.address = this.neverPersist.wallet.address

      this.persist.userUuid = userData.uuid

      // 5. If the user has never signed into this App before, we need to update
      //    the appropriate tables with the user's data unless this is happening on the hosted-wallet side of things:
      //
      if (this.hostedApp !== true) {

        /* REMOVE Test code when working ****************************************/
        const oldAppId = this.appId
        if (TEST_SIGN_USER_UP_TO_NEW_APP) {
          console.log('************************ REMOVE WHEN WORKING ***************')
          console.log('* Faking a new AppId to build signUserUpToNewApp           *')
          console.log('************************************************************')
          this.appId = `new-app-id-random-authd-${Date.now()}`
        }
        // See also: BEGIN REMOVE ~10 lines down
        /* END REMOVE ***********************************************************/

        let userDataDbNeedsUpdate = false
        if (!userData.apps.hasOwnProperty(this.appId)) {
          // TODO: make this a partial update using the idp partial update (writing
          //       the buffers with the secrets etc. is costly and dangerous--failed write
          //       could eliminate the cipherText secrets).
          //
          userDataDbNeedsUpdate = true

          userData.apps[this.appId] = {}

          if (this.appIsSimpleId) {
            const sidObj = await this.createSidObject()
            userData.sid = sidObj
            this.persist.sid = sidObj
          } else {
          }

          const authenticatedUser = true
          await this.signUserUpToNewApp(authenticatedUser)
        }

        // WARNING: Moving this will break the SID Analytics App
        //
        this.persist.sid = userData && userData.sid ? userData.sid : undefined;

        // BEGIN REMOVE
        // restore appId
        this.appId = oldAppId
        // END REMOVE


        // 6. If we modified the User Data, update the DB version:
        //
        if (userDataDbNeedsUpdate) {
          await this.tablePutWithIdpCredentials( userData )
          userDataDbNeedsUpdate = false
        }
      }
    }

    if (authenticated) {
      try {
        console.log('this.perist')
        console.log(JSON.stringify(this.persist))
        // TODO: obfuscate using static symmetric encryption key SID_SVCS_LS_ENC_KEY
        localStorage.setItem(SID_SVCS_LS_KEY, JSON.stringify(this.persist))
      } catch (suppressedError) {
        console.log(`ERROR persisting SID services data to local store.\n${suppressedError}`)
      }
    }

    // moving the authenticated = true into an object so that we include signUpMnemonicReveal
    // this needs to be sent so that in postMessage.js we know if we need to update state accordingly
    return { authenticated, signUpMnemonicReveal }
  }

  isAuthenticated = async (anEmail=undefined) => {
    try {
      const session = await Auth.currentSession();

      const tokenEmail = session.idToken.email
      if (anEmail && (anEmail !== tokenEmail)) {
        throw new Error('Stored token is for different user. Returning false for isAuthenticated.')
      }

      return true;
    } catch (suppressedError) {
      console.log(`WARN: Suppressing error in isAuthenticated.\n${suppressedError}`)
      return false;
    }
  }

  getUserDetails = async () => {
    try {
      if (!this.cognitoUser) {
        this.cognitoUser = await Auth.currentAuthenticatedUser()
      }
      return await Auth.userAttributes(this.cognitoUser)
    } catch (suppressedError) {
      console.log(`WARN: Unable to get user details from token.\n${suppressedError}`)
    }
    return undefined
  }

  getKeyAssignmentFromTokenAttr = async () => {
    const userAttributes = await this.getUserDetails()

    // TODO: Clean this up (i.e. see if we can do direct assignment instead of a loop)
    const keyAssignments = {}
    for (const userAttribute of userAttributes) {
      if (userAttribute.getName() === 'custom:kfa1') {
        console.log(`returning kfa1: ${userAttribute.getValue()}`)
        keyAssignments['kfa1'] = userAttribute.getValue()
      } else if (userAttribute.getName() === 'custom:kfa2') {
        console.log(`returning kfa2: ${userAttribute.getValue()}`)
        keyAssignments['kfa2'] = userAttribute.getValue()
      }
    }

    return keyAssignments
  }



/******************************************************************************
 *                                                                            *
 * SimpleID Analytics Tool Related Methods                                    *
 *                                                                            *
 ******************************************************************************/

  /**
   * getUuidsForWalletAddresses:
   *
   * Notes: Given a list of wallet addresses for an app ID, this method
   *        fetches the uuids corresponding to the wallet addresses.
   *
   *        This method only works if this user has access to the organization
   *        private key.
   */
  getUuidsForWalletAddresses = async (
      anAppId="418fb762-f234-4a21-897a-2a598fd6965d",
      theWalletAddresses=["0xD6E46cF625f4edcAdF79344EE6356b6DFaf1B1Df",
                          "0x27C40E3a8114f442dad71756F52Bd74a19a94ADE"]
    ) => {

    let uuids = []

    // 1. Fetch the encrypted uuids for the given wallet addresses and appID:
    //
    const encryptedUuids = []
    const encryptedUuidMaps = await walletToUuidMapTableGetUuids(theWalletAddresses)
    for (const encryptedUuidMap of encryptedUuidMaps) {
      try {
        const cipherObj = encryptedUuidMap.app_to_enc_uuid_map[anAppId]
        encryptedUuids.push(cipherObj)
      } catch (suppressedError) {
        continue
      }
    }

    // 2. Fetch the private key required to decrypt the uuids:
    //
    // TODO:
    //      - Make this efficient (this is awful)
    let orgEcPriKey = undefined
    try {
      const orgData = await organizationDataTableGet(this.persist.sid.org_id)
      const cipherObj = orgData.Item.cryptography.pri_key_ciphertexts[this.persist.userUuid]

      const userEcPriKeyCipherText = this.persist.sid.pri_key_cipher_text
      const userEcPriKey = await this.decryptWithKmsUsingIdpCredentials(userEcPriKeyCipherText)

      orgEcPriKey = await eccrypto.decrypt(userEcPriKey, cipherObj)
    } catch (error) {
      throw new Error(`Failed to fetch user EC private key.\n${error}`)
    }

    // 3. Decrypt the encrypted uuids and return them:
    //
    let failedDecryptions = 0
    for (const encryptedUuidCipherText of encryptedUuids) {
      try {
        const uuid = await eccrypto.decrypt(orgEcPriKey, encryptedUuidCipherText)
        uuids.push(uuid.toString())
      } catch (suppressedError) {
        failedDecryptions++
      }
    }

    console.log('uuids:')
    console.log(uuids)

    return uuids
  }

  getEmailsForUuids = async(theUuids) => {

  }


  /**
   * createOrganizationId
   *
   * Notes:  This method generates an organization id and then populates the
   *         Organization Data Table with the newly created organization id.
   *
   *         @return orgId, the newly created organization id
   */
  createOrganizationId = async(aUserUuid, aUserPubKey, aUserPriKey) => {
    const orgId = uuidv4()

    let sub = undefined
    try {
      // Prob don't need to do this as it's done implicitly above for the
      // encrypt with keys.  TODO: something better when time.
      await this.requestIdpCredentials()
      sub = AWS.config.credentials.identityId
    } catch (error) {
      throw Error('ERROR: Failed to get id from Identity Pool.')
    }

    const orgPriKey = eccrypto.generatePrivate()
    const orgPubKey = eccrypto.getPublic(orgPriKey)
    let priKeyCipherText = undefined
    try {
      priKeyCipherText = await eccrypto.encrypt(aUserPubKey, orgPriKey)
    } catch (error) {
      throw new Error(`ERROR: Creating organization id. Failed to create private key cipher text.\n${error}`)
    }

    if (TEST_ASYMMETRIC_DECRYPT) {
      try {
        const recoveredPriKey =
          await eccrypto.decrypt(aUserPriKey, priKeyCipherText)

        if (recoveredPriKey.toString('hex') !== orgPriKey.toString('hex')) {
          throw new Error(`Recovered private key does not match private key:\nrecovered:${recoveredPriKey[0].toString('hex')}\noriginal:${orgPriKey.toString('hex')}\n`);
        }
      } catch (error) {
        throw new Error(`ERROR: testing asymmetric decryption.\n${error}`)
      }
    }

    const organizationDataRowObj = {
      org_id: orgId,
      cryptography: {
        pub_key: orgPubKey,
        pri_key_ciphertexts: {
          [ aUserUuid ] : priKeyCipherText,
        }
      },
      owner: {
        sub: sub,
        uuid: aUserUuid,
      },
      members: [],
      apps: {}
    }

    try {
      await organizationDataTablePut(organizationDataRowObj)
    } catch(error) {
      throw Error(`ERROR: Creating organization id.\n${error}`)
    }

    return orgId
  }

  createSidObject = async() => {
    if (!this.appIsSimpleId) {
      return {}
    }

    const priKey = eccrypto.generatePrivate()
    const pubKey = eccrypto.getPublic(priKey)
    const priKeyCipherText =
      await this.encryptWithKmsUsingIdpCredentials(this.keyId1, priKey)

    const orgId = await this.createOrganizationId(this.persist.userUuid, pubKey, priKey)

    let sidObj = {
      org_id: orgId,
      pub_key: pubKey,
      pri_key_cipher_text: priKeyCipherText,
      apps: {}
    }

    this.persist.sid = sidObj
    this.neverPersist.priKey = priKey

    return sidObj
  }

  /**
   * createAppId
   *
   * Notes:  This method generates an app id and then populates the
   *         Organization Data Table and Wallet Analytics Tables with the
   *         newly created organization id.
   */
  createAppId = async(anOrgId, anAppObject) => {
    // await this.getUuidsForWalletAddresses()
    // return
    // TODO: 1. Might want to check if the user has the org_id in their sid
    //       user data property.
    //       2. Might want to check if the user is listed as a member in the
    //       org data table.
    //       3. Use update to do the assignment (right now we're doing the
    //       horrible read--modify--clobber-write)
    //       4. Def check to make sure the same app id doesn't exist / collide
    //       in the wallet analytics table

    const appId = uuidv4()

    // 1. Update the Organization Data table:
    //
    let orgData = undefined
    try {
      // TODO: See TODO.3 above!
      orgData = await organizationDataTableGet(anOrgId)
      orgData.Item.apps[appId] = anAppObject
      await organizationDataTablePut(orgData.Item)
    } catch (error) {
      throw new Error(`ERROR: Failed to update apps in Organization Data table.\n${error}`)
    }

    // 1.5 Get the public key
    //
    let publicKey = undefined
    try {
      publicKey = orgData.Item.cryptography.pub_key
    } catch (error) {
      throw new Error(`Error: Failed to fetch public key from Org Data.\n${error}`)
    }

    // 2. Update the Wallet Analytics Data table
    //
    try {
      const walletAnalyticsRowObj = {
        app_id: appId,
        org_id: anOrgId,
        public_key: publicKey,
        analytics: {}
      }
      await walletAnalyticsDataTablePut(walletAnalyticsRowObj)
    } catch (error) {
      throw new Error(`ERROR: Failed to add row Wallet Analytics Data table.\n${error}`)
    }

    // AC: Not sure if this is needed.
    // // 3. TODO: Update the user data using Cognito IDP (the 'sid' property)
    // //
    // await this.tableUpdateWithIdpCredentials('sid', 'apps', appId, {})

    return appId
  }

  /**
   * deleteAppId
   *
   * Notes:  This method removes an app id from the
   *         Organization Data Table and Wallet Analytics Tables with the
   *         newly created organization id.
   *
   *         It does not remove the app id from the User Data table, the
   *         Unauthenticated UUID table, or the Wallet to UUID Map table.
   */
  deleteAppId = async() => {
    // TODO deleteAppId
  }

  /**
   * signUserUpToNewApp
   *
   * Notes:  If a user has or has not joined Simple ID Cognito's user pool, there
   *         is still the matter of creating their data pertaining to the app
   *         they signed in from.
   *
   *         This method inserts the appId related data into the User Data table
   *         or Unauthenticated UUID table (depending on if they're using us for
   *         auth), and the Wallet Analytics Data table and Wallet to UUID Map
   *         table.
   *
   * TODO:
   *       - Failure resistant db write methods.
   *       - Concurrency and an await Promise.all () with handled
   *         catch statements on individual promises.
   */
  signUserUpToNewApp = async(isAuthenticatedUser) => {
    const hostedApp = this.hostedApp

    //We should only be doing this if the request is coming from a regular app.
    //If the request is coming from wallet.simpleid.xyz, the experience needs to be
    //different.
    if(hostedApp === true) {
      return
    }

    if (isAuthenticatedUser) {
      // 1.a) Update the User Data Table if the user is authenticated.
      //
      // We do this in the 2nd part of the sign in flow when the user
      // answers a challenge but still need to do the other operations
      // below.
    } else {
      // 1.b) Otherwise update the Unauthenticated UUID Table if the user is an
      //      unauthenticated user.
      //
      await unauthenticatedUuidTableAppendAppId(this.persist.userUuid, this.appId)
    }

    // 2. Update the Wallet Analytics Data table:
    //
    await walletAnalyticsDataTableAddWalletForAnalytics(this.persist.address, this.appId)

    // 3. Update the Wallet to UUID Map table:
    //
    const appPublicKey = await walletAnalyticsDataTableGetAppPublicKey(this.appId)
    const userUuidCipherText =
      await eccrypto.encrypt(appPublicKey, Buffer.from(this.persist.userUuid))

    await walletToUuidMapTableAddCipherTextUuidForAppId(
      this.persist.address, userUuidCipherText, this.appId)
  }

/******************************************************************************
 *                                                                            *
 * Non-SimpleID Wallet User Methods                                           *
 *                                                                            *
 ******************************************************************************/

 persistNonSIDUserInfo = async (userInfo) => {
   if (this.appIsSimpleId) {
     // We don't do this in Simple ID.
     return
   }

   const { email, address } = userInfo
   this.persist.email = email
   this.persist.address = address

   // Check to see if this user exists in Unauthenticated UUID table (email key
   // is also indexed):
   const uuidResults = await unauthenticatedUuidTableQueryByEmail(email)
   const userExists = (uuidResults.Items.length === 1)
   if (uuidResults.Items.length !== 0 && uuidResults.Items.length !== 1) {
     throw new Error('ERROR: collision with user in Simple ID unauth\'d user table.')
   }

   if (!userExists) {
     // The unauthenticated user does not exist in our data model. Initialize and
     // create DB entries for them:
     //
     // 1. Create a uuid for this user and insert them into the
     //    Unauthenticated UUID table:
     //
     // TODO:
     //       - think about obfusicating the email due to the openness of this table.
     //       - Refactor to createUnauthenticatedUser
     //
     this.persist.userUuid = uuidv4()
     const unauthenticatedUuidRowObj = {
       uuid: this.persist.userUuid,
       email,
       apps: [ this.appId ]
     }
     await unauthenticatedUuidTablePut(unauthenticatedUuidRowObj)

     // 2. Create an entry for them in the Wallet Analytics Data Table
     //
     await walletAnalyticsDataTableAddWalletForAnalytics(this.persist.address, this.appId)

     // 3. Create an entry for them in the Wallet to UUID Map
     //
     // TODO: Fetch the public key for the row corresponding to this app_id
     //       from the simple_id_cust_analytics_data_v001 table and use it
     //       to asymmetricly encrypt the user uuid. For now we just pop in
     //       the plain text uuid.
     //
     const appPublicKey = await walletAnalyticsDataTableGetAppPublicKey(this.appId)
     const userUuidCipherText = await eccrypto.encrypt(
       appPublicKey, Buffer.from(this.persist.userUuid))

     const walletUuidMapRowObj = {
       wallet_address: address,
       app_to_enc_uuid_map: {
         [ this.appId ] : userUuidCipherText
       }
     }
     //
     // TODO: Make this use Cognito to get write permission to the DB (for the
     //       time being we're using an AWS_SECRET):
     // TODO: Make this update / append when needed too (here it's new data so it's okay)
     await walletToUuidMapTablePut(walletUuidMapRowObj)
   } else {
     // TODO Refactor to persistUnauthenticatedUser
     //
     this.persist.userUuid = uuidResults.Items[0].uuid

     // 1. Fetch the email & apps from the Unauthenticated UUID table and ensure
     //    this app is listed.
     //
     const unauthdUuidRowObj = await unauthenticatedUuidTableGetByUuid(this.persist.userUuid)

     // BEGIN REMOVE
     const oldAppId = this.appId
     if (TEST_SIGN_USER_UP_TO_NEW_APP) {
       console.log('************************ REMOVE WHEN WORKING ***************')
       console.log('* Faking a new AppId to build signUserUpToNewApp           *')
       console.log('************************************************************')
       this.appId = `new-app-id-random-${Date.now()}`
     }
     // See also: BEGIN REMOVE ~10 lines down
     // END REMOVE

     if ( !unauthdUuidRowObj.Item.apps.includes(this.appId) ) {
       // The App doesn't exist in the user's profile (this is the first time
       // the user is using it). Update the Unauthenticated UUID table,
       // Wallet Analytics Data table, and Wallet to UUID tables.
       const authenticatedUser = false
       await this.signUserUpToNewApp(authenticatedUser)
     }

     // BEGIN REMOVE
     // restore appId
     this.appId = oldAppId
     // END REMOVE
   }

   // TODO: this needs to be obfuscated. It should also use a common method with
   //       our other flow persistence. The data should also be stored in this.persist
   //
   // TODO: Justin, why not use SID_SVCS_LS_KEY and add a boolean to the object
   //       indicating unauthenticatedUser (i.e. non wallet)?
   //
   //TODO: AC review. This feels super hacky, but might be the right way to handle it
   localStorage.setItem(NON_SID_WALLET_USER_INFO, JSON.stringify(userInfo));


 }

 getNonSIDUserInfo() {
   const userInfo = localStorage.getItem(NON_SID_WALLET_USER_INFO);
   return JSON.parse(userInfo);
 }

/******************************************************************************
 *                                                                            *
 * Cognito Related Methods                                                    *
 *                                                                            *
 ******************************************************************************/

  // TODO: need a way to shortcut this if we already have the credentials
  requestIdpCredentials = async (
      aRegion:string=process.env.REACT_APP_REGION,
      aUserPoolId:string=process.env.REACT_APP_USER_POOL_ID,
      anIdentityPoolId:string=process.env.REACT_APP_IDENTITY_POOL_ID ) => {

    const session = await Auth.currentSession()

    AWS.config.region = aRegion
    const data = { UserPoolId: aUserPoolId }
    const cognitoLogin = `cognito-idp.${AWS.config.region}.amazonaws.com/${data.UserPoolId}`
    const logins = {}
    logins[cognitoLogin] = session.getIdToken().getJwtToken()

    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: anIdentityPoolId,
      Logins: logins
    })

    // Modified to use getPromise from:
    //    https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html#get-property
    //
    await AWS.config.credentials.getPromise()
  }



/******************************************************************************
 *                                                                            *
 * HSM / KMS Related Methods                                                  *
 *                                                                            *
 ******************************************************************************/

  encryptWithKmsUsingIdpCredentials = async (keyId, plainText) => {
    await this.requestIdpCredentials()

    // Now that the AWS creds are configured with the cognito login above, we
    // should be able to access the KMS key if we got the IAMs users/roles/grants
    // correct.
    const kms = new AWS.KMS( { region : process.env.REACT_APP_REGION } )

    const cipherText = await new Promise((resolve, reject) => {
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

    return cipherText
  }


  decryptWithKmsUsingIdpCredentials = async (cipherText) => {
    await this.requestIdpCredentials()

    // Now that the AWS creds are configured with the cognito login above, we
    // should be able to access the KMS key if we got the IAMs users/roles/grants
    // correct.
    const kms = new AWS.KMS( {region:'us-west-2'} )

    const plainText = await new Promise((resolve, reject) => {
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

    return plainText
  }



/******************************************************************************
 *                                                                            *
 * DynamoDB Methods                                                           *
 *                                                                            *
 ******************************************************************************/

  // TODO:  For the table* methods below:
  //  - clean up, refactor, sensible accessors to commonly used tables
  //  - better separation and re-use with cognito

  // TODO: abstract the restricted sub out of this code so it's more generic and
  //       not just for restricted row access dynamos.
  tableGetWithIdpCredentials = async () => {
    await this.requestIdpCredentials()

    let sub = undefined
    try {
      sub = AWS.config.credentials.identityId
    } catch (error) {
      throw Error(`ERROR: getting credential identityId.\n${error}`)
    }

    const docClient = new AWS.DynamoDB.DocumentClient({
      region: process.env.REACT_APP_REGION })

    const dbParams = {
      Key: {
        sub: sub
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

    return awsDynDbRequest
  }

  tablePutWithIdpCredentials = async (keyValueData) => {
    // Adapted from the JS on:
    //    https://aws.amazon.com/blogs/mobile/building-fine-grained-authorization-using-amazon-cognito-user-pools-groups/
    //
    await this.requestIdpCredentials()

    // Modified to use getPromise from:
    //    https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html#get-property
    //
    let sub = undefined
    try {
      sub = AWS.config.credentials.identityId
    } catch (error) {
      throw Error(`ERROR: getting credential identityId.\n${error}`)
    }

    const docClient = new AWS.DynamoDB.DocumentClient(
      { region: process.env.REACT_APP_REGION })

    const item = {
      sub: sub
    }
    for (const k in keyValueData) {
      item[k] = keyValueData[k]
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

    return awsDynDbRequest
  }

  // TODO: might not be needed (Read Modify Write might be sufficient)
  //       hold on to this for the time being:
  //
  // // Rename: adapeted from dynamoBasics method tableUpdateAppendNestedObjectProperty
  // tableUpdateWithIdpCredentials = async (aNestedObjKey, a2ndNestedObjKey, aPropName, aPropValue) => {
  //   // Adapted from the JS on:
  //   //    https://aws.amazon.com/blogs/mobile/building-fine-grained-authorization-using-amazon-cognito-user-pools-groups/
  //   //
  //   await this.requestIdpCredentials()
  //
  //   // Modified to use getPromise from:
  //   //    https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html#get-property
  //   //
  //   let sub = undefined
  //   try {
  //     sub = AWS.config.credentials.identityId
  //   } catch (error) {
  //     throw Error(`ERROR: getting credential identityId.\n${error}`)
  //   }
  //
  //   const docClient = new AWS.DynamoDB.DocumentClient(
  //     { region: process.env.REACT_APP_REGION })
  //
  //
  //   // Taken from dynamoBasics method tableUpdateAppendNestedObjectProperty
  //   const dbParams = {
  //     TableName: process.env.REACT_APP_UD_TABLE,
  //     Key: {
  //       sub: sub
  //     },
  //     UpdateExpression: 'set #objName.#objName2.#objPropName = :propValue',
  //     ExpressionAttributeNames: {
  //       '#objName': aNestedObjKey,
  //       '#objName2': a2ndNestedObjKey,
  //       '#objPropName': aPropName
  //     },
  //     ExpressionAttributeValues: {
  //       ':propValue': aPropValue
  //     },
  //     ReturnValues: 'NONE'
  //   }
  //
  //   const awsDynDbRequest = await new Promise(
  //     (resolve, reject) => {
  //       docClient.update(dbParams, (err, data) => {
  //         if (err) {
  //           dbRequestDebugLog('tableUpdateWithIdpCredentials', dbParams, err)
  //
  //           reject(err)
  //         } else {
  //           resolve(data)
  //         }
  //       })
  //     }
  //   )
  //
  //   return awsDynDbRequest
  // }
}
