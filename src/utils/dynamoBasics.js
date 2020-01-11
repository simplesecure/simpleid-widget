const AWS = require('aws-sdk')

// TODO TODO TODO TODO
// This is for quick dev, remove this and use Cognito to assign role based access
// through IDP (at least within the iFrame) lest we mess things up with
// confliting perms and excess access:
//
AWS.config.update({
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  region: process.env.REACT_APP_REGION
})
//
// _docClientAK: AK --> AWS Access Key Credentialing (vs. Cognito Credentials).
//
const _docClientAK = new AWS.DynamoDB.DocumentClient()



export async function tableGet(aTable, aKeyName, aKeyValue) {
  const params = {
    TableName: aTable,
    Key: {}
  }
  params.Key[aKeyName] = aKeyValue

  return new Promise((resolve, reject) => {
    _docClientAK.get(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

export async function tablePut(aTable, anObject) {
  const params = {
    TableName: aTable,
    Item: anObject
  }

  return new Promise((resolve, reject) => {
    _docClientAK.put(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}



// Adapted from: https://stackoverflow.com/questions/51134296/dynamodb-how-to-query-a-global-secondary-index
//
export async function tableGetBySecondaryIndex(aTable, anIndexName, aKeyName, aKeyValue) {

  const expressionAtrNameObj = {}
  expressionAtrNameObj[`#${aKeyName}`] = aKeyName

  var params = {
    TableName : aTable,
    IndexName : anIndexName,
    KeyConditionExpression: `#${aKeyName} = :value`,
    ExpressionAttributeNames: expressionAtrNameObj,
    ExpressionAttributeValues: {
        ':value': aKeyValue
    }
  }

  return new Promise((resolve, reject) => {
    _docClientAK.query(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

// Reference this to make the list_append function work in update set eqn:
//   - https://stackoverflow.com/questions/44219664/inserting-a-nested-attributes-array-element-in-dynamodb-table-without-retrieving
//   - https://stackoverflow.com/questions/41400538/append-a-new-object-to-a-json-array-in-dynamodb-using-nodejs
//   -
export async function tableUpdateListAppend(aTable, aPrimKeyObj, anArrayKey, anArrayValue) {
  console.log('DBG: tableUpdateListAppend')
  console.log(`  aTable:${aTable},\n  aPrimKeyObj:${aPrimKeyObj},\n  anArrayKey:${anArrayKey},\n  anArrayValue:${anArrayValue}`)
  const exprAttr = ':eleValue'
  const updateExpr = `set ${anArrayKey} = list_append(${anArrayKey}, ${exprAttr})`

  const params = {
    TableName: aTable,
    Key: aPrimKeyObj,
    UpdateExpression: updateExpr,
    ExpressionAttributeValues: {
      ':eleValue': [anArrayValue]
    },
    ReturnValues:"NONE"
  }

  console.log('DBG: params')
  console.log(params)

  return new Promise((resolve, reject) => {
    _docClientAK.update(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

/* tableUpdateAppendNestedObjectProperty:
 *
 * Notes: Adds a new property to an object in a Dynamo Table row. Consider
 *        this example row:
 *        {
 *          <some primary key>: <some value>,
 *          'my_object_name': {
 *            'key1': 'value1',
 *            'key2': 'value2'
 *          }
 *        }
 *
 *        Calling this method with:
 *          aPrimKeyObj = {<some primary key>: <some value>}
 *          aNestedObjKey = 'my_object_name'
 *          aPropName = 'key3'
 *          aPropValue = 'value3'
 *
 *        Would result in Dynamo containing this row:
 *        {
 *          <some primary key>: <some value>,
 *          'my_object_name': {
 *            'key1': 'value1',
 *            'key2': 'value2',
 *            'key3': 'value3'
 *          }
 *        }
 *
 * Further Reading:
 *   - https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html
 *   - https://stackoverflow.com/questions/51911927/update-nested-map-dynamodb
 *       - This SO answer is decent as it mentions schema design complexity being a
 *         problem and limitations in Dynamo
 *
 * TODO:
 *   - Bolting a simple parse to this could result in extended nesting
 *     assignments, i.e. pass in something like this for aPropName
 *        'my_object_name.key1.value1'
 *     then separate on '.' and convert to arbitrary length prop names.
 *   - Consider adding existence test logic.
 */
export async function tableUpdateAppendNestedObjectProperty(
  aTable, aPrimKeyObj, aNestedObjKey, aPropName, aPropValue) {

  console.log('DBG: tableUpdateAppendObjectProperty')
  console.log(`  aTable:${aTable}`)
  console.log(`  aPrimKeyObj:${JSON.stringify(aPrimKeyObj)}`)
  console.log(`  aNestedObjKey:${aNestedObjKey}`)
  console.log(`  aPropName:${aPropName}`)
  console.log(`  aPropValue:${aPropValue}`)

  const params = {
    TableName: aTable,
    Key: aPrimKeyObj,
    UpdateExpression: 'set #objName.#objPropName = :propValue',
    ExpressionAttributeNames: {
      '#objName': aNestedObjKey,
      '#objPropName': aPropName
    },
    ExpressionAttributeValues: {
      ':propValue': aPropValue
    },
    ReturnValues: 'UPDATED_NEW'
  }

  console.log("UPDATE PARAMS: ", params);

  return new Promise((resolve, reject) => {
    _docClientAK.update(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}
