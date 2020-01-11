import { Auth } from 'aws-amplify'
import Amplify from 'aws-amplify';

import { walletAnalyticsDataTablePut,
         walletToUuidMapTablePut,
         organizationDataTableGet,
         organizationDataTablePut,
         unauthenticatedUuidTableQueryByEmail,
         unauthenticatedUuidTableGetByUuid,
         unauthenticatedUuidTablePut,
         unauthenticatedUuidTableAppendAppId,
         walletToUuidMapTableAddCipherTextUuidForAppId,
         walletAnalyticsDataTableAddWalletForAnalytics } from './dynamoConveniences.js'

const AWS = require('aws-sdk')
const ethers = require('ethers')

const NON_SID_WALLET_USER_INFO = "non-sid-user-info";

// v4 = random. Might consider using v5 (namespace, in conjunction w/ app id)
// see: https://github.com/kelektiv/node-uuid
const uuidv4 = require('uuid/v4')

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

AWS.config.update({ region: process.env.REACT_APP_REGION })


const SID_ANALYTICS_APP_ID = '00000000000000000000000000000000'

// TODO: move these to dynamo / lambda system in milestone 2
const KEY_FARM_IDS = [
  '66d158b8-ecbd-4962-aedb-15d5dd4024ee',   // Key 0
  '2fe4d745-6685-4581-93ca-6fd7aff92426',   // Key 1
  'ba920788-7c6a-4553-b804-958870279f53'    // Key 2
]

/*******************************************************************************
 * Test Switches - Remove / Disable in Production
 ******************************************************************************/
const TEST_SIGN_USER_UP_TO_NEW_APP = false


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

// Local storage key for sid services data and static symmetric encryption
// key obfuscate locally stored data:
const SID_SVCS_LS_KEY = 'SID_SVCS'
//const SID_SVCS_LS_ENC_KEY = 'fsjl-239i-sjn3-wen3' TODO: AC code, do we need this? Wasn't being used
//                                                        Justin: - this is going to get used to obfuscate
//                                                                  our local store when everything's done.

