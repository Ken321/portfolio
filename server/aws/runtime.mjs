import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createHandlers } from './core.mjs';
const options={maxAttempts:2};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(options));
const sqs=new SQSClient(options),ssm=new SSMClient(options);
const TableName=process.env.TABLE_NAME;
const store={
  async get(token){return (await db.send(new GetCommand({TableName,Key:{pk:`call#${token}`},ConsistentRead:true}))).Item;},
  async reserve(token,now,limit){
    const day=new Date(now).toISOString().slice(0,10);
    for(let slot=0;slot<2;slot++) {
      try {
        await db.send(new TransactWriteCommand({ClientRequestToken:`${token.slice(0,30)}-${slot}`,TransactItems:[
          {Update:{TableName,Key:{pk:`day#${day}`},UpdateExpression:'SET #n = if_not_exists(#n, :zero) + :one, expiresAt = :ttl',ConditionExpression:'attribute_not_exists(#n) OR #n < :limit',ExpressionAttributeNames:{'#n':'count'},ExpressionAttributeValues:{':zero':0,':one':1,':limit':limit,':ttl':Math.floor(now/1000)+172800}}},
          // Slots do not expire automatically: failed cleanup fails closed until investigated.
          {Put:{TableName,Item:{pk:`slot#${slot}`,token},ConditionExpression:'attribute_not_exists(pk)'}},
          {Put:{TableName,Item:{pk:`call#${token}`,slot,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}}
        ]}));return slot;
      } catch(e){if(e.name!=='TransactionCanceledException')throw e;
        if(!e.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed'))throw e;}
    }return null;
  },
  async activate(token,id){await db.send(new UpdateCommand({TableName,Key:{pk:`call#${token}`},UpdateExpression:'SET id = :id',ConditionExpression:'attribute_exists(pk)',ExpressionAttributeValues:{':id':id}}));},
  async release(token,slot){
    try {await db.send(new TransactWriteCommand({TransactItems:[
      {Delete:{TableName,Key:{pk:`slot#${slot}`},ConditionExpression:'#t = :token',ExpressionAttributeNames:{'#t':'token'},ExpressionAttributeValues:{':token':token}}},
      {Delete:{TableName,Key:{pk:`call#${token}`}}}
    ]}));}catch(e){if(e.name!=='TransactionCanceledException')throw e;
      // Concurrent end and delayed jobs may already have removed this call.
      if(await store.get(token))throw e;}
  }
};
let secret,secretUntil=0;
async function getKey(){
  if(secret && Date.now()<secretUntil)return secret;
  const r=await ssm.send(new GetParameterCommand({Name:process.env.API_KEY_PARAMETER,WithDecryption:true}));
  if(!r.Parameter?.Value)throw Error('missing_key');
  secret=r.Parameter.Value;secretUntil=Date.now()+300000;return secret;
}
const handlers=createHandlers({store,getKey,env:process.env,queue:(token,delay)=>sqs.send(new SendMessageCommand({QueueUrl:process.env.QUEUE_URL,MessageBody:JSON.stringify({token}),DelaySeconds:delay}))});
export const api=handlers.api;
export const worker=handlers.worker;