/**
 * jsonParseToBuffer:
 *
 * Notes:
 *    Adapted from: https://stackoverflow.com/questions/34557889/how-to-deserialize-a-nested-buffer-using-json-parse
 *
 * TODO:
 *        1. Refactor to common area.
 *
 */
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
    this.cognitoUser = undefined
    this.signUpUserOnConfirm = false

    this.keyId1 = undefined
    this.keyId2 = undefined

    this.appId = anAppId
    this.appIsSimpleId = (this.appId === SID_ANALYTICS_APP_ID )

    // Probably want to move this into this.persist below:
    this.userUuid = undefined

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

  getAddress() {
    return this.persist.address
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
    // If the user is already authenticated, then skip this function.
    const authenticated = await this.isAuthenticated(anEmail)
    if (authenticated) {
      // TODO: Might need to handle the UI (i.e. waiting on challenge is not
      //       needed if we're returning here.)
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
        password: SidServices._getRandomString(30),
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
   * TODO:
   *        1. What is the best thing to do here?
   *             - clobber the token and sign out?
   *             - block specific calling appId?
   */
  signOut = async () => {
    try {
      await Auth.signOut()
    } catch (error) {
      throw Error(`ERROR: Signing out encounted an error.\n${error}`)
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
    try {
      this.cognitoUser =
        await Auth.sendCustomChallengeAnswer(this.cognitoUser, anAnswer)
    } catch (error) {
      console.log("CUSTOM CHALLENGE ERROR: ", error)
      throw error
    }

    // The user has entered a challenge answer and no error occured. Now test
    // to see if they are authenticated into Cognito (i.e. have a valid token):
    const authenticated = await this.isAuthenticated()

    if (authenticated && this.signUpUserOnConfirm) {
      // Phase 2 of signUp flow:
      //////////////////////////

      try {
        //  0. Generate uuid
        //
        this.userUuid = uuidv4()

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
          await this.encryptKeyAssignmentWithIdpCredentials(this.keyId1, shares[0])
        this.persist.secretCipherText2 =
          await this.encryptKeyAssignmentWithIdpCredentials(this.keyId2, shares[1])

        //  4. a)  Create and store entry in Organization Data (simple_id_org_data_v001)
        //         the this.appIsSimpleId
        //
        let orgId = (this.appIsSimpleId) ?
          await this.createOrganizationId(this.userUuid) : undefined

        //  4. b) Create and store User Data (simple_id_auth_user_data_v001)
        //
        const userDataRow = {
          // sub: <cognito idp sub>  is implicitly added to this in call to tablePutWithIdpCredentials below.
          uuid: this.userUuid,
          email: this.persist.email,
          secretCipherText1: this.persist.secretCipherText1,
          secretCipherText2: this.persist.secretCipherText2,
          apps: {},
          sid: {},
          address: this.persist.address,
        }
        userDataRow.apps[this.appId] = {}   // Empty Contact Prefs Etc.
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
        if (this.appIsSimpleId) {
          userDataRow.sid['org_id'] = orgId
          this.persist['sid'] = {};
          this.persist.sid['org_id'] = orgId;
        }
        // Write this to the user data table:
        await this.tablePutWithIdpCredentials( userDataRow )

        //  4. c)  Create and store entry in Wallet to UUID map for this app
        //         (simple_id_wallet_uuid_map_v001)
        //
        // TODO: Fetch the public key for the row corresponding to this app_id
        //       from the simple_id_cust_analytics_data_v001 table and use it
        //       to asymmetricly encrypt the user uuid. For now we just pop in
        //       the plain text uuid.

        //TODO: Review this with AC

        // if (!this.appIsSimpleId) {
          const plainTextUuid = this.userUuid
          const walletUuidMapRow = {
            wallet_address: this.persist.address,
            app_to_enc_uuid_map: {}
          }
          walletUuidMapRow.app_to_enc_uuid_map[this.appId] = plainTextUuid    // TODO Enc this!
          //
          // TODO: Make this use Cognito to get write permission to the DB (for the
          //       time being we're using an AWS_SECRET):
          // TODO: Make this update / append when needed too (here it's new data so it's okay)
          await walletToUuidMapTablePut(walletUuidMapRow)
        // }

        //  4. d)  Create and store Wallet Analytics Data
        //         (simple_id_cust_analytics_data_v001)
        //

        //TODO: Review this with AC

        await walletAnalyticsDataTableAddWalletForAnalytics(
          this.persist.address, this.appId)

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
      // Phase 2 of signIn flow:
      //////////////////////////

      // 1. Fetch the encrypted secrets from Dynamo
      //
      const userDataDbRow = await this.tableGetWithIdpCredentials()
      const userData = userDataDbRow.Item
      console.log("USER DATA FROM EXISTING USER: ", userData);
      this.persist.secretCipherText1 = userData.secretCipherText1
      this.persist.secretCipherText2 = userData.secretCipherText2

      // 2. Decrypt the secrets on the appropriate HSM KMS CMKs
      //
      const secretPlainText1 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText1)
      const secretPlainText2 =
        await this.decryptKeyAssignmentWithIdpCredentials(this.persist.secretCipherText2)

      // 3. Merge the secrets to recover the keychain
      //
      const secretMnemonic = SSS.combine([secretPlainText1, secretPlainText2])

      // 4. Inflate the wallet and persist it to state.
      //
      const mnemonicStr = secretMnemonic.toString()
      this.neverPersist.wallet = new ethers.Wallet.fromMnemonic(mnemonicStr)
      this.persist.address = this.neverPersist.wallet.address

      this.userUuid = userData.uuid

      let userDataDbNeedsUpdate = false
      // 4.1 Here Justin appears to be checking if a user has sid data and
      //     adds that to the perstence model, otherwise he check if the app is
      //     simpleID and creates and stores it in the User Data DB.
      if(userData && userData.sid && userData.sid.org_id) {
        this.persist.sid = userData && userData.sid ? userData.sid : null;
      } else {
        //If this is coming from the SimpleID app, need to make sure a user that may have existed before
        //can still create an org
        if (this.appIsSimpleId) {
          let orgId = (this.appIsSimpleId) ?
            await this.createOrganizationId(this.userUuid) : undefined
          this.persist['sid'] = {};
          this.persist.sid['org_id'] = orgId;
          userData['sid'] = {};
          userData.sid['org_id'] = orgId;
          userDataDbNeedsUpdate = true
        } else {
          this.persist['sid'] = userData.sid;
        }
      }

      // 5. If the user has never signed into this App before, we need to update
      //    the appropriate tables with the user's data:
      //
      /* REMOVE Test code when working ****************************************/
      const oldAppId = this.appId
      if (TEST_SIGN_USER_UP_TO_NEW_APP) {
        this.appId = `new-app-id-random-authd-${Date.now()}`
      }
      // See also: BEGIN REMOVE ~10 lines down
      /* END REMOVE ***********************************************************/
      if (!userData.apps.hasOwnProperty(this.appId)) {
        console.log('First time logging into this app, updating associate DBs')
        userData.apps[this.appId] = {}
        userDataDbNeedsUpdate = true

        const authenticatedUser = true
        await this.signUserUpToNewApp(authenticatedUser)
      }
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

      // TODO: Justin solution to persist (local storage in encrypted state so
      //       no need to hit AWS (faster, cheaper))
      console.log('DBG: DELETE this comment after debugging / system ready')
      console.log('*******************************************************')
      console.log('Eth Wallet:')
      console.log(this.neverPersist.wallet)
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



/******************************************************************************
 *                                                                            *
 * SimpleID Analytics Tool Related Methods                                    *
 *                                                                            *
 ******************************************************************************/

  /**
   * createOrganizationId
   *
   * Notes:  This method generates an organization id and then populates the
   *         Organization Data Table and User Data Tables with the
   *         newly created organization id.
   */
  createOrganizationId = async(aUserUuid) => {
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

    const organizationDataRowObj = {
      org_id: orgId,
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

  /**
   * createAppId
   *
   * Notes:  This method generates an app id and then populates the
   *         Organization Data Table and Wallet Analytics Tables with the
   *         newly created organization id.
   */
  createAppId = async(anOrgId, anAppName) => {
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
    try {
      // TODO: See TODO.3 above!
      const data = await organizationDataTableGet(anOrgId)
      data.Item.apps[appId] = anAppName
      await organizationDataTablePut(data.Item)
    } catch (error) {
      throw new Error(`ERROR: Failed to update apps in Organization Data table.\n${error}`)
    }

    // 2. Update the Wallet Analytics Data table
    //
    try {
      const walletAnalyticsRowObj = {
        app_id: appId,
        org_id: anOrgId,
        public_key: 'TODO: generate a key pair for the org and propagate that to here',
        analytics: {}
      }
      // TODO: remove example data below
      for (let i = 0; i <= 4; i++) {
        const walletAddr = SidServices._getRandomString(32)
        walletAnalyticsRowObj.analytics[walletAddr] = {
          event: 'sign-up',
          utc: Date.now()
        }
      }
      await walletAnalyticsDataTablePut(walletAnalyticsRowObj)
    } catch (error) {
      throw new Error(`ERROR: Failed to add row Wallet Analytics Data table.\n${error}`)
    }

    // 3. TODO: Update the user data using Cognito IDP (the 'sid' property)
    //
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
    // TODO
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
    console.log(`DBG: signUserUpToNewApp`)
    console.log('-------------------------------------------------------------')
    console.log(`  isAuthenticatedUser: ${isAuthenticatedUser}`)
    console.log(`  this.appId: ${this.appId}`)
    console.log(`  this.userUuid: ${this.userUuid}`)
    console.log(`  address: ${this.persist.address}`)

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
      console.log(`DBG: Appending ${this.appId} to ${this.userUuid}`)
      await unauthenticatedUuidTableAppendAppId(this.userUuid, this.appId)
    }

    // 2. Update the Wallet Analytics Data table:
    //
    // TODO:
    console.log('before walletAnalyticsDataTableAddWalletForAnalytics')
    await this.walletAnalyticsDataTableAddWalletForAnalytics()
    console.log('after walletAnalyticsDataTableAddWalletForAnalytics')

    // 3. Update the Wallet to UUID Map table:
    //
    // TODO: need to encrypt the uuid with the app devs PK
    //
    const plainTextUuid = this.userUuid   // TODO: Encrypt!!!
     await walletToUuidMapTableAddCipherTextUuidForAppId(
       this.persist.address, plainTextUuid, this.appId)
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

   console.log("NON SID USER INFO: ", userInfo);

   const { email, address } = userInfo
   this.persist.email = email
   this.persist.address = address

   // Check to see if this user exists in Unauthenticated UUID table (email key
   // is also indexed):
   const uuidResults = await unauthenticatedUuidTableQueryByEmail(email)
   let userExists = false
   if (uuidResults.Items.length === 1) {
     userExists = true
   } else if (uuidResults.Items.length !== 0) {
     throw new Error('ERROR: collision with user in Simple ID unauth\'d user table.')
   }

   if (!userExists) {
     // TODO Refactor to createUnauthenticatedUser
     //
     // The unauthenticated user does not exist in our data model. Initialize and
     // create DB entries for them:
     //
     // 1. Create a uuid for this user and insert them into the
     //    Unauthenticated UUID table:
     //
     // TODO:
     //       - think about obfusicating the email due to the openness of this table.
     //
     this.userUuid = uuidv4()
     const unauthenticatedUuidRowObj = {
       uuid: this.userUuid,
       email,
       apps: [ this.appId ]
     }
     console.log('trying to put unauthenticatedUuidRowObj')
     console.log(unauthenticatedUuidRowObj)
     await unauthenticatedUuidTablePut(unauthenticatedUuidRowObj)
     console.log('success')

     // 2. Create an entry for them in the Wallet Analytics Data Table
     //
     await this.walletAnalyticsDataTableAddWalletForAnalytics()

     // 3. Create an entry for them in the Wallet to UUID Map
     //
     // TODO: Fetch the public key for the row corresponding to this app_id
     //       from the simple_id_cust_analytics_data_v001 table and use it
     //       to asymmetricly encrypt the user uuid. For now we just pop in
     //       the plain text uuid.
     //
     const plainTextUuid = this.userUuid
     const walletUuidMapRowObj = {
       wallet_address: address,
       app_to_enc_uuid_map: {}
     }
     //
     // TODO: Make this use Cognito to get write permission to the DB (for the
     //       time being we're using an AWS_SECRET):
     // TODO: Make this update / append when needed too (here it's new data so it's okay)
     walletUuidMapRowObj.app_to_enc_uuid_map[this.appId] = plainTextUuid    // TODO Enc this!
     console.log('trying to put walletUuidMapRowObj')
     console.log(walletUuidMapRowObj)
     await walletToUuidMapTablePut(walletUuidMapRowObj)
     console.log('success')
   } else {
     // TODO Refactor to persistUnauthenticatedUser
     //
     this.userUuid = uuidResults.Items[0].uuid
     console.log('DBG: USER EXISTS, uuid = ')
     console.log(this.userUuid)

     // 1. Fetch the email & apps from the Unauthenticated UUID table and ensure
     //    this app is listed.
     //
     const unauthdUuidRowObj =
       await unauthenticatedUuidTableGetByUuid(this.userUuid)

     console.log('Fetched unauthdUuidRowObj:')
     console.log(JSON.stringify(unauthdUuidRowObj))

     // BEGIN REMOVE
     console.log('************************ REMOVE WHEN WORKING ***************')
     console.log('* Faking a new AppId to build signUserUpToNewApp           *')
     console.log('************************************************************')
     const oldAppId = this.appId
     if (TEST_SIGN_USER_UP_TO_NEW_APP) {
       this.appId = `new-app-id-random-${Date.now()}`
     }
     // See also: BEGIN REMOVE ~10 lines down
     // END REMOVE

     if ( !unauthdUuidRowObj.Item.apps.includes(this.appId) ) {
       console.log('New App ID detected, must add this app to tables ....')
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



/******************************************************************************
 *                                                                            *
 * HSM / KMS Related Methods                                                  *
 *                                                                            *
 ******************************************************************************/

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
    console.log('tableGetWithIdpCredentials')
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

  tablePutWithIdpCredentials = async (kvData) => {
    // Adapted from the JS on:
    //    https://aws.amazon.com/blogs/mobile/building-fine-grained-authorization-using-amazon-cognito-user-pools-groups/
    //
    console.log('tablePutWithIdpCredentials')
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
  }

  tableUpdateWithIdpCredentials = async () => {
    // TODO: a fast efficient update of a dynamo table auth'd with IDP creds.
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
